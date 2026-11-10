import { bitgo } from "@bitgo/utxo-lib";
import { type HedlesApi, HedlesApiError } from "./api.ts";
import { stampActivities } from "./signing.ts";
import { fundingNetwork, utxoKeyPair } from "./swap.ts";
import type { CreatePayoutResponse, PayoutResponse, SignedActivity, Stamper } from "./types.ts";

type PayoutSigningApi = Pick<HedlesApi, "submitPayoutSignatures" | "getPayout">;

export interface RoundWait {
  intervalMs: number;
  timeoutMs: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

// A Zcash payout spending mining rewards returns an empty round while Hedles
// proves its first transaction (usually 15–30 s), then the next round on a read.
export const DEFAULT_ROUND_WAIT: RoundWait = { intervalMs: 5_000, timeoutMs: 10 * 60_000 };

export interface BusyRetry {
  initialDelayMs: number;
  maxDelayMs: number;
  timeoutMs: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

// 409 payout_source_busy comes before approval while the source has an
// unconfirmed transaction or a lower nonce still unsent, and after approval when
// another payout wins the broadcast claim or the node refuses a delegated
// account's nonce gap; Hedles then keeps the signed bytes for the resubmission.
// Ten minutes stays well inside the payout's one-hour signing window.
export const DEFAULT_BUSY_RETRY: BusyRetry = {
  initialDelayMs: 5_000,
  maxDelayMs: 60_000,
  timeoutMs: 10 * 60_000,
};

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
  wait: RoundWait = DEFAULT_ROUND_WAIT,
  busy: BusyRetry = DEFAULT_BUSY_RETRY,
): Promise<PayoutResponse> {
  let response = created;

  for (let round = 0; round < MAX_SIGNING_ROUNDS; round += 1) {
    if (round > 0 && response.signingRequests.length === 0 && response.status === "pending") {
      response = await waitForNextRound(api, response.id, wait);
    }
    if (response.signingRequests.length === 0) return response;

    const stamped: SignedActivity[] = await stampActivities(response.signingRequests, stamper);
    const [first] = response.signingRequests;
    if (round === 0 && externalKeys.length > 0 && first) {
      stamped.push({
        method: "signedPsbt",
        body: signExternalInputs(response.chain, first.transaction, externalKeys),
      });
    }
    response = await submitWhileBusy(api, response.id, stamped, busy);
  }

  throw new Error(`Payout still requires signatures after ${MAX_SIGNING_ROUNDS} signing rounds`);
}

// The identical stamped items are resubmitted, never re-stamped: Hedles matches
// them against the payout's signing window, and after a node refusal it resends
// the transaction it already holds instead of asking for another approval.
async function submitWhileBusy(
  api: PayoutSigningApi,
  payoutId: string,
  stamped: SignedActivity[],
  busy: BusyRetry,
): Promise<PayoutResponse> {
  const sleep = busy.sleep ?? Bun.sleep;
  const now = busy.now ?? Date.now;
  const deadline = now() + busy.timeoutMs;
  let delay = busy.initialDelayMs;
  for (;;) {
    try {
      return await api.submitPayoutSignatures(payoutId, stamped);
    } catch (err) {
      if (messageChanged(err)) {
        throw new Error(
          `payout ${payoutId} was rebuilt after it was signed; read the payout and sign it again`,
          {
            cause: err,
          },
        );
      }
      if (!retryableBusy(err) || now() + delay > deadline) throw err;
    }
    await sleep(delay);
    delay = Math.min(delay * 2, busy.maxDelayMs);
  }
}

function conflict(err: unknown): { code: string | undefined; details: Record<string, unknown> } | null {
  if (!(err instanceof HedlesApiError) || err.status !== 409) return null;
  if (typeof err.body !== "object" || err.body === null) return null;
  const { details } = err.body;
  return {
    code: err.body.code,
    details:
      typeof details === "object" && details !== null ? Object.fromEntries(Object.entries(details)) : {},
  };
}

function retryableBusy(err: unknown): boolean {
  const body = conflict(err);
  return body?.code === "payout_source_busy" && body.details.retryable === true;
}

function messageChanged(err: unknown): boolean {
  const body = conflict(err);
  const detail = body?.details.detail;
  return (
    body?.code === "broadcast_failed" && typeof detail === "string" && detail.includes("message changed")
  );
}

async function waitForNextRound(
  api: PayoutSigningApi,
  payoutId: string,
  wait: RoundWait,
): Promise<PayoutResponse> {
  const sleep = wait.sleep ?? Bun.sleep;
  const now = wait.now ?? Date.now;
  const deadline = now() + wait.timeoutMs;
  for (;;) {
    await sleep(wait.intervalMs);
    const payout = await api.getPayout(payoutId);
    if (payout.signingRequests.length > 0 || payout.status !== "pending") return payout;
    if (now() >= deadline) throw new Error(`payout ${payoutId} is pending with no next signing round`);
  }
}
