import type { HedlesApi } from "./api.ts";
import { obtainSession } from "./auth.ts";
import { createTurnkeyStamper } from "./turnkey.ts";
import type {
  BeginClaimResponse,
  ClaimDeliveryResponse,
  ClaimResponse,
  SessionResponse,
  TurnkeyCredentials,
} from "./types.ts";

type ClaimApi = Pick<
  HedlesApi,
  "beginClaim" | "verifyClaimCode" | "completeClaim" | "bootstrapSession" | "createSession"
>;

export interface ClaimDelivery {
  claimUrl: string;
  code: string;
  expiresAt: string;
}

export interface CompleteTenantClaimInput {
  tenantId: string;
  claimCode: string;
  userName?: string;
  custodyMode: "custodial" | "cosigned";
  credentials: TurnkeyCredentials;
}

export interface CompleteTenantClaimResult {
  claim: BeginClaimResponse;
  completed: ClaimResponse;
  session: SessionResponse;
}

export function requireExternalClaimDelivery(response: ClaimDeliveryResponse): ClaimDelivery {
  if (!response.externalClaimDelivery || response.claimEmailSent) {
    throw new Error("The API did not return a self-managed claim delivery");
  }

  return {
    claimUrl: response.claimUrl,
    code: response.externalClaimDelivery.code,
    expiresAt: response.externalClaimDelivery.expiresAt,
  };
}

export async function completeTenantClaim(
  api: ClaimApi,
  input: CompleteTenantClaimInput,
): Promise<CompleteTenantClaimResult> {
  const claim = await api.beginClaim(input.tenantId);
  const verified = await api.verifyClaimCode(input.tenantId, input.claimCode);
  const completed = await api.completeClaim(input.tenantId, {
    claimTicket: verified.claimTicket,
    userName: input.userName ?? verified.email,
    mode: input.custodyMode,
    credential: {
      type: "apiKey",
      apiKeyPublicKey: input.credentials.publicKey,
      curveType: "API_KEY_CURVE_P256",
    },
  });
  const session = await obtainSession(api, createTurnkeyStamper(input.credentials));

  return { claim, completed, session };
}
