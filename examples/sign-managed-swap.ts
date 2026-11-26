import { createInterface } from "node:readline/promises";
import { authenticatedOptions, parseCommand } from "../src/cli.ts";
import { apiKeyCredentials } from "../src/config.ts";
import { authenticatedApi, printJson, runExample } from "../src/runtime.ts";
import { createStamper } from "../src/stamper.ts";
import { MANAGED_SWAP_WAIT, signManagedSwap } from "../src/swap.ts";

await runExample(async () => {
  const options = parseCommand({
    name: "swap-sign",
    description:
      "Fund a swap quoted for a Hedles wallet: stamp the signing requests of its funding payout and submit them.",
    options: {
      ...authenticatedOptions,
      quoteId: {
        description: "Quote identifier from swap-quote",
        valueName: "id",
        required: true,
      },
    },
  });
  if (!options) return;

  const api = await authenticatedApi(options.apiUrl, options.organizationId);
  printJson(
    await signManagedSwap(api, options.quoteId, createStamper(apiKeyCredentials()), {
      ...MANAGED_SWAP_WAIT,
      async reviewReplacement(transactions) {
        console.error("Review the replacement funding transaction", JSON.stringify(transactions, null, 2));
        if (!process.stdin.isTTY) return false;
        using input = createInterface({ input: process.stdin, output: process.stderr });
        return (await input.question("Sign the replacement funding transaction? [y/N] ")).trim() === "y";
      },
    }),
  );
});
