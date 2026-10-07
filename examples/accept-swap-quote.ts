import { authenticatedOptions, parseCommand } from "../src/cli.ts";
import { authenticatedApi, printJson, runExample } from "../src/runtime.ts";

await runExample(async () => {
  const options = parseCommand({
    name: "swap-accept",
    description: "Accept a swap quote by posting the wallet-signed version of its funding transaction.",
    options: {
      ...authenticatedOptions,
      quoteId: {
        description: "Quote identifier from swap-quote",
        valueName: "id",
        required: true,
      },
      token: {
        description: "Short-lived token returned with the quote",
        valueName: "token",
        required: true,
      },
      signature: {
        description: "Signed funding transaction produced from the quote's fundingTransaction",
        valueName: "payload",
        required: true,
      },
    },
  });
  if (!options) return;

  const api = await authenticatedApi(options.apiUrl, options.organizationId);
  const swap = await api.acceptSwapQuote({
    quoteId: options.quoteId,
    token: options.token,
    signature: options.signature,
  });

  printJson(swap);
  console.error(
    `\nTrack execution with: GET /v1/swaps/${swap.id} (statuses: pending, executing, executed, expired, failed)`,
  );
});
