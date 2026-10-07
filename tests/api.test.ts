import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { HedlesApi, HedlesApiError } from "../src/api.ts";

let server: ReturnType<typeof Bun.serve>;
let api: HedlesApi;
let lastAuthorization: string | null;
let lastBody: unknown;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    routes: {
      "/v1/payins": {
        async POST(request) {
          lastAuthorization = request.headers.get("Authorization");
          lastBody = await request.json();
          return Response.json({
            id: "payin-1",
            status: "awaiting_payment",
            reference: null,
            chainKey: "chain",
            assetKey: "asset",
            address: "deposit-address",
            addressId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            fromAddress: null,
            expectedAmount: "1000",
            amount: null,
            txHash: null,
            confirmations: 0,
            classification: "matched",
            createdAt: "2026-07-30T00:00:00.000Z",
            confirmedAt: null,
            expiresAt: "2026-07-30T01:00:00.000Z",
          });
        },
      },
      "/v1/payouts/error": {
        GET() {
          return Response.json({ code: "example_error" }, { status: 422 });
        },
      },
      "/v1/swaps/quotes": {
        async POST(request) {
          lastAuthorization = request.headers.get("Authorization");
          lastBody = await request.json();
          return Response.json({
            id: "11111111-1111-4111-8111-111111111111",
            status: "quoted",
            sellChain: "sell-chain",
            sellAsset: "SELL",
            buyChain: "buy-chain",
            buyAsset: "BUY",
            sellAmount: "1000",
            quotedBuyAmount: "990",
            minimumBuyAmount: "980",
            quotedRate: "0.99",
            venueFundingAddress: "venue-address",
            fundingMemo: null,
            fundingTransaction: "unsigned-funding-psbt",
            token: "quote-token",
            expiresAt: "2026-07-30T01:00:00.000Z",
            createdAt: "2026-07-30T00:00:00.000Z",
          });
        },
      },
      "/v1/swaps": {
        async POST(request) {
          lastAuthorization = request.headers.get("Authorization");
          lastBody = await request.json();
          return Response.json({
            id: "11111111-1111-4111-8111-111111111111",
            status: "pending",
            sellChain: "sell-chain",
            sellAsset: "SELL",
            buyChain: "buy-chain",
            buyAsset: "BUY",
            sellAmount: "1000",
            quotedBuyAmount: "990",
            minimumBuyAmount: "980",
            quotedRate: "0.99",
            venueFundingAddress: "venue-address",
            fundingTxHash: "funding-txid",
            failureReason: null,
            executedAt: null,
            acceptedAt: "2026-07-30T00:01:00.000Z",
            createdAt: "2026-07-30T00:00:00.000Z",
          });
        },
      },
    },
  });
  api = new HedlesApi(`http://127.0.0.1:${server.port}`, "hp_sess_test");
});

afterAll(() => {
  server.stop(true);
});

describe("HedlesApi", () => {
  test("sends bearer authentication and JSON bodies", async () => {
    const result = await api.createPayin({
      chainKey: "chain",
      assetKey: "asset",
      amount: "1000",
    });

    expect(result.id).toBe("payin-1");
    expect(result.classification).toBe("matched");
    expect(lastAuthorization).toBe("Bearer hp_sess_test");
    expect(lastBody).toEqual({
      chainKey: "chain",
      assetKey: "asset",
      amount: "1000",
    });
  });

  test("surfaces structured API errors", async () => {
    await expect(api.getPayout("error")).rejects.toEqual(new HedlesApiError(422, { code: "example_error" }));
  });

  test("requests a swap quote with the RFQ inputs", async () => {
    const quote = await api.requestSwapQuote({
      sellChain: "sell-chain",
      sellAsset: "SELL",
      buyChain: "buy-chain",
      buyAsset: "BUY",
      amount: "1000",
      side: "sell",
      senderAddress: "seller-address",
      recipientAddress: "buyer-address",
    });

    expect(quote.status).toBe("quoted");
    expect(quote.fundingTransaction).toBe("unsigned-funding-psbt");
    expect(quote.token).toBe("quote-token");
    expect(lastAuthorization).toBe("Bearer hp_sess_test");
    expect(lastBody).toEqual({
      sellChain: "sell-chain",
      sellAsset: "SELL",
      buyChain: "buy-chain",
      buyAsset: "BUY",
      amount: "1000",
      side: "sell",
      senderAddress: "seller-address",
      recipientAddress: "buyer-address",
    });
  });

  test("accepts a swap quote with the signed funding transaction", async () => {
    const swap = await api.acceptSwapQuote({
      quoteId: "11111111-1111-4111-8111-111111111111",
      token: "quote-token",
      signature: "signed-funding-psbt",
    });

    expect(swap.status).toBe("pending");
    expect(swap.fundingTxHash).toBe("funding-txid");
    expect(lastBody).toEqual({
      quoteId: "11111111-1111-4111-8111-111111111111",
      token: "quote-token",
      signature: "signed-funding-psbt",
    });
  });
});
