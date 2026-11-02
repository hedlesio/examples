import { bitgo } from "@bitgo/utxo-lib";
import type { HedlesApi } from "./api.ts";
import { stampActivities } from "./signing.ts";
import { fundingNetwork, utxoKeyPair } from "./swap.ts";
import type { CreatePayoutResponse, PayoutResponse, SignedActivity, Stamper } from "./types.ts";

type PayoutSigningApi = Pick<HedlesApi, "submitPayoutSignatures">;

// Two rounds cover the deepest published flow (EIP-7702 authorization, then the
// resulting transaction); one extra round absorbs a future additional request.
const MAX_SIGNING_ROUNDS = 3;

// Signs, in the payout's review PSBT, every input one of the keys controls and
// changes nothing else. Hedles verifies these signatures against the payout it
// built, so the PSBT must otherwise stay byte for byte as received.
export function signExternalInputs(chain: string, transaction: string, secrets: readonly string[]): string {
  const psbt = bitgo.createPsbtDecode(transaction.replace(/^0x/i, ""), fundingNetwork(chain));
  let signed = 0;
  for (const secret of secrets) {
    const keyPair = utxoKeyPair(secret, chain);
    for (let index = 0; index < psbt.data.inputs.length; index += 1) {
      try {
        psbt.signInput(index, keyPair);
        signed += 1;
      } catch {
        // This key does not control that input; another key or Hedles signs it.
      }
    }
  }
  if (signed === 0) throw new Error("none of the external keys controls an input of this payout");
  return `0x${psbt.toHex()}`;
}

// A payout that spends addresses Hedles does not control (additionalFromAddresses)
// needs their signatures as one signedPsbt item, sent with the first stamps.
export async function completePayoutSigning(
  api: PayoutSigningApi,
  created: CreatePayoutResponse,
  stamper: Stamper,
  externalKeys: readonly string[] = [],
): Promise<PayoutResponse> {
  let response = created;

  for (let round = 0; round < MAX_SIGNING_ROUNDS; round += 1) {
    if (response.signingRequests.length === 0) return response;

    const stamped: SignedActivity[] = await stampActivities(response.signingRequests, stamper);
    const [first] = response.signingRequests;
    if (round === 0 && externalKeys.length > 0 && first) {
      stamped.push({
        method: "signedPsbt",
        body: signExternalInputs(response.chain, first.transaction, externalKeys),
      });
    }
    response = await api.submitPayoutSignatures(response.id, stamped);
  }

  throw new Error(`Payout still requires signatures after ${MAX_SIGNING_ROUNDS} signing rounds`);
}
