import type { TurnkeyCredentials } from "./types.ts";

const DEFAULT_API_URL = "https://api-dev.hedles.io";

export function apiUrl(): string {
  return optionalEnv("HEDLES_API_URL") ?? DEFAULT_API_URL;
}

export function optionalEnv(name: string): string | undefined {
  const value = Bun.env[name]?.trim();
  return value || undefined;
}

export function requiredEnv(name: string): string {
  const value = optionalEnv(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function turnkeyCredentials(): TurnkeyCredentials {
  return {
    publicKey: requiredEnv("TURNKEY_API_PUBLIC_KEY"),
    privateKey: requiredEnv("TURNKEY_API_PRIVATE_KEY"),
  };
}

export function positiveIntegerEnv(name: string, fallback?: number): number | undefined {
  const raw = optionalEnv(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

export function uint32Env(name: string): number | undefined {
  const raw = optionalEnv(name);
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`${name} must be an integer between 0 and 4294967295`);
  }
  return value;
}

export function custodyMode(): "custodial" | "cosigned" {
  const mode = optionalEnv("HEDLES_CUSTODY_MODE") ?? "cosigned";
  if (mode !== "custodial" && mode !== "cosigned") {
    throw new Error("HEDLES_CUSTODY_MODE must be custodial or cosigned");
  }
  return mode;
}
