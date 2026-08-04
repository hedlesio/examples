import { authenticatedOptions, parseCommand, positiveInteger } from "../src/cli.ts";
import { authenticatedApi, printJson, runExample } from "../src/runtime.ts";

await runExample(async () => {
  const options = parseCommand({
    name: "payin",
    description: "Create a pay-in.",
    options: {
      ...authenticatedOptions,
      chain: {
        description: "Chain key",
        valueName: "key",
        required: true,
      },
      asset: {
        description: "Asset key",
        valueName: "key",
        required: true,
      },
      amount: {
        description: "Expected amount in atomic units",
        valueName: "amount",
        required: true,
      },
      reference: {
        description: "Reconciliation reference",
        valueName: "reference",
      },
      expiresIn: {
        description: "Expiry in seconds",
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
