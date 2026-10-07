import { authenticatedOptions, choice, parseCommand } from "../src/cli.ts";
import { authenticatedApi, printJson, runExample } from "../src/runtime.ts";

await runExample(async () => {
  const options = parseCommand({
    name: "swap-quote",
    description: "Request a firm RFQ quote to swap one supported asset for another.",
    options: {
      ...authenticatedOptions,
      sellChain: {
        description: "Chain key of the asset being sold",
        valueName: "key",
        required: true,
      },
      sellAsset: {
        description: "Asset key of the asset being sold",
        valueName: "key",
        required: true,
      },
      buyChain: {
        description: "Chain key of the asset being bought",
        valueName: "key",
        required: true,
      },
      buyAsset: {
        description: "Asset key of the asset being bought",
        valueName: "key",
        required: true,
      },
      amount: {
        description: "Amount in atomic units of the leg selected by --side",
        valueName: "amount",
        required: true,
      },
      side: {
        description: "Which leg the amount fixes: sell or buy (buy is not implemented yet)",
        valueName: "side",
        defaultValue: "sell",
      },
      senderAddress: {
        description: "Your wallet address that sends the sold asset to the venue",
        valueName: "address",
        required: true,
      },
      recipientAddress: {
        description: "Your wallet address that receives the bought asset",
        valueName: "address",
        required: true,
      },
    },
  });
  if (!options) return;

  const api = await authenticatedApi(options.apiUrl, options.organizationId);
  const quote = await api.requestSwapQuote({
    sellChain: options.sellChain,
    sellAsset: options.sellAsset,
    buyChain: options.buyChain,
    buyAsset: options.buyAsset,
    amount: options.amount,
    side: choice(options.side, "--side", ["sell", "buy"]),
    senderAddress: options.senderAddress,
    recipientAddress: options.recipientAddress,
  });

  printJson(quote);
  console.error(
    `\nSign the quote's fundingTransaction with the wallet that controls ${options.senderAddress}, then accept before ${quote.expiresAt}:\n` +
      `  bun run swap-accept --quote-id ${quote.id} --token <token> --signature <signed funding transaction>`,
  );
});
