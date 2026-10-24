import { describe, expect, test } from "bun:test";
import { completePayoutSigning } from "../src/payout.ts";
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
