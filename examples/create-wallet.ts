import { authenticatedOptions, parseCommand } from "../src/cli.ts";
import { authenticatedApi, printJson, runExample } from "../src/runtime.ts";

await runExample(async () => {
  const options = parseCommand({
    name: "wallet",
    description: "Create a tenant wallet address.",
    options: {
      ...authenticatedOptions,
      chainType: {
        description: "Wallet address family",
        valueName: "type",
        defaultValue: "evm",
      },
    },
  });
  if (!options) return;

  const api = await authenticatedApi(options.apiUrl, options.organizationId);
  printJson(await api.createAddress(options.chainType));
});
