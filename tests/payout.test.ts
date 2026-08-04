import { describe, expect, test } from "bun:test";
import { completePayoutSigning } from "../src/payout.ts";
import type {
  PayoutResponse,
  PreparedTurnkeyActivity,
  SignedTurnkeyActivity,
  Stamper,
} from "../src/types.ts";

function activity(id: string, body: string): PreparedTurnkeyActivity {
  return {
    id,
    body,
    token: `token-${id}`,
    authorization: {
      required: 2,
      received: 0,
      remaining: 2,
      approvers: [],
    },
  };
}

function payout(signing: PayoutResponse["signing"]): PayoutResponse {
  return {
    id: "payout-1",
    chain: "chain",
    asset: "asset",
    fromAddress: "from",
    toAddress: "to",
    amount: "1000",
    kind: "direct",
    status: signing ? "prepared" : "broadcast",
    unsignedTx: signing ? "unsigned" : null,
    txHash: signing ? null : "0xhash",
    note: null,
    createdAt: "2026-07-30T00:00:00.000Z",
    broadcastAt: signing ? null : "2026-07-30T00:00:01.000Z",
    settledAt: null,
    signing,
  };
}

describe("completePayoutSigning", () => {
  test("injects the stamper into every request across two signing stages", async () => {
    const submissions: SignedTurnkeyActivity[][] = [];
    const api = {
      async submitPayoutSignatures(_payoutId: string, requests: SignedTurnkeyActivity[]) {
        submissions.push(requests);
        if (submissions.length === 1) {
          return payout({ stage: "evm", requests: [activity("stage-2", "body-2")] });
        }
        return payout(null);
      },
    };
    const stamper: Stamper = {
      async stamp(input) {
        return {
          stampHeaderName: "X-Stamp",
          stampHeaderValue: `signed:${input}`,
        };
      },
    };

    const result = await completePayoutSigning(
      api,
      payout({ stage: "evm", requests: [activity("stage-1", "body-1")] }),
      stamper,
    );

    expect(result.signing).toBeNull();
    expect(submissions).toEqual([
      [
        {
          id: "stage-1",
          body: "body-1",
          token: "token-stage-1",
          stamp: { name: "X-Stamp", value: "signed:body-1" },
        },
      ],
      [
        {
          id: "stage-2",
          body: "body-2",
          token: "token-stage-2",
          stamp: { name: "X-Stamp", value: "signed:body-2" },
        },
      ],
    ]);
  });

  test("returns immediately when the payout needs no client signature", async () => {
    const initial = payout(null);
    const api = {
      async submitPayoutSignatures() {
        throw new Error("must not submit signatures");
      },
    };
    const stamper: Stamper = {
      async stamp() {
        throw new Error("must not stamp");
      },
    };

    expect(await completePayoutSigning(api, initial, stamper)).toBe(initial);
  });
});
