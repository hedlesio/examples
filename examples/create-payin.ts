import { authenticatedOptions, parseCommand, positiveInteger } from "../src/cli.ts";
import { authenticatedApi, printJson, runExample } from "../src/runtime.ts";

await runExample(async () => {
  const options = parseCommand({
    name: "payin",
    description: "Create a pay-in and allocate its deposit address.",
    options: {
      ...authenticatedOptions,
      chain: {
        description: "Enabled Hedles chain key",
        valueName: "key",
        required: true,
      },
      asset: {
        description: "Enabled Hedles asset key",
        valueName: "key",
        required: true,
      },
      amount: {
        description: "Expected amount in atomic units",
        valueName: "amount",
        required: true,
      },
      reference: {
        description: "Optional reconciliation reference",
        valueName: "reference",
      },
      expiresIn: {
        description: "Expiry duration in seconds",
        valueName: "seconds",
        defaultValue: "3600",
      },
    },
  });
  if (!options) return;

  const api = await authenticatedApi(options.apiUrl, options.organizationId);
  const expiresIn = positiveInteger(options.expiresIn, "--expires-in");
  const payin = await api.createPayin({
    chainKey: options.chain,
    assetKey: options.asset,
    amount: options.amount,
    ...(options.reference ? { reference: options.reference } : {}),
    expiresIn,
  });
  printJson(payin);
});
