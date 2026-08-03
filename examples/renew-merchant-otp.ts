import { requireExternalClaimDelivery } from "../src/claim.ts";
import { authenticatedOptions, parseCommand } from "../src/cli.ts";
import { authenticatedApi, printJson, runExample } from "../src/runtime.ts";

await runExample(async () => {
  const options = parseCommand({
    name: "merchant-otp-renew",
    description: "Rotate an expired merchant claim OTP for external delivery.",
    options: {
      ...authenticatedOptions,
      tenantId: {
        description: "Unclaimed directly owned merchant UUID",
        valueName: "uuid",
        required: true,
      },
    },
  });
  if (!options) return;

  const renewed = await (await authenticatedApi(options.apiUrl, options.organizationId)).resendClaim(
    options.tenantId,
  );
  if (renewed.tooSoon) {
    printJson({
      tenantId: options.tenantId,
      rotated: false,
      reason: "otp_cooldown",
      existingCodeStillValid: true,
      claimUrl: renewed.claimUrl,
    });
    return;
  }

  printJson({
    tenantId: options.tenantId,
    rotated: true,
    delivery: requireExternalClaimDelivery(renewed),
  });
});
