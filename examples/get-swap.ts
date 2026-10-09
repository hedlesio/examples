import { authenticatedOptions, parseCommand, positiveInteger } from "../src/cli.ts";
import { authenticatedApi, printJson, runExample } from "../src/runtime.ts";

await runExample(async () => {
  const options = parseCommand({
    name: "swap-status",
    description: "Fetch one swap, or list recent swaps when no id is given.",
    options: {
      ...authenticatedOptions,
      id: {
        description: "Swap id (same id as its quote)",
        valueName: "uuid",
      },
      limit: {
        description: "Page size when listing",
        valueName: "count",
        defaultValue: "20",
      },
    },
  });
  if (!options) return;

  const api = await authenticatedApi(options.apiUrl, options.organizationId);
  if (options.id) {
    printJson(await api.getSwap(options.id));
    return;
  }
  printJson(await api.listSwaps({ limit: positiveInteger(options.limit, "--limit") }));
});
