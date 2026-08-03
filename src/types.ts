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

export interface BeginClaimResponse {
  tenantId: string;
  tenantName: string;
  tenantKind: "platform" | "merchant";
}

export interface VerifyClaimCodeResponse {
  claimTicket: string;
  email: string;
}

export interface CompleteClaimInput {
  claimTicket: string;
  userName: string;
  mode: "custodial" | "cosigned";
  credential: {
    type: "apiKey";
    apiKeyPublicKey: string;
    curveType: "API_KEY_CURVE_P256";
  };
}

export interface CreateMerchantInput {
  name: string;
  email: string;
  externalClaimDelivery: true;
}

export interface ExternalClaimDelivery {
  code: string;
  expiresAt: string;
}

export interface ClaimDeliveryResponse {
  claimUrl: string;
  claimEmailSent: boolean;
  externalClaimDelivery: ExternalClaimDelivery | null;
}

export interface ResendClaimResponse extends ClaimDeliveryResponse {
  tooSoon?: boolean;
}

export interface CreateMerchantResponse {
  id: string;
  kind: "merchant";
  parentTenantId: string | null;
  name: string;
  email: string | null;
  status: "active" | "suspended" | "archived";
  custodyAttestationId: string | null;
  custodyAttestedByTenantId: string | null;
  custodyAttestedAt: string | null;
  claimed: boolean;
  claimUrl: string;
  createdAt: string;
  omnibusAddress: string | null;
  claimEmailSent: boolean;
  externalClaimDelivery: ExternalClaimDelivery | null;
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
