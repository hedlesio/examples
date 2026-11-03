import { open, rename, rm, stat, writeFile } from "node:fs/promises";
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
const LOCK_WAIT_MS = 30_000;
const LOCK_STALE_MS = 60_000;

interface CachedSession {
  context: string;
  session: string;
  expiresAt: number;
}

async function readCached(path: string, context: string, now: number): Promise<string | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  const cached = (await file.json().catch(() => null)) as Partial<CachedSession> | null;
  if (
    cached?.context !== context ||
    typeof cached.session !== "string" ||
    typeof cached.expiresAt !== "number" ||
    cached.expiresAt - SESSION_REUSE_MARGIN_MS <= now
  ) {
    return null;
  }
  return cached.session;
}

// One process logs in at a time; the others wait and then reuse its session.
async function withLock<T>(lockPath: string, work: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      await handle.close();
      break;
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
      const held = await stat(lockPath).catch(() => null);
      if (held && Date.now() - held.mtimeMs > LOCK_STALE_MS) await rm(lockPath, { force: true });
      if (Date.now() > deadline) throw new Error(`Timed out waiting for the session cache lock ${lockPath}`);
      await Bun.sleep(200);
    }
  }
  try {
    return await work();
  } finally {
    await rm(lockPath, { force: true });
  }
}

// Many example processes started together each log in, and logins are rate
// limited per client, so they can share one session through a file instead.
// The file holds a bearer credential, is readable by its owner only, and is
// bound to the API, organization and key it was issued for.
export async function cachedSessionToken(
  path: string,
  context: string,
  obtain: () => Promise<BearerSessionResponse>,
  now: () => number = Date.now,
): Promise<string> {
  const cached = await readCached(path, context, now());
  if (cached) return cached;
  return withLock(`${path}.lock`, async () => {
    const raced = await readCached(path, context, now());
    if (raced) return raced;
    const fresh = await obtain();
    const entry: CachedSession = {
      context,
      session: fresh.session,
      expiresAt: now() + fresh.expiresIn * 1000,
    };
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(entry), { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
    return fresh.session;
  });
}

export async function resolveSessionToken(
  api: SessionApi & Pick<HedlesApi, "baseUrl">,
  organizationId?: string,
): Promise<string> {
  const existing = optionalEnv("HEDLES_SESSION_TOKEN");
  if (existing) return existing;
  const credentials = apiKeyCredentials();
  const obtain = () => obtainSession(api, createStamper(credentials), organizationId);
  const cache = optionalEnv("HEDLES_SESSION_CACHE");
  if (!cache) return (await obtain()).session;
  const context = JSON.stringify([api.baseUrl, organizationId ?? null, credentials.publicKey]);
  return cachedSessionToken(cache, context, obtain);
}
