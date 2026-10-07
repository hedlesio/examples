export interface TurnkeyStamp {
  stampHeaderName: string;
  stampHeaderValue: string;
}

export interface Stamper {
  stamp(input: string): Promise<TurnkeyStamp>;
}

export interface TurnkeyCredentials {
  publicKey: string;
  privateKey: string;
}

export interface SignedIdentityRequest {
  body: string;
  stampHeaderName: string;
  stampHeaderValue: string;
}

export interface SessionResponse {
  session: string;
  tenantId: string;
  tenantKind: "platform" | "merchant";
  userId: string;
  expiresIn: number;
}

export interface ClaimResponse {
  tenantId: string;
  rootUserId: string;
  mode: "custodial" | "cosigned";
}

export interface AddressEntry {
  id: string;
  tenant_id: string;
  chainType: string;
  address: string;
  address_kind: string;
  address_role: string;
  status: string;
  isSignable: boolean;
  derivation_path: string | null;
  created_at: string;
  updated_at: string;
  deletedAt: string | null;
  whitelistedAt: string | null;
  chains: Array<{ chainKey: string }>;
}

export interface CreatePayinInput {
  chainKey: string;
  assetKey: string;
  amount: string;
  reference?: string;
  expiresIn?: number;
  addressId?: string;
}

export type PayinClassification = "matched" | "expired" | "pending";

export interface PayinResponse {
  id: string;
  status: string;
  reference: string | null;
  chainKey: string;
  assetKey: string;
  address: string;
  addressId: string;
  fromAddress: string | null;
  expectedAmount: string | null;
  amount: string | null;
  txHash: string | null;
  confirmations: number;
  classification: PayinClassification;
  createdAt: string;
  confirmedAt: string | null;
  expiresAt: string | null;
}

export interface PayoutTransferInput {
  toAddress: string;
  amount: string;
  destinationTag?: number;
}

export interface CreatePayoutInput {
  chain: string;
  asset: string;
  fromAddress: string;
  transfers: PayoutTransferInput[];
  reference?: string;
}

export interface SigningRequest {
  id: string;
  body: string;
  token: string;
}

export interface SignedTurnkeyActivity {
  id: string;
  body: string;
  token: string;
  stamp: {
    name: string;
    value: string;
  };
}

export type TransferStatus = "pending" | "settled" | "failed";

export interface TransferRow {
  id: string;
  position: number;
  kind: "recipient" | "fee";
  asset: string;
  fromAddress: string;
  toAddress: string;
  amount: string;
  status: TransferStatus;
  error: string | null;
  createdAt: string;
  settledAt: string | null;
}

export interface PayoutSigningError {
  code: string;
  chain?: string;
  category?: string;
  detail?: string;
}

export interface PayoutResponse {
  id: string;
  chain: string;
  asset: string;
  fromAddress: string;
  toAddress: string;
  amount: string;
  feeTotal: string | null;
  kind: "payout" | "deposit_account_payout";
  status: "pending" | "prepared" | "ready" | "signed" | "broadcast" | "settled" | "failed";
  unsignedTx: string | null;
  signedTx: string | null;
  txHash: string | null;
  nonce: string | null;
  confirmations: number;
  requiredConfirmations: number;
  reference: string | null;
  lastError: string | null;
  transfers: TransferRow[];
  createdAt: string;
  broadcastAt: string | null;
  settledAt: string | null;
  signingRequests: SigningRequest[];
  signingError?: PayoutSigningError;
}

export interface PayoutPreparation {
  signingRequests: SigningRequest[];
}

export type CreatePayoutResponse = PayoutResponse | PayoutPreparation;

export interface RequestSwapQuoteInput {
  sellChain: string;
  sellAsset: string;
  buyChain: string;
  buyAsset: string;
  amount: string;
  side: "sell" | "buy";
  senderAddress: string;
  recipientAddress: string;
}

export interface SwapQuoteResponse {
  id: string;
  status: "quoted" | "expired" | "accepted";
  sellChain: string;
  sellAsset: string;
  buyChain: string;
  buyAsset: string;
  sellAmount: string;
  quotedBuyAmount: string;
  minimumBuyAmount: string;
  quotedRate: string;
  venueFundingAddress: string;
  fundingMemo: string | null;
  fundingTransaction: string;
  token: string;
  expiresAt: string;
  createdAt: string;
}

export interface AcceptSwapQuoteInput {
  quoteId: string;
  token: string;
  signature: string;
}

export interface SwapResponse {
  id: string;
  status: "quoted" | "pending" | "executing" | "executed" | "expired" | "failed";
  sellChain: string;
  sellAsset: string;
  buyChain: string;
  buyAsset: string;
  sellAmount: string;
  quotedBuyAmount: string;
  minimumBuyAmount: string;
  quotedRate: string;
  venueFundingAddress: string;
  fundingTxHash: string;
  failureReason: string | null;
  executedAt: string | null;
  acceptedAt: string;
  createdAt: string;
}

export interface WebhookTransfer {
  transferId: string;
  position: number;
  kind: "recipient" | "fee";
  asset: string;
  fromAddress: string;
  toAddress: string;
  amount: string;
  status: TransferStatus;
  error: string | null;
}

export type WebhookEvent =
  | {
      event: "payin.pending";
      data: { payinId: string; txHash: string; amount: string; chain: string; fromAddress: string | null };
    }
  | {
      event: "payin.confirmed";
      data: {
        payinId: string;
        txHash: string;
        blockNumber: number;
        confirmations: number;
        chain: string;
        fromAddress: string | null;
      };
    }
  | {
      event: "payin.expired";
      data: { payinId: string };
    }
  | {
      event: "payout.created";
      data: {
        payoutId: string;
        amount: string;
        chain: string;
        asset: string;
        fromAddress: string;
        toAddress: string;
        transfers: WebhookTransfer[];
      };
    }
  | {
      event: "payout.broadcast";
      data: {
        payoutId: string;
        txHash: string;
        amount: string;
        chain: string;
        asset: string;
        transfers: WebhookTransfer[];
      };
    }
  | {
      event: "payout.settled";
      data: {
        payoutId: string;
        txHash: string;
        amount: string;
        chain: string;
        asset: string;
        transfers: WebhookTransfer[];
      };
    }
  | {
      event: "payout.failed";
      data: {
        payoutId: string;
        amount: string;
        chain: string;
        asset: string;
        reason: string;
        transfers: WebhookTransfer[];
      };
    }
  | {
      event: "swap.accepted";
      data: {
        swapId: string;
        sellChain: string;
        sellAsset: string;
        buyChain: string;
        buyAsset: string;
        sellAmount: string;
        quotedBuyAmount: string;
        minimumBuyAmount: string;
        venueFundingAddress: string;
        fundingTxHash: string;
      };
    }
  | {
      event: "swap.executing";
      data: { swapId: string; fundingTxHash: string; trackingReference: string | null };
    }
  | {
      event: "swap.executed";
      data: {
        swapId: string;
        sellAmount: string;
        quotedBuyAmount: string;
        minimumBuyAmount: string;
        quotedRate: string;
        executedAt: string;
      };
    }
  | {
      event: "swap.expired";
      data: { swapId: string };
    }
  | {
      event: "swap.failed";
      data: { swapId: string; reason: string };
    };
