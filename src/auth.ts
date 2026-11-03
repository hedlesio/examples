import { chmod, writeFile } from "node:fs/promises";
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

// Reused only while comfortably inside its lifetime, so a command started
// near expiry does not run with a token that lapses mid-request.
const SESSION_REUSE_MARGIN_MS = 5 * 60_000;

// Many example processes started together each log in, and logins are rate
// limited per client, so they can share one session through a file instead.
// The file holds a bearer credential and is readable by its owner only.
export async function cachedSessionToken(
  path: string,
  obtain: () => Promise<BearerSessionResponse>,
  now = Date.now(),
): Promise<string> {
  const file = Bun.file(path);
  if (await file.exists()) {
    const cached = (await file.json().catch(() => null)) as { session?: unknown; expiresAt?: unknown } | null;
    if (
      typeof cached?.session === "string" &&
      typeof cached.expiresAt === "number" &&
      cached.expiresAt - SESSION_REUSE_MARGIN_MS > now
    ) {
      return cached.session;
    }
  }
  const fresh = await obtain();
  await writeFile(path, JSON.stringify({ session: fresh.session, expiresAt: now + fresh.expiresIn * 1000 }), {
    mode: 0o600,
  });
  await chmod(path, 0o600);
  return fresh.session;
}

export async function resolveSessionToken(api: SessionApi, organizationId?: string): Promise<string> {
  const existing = optionalEnv("HEDLES_SESSION_TOKEN");
  if (existing) return existing;
  const obtain = () => obtainSession(api, createStamper(apiKeyCredentials()), organizationId);
  const cache = optionalEnv("HEDLES_SESSION_CACHE");
  if (cache) return cachedSessionToken(cache, obtain);
  return (await obtain()).session;
}
