import { generateP256KeyPair } from "@turnkey/crypto";
import { completeTenantClaim, requireExternalClaimDelivery } from "../src/claim.ts";
import { authenticatedOptions, choice, parseCommand } from "../src/cli.ts";
import { authenticatedApi, printJson, publicApi, runExample } from "../src/runtime.ts";

await runExample(async () => {
  const options = parseCommand({
    name: "merchant-otp",
    description: "Create a merchant, expose its external OTP delivery, claim it, and open its first session.",
    options: {
      ...authenticatedOptions,
      name: {
        description: "Merchant display name",
        valueName: "name",
        required: true,
      },
      email: {
        description: "Pre-registered merchant owner email",
        valueName: "email",
        required: true,
      },
      userName: {
        description: "Merchant owner name; defaults to verified email",
        valueName: "name",
      },
      custodyMode: {
        description: "Merchant custody mode",
        valueName: "mode",
        defaultValue: "cosigned",
      },
    },
  });
  if (!options) return;

  const merchant = await (await authenticatedApi(options.apiUrl, options.organizationId)).createMerchant({
    name: options.name,
    email: options.email,
    externalClaimDelivery: true,
  });
  const delivery = requireExternalClaimDelivery(merchant);
  const credentials = generateP256KeyPair();
  const claimed = await completeTenantClaim(publicApi(options.apiUrl), {
    tenantId: merchant.id,
    claimCode: delivery.code,
    ...(options.userName ? { userName: options.userName } : {}),
    custodyMode: choice(options.custodyMode, "--custody-mode", ["cosigned", "custodial"]),
    credentials,
  });

  printJson({
    merchant: {
      id: merchant.id,
      name: merchant.name,
      email: merchant.email,
    },
    delivery: {
      email: options.email,
      ...delivery,
    },
    claimed,
    credentials,
  });

  console.error(
    "A new merchant private key was printed once. Store it securely before closing this terminal.",
  );
});
