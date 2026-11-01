import { describe, expect, test } from "bun:test";
import { bitgo, ECPair, payments } from "@bitgo/utxo-lib";
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
    toAddress: "to",
    amount: "1000",
    feeTotal: null,
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

  test("fails when signing requests never drain", async () => {
    let round = 0;
    const api = {
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
