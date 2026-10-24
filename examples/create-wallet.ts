import { CHAINS } from "../src/api-values.ts";
import { authenticatedOptions, choice, parseCommand } from "../src/cli.ts";
import { authenticatedApi, printJson, runExample } from "../src/runtime.ts";

await runExample(async () => {
  const options = parseCommand({
    name: "wallet",
    description: "Create a tenant wallet address.",
    options: {
      ...authenticatedOptions,
      chain: {
        description: "Canonical chain to enable for the address",
        valueName: "chain",
        defaultValue: "base",
      },
    },
  });
  if (!options) return;

  const api = await authenticatedApi(options.apiUrl, options.organizationId);
  printJson(await api.createAddress(choice(options.chain, "--chain", CHAINS)));
});
