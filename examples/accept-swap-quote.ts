import { authenticatedOptions, parseCommand } from "../src/cli.ts";
import { authenticatedApi, printJson, runExample } from "../src/runtime.ts";

await runExample(async () => {
  const options = parseCommand({
    name: "swap-accept",
    description: "Accept a swap quote by posting back its deposit transaction with your signature.",
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
      transaction: {
        description: "The quote's unsigned deposit transaction, byte-for-byte unchanged",
        valueName: "tx",
        required: true,
      },
      signature: {
        description: "Raw signature over the transaction from the wallet controlling the from-address",
        valueName: "hex",
        required: true,
      },
    },
  });
  if (!options) return;

  const api = await authenticatedApi(options.apiUrl, options.organizationId);
  const swap = await api.acceptSwapQuote({
    quoteId: options.quoteId,
    token: options.token,
    transaction: options.transaction,
    signature: options.signature,
  });

  printJson(swap);
  console.error(
    `\nTrack execution with: GET /v1/swaps/${swap.id} (statuses: pending, executing, executed, failed)`,
  );
});
