import { CHAINS } from "../src/api-values.ts";
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
      additionalSender: {
        description:
          "Another BTC, LTC, DOGE or BCH address that funds the swap with --sender-address (repeatable)",
        valueName: "address",
        repeatable: true,
      },
      recipientAddress: {
        description: "Your wallet address that receives the bought asset",
        valueName: "address",
        required: true,
      },
      refundAddress: {
        description:
          "Sell-chain address that receives a refund if the swap fails or is refunded (defaults to the sender)",
        valueName: "address",
      },
    },
  });
  if (!options) return;

  const api = await authenticatedApi(options.apiUrl, options.organizationId);
  const quote = await api.requestSwapQuote({
    sellChain: choice(options.sellChain, "--sell-chain", CHAINS),
    sellAsset: options.sellAsset,
    buyChain: choice(options.buyChain, "--buy-chain", CHAINS),
    buyAsset: options.buyAsset,
    amount: options.amount,
    side: choice(options.side, "--side", ["sell", "buy"]),
    senderAddress: options.senderAddress,
    ...(options.additionalSender.length > 0 ? { additionalSenderAddresses: options.additionalSender } : {}),
    recipientAddress: options.recipientAddress,
    ...(options.refundAddress ? { refundAddress: options.refundAddress } : {}),
  });

  printJson(quote);
  console.error(
    `\nAccept before ${quote.expiresAt}. The quote reserves nothing until then.\n` +
      `- Hedles wallet: Hedles builds the funding and you sign its requests:\n` +
      `    bun run swap-sign --quote-id ${quote.id} --token <token>\n` +
      `- Wallet you control: sign the quote's fundingTransaction, then:\n` +
      `    bun run swap-accept --quote-id ${quote.id} --token <token> --signature <signed funding transaction>`,
  );
});
