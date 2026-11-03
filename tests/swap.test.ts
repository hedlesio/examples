import { describe, expect, test } from "bun:test";
import { bitgo, ECPair } from "@bitgo/utxo-lib";
import { HedlesApiError } from "../src/api.ts";
import {
  acceptQuote,
  assertQuoteAcceptable,
  executeSwap,
  fundingSigner,
  signFundingTransaction,
  signManagedSwap,
} from "../src/swap.ts";
import type {
  AcceptSwapQuoteInput,
  RequestSwapQuoteInput,
  SwapQuoteResponse,
  SwapResponse,
} from "../src/types.ts";
import { fundingFixture } from "./_helpers/funding-psbt.ts";

function quote(overrides: Partial<SwapQuoteResponse> = {}): SwapQuoteResponse {
  return {
    id: "6d0b6a34-0c77-4e6a-9f3f-3f3c9d3f1a11",
    status: "quoted",
    sellChain: "bitcoin",
    sellAsset: "BTC",
    buyChain: "ethereum",
    buyAsset: "USDT",
    sellAmount: "90000",
    quotedBuyAmount: "8186526",
    minimumBuyAmount: "8104661",
    quotedRate: "90961.4",
    additionalSenderAddresses: [],
    venueFundingAddress: "bc1qvenue",
    refundAddress: "bc1qsender",
    fundingMemo: null,
    fundingTransaction: "",
    token: "quote-token",
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function swap(id: string): SwapResponse {
  return {
    id,
    status: "pending",
    sellChain: "bitcoin",
    sellAsset: "BTC",
    buyChain: "ethereum",
    buyAsset: "USDT",
    sellAmount: "90000",
    quotedBuyAmount: "8186526",
    minimumBuyAmount: "8104661",
    quotedRate: "90961.4",
    additionalSenderAddresses: [],
    venueFundingAddress: "bc1qvenue",
    fundingTxHash: "ab".repeat(32),
    refundAddress: "bc1qsender",
    buyAmount: null,
    payoutTxHash: null,
    refundTxHash: null,
    fees: [],
    failureReason: null,
    executedAt: null,
    acceptedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
}

describe("signFundingTransaction", () => {
  test("adds valid signatures without altering the quoted transaction", () => {
    for (const chain of ["bitcoin", "dogecoin", "litecoin"] as const) {
      const f = fundingFixture(chain);
      const signed = signFundingTransaction(chain, f.unsigned, fundingSigner(f.senderWif, chain));

      const unsignedTx = bitgo.createPsbtDecode(f.unsigned, f.network).getUnsignedTx().toBuffer();
      const signedPsbt = bitgo.createPsbtDecode(signed, f.network);
      expect(signedPsbt.getUnsignedTx().toBuffer().equals(unsignedTx)).toBe(true);
      expect(signedPsbt.validateSignaturesOfAllInputs()).toBe(true);
      expect(() => signedPsbt.finalizeAllInputs().extractTransaction()).not.toThrow();
    }
  });

  test("accepts the sender key as 32-byte hex", () => {
    const f = fundingFixture("bitcoin");
    const fromWif = signFundingTransaction("bitcoin", f.unsigned, fundingSigner(f.senderWif, "bitcoin"));
    const fromHex = signFundingTransaction(
      "bitcoin",
      f.unsigned,
      fundingSigner(`0x${f.senderHex}`, "bitcoin"),
    );
    expect(fromHex).toBe(fromWif);
  });

  test("rejects a key that does not control the inputs", () => {
    const f = fundingFixture("bitcoin");
    const other = ECPair.makeRandom({ network: f.network }).toWIF();
    expect(() => signFundingTransaction("bitcoin", f.unsigned, fundingSigner(other, "bitcoin"))).toThrow();
  });

  test("imports a mainnet WIF for Zcash despite its two-byte address prefix", () => {
    const wif = ECPair.makeRandom().toWIF();
    expect(() => fundingSigner(wif, "zcash")).not.toThrow();
  });

  test("rejects sell chains that are not swap funding chains", () => {
    expect(() => fundingSigner("5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ", "eip155:1")).toThrow(
      "eip155:1 is not a supported swap sell chain",
    );
  });
});

describe("assertQuoteAcceptable", () => {
  test("refuses accepted and expired quotes", () => {
    expect(() => assertQuoteAcceptable(quote())).not.toThrow();
    expect(() => assertQuoteAcceptable(quote({ status: "accepted" }))).toThrow("already accepted");
    expect(() => assertQuoteAcceptable(quote({ status: "expired" }))).toThrow("expired");
    expect(() =>
      assertQuoteAcceptable(quote({ expiresAt: new Date(Date.now() - 1_000).toISOString() })),
    ).toThrow("expired");
  });
});

describe("executeSwap", () => {
  test("requests a quote, signs its PSBT, and accepts with the bound token", async () => {
    const f = fundingFixture("dogecoin");
    const requests: RequestSwapQuoteInput[] = [];
    const accepts: AcceptSwapQuoteInput[] = [];
    const issued = quote({ sellChain: "dogecoin", sellAsset: "DOGE", fundingTransaction: f.unsigned });
    const api = {
      async requestSwapQuote(input: RequestSwapQuoteInput) {
        requests.push(input);
        return issued;
      },
      async getSwapQuote() {
        return issued;
      },
      async acceptSwapQuote(input: AcceptSwapQuoteInput) {
        accepts.push(input);
        return swap(input.quoteId);
      },
    };
    const input: RequestSwapQuoteInput = {
      sellChain: "dogecoin",
      sellAsset: "DOGE",
      buyChain: "bitcoin",
      buyAsset: "BTC",
      amount: "90000",
      side: "sell",
      senderAddress: f.senderAddress,
      recipientAddress: "bc1qrecipient",
    };

    const result = await executeSwap(api, input, fundingSigner(f.senderWif, "dogecoin"));

    expect(requests).toEqual([input]);
    expect(accepts).toHaveLength(1);
    expect(accepts[0]?.quoteId).toBe(issued.id);
    expect(accepts[0]?.token).toBe("quote-token");
    expect(accepts[0]?.signature).toBe(result.signature);
    expect(result.swap.id).toBe(issued.id);

    // Accepting the same quote again produces the identical signed bytes, so a
    // retry after a lost response is safe.
    const retry = await acceptQuote(api, issued, fundingSigner(f.senderWif, "dogecoin"));
    expect(retry.signature).toBe(result.signature);
  });
});

describe("signManagedSwap", () => {
  const stamper = {
    async stamp(input: string) {
      return { stampHeaderName: "X-Stamp", stampHeaderValue: `signed:${input}` };
    },
  };

  test("stamps the funding payout's requests and returns them with their tokens", async () => {
    const submitted: unknown[] = [];
    const api = {
      async prepareSwapSigning() {
        return {
          id: "quote-1",
          signingRequests: [
            {
              id: "00000000-0000-4000-8000-000000000001",
              method: "stampedRequest" as const,
              body: "body-1",
              signer: "bc1qsender",
              transaction: "0x70736274ff",
              token: "request-token",
            },
          ],
        };
      },
      async submitSwapSignatures(quoteId: string, requests: unknown[]) {
        submitted.push({ quoteId, requests });
        return { signed: true } as never;
      },
      async getSwap(): Promise<SwapResponse> {
        throw new Error("unexpected swap read");
      },
    };
    await signManagedSwap(api, "quote-1", "quote-token", stamper);
    expect(submitted).toEqual([
      {
        quoteId: "quote-1",
        requests: [
          {
            id: "00000000-0000-4000-8000-000000000001",
            method: "stampedRequest",
            body: "body-1",
            token: "request-token",
            stamp: { name: "X-Stamp", value: "signed:body-1" },
          },
        ],
      },
    ]);
  });
  test("signs the second round a first EVM payout returns after its delegation authorization", async () => {
    const request = (n: number) => ({
      id: `00000000-0000-4000-8000-00000000000${n}`,
      method: "stampedRequest" as const,
      body: `body-${n}`,
      signer: "0x0000000000000000000000000000000000000001",
      transaction: "0x04",
      token: `token-${n}`,
    });
    const rounds: string[][] = [];
    const api = {
      async prepareSwapSigning() {
        return { id: "quote-1", signingRequests: [request(1)] };
      },
      async submitSwapSignatures(_quoteId: string, requests: { body: string }[]) {
        rounds.push(requests.map((r) => r.body));
        return (
          rounds.length === 1 ? { id: "quote-1", signingRequests: [request(2)] } : { status: "accepted" }
        ) as never;
      },
      async getSwap(): Promise<SwapResponse> {
        throw new Error("unexpected swap read");
      },
    };
    expect(await signManagedSwap(api, "quote-1", "quote-token", stamper)).toEqual({
      status: "accepted",
    } as never);
    expect(rounds).toEqual([["body-1"], ["body-2"]]);
  });
  test("waits through a Zcash mining-reward funding: derivation, proof, first transaction, then the swap", async () => {
    const request = (id: string) => ({
      id,
      method: "stampedRequest" as const,
      body: `body-${id}`,
      signer: "t1signer",
      transaction: "00",
      token: `token-${id}`,
    });
    const prepares = [
      { id: "quote-1", signingRequests: [request("derivation")] },
      { id: "quote-1", signingRequests: [] },
      { id: "quote-1", signingRequests: [request("tx1")] },
      { id: "quote-1", signingRequests: [] },
    ];
    const swapReads = [404, 404, 404, 200];
    const submitted: string[][] = [];
    let clock = 0;
    const api = {
      async prepareSwapSigning() {
        return prepares.shift() ?? { id: "quote-1", signingRequests: [] };
      },
      async submitSwapSignatures(_quoteId: string, requests: { body: string }[]) {
        submitted.push(requests.map((r) => r.body));
        return { id: "quote-1", signingRequests: [] } as never;
      },
      async getSwap() {
        if ((swapReads.shift() ?? 200) === 404) throw new HedlesApiError(404, { code: "swap_not_found" });
        return { id: "quote-1", status: "pending" } as never;
      },
    };
    const result = await signManagedSwap(api, "quote-1", "quote-token", stamper, {
      intervalMs: 10,
      timeoutMs: 60_000,
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
    });
    expect(submitted).toEqual([["body-derivation"], ["body-tx1"]]);
    expect(result).toEqual({ id: "quote-1", status: "pending" } as never);
  });
});
