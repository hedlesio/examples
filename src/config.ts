import type { ApiKeyCredentials } from "./types.ts";

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

export function apiKeyCredentials(): ApiKeyCredentials {
  return {
    publicKey: requiredEnv("HEDLES_API_PUBLIC_KEY"),
    privateKey: requiredEnv("HEDLES_API_PRIVATE_KEY"),
  };
}
