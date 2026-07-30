import { describe, expect, test } from "bun:test";
import type { AddressEntry, SignedIdentityRequest, Stamper } from "../src/types.ts";
import { createWalletAddress } from "../src/wallet.ts";

const address: AddressEntry = {
  id: "address-1",
  tenant_id: "tenant-1",
  chainType: "evm",
  address: "0x1234",
  address_role: "payin",
  status: "available",
  isSignable: false,
  derivation_path: null,
  created_at: "2026-07-30T00:00:00.000Z",
  updated_at: "2026-07-30T00:00:00.000Z",
  deletedAt: null,
  chains: [{ chainKey: "base-sepolia" }],
};

describe("createWalletAddress", () => {
  test("stamps and resubmits a prepared Turnkey activity", async () => {
    let submission: SignedIdentityRequest | undefined;
    const api = {
      async createAddress(_chainType: string, signedRequest?: SignedIdentityRequest) {
        if (!signedRequest) return { prepared: { body: "turnkey-wallet-activity" } };
        submission = signedRequest;
        return address;
      },
    };
    const stamper: Stamper = {
      async stamp(input) {
        expect(input).toBe("turnkey-wallet-activity");
        return { stampHeaderName: "X-Stamp", stampHeaderValue: "signed-wallet" };
      },
    };

    expect(await createWalletAddress(api, "evm", () => stamper)).toEqual(address);
    expect(submission).toEqual({
      body: "turnkey-wallet-activity",
      stampHeaderName: "X-Stamp",
      stampHeaderValue: "signed-wallet",
    });
  });

  test("returns a server-created address without invoking the stamper", async () => {
    const api = {
      async createAddress() {
        return address;
      },
    };
    const stamper: Stamper = {
      async stamp() {
        throw new Error("must not stamp");
      },
    };

    expect(await createWalletAddress(api, "evm", () => stamper)).toEqual(address);
  });
});
