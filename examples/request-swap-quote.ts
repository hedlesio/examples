import { authenticatedOptions, parseCommand } from "../src/cli.ts";
import { authenticatedApi, printJson, runExample } from "../src/runtime.ts";

await runExample(async () => {
  const options = parseCommand({
    name: "swap-quote",
    description: "Request a firm RFQ quote to swap one supported asset for another.",
    options: {
      ...authenticatedOptions,
      fromChain: {
        description: "Chain key of the asset being sold",
        valueName: "key",
        required: true,
      },
      fromAsset: {
        description: "Asset key of the asset being sold",
        valueName: "key",
        required: true,
      },
      toChain: {
        description: "Chain key of the asset being bought",
        valueName: "key",
        required: true,
      },
      toAsset: {
        description: "Asset key of the asset being bought",
        valueName: "key",
        required: true,
      },
      amount: {
        description: "Amount in atomic units of the side selected by --side",
        valueName: "amount",
        required: true,
      },
      side: {
        description: "Which leg the amount fixes: from or to",
        valueName: "side",
        defaultValue: "from",
      },
      fromAddress: {
        description: "Your wallet address on the from-chain that funds the deposit",
        valueName: "address",
        required: true,
      },
    },
  });
  if (!options) return;

  if (options.side !== "from" && options.side !== "to") {
    throw new Error("--side must be from or to");
  }

  const api = await authenticatedApi(options.apiUrl, options.organizationId);
  const quote = await api.requestSwapQuote({
    fromChain: options.fromChain,
    fromAsset: options.fromAsset,
    toChain: options.toChain,
    toAsset: options.toAsset,
    amount: options.amount,
    side: options.side,
    fromAddress: options.fromAddress,
  });

  printJson(quote);
  console.error(
    `\nSign the quote's transaction bytes with the wallet that controls ${options.fromAddress}, then accept before ${quote.expiresAt}:\n` +
      `  bun run swap-accept --quote-id ${quote.id} --token <token> --transaction <transaction> --signature <hex>`,
  );
});
