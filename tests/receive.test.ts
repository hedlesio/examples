import { describe, expect, test } from "bun:test";
import {
  omnibusAddress,
  type Poll,
  receiveAndSweep,
  sweepToOmnibus,
  waitForPayin,
  waitForPayout,
} from "../src/receive.ts";
import type { AddressPage, PayinResponse, PayoutResponse, Stamper } from "../src/types.ts";

const poll: Poll = { intervalMs: 1, timeoutMs: 1_000, sleep: async () => {} };

const stamper: Stamper = {
  async stamp(input) {
    return { stampHeaderName: "X-Stamp", stampHeaderValue: `signed:${input}` };
  },
};

function payin(status: PayinResponse["status"]): PayinResponse {
  return {
    id: "payin-1",
    status,
    chain: "base",
    asset: "USDC",
    address: "0x00000000000000000000000000000000000000d1",
    reference: "invoice-1",
  } as PayinResponse;
}

function payout(status: PayoutResponse["status"], signingRequests: PayoutResponse["signingRequests"] = []) {
  return { id: "payout-1", chain: "base", status, signingRequests } as unknown as PayoutResponse;
}

describe("omnibusAddress", () => {
  test("asks for the active omnibus on the chain and returns its address", async () => {
    const queries: unknown[] = [];
    const api = {
      async listAddresses(query: unknown) {
        queries.push(query);
        return { items: [{ address: "0x00000000000000000000000000000000000000aa" }] } as AddressPage;
      },
    };
    expect(await omnibusAddress(api, "base")).toBe("0x00000000000000000000000000000000000000aa");
    expect(queries).toEqual([{ chain: "base", role: "omnibus", status: "active", limit: 1 }]);
  });

  test("fails clearly when the tenant has no omnibus on the chain", async () => {
    const api = {
      async listAddresses() {
        return { items: [] } as unknown as AddressPage;
      },
    };
    await expect(omnibusAddress(api, "zcash")).rejects.toThrow("no active omnibus on zcash");
  });
});

describe("waitForPayin", () => {
  test("polls until the payin is confirmed, reporting each new status once", async () => {
    const statuses: PayinResponse["status"][] = [
      "awaiting_payment",
      "awaiting_payment",
      "pending",
      "confirmed",
    ];
    const seen: string[] = [];
    const api = {
      async getPayin() {
        return payin(statuses.shift() ?? "confirmed");
      },
    };
    const confirmed = await waitForPayin(api, "payin-1", poll, (row) => seen.push(row.status));
    expect(confirmed.status).toBe("confirmed");
    expect(seen).toEqual(["awaiting_payment", "pending", "confirmed"]);
  });

  test("stops when the payin expires", async () => {
    const api = {
      async getPayin() {
        return payin("expired");
      },
    };
    await expect(waitForPayin(api, "payin-1", poll)).rejects.toThrow("payin payin-1 ended expired");
  });

  test("gives up after the timeout", async () => {
    let now = 0;
    const api = {
      async getPayin() {
        return payin("awaiting_payment");
      },
    };
    const clock: Poll = {
      intervalMs: 10,
      timeoutMs: 25,
      sleep: async (ms) => void (now += ms),
      now: () => now,
    };
    await expect(waitForPayin(api, "payin-1", clock)).rejects.toThrow("timed out");
  });
});

describe("sweepToOmnibus", () => {
  test("moves the whole payin balance to the omnibus and signs every round", async () => {
    const created: unknown[] = [];
    const submitted: unknown[] = [];
    const request = (id: string) => ({
      id,
      body: `body-${id}`,
      method: "stampedRequest" as const,
      signer: "0x00000000000000000000000000000000000000d1",
      transaction: "0x02",
    });
    const api = {
      async createPayout(input: unknown) {
        created.push(input);
        return payout("pending", [request("authorization")]);
      },
      async submitPayoutSignatures(_id: string, items: unknown[]) {
        submitted.push(items);
        return submitted.length === 1 ? payout("pending", [request("transaction")]) : payout("broadcast");
      },
      async getPayout(): Promise<PayoutResponse> {
        throw new Error("unexpected payout read");
      },
    };
    const result = await sweepToOmnibus(
      api,
      payin("confirmed"),
      "0x00000000000000000000000000000000000000aa",
      stamper,
    );
    expect(result.status).toBe("broadcast");
    expect(created).toEqual([
      {
        chain: "base",
        asset: "USDC",
        fromAddress: "0x00000000000000000000000000000000000000d1",
        transfers: [{ toAddress: "0x00000000000000000000000000000000000000aa", amount: "all" }],
        reference: "sweep-payin-1",
      },
    ]);
    expect(submitted).toHaveLength(2);
  });
});

describe("waitForPayout", () => {
  test("returns once the payout settles", async () => {
    const statuses: PayoutResponse["status"][] = ["broadcast", "settled"];
    const api = {
      async getPayout() {
        return payout(statuses.shift() ?? "settled");
      },
    };
    expect((await waitForPayout(api, "payout-1", poll)).status).toBe("settled");
  });

  test("throws when the payout fails", async () => {
    const api = {
      async getPayout() {
        return payout("failed");
      },
    };
    await expect(waitForPayout(api, "payout-1", poll)).rejects.toThrow("payout payout-1 failed");
  });
});

describe("receiveAndSweep", () => {
  test("creates the payin, waits for it, sweeps it to the omnibus and waits for settlement", async () => {
    const calls: string[] = [];
    const api = {
      async createPayin(input: unknown) {
        calls.push(`createPayin ${JSON.stringify(input)}`);
        return payin("awaiting_payment");
      },
      async getPayin() {
        calls.push("getPayin");
        return payin("confirmed");
      },
      async listAddresses() {
        calls.push("listAddresses");
        return { items: [{ address: "0x00000000000000000000000000000000000000aa" }] } as AddressPage;
      },
      async createPayout() {
        calls.push("createPayout");
        return payout("broadcast");
      },
      async submitPayoutSignatures() {
        return payout("broadcast");
      },
      async getPayout() {
        calls.push("getPayout");
        return payout("settled");
      },
    };
    const log: string[] = [];
    const result = await receiveAndSweep(
      api,
      { chain: "base", asset: "USDC", amount: "1000000", reference: "invoice-1" },
      stamper,
      poll,
      (line) => log.push(line),
    );
    expect(result.payout.status).toBe("settled");
    expect(calls).toEqual([
      'createPayin {"chain":"base","asset":"USDC","amount":"1000000","reference":"invoice-1"}',
      "getPayin",
      "listAddresses",
      "createPayout",
      "getPayout",
    ]);
    expect(log[0]).toContain(
      "send 1000000 USDC (atomic units) on base to 0x00000000000000000000000000000000000000d1",
    );
  });
});
