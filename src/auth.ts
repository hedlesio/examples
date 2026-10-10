import type { HedlesApi } from "./api.ts";
import { apiKeyCredentials, optionalEnv } from "./config.ts";
import { stampIdentity } from "./signing.ts";
import { createStamper } from "./stamper.ts";
import type { SessionResponse, Stamper } from "./types.ts";

type SessionApi = Pick<HedlesApi, "bootstrapSession" | "createSession">;

export async function obtainSession(
  api: SessionApi,
  stamper: Stamper,
  organizationId?: string,
): Promise<SessionResponse> {
  const resolvedOrganizationId = organizationId ?? (await api.bootstrapSession()).organizationId;
  // The timestamp makes a captured login stamp worth minutes, not forever: the
  // API rejects a body whose timestampMs is outside its tolerance.
  const body = JSON.stringify({ organizationId: resolvedOrganizationId, timestampMs: Date.now().toString() });
  return api.createSession(await stampIdentity(body, stamper));
}

export async function resolveSessionToken(api: SessionApi, organizationId?: string): Promise<string> {
  const existing = optionalEnv("HEDLES_SESSION_TOKEN");
  if (existing) return existing;
  const stamper = createStamper(apiKeyCredentials());
  return (await obtainSession(api, stamper, organizationId)).session;
}
