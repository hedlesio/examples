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
  address_role: string;
  status: string;
  isSignable: boolean;
  derivation_path: string | null;
  created_at: string;
  updated_at: string;
  deletedAt: string | null;
  chains: Array<{ chainKey: string }>;
}

export interface PreparedAddressActivity {
  prepared: {
    body: string;
  };
}

export type CreateAddressResponse = AddressEntry | PreparedAddressActivity;

export interface CreatePayinInput {
  chainKey: string;
  assetKey: string;
  amount: string;
  reference?: string;
  metadata?: Record<string, string>;
  expiresIn?: number;
  addressId?: string;
}

export interface PayinResponse {
  id: string;
  status: string;
  reference: string | null;
  metadata: Record<string, string> | null;
  chainKey: string;
  assetKey: string;
  address: string;
  expectedAmount: string | null;
  amount: string | null;
  txHash: string | null;
  confirmations: number;
  createdAt: string;
  confirmedAt: string | null;
  expiresAt: string | null;
}

export interface CreatePayoutInput {
  chain: string;
  asset: string;
  fromAddress: string;
  toAddress: string;
  amount: string;
  destinationTag?: number;
  note?: string;
}

export interface TurnkeyAuthorization {
  required: number;
  received: number;
  remaining: number;
  approvers: string[];
}

export interface PreparedTurnkeyActivity {
  id: string;
  body: string;
  token: string;
  authorization: TurnkeyAuthorization;
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

export interface PayoutSigningState {
  stage: "evm" | "solana" | "tron" | "utxo" | "xrp";
  requests: PreparedTurnkeyActivity[];
}

export interface PayoutResponse {
  id: string;
  chain: string;
  asset: string;
  fromAddress: string;
  toAddress: string;
  amount: string;
  kind: string;
  status: string;
  unsignedTx: string | null;
  txHash: string | null;
  note: string | null;
  createdAt: string;
  broadcastAt: string | null;
  settledAt: string | null;
  signing: PayoutSigningState | null;
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
      };
    }
  | {
      event: "payout.broadcast";
      data: { payoutId: string; txHash: string; amount: string; chain: string; asset: string };
    }
  | {
      event: "payout.settled";
      data: { payoutId: string; txHash: string; amount: string; chain: string; asset: string };
    }
  | {
      event: "payout.failed";
      data: { payoutId: string; amount: string; chain: string; asset: string; reason: string };
    };
