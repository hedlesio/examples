import type { HedlesApi } from "./api.ts";
import { optionalEnv, turnkeyCredentials } from "./config.ts";
import { createTurnkeyStamper, stampIdentity } from "./turnkey.ts";
import type { SessionResponse, Stamper } from "./types.ts";

type SessionApi = Pick<HedlesApi, "bootstrapSession" | "createSession">;

export async function obtainSession(
  api: SessionApi,
  stamper: Stamper,
  organizationId?: string,
): Promise<SessionResponse> {
  const resolvedOrganizationId = organizationId ?? (await api.bootstrapSession()).organizationId;
  const body = JSON.stringify({ organizationId: resolvedOrganizationId });
  return api.createSession(await stampIdentity(body, stamper));
}

export async function resolveSessionToken(api: SessionApi, organizationId?: string): Promise<string> {
  const existing = optionalEnv("HEDLES_SESSION_TOKEN");
  if (existing) return existing;
  const stamper = createTurnkeyStamper(turnkeyCredentials());
  return (await obtainSession(api, stamper, organizationId)).session;
}
