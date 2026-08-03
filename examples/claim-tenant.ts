import { generateP256KeyPair } from "@turnkey/crypto";
import { completeTenantClaim } from "../src/claim.ts";
import { apiOptions, choice, parseCommand } from "../src/cli.ts";
import { optionalEnv } from "../src/config.ts";
import { printJson, publicApi, runExample } from "../src/runtime.ts";
import type { TurnkeyCredentials } from "../src/types.ts";

function claimCredentials(): { credentials: TurnkeyCredentials; generated: boolean } {
  const publicKey = optionalEnv("HEDLES_API_PUBLIC_KEY");
  const privateKey = optionalEnv("HEDLES_API_PRIVATE_KEY");

  if (publicKey && privateKey) {
    return { credentials: { publicKey, privateKey }, generated: false };
  }
  if (publicKey || privateKey) {
    throw new Error("Set both HEDLES_API_PUBLIC_KEY and HEDLES_API_PRIVATE_KEY, or leave both empty");
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
  const options = parseCommand({
    name: "claim",
    description: "Claim a tenant and create its first session.",
    options: {
      ...apiOptions,
      tenantId: {
        description: "Tenant UUID from the claim link",
        valueName: "uuid",
        required: true,
      },
      claimCode: {
        description: "Emailed one-time verification code",
        valueName: "code",
        required: true,
      },
      userName: {
        description: "Owner name; defaults to verified email",
        valueName: "name",
      },
      custodyMode: {
        description: "Tenant custody mode",
        valueName: "mode",
        defaultValue: "cosigned",
      },
    },
  });
  if (!options) return;

  const { credentials, generated } = claimCredentials();
  const result = await completeTenantClaim(publicApi(options.apiUrl), {
    tenantId: options.tenantId,
    claimCode: options.claimCode,
    ...(options.userName ? { userName: options.userName } : {}),
    custodyMode: choice(options.custodyMode, "--custody-mode", ["cosigned", "custodial"]),
    credentials,
  });
  printJson({
    ...result,
    credentials: generated ? credentials : { publicKey: credentials.publicKey, source: "environment" },
  });

  if (generated) {
    console.error("A new private key was printed once. Store it securely before closing this terminal.");
  }
});
