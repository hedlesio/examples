import { obtainSession } from "../src/auth.ts";
import { apiOptions, choice, parseCommand } from "../src/cli.ts";
import { optionalEnv } from "../src/config.ts";
import { printJson, publicApi, runExample } from "../src/runtime.ts";
import { createStamper, generateKeyPair } from "../src/stamper.ts";
import type { ApiKeyCredentials } from "../src/types.ts";

async function claimCredentials(): Promise<{ credentials: ApiKeyCredentials; generated: boolean }> {
  const publicKey = optionalEnv("HEDLES_API_PUBLIC_KEY");
  const privateKey = optionalEnv("HEDLES_API_PRIVATE_KEY");

  if (publicKey && privateKey) {
    return { credentials: { publicKey, privateKey }, generated: false };
  }
  if (publicKey || privateKey) {
    throw new Error("Set both HEDLES_API_PUBLIC_KEY and HEDLES_API_PRIVATE_KEY, or leave both empty");
  }

  return { credentials: await generateKeyPair(), generated: true };
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

  const api = publicApi(options.apiUrl);
  const tenantId = options.tenantId;
  const claim = await api.beginClaim(tenantId);
  const verified = await api.verifyClaimCode(tenantId, options.claimCode);
  const { credentials, generated } = await claimCredentials();

  const completed = await api.completeClaim(tenantId, {
    claimTicket: verified.claimTicket,
    userName: options.userName ?? verified.email,
    mode: choice(options.custodyMode, "--custody-mode", ["cosigned", "custodial"]),
    credential: {
      type: "apiKey",
      apiKeyPublicKey: credentials.publicKey,
      curveType: "API_KEY_CURVE_P256",
    },
  });

  const session = await obtainSession(api, createStamper(credentials));
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
