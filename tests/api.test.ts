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
            status: "pending",
            reference: null,
            metadata: null,
            chainKey: "chain",
            assetKey: "asset",
            address: "deposit-address",
            expectedAmount: "1000",
            amount: null,
            txHash: null,
            confirmations: 0,
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
            status: "active",
            fromChain: "from-chain",
            fromAsset: "FROM",
            toChain: "to-chain",
            toAsset: "TO",
            fromAmount: "1000",
            toAmount: "990",
            rate: "0.99",
            feeAmount: "10",
            depositAddress: "deposit-address",
            depositMemo: null,
            transaction: "unsigned-transaction",
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
            id: "22222222-2222-4222-8222-222222222222",
            quoteId: "11111111-1111-4111-8111-111111111111",
            status: "pending",
            fromChain: "from-chain",
            fromAsset: "FROM",
            toChain: "to-chain",
            toAsset: "TO",
            fromAmount: "1000",
            toAmount: "990",
            rate: "0.99",
            feeAmount: "10",
            depositAddress: "deposit-address",
            depositTxHash: null,
            venueOrderId: null,
            failureReason: null,
            executedAt: null,
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
      fromChain: "from-chain",
      fromAsset: "FROM",
      toChain: "to-chain",
      toAsset: "TO",
      amount: "1000",
      side: "from",
      fromAddress: "seller-address",
    });

    expect(quote.status).toBe("active");
    expect(quote.transaction).toBe("unsigned-transaction");
    expect(quote.token).toBe("quote-token");
    expect(lastAuthorization).toBe("Bearer hp_sess_test");
    expect(lastBody).toEqual({
      fromChain: "from-chain",
      fromAsset: "FROM",
      toChain: "to-chain",
      toAsset: "TO",
      amount: "1000",
      side: "from",
      fromAddress: "seller-address",
    });
  });

  test("accepts a swap quote with the signed deposit transaction", async () => {
    const swap = await api.acceptSwapQuote({
      quoteId: "11111111-1111-4111-8111-111111111111",
      token: "quote-token",
      transaction: "unsigned-transaction",
      signature: "aabbcc",
    });

    expect(swap.status).toBe("pending");
    expect(swap.quoteId).toBe("11111111-1111-4111-8111-111111111111");
    expect(lastBody).toEqual({
      quoteId: "11111111-1111-4111-8111-111111111111",
      token: "quote-token",
      transaction: "unsigned-transaction",
      signature: "aabbcc",
    });
  });
});
