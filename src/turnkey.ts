import { ApiKeyStamper } from "@turnkey/api-key-stamper";
import type {
  PreparedTurnkeyActivity,
  SignedIdentityRequest,
  SignedTurnkeyActivity,
  Stamper,
  TurnkeyCredentials,
} from "./types.ts";

export function normalizePrivateKey(privateKey: string): string {
  const normalized = privateKey.trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error("TURNKEY_API_PRIVATE_KEY must be a 32-byte hexadecimal P-256 private key");
  }
  return normalized;
}

export function createTurnkeyStamper(credentials: TurnkeyCredentials): Stamper {
  return new ApiKeyStamper({
    apiPublicKey: credentials.publicKey,
    apiPrivateKey: normalizePrivateKey(credentials.privateKey),
  });
}

export async function stampIdentity(body: string, stamper: Stamper): Promise<SignedIdentityRequest> {
  const stamp = await stamper.stamp(body);
  return {
    body,
    stampHeaderName: stamp.stampHeaderName,
    stampHeaderValue: stamp.stampHeaderValue,
  };
}

export async function stampActivities(
  requests: PreparedTurnkeyActivity[],
  stamper: Stamper,
): Promise<SignedTurnkeyActivity[]> {
  return Promise.all(
    requests.map(async (request) => {
      const stamp = await stamper.stamp(request.body);
      return {
        id: request.id,
        body: request.body,
        token: request.token,
        stamp: {
          name: stamp.stampHeaderName,
          value: stamp.stampHeaderValue,
        },
      };
    }),
  );
}
