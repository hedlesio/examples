import type { TurnkeyCredentials } from "./types.ts";

export const DEFAULT_API_URL = "https://api-dev.hedles.io";

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
