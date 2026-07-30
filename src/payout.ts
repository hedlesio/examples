import type { HedlesApi } from "./api.ts";
import { stampActivities } from "./turnkey.ts";
import type { PayoutResponse, Stamper } from "./types.ts";

type PayoutSigningApi = Pick<HedlesApi, "submitPayoutSignatures">;

export async function completePayoutSigning(
  api: PayoutSigningApi,
  initialPayout: PayoutResponse,
  stamper: Stamper,
): Promise<PayoutResponse> {
  let payout = initialPayout;

  for (let stage = 0; stage < 2 && payout.signing; stage += 1) {
    const requests = await stampActivities(payout.signing.requests, stamper);
    payout = await api.submitPayoutSignatures(payout.id, requests);
  }

  if (payout.signing) {
    throw new Error("Payout still requires signatures after two Turnkey signing stages");
  }
  return payout;
}
