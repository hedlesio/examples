import { describe, expect, test } from "bun:test";
import { completePayoutSigning } from "../src/payout.ts";
import type { PayoutResponse, SignedTurnkeyActivity, SigningRequest, Stamper } from "../src/types.ts";

function signingRequest(id: string, body: string): SigningRequest {
  return { id, body, token: `token-${id}` };
}

function payout(signingRequests: SigningRequest[]): PayoutResponse {
  const complete = signingRequests.length === 0;
  return {
    id: "payout-1",
    chain: "chain",
    asset: "asset",
    fromAddress: "from",
    toAddress: "to",
    amount: "1000",
    feeTotal: null,
    kind: "payout",
    status: complete ? "broadcast" : "pending",
    unsignedTx: complete ? null : "unsigned",
    signedTx: null,
    txHash: complete ? "0xhash" : null,
    nonce: null,
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
  test("submits the initial request by its signing-request id, then by the payout id", async () => {
    const submissions: Array<{ target: string; requests: SignedTurnkeyActivity[] }> = [];
    const api = {
      async submitPayoutSignatures(target: string, requests: SignedTurnkeyActivity[]) {
        submissions.push({ target, requests });
        if (submissions.length === 1) return payout([signingRequest("round-2", "body-2")]);
        return payout([]);
      },
    };

    const result = await completePayoutSigning(
      api,
      { signingRequests: [signingRequest("round-1", "body-1")] },
      stamper,
    );

    expect(result.signingRequests).toEqual([]);
    expect(submissions).toEqual([
      {
        target: "round-1",
        requests: [
          {
            id: "round-1",
            body: "body-1",
            token: "token-round-1",
            stamp: { name: "X-Stamp", value: "signed:body-1" },
          },
        ],
      },
      {
        target: "payout-1",
        requests: [
          {
            id: "round-2",
            body: "body-2",
            token: "token-round-2",
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
      completePayoutSigning(api, { signingRequests: [signingRequest("round-0", "body-0")] }, stamper),
    ).rejects.toThrow("still requires signatures");
  });
});
