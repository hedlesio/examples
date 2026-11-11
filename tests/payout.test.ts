import { describe, expect, test } from "bun:test";
import { bitgo, ECPair, payments } from "@bitgo/utxo-lib";
import { HedlesApiError } from "../src/api.ts";
import { completePayoutSigning, signExternalInputs } from "../src/payout.ts";
import { fundingNetwork } from "../src/swap.ts";
import type { PayoutResponse, SignedActivity, SigningRequest, Stamper } from "../src/types.ts";

const firstBody = '{ "timestampMs": 1760000000000, "payload": "0x01" }';

function signingRequest(id: string, body: string): SigningRequest {
  return { id, body, method: "stampedRequest", signer: "from", transaction: "0x0100" };
}

function payout(signingRequests: SigningRequest[]): PayoutResponse {
  const complete = signingRequests.length === 0;
  return {
    id: "payout-1",
    chain: "base",
    asset: "asset",
    fromAddress: "from",
    additionalFromAddresses: [],
    amount: "1000",
    feeTotal: null,
    swapId: null,
    executionMode: "atomic",
    status: complete ? "broadcast" : "pending",
    txHash: complete ? "0xhash" : null,
    confirmations: 0,
    requiredConfirmations: 1,
    reference: null,
    lastError: null,
    transfers: [],
    createdAt: "2026-07-30T00:00:00.000Z",
    broadcastAt: complete ? "2026-07-30T00:00:01.000Z" : null,
    settledAt: null,
    signingRequests,
  };
}

let clock = 0;
const instantWait = {
  intervalMs: 10,
  timeoutMs: 60_000,
  sleep: async (ms: number) => {
    clock += ms;
  },
  now: () => clock,
};

async function unexpectedRead(): Promise<PayoutResponse> {
  throw new Error("unexpected payout read");
}

const stamper: Stamper = {
  async stamp(input) {
    return {
      stampHeaderName: "X-Stamp",
      stampHeaderValue: `signed:${input}`,
    };
  },
};

describe("completePayoutSigning", () => {
  test("uses the payout id for authorization and transaction rounds", async () => {
    const submissions: Array<{ target: string; requests: SignedActivity[] }> = [];
    const api = {
      getPayout: unexpectedRead,
      async submitPayoutSignatures(target: string, requests: SignedActivity[]) {
        submissions.push({ target, requests });
        if (submissions.length === 1) return payout([signingRequest("round-2", "body-2")]);
        return payout([]);
      },
    };

    const result = await completePayoutSigning(api, payout([signingRequest("round-1", firstBody)]), stamper);

    expect(result.signingRequests).toEqual([]);
    expect(submissions).toEqual([
      {
        target: "payout-1",
        requests: [
          {
            id: "round-1",
            body: firstBody,
            method: "stampedRequest",
            stamp: { name: "X-Stamp", value: `signed:${firstBody}` },
          },
        ],
      },
      {
        target: "payout-1",
        requests: [
          {
            id: "round-2",
            body: "body-2",
            method: "stampedRequest",
            stamp: { name: "X-Stamp", value: "signed:body-2" },
          },
        ],
      },
    ]);
  });

  test("returns immediately when the payout needs no client signature", async () => {
    const initial = payout([]);
    const api = {
      getPayout: unexpectedRead,
      async submitPayoutSignatures(): Promise<PayoutResponse> {
        throw new Error("must not submit signatures");
      },
    };
    const silent: Stamper = {
      async stamp() {
        throw new Error("must not stamp");
      },
    };

    expect(await completePayoutSigning(api, initial, silent)).toBe(initial);
  });

  test("waits for the next round while a Zcash mining-reward payout proves its first transaction", async () => {
    const derivation = signingRequest("derivation", "derivation-body");
    const tx1 = signingRequest("tx1-input-0", "tx1-body");
    const reads = [payout([]), payout([]), payout([tx1])].map((row) => ({ ...row, chain: "zcash" as const }));
    const submitted: string[] = [];
    let read = 0;
    const api = {
      async submitPayoutSignatures(_id: string, requests: SignedActivity[]) {
        submitted.push(requests.map((request) => request.body).join(","));
        if (submitted.length === 1)
          return { ...payout([]), chain: "zcash" as const, status: "pending" as const, txHash: null };
        return { ...payout([]), chain: "zcash" as const, status: "processing" as const, txHash: null };
      },
      async getPayout() {
        const row = reads[read] ?? reads[reads.length - 1]!;
        read += 1;
        return { ...row, status: "pending" as const, txHash: null };
      },
    };

    const result = await completePayoutSigning(api, payout([derivation]), stamper, [], instantWait);

    expect(submitted).toEqual(["derivation-body", "tx1-body"]);
    expect(read).toBe(3);
    expect(result.status).toBe("processing");
  });

  test("gives up when the next round never appears", async () => {
    const api = {
      async submitPayoutSignatures() {
        return { ...payout([]), status: "pending" as const, txHash: null };
      },
      async getPayout() {
        return { ...payout([]), status: "pending" as const, txHash: null };
      },
    };

    await expect(
      completePayoutSigning(api, payout([signingRequest("derivation", "derivation-body")]), stamper, [], {
        ...instantWait,
        timeoutMs: 30,
      }),
    ).rejects.toThrow("no next signing round");
  });

  test("fails when signing requests never drain", async () => {
    let round = 0;
    const api = {
      getPayout: unexpectedRead,
      async submitPayoutSignatures() {
        round += 1;
        return payout([signingRequest(`round-${round}`, `body-${round}`)]);
      },
    };

    expect(
      completePayoutSigning(api, payout([signingRequest("round-0", "body-0")]), stamper),
    ).rejects.toThrow("still requires signatures");
  });
});

describe("a busy payout source", () => {
  const busy = new HedlesApiError(409, {
    code: "payout_source_busy",
    details: { chain: "base", retryable: true },
  });

  function busyClock() {
    const sleeps: number[] = [];
    let now = 0;
    return {
      sleeps,
      retry: {
        initialDelayMs: 5,
        maxDelayMs: 20,
        timeoutMs: 100,
        sleep: async (ms: number) => {
          sleeps.push(ms);
          now += ms;
        },
        now: () => now,
      },
    };
  }

  test("resubmits the identical stamped items with backoff until the source is free", async () => {
    const submissions: SignedActivity[][] = [];
    const api = {
      getPayout: unexpectedRead,
      async submitPayoutSignatures(_id: string, items: SignedActivity[]) {
        submissions.push(items);
        if (submissions.length < 4) throw busy;
        return payout([]);
      },
    };
    const { sleeps, retry } = busyClock();

    const result = await completePayoutSigning(
      api,
      payout([signingRequest("round-0", firstBody)]),
      stamper,
      [],
      instantWait,
      retry,
    );

    expect(result.status).toBe("broadcast");
    expect(submissions).toHaveLength(4);
    expect(new Set(submissions).size).toBe(1);
    expect(sleeps).toEqual([5, 10, 20]);
  });

  test("gives up with the conflict once the retry window is spent", async () => {
    let submissions = 0;
    const api = {
      getPayout: unexpectedRead,
      async submitPayoutSignatures(): Promise<PayoutResponse> {
        submissions += 1;
        throw busy;
      },
    };
    const { retry } = busyClock();

    await expect(
      completePayoutSigning(
        api,
        payout([signingRequest("round-0", firstBody)]),
        stamper,
        [],
        instantWait,
        retry,
      ),
    ).rejects.toBe(busy);
    expect(submissions).toBe(7);
  });

  test("does not retry a conflict that is not retryable", async () => {
    const other = new HedlesApiError(409, { code: "payout_source_busy", details: { chain: "base" } });
    let submissions = 0;
    const api = {
      getPayout: unexpectedRead,
      async submitPayoutSignatures(): Promise<PayoutResponse> {
        submissions += 1;
        throw other;
      },
    };

    await expect(
      completePayoutSigning(
        api,
        payout([signingRequest("round-0", firstBody)]),
        stamper,
        [],
        instantWait,
        busyClock().retry,
      ),
    ).rejects.toBe(other);
    expect(submissions).toBe(1);
  });

  test("asks for a fresh signature when the payout was rebuilt after signing", async () => {
    const api = {
      getPayout: unexpectedRead,
      async submitPayoutSignatures(): Promise<PayoutResponse> {
        throw new HedlesApiError(409, {
          code: "broadcast_failed",
          details: {
            detail: "the payout's message changed after it was signed; read the payout and sign again",
          },
        });
      },
    };

    await expect(
      completePayoutSigning(
        api,
        payout([signingRequest("round-0", firstBody)]),
        stamper,
        [],
        instantWait,
        busyClock().retry,
      ),
    ).rejects.toThrow("read the payout and sign it again");
  });
});

function twoSourcePsbt() {
  const network = fundingNetwork("bitcoin");
  const external = ECPair.makeRandom({ network });
  const managed = ECPair.makeRandom({ network });
  const previous = new bitgo.UtxoTransaction(network);
  previous.addInput(Buffer.alloc(32, 9), 0);
  for (const key of [external, managed]) {
    const payment = payments.p2pkh({ pubkey: key.publicKey, network });
    if (!payment.output) throw new Error("fixture payment failed");
    previous.addOutput(payment.output, 50_000);
  }
  const recipient = payments.p2pkh({ pubkey: ECPair.makeRandom({ network }).publicKey, network });
  if (!recipient.address) throw new Error("fixture payment failed");
  const psbt = bitgo.createPsbtForNetwork({ network });
  for (const index of [0, 1])
    psbt.addInput({ hash: previous.getId(), index, nonWitnessUtxo: previous.toBuffer() });
  psbt.addOutput({ address: recipient.address, value: 90_000n });
  return { external, unsigned: `0x${psbt.toHex()}`, network };
}

describe("payouts spending addresses Hedles does not control", () => {
  test("signs only the inputs an external key controls and keeps the transaction unchanged", () => {
    const fixture = twoSourcePsbt();
    const signed = signExternalInputs("bitcoin", fixture.unsigned, [fixture.external.toWIF()]);
    const before = bitgo.createPsbtDecode(fixture.unsigned.slice(2), fixture.network);
    const after = bitgo.createPsbtDecode(signed.slice(2), fixture.network);
    expect(after.getUnsignedTx().toHex()).toBe(before.getUnsignedTx().toHex());
    expect(after.data.inputs[0]?.partialSig).toHaveLength(1);
    expect(after.data.inputs[1]?.partialSig ?? []).toHaveLength(0);
  });

  test("refuses keys that control none of the inputs", () => {
    const fixture = twoSourcePsbt();
    expect(() =>
      signExternalInputs("bitcoin", fixture.unsigned, [
        ECPair.makeRandom({ network: fixture.network }).toWIF(),
      ]),
    ).toThrow("none of the external keys");
  });

  test("sends the signed PSBT as one signedPsbt item with the first stamps", async () => {
    const fixture = twoSourcePsbt();
    const submissions: SignedActivity[][] = [];
    const api = {
      getPayout: unexpectedRead,
      async submitPayoutSignatures(_target: string, requests: SignedActivity[]) {
        submissions.push(requests);
        return payout([]);
      },
    };
    const created = {
      ...payout([{ ...signingRequest("input-1", firstBody), transaction: fixture.unsigned }]),
      chain: "bitcoin" as const,
    };
    await completePayoutSigning(api, created, stamper, [fixture.external.toWIF()]);
    expect(submissions).toHaveLength(1);
    expect(submissions[0]?.map((item) => item.method)).toEqual(["stampedRequest", "signedPsbt"]);
  });
});
