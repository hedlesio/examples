import { describe, expect, test } from "bun:test";
import { bitgo, ECPair } from "@bitgo/utxo-lib";
import {
  acceptQuote,
  assertQuoteAcceptable,
  executeSwap,
  fundingSigner,
  signFundingTransaction,
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
    buyChain: "eip155:1",
    buyAsset: "USDT",
    sellAmount: "90000",
    quotedBuyAmount: "8186526",
    minimumBuyAmount: "8104661",
    quotedRate: "90961.4",
    venueFundingAddress: "bc1qvenue",
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
    buyChain: "eip155:1",
    buyAsset: "USDT",
    sellAmount: "90000",
    quotedBuyAmount: "8186526",
    minimumBuyAmount: "8104661",
    quotedRate: "90961.4",
    venueFundingAddress: "bc1qvenue",
    fundingTxHash: "ab".repeat(32),
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
