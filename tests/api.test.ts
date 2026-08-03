import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { HedlesApi, HedlesApiError } from "../src/api.ts";

let server: ReturnType<typeof Bun.serve>;
let api: HedlesApi;
let lastAuthorization: string | null;
let lastBody: unknown;
let lastMerchantBody: unknown;
let lastMerchantAuthorization: string | null;
let lastResendBody: unknown;

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
      "/v1/merchants": {
        async POST(request) {
          lastMerchantAuthorization = request.headers.get("Authorization");
          lastMerchantBody = await request.json();
          return Response.json({
            id: "merchant-1",
            name: "Example Merchant",
            email: "owner@example.com",
            claimUrl: "https://dev.hedles.io/claim?tenantId=merchant-1",
            claimEmailSent: false,
            externalClaimDelivery: {
              code: "123456",
              expiresAt: "2026-07-31T00:00:00.000Z",
            },
          });
        },
      },
      "/v1/tenants/merchant-1/resend-claim": {
        async POST(request) {
          lastResendBody = await request.json();
          return Response.json({
            claimUrl: "https://dev.hedles.io/claim?tenantId=merchant-1",
            claimEmailSent: false,
            externalClaimDelivery: {
              code: "654321",
              expiresAt: "2026-08-01T00:00:00.000Z",
            },
          });
        },
      },
      "/v1/payouts/error": {
        GET() {
          return Response.json({ code: "example_error" }, { status: 422 });
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

  test("requests self-managed OTP delivery when creating a merchant", async () => {
    const result = await api.createMerchant({
      name: "Example Merchant",
      email: "owner@example.com",
      externalClaimDelivery: true,
    });

    expect(result.externalClaimDelivery?.code).toBe("123456");
    expect(lastMerchantAuthorization).toBe("Bearer hp_sess_test");
    expect(lastMerchantBody).toEqual({
      name: "Example Merchant",
      email: "owner@example.com",
      externalClaimDelivery: true,
    });
  });

  test("requests a rotated OTP from the authenticated resend route", async () => {
    const result = await api.resendClaim("merchant-1");

    expect(result.externalClaimDelivery?.code).toBe("654321");
    expect(lastResendBody).toEqual({ externalClaimDelivery: true });
  });
});
