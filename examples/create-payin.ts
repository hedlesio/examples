import { CHAINS } from "../src/api-values.ts";
import { authenticatedOptions, choice, parseCommand, positiveInteger } from "../src/cli.ts";
import { authenticatedApi, printJson, runExample } from "../src/runtime.ts";

const DEFAULT_EXPIRES_IN_SECONDS = 3600;

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
        description:
          "Expiry in seconds (default: 3600; not accepted for lightning, whose invoices last 30 days)",
        valueName: "seconds",
      },
    },
  });
  if (!options) return;

  const api = await authenticatedApi(options.apiUrl, options.organizationId);
  const chain = choice(options.chain, "--chain", CHAINS);
  let expiresIn: number | undefined;
  if (options.expiresIn !== undefined) expiresIn = positiveInteger(options.expiresIn, "--expires-in");
  else if (chain !== "lightning") expiresIn = DEFAULT_EXPIRES_IN_SECONDS;
  const payin = await api.createPayin({
    chain,
    asset: options.asset,
    amount: options.amount,
    ...(options.reference ? { reference: options.reference } : {}),
    ...(expiresIn === undefined ? {} : { expiresIn }),
  });
  printJson(payin);
});
