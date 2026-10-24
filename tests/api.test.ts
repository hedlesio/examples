import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { HedlesApi, HedlesApiError } from "../src/api.ts";

let server: ReturnType<typeof Bun.serve>;
let api: HedlesApi;
let lastAuthorization: string | null;
let lastBody: unknown;
let bootstrapContext: string | null;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    routes: {
      "/v1/sessions/bootstrap": {
        GET(request) {
          bootstrapContext = new URL(request.url).searchParams.get("organizationId");
          return Response.json({
            organizationId: bootstrapContext ?? "org-default",
            body: '{ "timestampMs": 1760000000000, "opaque": true }',
            expiresIn: 300,
          });
        },
      },
      "/v1/payins": {
        async POST(request) {
          lastAuthorization = request.headers.get("Authorization");
          lastBody = await request.json();
          return Response.json({
            id: "payin-1",
            status: "awaiting_payment",
            reference: null,
            chain: "base",
            asset: "USDC",
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
            sellChain: "bitcoin",
            sellAsset: "SELL",
            buyChain: "ethereum",
            buyAsset: "BUY",
            sellAmount: "1000",
            quotedBuyAmount: "990",
            minimumBuyAmount: "980",
            quotedRate: "0.99",
            venueFundingAddress: "venue-address",
            fundingMemo: null,
            fundingTransaction: "unsigned-funding-psbt",
            signingRequests: [],
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
            sellChain: "bitcoin",
            sellAsset: "SELL",
            buyChain: "ethereum",
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
  test("gets the signing body and encodes an optional organization context", async () => {
    expect(await api.bootstrapSession()).toMatchObject({
      organizationId: "org-default",
      body: '{ "timestampMs": 1760000000000, "opaque": true }',
      expiresIn: 300,
    });
    expect(bootstrapContext).toBeNull();
    const context = "org:a/b &?";
    expect((await api.bootstrapSession(context)).organizationId).toBe(context);
    expect(bootstrapContext).toBe(context);
  });
  test("sends bearer authentication and JSON bodies", async () => {
    const result = await api.createPayin({
      chain: "base",
      asset: "USDC",
      amount: "1000",
    });

    expect(result.id).toBe("payin-1");
    expect(result.classification).toBe("matched");
    expect(lastAuthorization).toBe("Bearer hp_sess_test");
    expect(lastBody).toEqual({
      chain: "base",
      asset: "USDC",
      amount: "1000",
    });
  });

  test("surfaces structured API errors", async () => {
    await expect(api.getPayout("error")).rejects.toEqual(new HedlesApiError(422, { code: "example_error" }));
  });

  test("requests a swap quote with the RFQ inputs", async () => {
    const quote = await api.requestSwapQuote({
      sellChain: "bitcoin",
      sellAsset: "SELL",
      buyChain: "ethereum",
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
      sellChain: "bitcoin",
      sellAsset: "SELL",
      buyChain: "ethereum",
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

test("serializes typed pagination and scope options instead of offset", async () => {
  let received = "";
  const listServer = Bun.serve({
    port: 0,
    fetch(request) {
      received = new URL(request.url).search;
      return Response.json({ items: [], page: 2, limit: 5, total: 0, totalPages: 0, hasMore: false });
    },
  });
  try {
    const result = await new HedlesApi(`http://127.0.0.1:${listServer.port}`).listSwaps({
      page: 2,
      limit: 5,
      includeDescendants: false,
    });
    expect(result.page).toBe(2);
    expect(new URLSearchParams(received).get("includeDescendants")).toBe("false");
    expect(new URLSearchParams(received).get("page")).toBe("2");
    expect(new URLSearchParams(received).has("offset")).toBe(false);
  } finally {
    listServer.stop(true);
  }
});

test("prepares swap signing without claiming an executed swap response", async () => {
  let received: unknown;
  const signingServer = Bun.serve({
    port: 0,
    async fetch(request) {
      received = await request.json();
      return Response.json({ id: "quote-id", signingRequests: [] });
    },
  });
  try {
    const result = await new HedlesApi(`http://127.0.0.1:${signingServer.port}`).acceptSwapQuote({
      quoteId: "quote-id",
      token: "quote-token",
    });
    expect(received).toEqual({ quoteId: "quote-id", token: "quote-token" });
    expect(result).toEqual({ id: "quote-id", signingRequests: [] });
  } finally {
    signingServer.stop(true);
  }
});
