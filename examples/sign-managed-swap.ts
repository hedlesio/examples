import { authenticatedOptions, parseCommand } from "../src/cli.ts";
import { apiKeyCredentials } from "../src/config.ts";
import { authenticatedApi, printJson, runExample } from "../src/runtime.ts";
import { createStamper } from "../src/stamper.ts";
import { signManagedSwap } from "../src/swap.ts";

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
  printJson(await signManagedSwap(api, options.quoteId, createStamper(apiKeyCredentials())));
});
