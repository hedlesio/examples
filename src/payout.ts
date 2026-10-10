import type { HedlesApi } from "./api.ts";
import { stampActivities } from "./signing.ts";
import type { CreatePayoutResponse, PayoutResponse, Stamper } from "./types.ts";

type PayoutSigningApi = Pick<HedlesApi, "submitPayoutSignatures">;

// Two rounds cover the deepest published flow (EIP-7702 authorization, then the
// resulting transaction); one extra round absorbs a future additional request.
const MAX_SIGNING_ROUNDS = 3;

export async function completePayoutSigning(
  api: PayoutSigningApi,
  created: CreatePayoutResponse,
  stamper: Stamper,
): Promise<PayoutResponse> {
  let response = created;

  for (let round = 0; round < MAX_SIGNING_ROUNDS; round += 1) {
    if ("id" in response && response.signingRequests.length === 0) return response;

    // Before the payout exists the signing-request id addresses the submission;
    // every later round uses the database-generated payout id.
    const target = "id" in response ? response.id : response.signingRequests[0]?.id;
    if (!target) throw new Error("Payout response carries neither a payout id nor a signing request");

    const stamped = await stampActivities(response.signingRequests, stamper);
    response = await api.submitPayoutSignatures(target, stamped);
  }

  throw new Error(`Payout still requires signatures after ${MAX_SIGNING_ROUNDS} signing rounds`);
}
