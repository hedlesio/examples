import type { HedlesApi } from "./api.ts";
import { apiKeyCredentials, optionalEnv } from "./config.ts";
import { stampIdentity } from "./signing.ts";
import { createStamper } from "./stamper.ts";
import type { BearerSessionResponse, Stamper } from "./types.ts";

type SessionApi = Pick<HedlesApi, "bootstrapSession" | "createSession">;

export async function obtainSession(
  api: SessionApi,
  stamper: Stamper,
  organizationId?: string,
): Promise<BearerSessionResponse> {
  const { body } = await api.bootstrapSession(organizationId);
  if (typeof body !== "string" || !body) {
    throw new Error("Login bootstrap did not return a signing body; use a bootstrap-enabled gateway.");
  }
  const response = await api.createSession(await stampIdentity(body, stamper));
  if (!response.session) throw new Error("Login did not return a bearer session token");
  return { ...response, session: response.session };
}

export async function resolveSessionToken(api: SessionApi, organizationId?: string): Promise<string> {
  const existing = optionalEnv("HEDLES_SESSION_TOKEN");
  if (existing) return existing;
  const stamper = createStamper(apiKeyCredentials());
  return (await obtainSession(api, stamper, organizationId)).session;
}
