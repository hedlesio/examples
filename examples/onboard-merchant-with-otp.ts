import { authenticatedOptions, parseCommand } from "../src/cli.ts";
import { authenticatedApi, printJson, runExample } from "../src/runtime.ts";

await runExample(async () => {
  const options = parseCommand({
    name: "merchant-otp",
    description: "Create a directly owned merchant and receive its claim OTP for external delivery.",
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
    },
  });
  if (!options) return;

  const merchant = await (await authenticatedApi(options.apiUrl, options.organizationId)).createMerchant({
    name: options.name,
    email: options.email,
    externalClaimDelivery: true,
  });
  if (!merchant.externalClaimDelivery || !merchant.claimUrl || merchant.claimEmailSent) {
    throw new Error("The API did not return a self-managed claim delivery");
  }

  printJson({
    merchant: {
      id: merchant.id,
      name: merchant.name,
      email: merchant.email,
    },
    delivery: {
      email: options.email,
      claimUrl: merchant.claimUrl,
      code: merchant.externalClaimDelivery.code,
      expiresAt: merchant.externalClaimDelivery.expiresAt,
    },
    nextCommand: `bun run claim --tenant-id ${merchant.id} --claim-code ${merchant.externalClaimDelivery.code}`,
  });
});
