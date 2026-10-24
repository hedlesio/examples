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
    if (response.signingRequests.length === 0) return response;

    const stamped = await stampActivities(response.signingRequests, stamper);
    response = await api.submitPayoutSignatures(response.id, stamped);
  }

  throw new Error(`Payout still requires signatures after ${MAX_SIGNING_ROUNDS} signing rounds`);
}
