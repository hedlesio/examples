import type { HedlesApi } from "./api.ts";
import { completePayoutSigning } from "./payout.ts";
import type { Chain, PayinResponse, PayinStatus, PayoutResponse, PayoutStatus, Stamper } from "./types.ts";

export interface Poll {
  intervalMs: number;
  timeoutMs: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export const DEFAULT_POLL: Poll = { intervalMs: 15_000, timeoutMs: 2 * 60 * 60 * 1000 };

const PAYIN_ENDED: Record<PayinStatus, boolean> = {
  awaiting_payment: false,
  pending: false,
  confirmed: true,
  expired: true,
  cancelled: true,
};

const PAYOUT_ENDED: Record<PayoutStatus, boolean> = {
  pending: false,
  signed: false,
  broadcast: false,
  processing: false,
  settled: true,
  failed: true,
};

async function pollUntil<T>(read: () => Promise<T>, done: (value: T) => boolean, poll: Poll, what: string) {
  const sleep = poll.sleep ?? Bun.sleep;
  const now = poll.now ?? Date.now;
  const deadline = now() + poll.timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (now() >= deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(poll.intervalMs);
  }
}

export async function omnibusAddress(api: Pick<HedlesApi, "listAddresses">, chain: Chain): Promise<string> {
  const page = await api.listAddresses({ chain, role: "omnibus", status: "active", limit: 1 });
  const omnibus = page.items[0];
  if (!omnibus) throw new Error(`the tenant has no active omnibus on ${chain}`);
  return omnibus.address;
}

// A payin is credited once it reaches the chain's confirmation threshold;
// `pending` means the deposit was seen but is not final yet.
export async function waitForPayin(
  api: Pick<HedlesApi, "getPayin">,
  payinId: string,
  poll: Poll = DEFAULT_POLL,
  onStatus: (payin: PayinResponse) => void = () => {},
): Promise<PayinResponse> {
  let last: PayinStatus | null = null;
  const payin = await pollUntil(
    async () => {
      const row = await api.getPayin(payinId);
      if (row.status !== last) onStatus(row);
      last = row.status;
      return row;
    },
    (row) => PAYIN_ENDED[row.status],
    poll,
    `payin ${payinId}`,
  );
  if (payin.status !== "confirmed") throw new Error(`payin ${payinId} ended ${payin.status}`);
  return payin;
}

// `all` moves the address's whole balance of the asset. The reference makes a
// rerun return the same payout instead of creating a second sweep.
export async function sweepToOmnibus(
  api: Pick<HedlesApi, "createPayout" | "submitPayoutSignatures" | "getPayout">,
  payin: PayinResponse,
  omnibus: string,
  stamper: Stamper,
): Promise<PayoutResponse> {
  const { chain } = payin;
  if (chain === "lightning")
    throw new Error("a Lightning payin is credited to the Spark wallet; there is nothing to sweep");
  const created = await api.createPayout({
    chain,
    asset: payin.asset,
    fromAddress: payin.address,
    transfers: [{ toAddress: omnibus, amount: "all" }],
    reference: `sweep-${payin.id}`,
  });
  return completePayoutSigning(api, created, stamper);
}

export async function waitForPayout(
  api: Pick<HedlesApi, "getPayout">,
  payoutId: string,
  poll: Poll = DEFAULT_POLL,
): Promise<PayoutResponse> {
  const payout = await pollUntil(
    () => api.getPayout(payoutId),
    (row) => PAYOUT_ENDED[row.status],
    poll,
    `payout ${payoutId}`,
  );
  if (payout.status === "failed")
    throw new Error(`payout ${payoutId} failed: ${payout.lastError ?? "no reason given"}`);
  return payout;
}

export interface ReceiveInput {
  chain: Exclude<Chain, "lightning">;
  asset: string;
  amount: string;
  reference?: string;
  sweepTo?: string;
}

type ReceiveApi = Pick<
  HedlesApi,
  "createPayin" | "getPayin" | "listAddresses" | "createPayout" | "submitPayoutSignatures" | "getPayout"
>;

export async function receiveAndSweep(
  api: ReceiveApi,
  input: ReceiveInput,
  stamper: Stamper,
  poll: Poll = DEFAULT_POLL,
  log: (line: string) => void = console.log,
): Promise<{ payin: PayinResponse; payout: PayoutResponse }> {
  const created = await api.createPayin({
    chain: input.chain,
    asset: input.asset,
    amount: input.amount,
    ...(input.reference ? { reference: input.reference } : {}),
  });
  // Hedles ignores transfers sent from the tenant's own omnibus or payin
  // addresses: moving funds internally is not a payment.
  log(
    `payin ${created.id}: send ${input.amount} ${input.asset} (atomic units) on ${input.chain} to ${created.address} from a wallet outside Hedles`,
  );
  const payin = await waitForPayin(api, created.id, poll, (row) => log(`payin ${row.id}: ${row.status}`));
  const omnibus = input.sweepTo ?? (await omnibusAddress(api, input.chain));
  const sweep = await sweepToOmnibus(api, payin, omnibus, stamper);
  log(`payout ${sweep.id}: sweeping ${payin.address} to ${omnibus}`);
  const payout = await waitForPayout(api, sweep.id, poll);
  log(`payout ${payout.id}: settled in ${payout.txHash}`);
  return { payin, payout };
}
