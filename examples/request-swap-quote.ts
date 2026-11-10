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
        description: "Amount in atomic units of the sold asset",
        valueName: "amount",
        required: true,
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
    fromAddress: options.senderAddress,
    ...(options.additionalSender.length > 0 ? { additionalFromAddresses: options.additionalSender } : {}),
    toAddress: options.recipientAddress,
    ...(options.refundAddress ? { refundAddress: options.refundAddress } : {}),
  });

  printJson(quote);
  console.error(
    `\nAccept before ${quote.expiresAt}. The quote reserves nothing until then.\n` +
      `- Hedles wallet: Hedles builds the funding and you sign its requests:\n` +
      `    bun run swap-sign --quote-id ${quote.id}\n` +
      `- Wallet you control: sign the quote's fundingTransaction, then:\n` +
      `    bun run swap-accept --quote-id ${quote.id} --signature <signed funding transaction>`,
  );
});
