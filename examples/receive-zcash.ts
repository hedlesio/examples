import { authenticatedOptions, parseCommand } from "../src/cli.ts";
import { apiKeyCredentials } from "../src/config.ts";
import { receiveAndSweep } from "../src/receive.ts";
import { authenticatedApi, printJson, runExample } from "../src/runtime.ts";
import { createStamper } from "../src/stamper.ts";

// Zcash payins use transparent (t1…) addresses. The sweep spends every
// confirmed coin on the payin address in one transparent transaction and pays
// the network fee out of the swept amount.
await runExample(async () => {
  const options = parseCommand({
    name: "receive-zcash",
    description:
      "Receive ZEC and sweep it to the omnibus: create a payin, wait until it is confirmed, then sign the sweep payout and wait until it settles.",
    options: {
      ...authenticatedOptions,
      amount: {
        description: "Expected amount in zatoshis (1 ZEC = 100000000)",
        valueName: "zatoshis",
        required: true,
      },
      reference: {
        description: "Reconciliation reference for the payin",
        valueName: "reference",
      },
      sweepTo: {
        description: "Sweep destination (defaults to the tenant's Zcash omnibus)",
        valueName: "address",
      },
    },
  });
  if (!options) return;

  const api = await authenticatedApi(options.apiUrl, options.organizationId);
  printJson(
    await receiveAndSweep(
      api,
      {
        chain: "zcash",
        asset: "ZEC",
        amount: options.amount,
        ...(options.reference ? { reference: options.reference } : {}),
        ...(options.sweepTo ? { sweepTo: options.sweepTo } : {}),
      },
      createStamper(apiKeyCredentials()),
    ),
  );
});
