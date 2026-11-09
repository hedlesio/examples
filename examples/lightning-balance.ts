import { authenticatedOptions, parseCommand } from "../src/cli.ts";
import { lightningBalance } from "../src/lightning.ts";
import { authenticatedApi, printJson, runExample } from "../src/runtime.ts";

await runExample(async () => {
  const options = parseCommand({
    name: "lightning-balance",
    description: "Show the tenant's Lightning wallet and its spendable balance in satoshis.",
    options: authenticatedOptions,
  });
  if (!options) return;

  const api = await authenticatedApi(options.apiUrl, options.organizationId);
  printJson(await lightningBalance(api));
});
