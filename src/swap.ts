import { bitgo, ECPair, type Network, networks } from "@bitgo/utxo-lib";
import type { HedlesApi } from "./api.ts";
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

type ManagedSwapApi = Pick<HedlesApi, "prepareSwapSigning" | "submitSwapSignatures">;

// A Hedles wallet never signs the venue's transaction: Hedles funds the swap
// with its own payout, and the quote's signingRequests are that payout's.
// Stamp each body unchanged and return it with its quote-bound token.
export async function signManagedSwap(
  api: ManagedSwapApi,
  quoteId: string,
  token: string,
  stamper: Stamper,
): Promise<SubmitSwapSignaturesResponse | SwapResponse> {
  const prepared = await api.prepareSwapSigning({ quoteId, token });
  // A custodial wallet's funding is signed by Hedles; the swap comes back accepted.
  if (!("signingRequests" in prepared)) return prepared;
  const { signingRequests } = prepared;
  if (signingRequests.length === 0) throw new Error(`quote ${quoteId} has nothing for this wallet to sign`);
  const stamped: SignedSwapActivity[] = await Promise.all(
    signingRequests.map(async (request) => {
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
  return api.submitSwapSignatures(quoteId, stamped);
}
