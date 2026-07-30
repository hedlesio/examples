import { generateP256KeyPair } from "@turnkey/crypto";
import { obtainSession } from "../src/auth.ts";
import { custodyMode, optionalEnv, requiredEnv } from "../src/config.ts";
import { printJson, publicApi, runExample } from "../src/runtime.ts";
import { createTurnkeyStamper } from "../src/turnkey.ts";
import type { TurnkeyCredentials } from "../src/types.ts";

function claimCredentials(): { credentials: TurnkeyCredentials; generated: boolean } {
  const publicKey = optionalEnv("TURNKEY_API_PUBLIC_KEY");
  const privateKey = optionalEnv("TURNKEY_API_PRIVATE_KEY");

  if (publicKey && privateKey) {
    return { credentials: { publicKey, privateKey }, generated: false };
  }
  if (publicKey || privateKey) {
    throw new Error("Set both TURNKEY_API_PUBLIC_KEY and TURNKEY_API_PRIVATE_KEY, or leave both empty");
  }

  const generated = generateP256KeyPair();
  return {
    credentials: {
      publicKey: generated.publicKey,
      privateKey: generated.privateKey,
    },
    generated: true,
  };
}

await runExample(async () => {
  const api = publicApi();
  const tenantId = requiredEnv("HEDLES_TENANT_ID");
  const claimCode = requiredEnv("HEDLES_CLAIM_CODE");
  const claim = await api.beginClaim(tenantId);
  const verified = await api.verifyClaimCode(tenantId, claimCode);
  const { credentials, generated } = claimCredentials();

  const completed = await api.completeClaim(tenantId, {
    claimTicket: verified.claimTicket,
    userName: optionalEnv("HEDLES_USER_NAME") ?? verified.email,
    mode: custodyMode(),
    credential: {
      type: "apiKey",
      apiKeyPublicKey: credentials.publicKey,
      curveType: "API_KEY_CURVE_P256",
    },
  });

  const session = await obtainSession(api, createTurnkeyStamper(credentials));
  printJson({
    claim,
    completed,
    credentials: generated ? credentials : { publicKey: credentials.publicKey, source: "environment" },
    session,
  });

  if (generated) {
    console.error("A new private key was printed once. Store it securely before closing this terminal.");
  }
});
