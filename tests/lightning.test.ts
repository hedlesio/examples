import { describe, expect, test } from "bun:test";
import { HedlesApiError } from "../src/api.ts";
import {
  createLightningPayout,
  LightningFeesUnsignedError,
  lightningBalance,
  lightningUri,
  signLightningPayout,
  waitForPayinConfirmed,
  waitForPayoutOutcome,
} from "../src/lightning.ts";
import type {
  AddressBalanceResponse,
  AddressPage,
  CreatePayoutInput,
  PayinResponse,
  PayoutResponse,
  PayoutStatus,
  SignedActivity,
  SigningRequest,
  Stamper,
} from "../src/types.ts";

const invoice = "lnbcrt10u1pexample";
const paymentHash = "ab".repeat(32);

function round(id: string): SigningRequest {
  return { id, body: `body-${id}`, method: "stampedRequest", signer: "sprt1wallet", transaction: "7b7d" };
}

function payout(status: PayoutStatus, signingRequests: SigningRequest[] = []): PayoutResponse {
  return {
    id: "payout-ln",
    chain: "lightning",
    asset: "BTC",
    fromAddress: "sprt1wallet",
    additionalFromAddresses: [],
    toAddress: null,
    invoice,
    paymentHash,
    amount: "1000",
    feeTotal: null,
    executionMode: "independent",
    status,
    txHash: null,
    confirmations: 0,
    requiredConfirmations: 0,
    reference: null,
    lastError: null,
    transfers: [],
    createdAt: "2026-11-06T00:00:00.000Z",
    broadcastAt: null,
    settledAt: null,
    signingRequests,
  };
}

function payin(status: PayinResponse["status"]): PayinResponse {
  return {
    id: "payin-ln",
    status,
    reference: null,
    chain: "lightning",
    asset: "BTC",
    address: "sprt1wallet",
    invoice,
    paymentHash,
    addressId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    fromAddress: null,
    expectedAmount: "1000",
    amount: status === "confirmed" ? "1000" : null,
    txHash: null,
    confirmations: 0,
    classification: "matched",
    createdAt: "2026-11-06T00:00:00.000Z",
    confirmedAt: null,
    expiresAt: "2026-12-06T00:00:00.000Z",
  };
}

let clock = 0;
const instant = {
  intervalMs: 10,
  timeoutMs: 1_000,
  sleep: async (ms: number) => {
    clock += ms;
  },
  now: () => clock,
};

const stamper: Stamper = {
  async stamp(input) {
    return { stampHeaderName: "X-Stamp", stampHeaderValue: `signed:${input}` };
  },
};

function submittedIds(submissions: SignedActivity[][]): string[] {
  return submissions.flat().map((item) => ("id" in item ? item.id : item.method));
}

describe("signLightningPayout", () => {
  test("stamps one round at a time until the payout leaves pending", async () => {
    const submissions: SignedActivity[][] = [];
    const next = [payout("pending", [round("fee")]), payout("processing")];
    const api = {
      async getPayout(): Promise<PayoutResponse> {
        throw new Error("unexpected read");
      },
      async submitPayoutSignatures(_id: string, requests: SignedActivity[]) {
        submissions.push(requests);
        return next.shift() ?? payout("processing");
      },
    };

    const result = await signLightningPayout(api, payout("pending", [round("invoice")]), stamper, instant);

    expect(result.status).toBe("processing");
    expect(submittedIds(submissions)).toEqual(["invoice", "fee"]);
    expect(submissions[0]?.[0]).toMatchObject({
      body: "body-invoice",
      stamp: { value: "signed:body-invoice" },
    });
  });

  test("re-reads and signs a fresh round when the old one expired", async () => {
    const submissions: SignedActivity[][] = [];
    const api = {
      async getPayout() {
        return payout("pending", [round("rebuilt")]);
      },
      async submitPayoutSignatures(_id: string, requests: SignedActivity[]) {
        submissions.push(requests);
        if (submissions.length === 1) {
          throw new HedlesApiError(409, { code: "lightning_approval_expired" });
        }
        return payout("settled");
      },
    };

    const result = await signLightningPayout(api, payout("pending", [round("stale")]), stamper, instant);

    expect(result.status).toBe("settled");
    expect(submittedIds(submissions)).toEqual(["stale", "rebuilt"]);
  });

  test("waits while another session holds the payout", async () => {
    const reads = [payout("pending"), payout("pending", [round("fee")])];
    const submissions: SignedActivity[][] = [];
    const api = {
      async getPayout() {
        return reads.shift() ?? payout("pending");
      },
      async submitPayoutSignatures(_id: string, requests: SignedActivity[]) {
        submissions.push(requests);
        return payout("processing");
      },
    };

    const result = await signLightningPayout(api, payout("pending"), stamper, instant);

    expect(result.status).toBe("processing");
    expect(submittedIds(submissions)).toEqual(["fee"]);
  });

  test("passes a custodial payout straight through", async () => {
    const api = {
      async getPayout(): Promise<PayoutResponse> {
        throw new Error("unexpected read");
      },
      async submitPayoutSignatures(): Promise<PayoutResponse> {
        throw new Error("must not submit");
      },
    };

    expect((await signLightningPayout(api, payout("processing"), stamper, instant)).status).toBe(
      "processing",
    );
  });

  test("propagates any other refusal", async () => {
    const api = {
      async getPayout(): Promise<PayoutResponse> {
        throw new Error("unexpected read");
      },
      async submitPayoutSignatures(): Promise<PayoutResponse> {
        throw new HedlesApiError(409, { code: "payout_not_pending" });
      },
    };

    await expect(signLightningPayout(api, payout("pending", [round("x")]), stamper, instant)).rejects.toThrow(
      "HTTP 409",
    );
  });
});

describe("createLightningPayout", () => {
  test("pays the invoice from the implicit Spark wallet", async () => {
    let body: CreatePayoutInput | undefined;
    const api = {
      async createPayout(input: CreatePayoutInput) {
        body = input;
        return payout("pending", [round("invoice")]);
      },
    };

    await createLightningPayout(api, invoice, "withdrawal-1");

    expect(body).toEqual({ chain: "lightning", asset: "BTC", invoice, reference: "withdrawal-1" });
  });

  test("names the payouts whose fee rounds block a new payment", async () => {
    const api = {
      async createPayout(): Promise<PayoutResponse> {
        throw new HedlesApiError(409, {
          code: "lightning_fees_unsigned",
          details: { detail: "sign them first", payoutIds: ["p-1", "p-2"] },
        });
      },
    };

    const error = await createLightningPayout(api, invoice).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LightningFeesUnsignedError);
    expect((error as LightningFeesUnsignedError).payoutIds).toEqual(["p-1", "p-2"]);
  });
});

describe("waiting", () => {
  test("follows a processing payout to its outcome", async () => {
    const reads: PayoutStatus[] = ["processing", "settled"];
    const api = {
      async getPayout() {
        return payout(reads.shift() ?? "settled");
      },
    };

    expect((await waitForPayoutOutcome(api, "payout-ln", instant)).status).toBe("settled");
  });

  test("keeps waiting past an expired pay-in, whose invoice is still payable", async () => {
    const reads: PayinResponse["status"][] = ["awaiting_payment", "expired", "confirmed"];
    const api = {
      async getPayin() {
        return payin(reads.shift() ?? "confirmed");
      },
    };

    expect((await waitForPayinConfirmed(api, "payin-ln", instant)).amount).toBe("1000");
  });

  test("gives up after the timeout", async () => {
    const api = {
      async getPayin() {
        return payin("awaiting_payment");
      },
    };

    await expect(waitForPayinConfirmed(api, "payin-ln", instant)).rejects.toThrow("still awaiting_payment");
  });
});

describe("wallet", () => {
  test("reads the Spark wallet's balance in sats", async () => {
    const wallet = { id: "wallet-1", address: "sprt1wallet" } as AddressPage["items"][number];
    const api = {
      async listAddresses() {
        return { items: [wallet], page: 1, limit: 1, total: 1, totalPages: 1, hasMore: false } as AddressPage;
      },
      async getAddressBalance(): Promise<AddressBalanceResponse> {
        return {
          id: "wallet-1",
          address: "sprt1wallet",
          chains: [{ chain: "lightning", assets: [{ asset: "BTC", atomic: "4200", decimals: 8 }] }],
        };
      },
    };

    expect(await lightningBalance(api)).toEqual({
      walletId: "wallet-1",
      sparkAddress: "sprt1wallet",
      sats: "4200",
      error: null,
    });
  });

  test("explains a tenant without Lightning", async () => {
    const api = {
      async listAddresses() {
        return { items: [], page: 1, limit: 1, total: 0, totalPages: 0, hasMore: false } as AddressPage;
      },
      async getAddressBalance(): Promise<AddressBalanceResponse> {
        throw new Error("unexpected balance read");
      },
    };

    await expect(lightningBalance(api)).rejects.toThrow("no Lightning wallet");
  });

  test("uppercases the invoice in its URI", () => {
    expect(lightningUri("lnbcrt10u1p")).toBe("lightning:LNBCRT10U1P");
  });
});
