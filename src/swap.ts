import { bitgo, ECPair, type Network, networks } from "@bitgo/utxo-lib";
import { type HedlesApi, HedlesApiError } from "./api.ts";
import type { RoundWait } from "./payout.ts";
import type {
  RequestSwapQuoteInput,
  SignedSwapActivity,
  Stamper,
  SubmitSwapSignaturesResponse,
  SwapQuoteResponse,
  SwapResponse,
} from "./types.ts";

// Swap funding transactions are PSBTs on the UTXO chains Hedles can quote as
// the sell leg. The network selects address encoding and the sighash scheme
// (Zcash differs), so it must match the quote's sell chain exactly.
const FUNDING_NETWORKS: Record<string, Network> = {
  bitcoin: networks.bitcoin,
  "bitcoin-testnet": networks.testnet,
  litecoin: networks.litecoin,
  "litecoin-testnet": networks.litecoinTest,
  "bitcoin-cash": networks.bitcoincash,
  "bitcoin-cash-testnet": networks.bitcoincashTestnet,
  dogecoin: networks.dogecoin,
  "dogecoin-testnet": networks.dogecoinTest,
  zcash: networks.zcash,
  "zcash-testnet": networks.zcashTest,
};

export const SWAP_FUNDING_CHAINS = Object.keys(FUNDING_NETWORKS);

export function fundingNetwork(sellChain: string): Network {
  const network = FUNDING_NETWORKS[sellChain];
  if (!network) {
    throw new Error(
      `${sellChain} is not a supported swap sell chain; expected one of ${SWAP_FUNDING_CHAINS.join(", ")}`,
    );
  }
  return network;
}

export type FundingPsbt = ReturnType<typeof bitgo.createPsbtDecode>;

export interface FundingSigner {
  sign: (psbt: FundingPsbt) => void;
}

// ECPair validates the network's address prefixes as single bytes, which
// Zcash's two-byte prefixes fail. Key import only needs the WIF prefix, so hand
// it a reduced network; the PSBT itself still carries the real one.
function keyNetwork(network: Network): Network {
  return { ...network, pubKeyHash: 0x00, scriptHash: 0x05 };
}

// Accepts the sender key as WIF or as 32-byte hex. The key must control the
// quote's senderAddress; it never leaves the process.
export function utxoKeyPair(secret: string, chain: string) {
  const network = keyNetwork(fundingNetwork(chain));
  const trimmed = secret.trim();
  return /^(0x)?[0-9a-fA-F]{64}$/.test(trimmed)
    ? ECPair.fromPrivateKey(Buffer.from(trimmed.replace(/^0x/i, ""), "hex"), { network })
    : ECPair.fromWIF(trimmed, network);
}

export function fundingSigner(secret: string, sellChain: string): FundingSigner {
  const keyPair = utxoKeyPair(secret, sellChain);
  return {
    sign: (psbt) => {
      psbt.signAllInputs(keyPair);
    },
  };
}

// Signs the quoted PSBT without changing it. The server re-derives the
// unsigned transaction from the signed PSBT and rejects any difference, so the
// only thing added here is input signatures.
export function signFundingTransaction(
  sellChain: string,
  fundingTransaction: string,
  signer: FundingSigner,
): string {
  const network = fundingNetwork(sellChain);
  const psbt = bitgo.createPsbtDecode(fundingTransaction, network);
  signer.sign(psbt);
  if (!psbt.validateSignaturesOfAllInputs()) {
    throw new Error("the signing key does not control every input of the funding transaction");
  }
  return psbt.toBase64();
}

type SwapApi = Pick<HedlesApi, "requestSwapQuote" | "getSwapQuote" | "acceptSwapQuote">;

export interface ExecuteSwapResult {
  quote: SwapQuoteResponse;
  signature: string;
  swap: SwapResponse;
}

export function assertQuoteAcceptable(quote: SwapQuoteResponse, now = Date.now()): void {
  if (quote.status === "accepted") throw new Error(`quote ${quote.id} was already accepted`);
  if (quote.status === "expired" || Date.parse(quote.expiresAt) <= now) {
    throw new Error(`quote ${quote.id} expired at ${quote.expiresAt}; request a new quote`);
  }
}

// Quote → sign → accept. Keep the returned signature: a retry of the accept
// call must resubmit these exact signed bytes, not sign the quote again.
export async function executeSwap(
  api: SwapApi,
  input: RequestSwapQuoteInput,
  signer: FundingSigner,
): Promise<ExecuteSwapResult> {
  return acceptQuote(api, await api.requestSwapQuote(input), signer);
}

export async function acceptQuote(
  api: SwapApi,
  quote: SwapQuoteResponse,
  signer: FundingSigner,
): Promise<ExecuteSwapResult> {
  assertQuoteAcceptable(quote);
  const signature = signFundingTransaction(quote.sellChain, quote.fundingTransaction, signer);
  const swap = await api.acceptSwapQuote({ quoteId: quote.id, token: quote.token, signature });
  return { quote, signature, swap };
}

type ManagedSwapApi = Pick<HedlesApi, "prepareSwapSigning" | "submitSwapSignatures" | "getSwap">;

// A Hedles wallet never signs the venue's transaction: Hedles funds the swap
// with its own payout, and the quote's signingRequests are that payout's.
// Stamp each body unchanged and return it with its quote-bound token. A first
// EVM payout takes two rounds (authorization, then transaction). A ZEC sell
// funded from mining rewards takes two rounds with a pause between them while
// Hedles proves its first transaction, and the swap only exists once Hedles
// sends the second; an empty answer means wait, then read the swap or ask for
// the next round again.
const MAX_SIGNING_ROUNDS = 4;
// The second Zcash transaction waits for the first to be mined (about 75 s a
// block), so the swap can take several minutes to appear.
export const MANAGED_SWAP_WAIT: RoundWait = { intervalMs: 5_000, timeoutMs: 30 * 60_000 };

type ManagedSwapStep = SubmitSwapSignaturesResponse | SwapResponse;

export async function signManagedSwap(
  api: ManagedSwapApi,
  quoteId: string,
  token: string,
  stamper: Stamper,
  wait: RoundWait = MANAGED_SWAP_WAIT,
): Promise<ManagedSwapStep> {
  let pending: ManagedSwapStep = await api.prepareSwapSigning({ quoteId, token });
  for (let round = 0; round < MAX_SIGNING_ROUNDS; round += 1) {
    if (!("signingRequests" in pending)) return pending;
    if (pending.signingRequests.length === 0) pending = await waitForSwapStep(api, quoteId, token, wait);
    if (!("signingRequests" in pending)) return pending;
    const stamped: SignedSwapActivity[] = await Promise.all(
      pending.signingRequests.map(async (request) => {
        const stamp = await stamper.stamp(request.body);
        return {
          id: request.id,
          method: request.method,
          body: request.body,
          token: request.token,
          stamp: { name: stamp.stampHeaderName, value: stamp.stampHeaderValue },
        };
      }),
    );
    pending = await api.submitSwapSignatures(quoteId, stamped);
  }
  if ("signingRequests" in pending && pending.signingRequests.length === 0) {
    return waitForSwapStep(api, quoteId, token, wait);
  }
  throw new Error(`quote ${quoteId} still needs signatures after ${MAX_SIGNING_ROUNDS} rounds`);
}

// The swap is accepted once its funding is sent; until then GET /v1/swaps/:id
// answers 404 and posting {quoteId, token} again returns the current round.
async function waitForSwapStep(
  api: ManagedSwapApi,
  quoteId: string,
  token: string,
  wait: RoundWait,
): Promise<ManagedSwapStep> {
  const sleep = wait.sleep ?? Bun.sleep;
  const now = wait.now ?? Date.now;
  const deadline = now() + wait.timeoutMs;
  for (;;) {
    await sleep(wait.intervalMs);
    try {
      return await api.getSwap(quoteId);
    } catch (err) {
      if (!(err instanceof HedlesApiError) || err.status !== 404) throw err;
    }
    const next = await api.prepareSwapSigning({ quoteId, token });
    if (!("signingRequests" in next) || next.signingRequests.length > 0) return next;
    if (now() >= deadline)
      throw new Error(`quote ${quoteId} has no next signing round and no accepted swap yet`);
  }
}
