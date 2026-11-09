import { type HedlesApi, HedlesApiError } from "./api.ts";
import { stampActivities } from "./signing.ts";
import type { AddressPage, PayinResponse, PayoutResponse, Stamper } from "./types.ts";

type PayoutSigningApi = Pick<HedlesApi, "getPayout" | "submitPayoutSignatures">;
type LightningWalletApi = Pick<HedlesApi, "listAddresses" | "getAddressBalance">;

export interface Poll {
  intervalMs: number;
  timeoutMs: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

// Hedles credits a paid invoice on a 15-second reconcile pass, so a payer
// usually sees the payin confirm within one or two polls.
export const DEFAULT_POLL: Poll = { intervalMs: 3_000, timeoutMs: 5 * 60_000 };

// One round per payment (the invoice, then each fee), each possibly preceded
// by a swap that makes exact change, plus re-reads of expired rounds.
const MAX_SIGNING_ROUNDS = 16;

// Uppercase lets wallets encode the QR code in alphanumeric mode, which is denser.
export function lightningUri(invoice: string): string {
  return `lightning:${invoice.toUpperCase()}`;
}

export function apiErrorCode(error: unknown): string | undefined {
  if (!(error instanceof HedlesApiError) || typeof error.body !== "object" || error.body === null) {
    return undefined;
  }
  return error.body.code;
}

// An earlier payout paid its invoice but its fee rounds are unsigned; the
// gateway refuses new Lightning payouts until they are signed.
export class LightningFeesUnsignedError extends Error {
  constructor(readonly payoutIds: string[]) {
    super(
      `earlier Lightning payouts still have unsigned fee rounds: ${payoutIds.join(", ")}; ` +
        "sign them with --payout-id before paying another invoice",
    );
    this.name = "LightningFeesUnsignedError";
  }
}

function waitingPayoutIds(error: HedlesApiError): string[] {
  const details = typeof error.body === "object" ? error.body?.details : undefined;
  if (typeof details !== "object" || details === null || !("payoutIds" in details)) return [];
  const { payoutIds } = details;
  return Array.isArray(payoutIds) ? payoutIds.filter((id): id is string => typeof id === "string") : [];
}

export async function createLightningPayout(
  api: Pick<HedlesApi, "createPayout">,
  invoice: string,
  reference?: string,
): Promise<PayoutResponse> {
  try {
    return await api.createPayout({
      chain: "lightning",
      asset: "BTC",
      invoice,
      ...(reference ? { reference } : {}),
    });
  } catch (error) {
    if (error instanceof HedlesApiError && apiErrorCode(error) === "lightning_fees_unsigned") {
      throw new LightningFeesUnsignedError(waitingPayoutIds(error));
    }
    throw error;
  }
}

// A cosigned payout returns one signing request per round. Each round can only
// be built after the previous one is published, so the loop stamps whatever the
// latest response carries until the payout leaves `pending`. A custodial payout
// is already `processing` and passes straight through.
export async function signLightningPayout(
  api: PayoutSigningApi,
  payout: PayoutResponse,
  stamper: Stamper,
  poll: Poll = DEFAULT_POLL,
): Promise<PayoutResponse> {
  let current = payout;
  for (let round = 0; round < MAX_SIGNING_ROUNDS; round += 1) {
    if (current.status !== "pending") return current;
    if (current.signingRequests.length === 0) {
      // Another session holds the payout (signingError operation_in_progress).
      current = await waitFor(
        api,
        current.id,
        poll,
        (next) => next.signingRequests.length > 0 || next.status !== "pending",
      );
      continue;
    }
    try {
      current = await api.submitPayoutSignatures(
        current.id,
        await stampActivities(current.signingRequests, stamper),
      );
    } catch (error) {
      // Spark refuses a round held longer than 10 minutes; a read rebuilds it.
      if (apiErrorCode(error) !== "lightning_approval_expired") throw error;
      current = await api.getPayout(current.id);
    }
  }
  throw new Error(`payout ${current.id} still needs signatures after ${MAX_SIGNING_ROUNDS} rounds`);
}

export function waitForPayoutOutcome(
  api: Pick<HedlesApi, "getPayout">,
  payoutId: string,
  poll: Poll = DEFAULT_POLL,
): Promise<PayoutResponse> {
  return waitFor(api, payoutId, poll, (payout) => payout.status === "settled" || payout.status === "failed");
}

// An expired or cancelled payin keeps its invoice payable, so only `confirmed`
// ends the wait.
export async function waitForPayinConfirmed(
  api: Pick<HedlesApi, "getPayin">,
  payinId: string,
  poll: Poll = DEFAULT_POLL,
): Promise<PayinResponse> {
  const sleep = poll.sleep ?? Bun.sleep;
  const now = poll.now ?? Date.now;
  const deadline = now() + poll.timeoutMs;
  for (;;) {
    const payin = await api.getPayin(payinId);
    if (payin.status === "confirmed") return payin;
    if (now() >= deadline) throw new Error(`payin ${payinId} is still ${payin.status}`);
    await sleep(poll.intervalMs);
  }
}

async function waitFor(
  api: Pick<HedlesApi, "getPayout">,
  payoutId: string,
  poll: Poll,
  done: (payout: PayoutResponse) => boolean,
): Promise<PayoutResponse> {
  const sleep = poll.sleep ?? Bun.sleep;
  const now = poll.now ?? Date.now;
  const deadline = now() + poll.timeoutMs;
  for (;;) {
    await sleep(poll.intervalMs);
    const payout = await api.getPayout(payoutId);
    if (done(payout)) return payout;
    if (now() >= deadline) throw new Error(`payout ${payoutId} is still ${payout.status}`);
  }
}

// The tenant's Spark wallet is its omnibus address enabled on lightning; it
// exists only once Hedles has set Lightning up for the organization.
export async function findLightningWallet(
  api: Pick<HedlesApi, "listAddresses">,
): Promise<AddressPage["items"][number]> {
  const page = await api.listAddresses({ chain: "lightning", role: "omnibus", limit: 1 });
  const [wallet] = page.items;
  if (!wallet) throw new Error("this tenant has no Lightning wallet yet (lightning_not_enabled)");
  return wallet;
}

export async function lightningBalance(
  api: LightningWalletApi,
): Promise<{ walletId: string; sparkAddress: string; sats: string | null; error: string | null }> {
  const wallet = await findLightningWallet(api);
  const balance = await api.getAddressBalance(wallet.id, { chain: "lightning", asset: "BTC" });
  const chain = balance.chains.find((entry) => entry.chain === "lightning");
  const btc = chain?.assets?.find((entry) => entry.asset === "BTC");
  return {
    walletId: wallet.id,
    sparkAddress: wallet.address,
    sats: btc?.atomic ?? null,
    error: chain?.error ?? null,
  };
}
