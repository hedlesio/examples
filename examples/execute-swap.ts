import { authenticatedOptions, choice, parseCommand } from "../src/cli.ts";
import { requiredEnv } from "../src/config.ts";
import { authenticatedApi, printJson, runExample } from "../src/runtime.ts";
import { acceptQuote, executeSwap, fundingSigner } from "../src/swap.ts";

function requireOption(value: string | undefined, flag: string): string {
  if (!value) throw new Error(`${flag} is required unless --quote-id is given`);
  return value;
}

await runExample(async () => {
  const options = parseCommand({
    name: "swap",
    description: "Request a swap quote, sign its funding transaction locally, and accept it.",
    options: {
      ...authenticatedOptions,
      quoteId: {
        description: "Sign and accept an existing quote instead of requesting one",
        valueName: "id",
      },
      sellChain: {
        description: "Chain key of the asset being sold",
        valueName: "key",
      },
      sellAsset: {
        description: "Asset key of the asset being sold",
        valueName: "key",
      },
      buyChain: {
        description: "Chain key of the asset being bought",
        valueName: "key",
      },
      buyAsset: {
        description: "Asset key of the asset being bought",
        valueName: "key",
      },
      amount: {
        description: "Amount in atomic units of the leg selected by --side",
        valueName: "amount",
      },
      side: {
        description: "Which leg the amount fixes: sell or buy (buy is not implemented yet)",
        valueName: "side",
        defaultValue: "sell",
      },
      senderAddress: {
        description: "Your wallet address that sends the sold asset; HEDLES_SWAP_SIGNING_KEY must control it",
        valueName: "address",
      },
      recipientAddress: {
        description: "Your wallet address that receives the bought asset",
        valueName: "address",
      },
    },
  });
  if (!options) return;

  const api = await authenticatedApi(options.apiUrl, options.organizationId);
  const signingKey = requiredEnv("HEDLES_SWAP_SIGNING_KEY");

  if (options.quoteId) {
    const quote = await api.getSwapQuote(options.quoteId);
    printJson(await acceptQuote(api, quote, fundingSigner(signingKey, quote.sellChain)));
    return;
  }

  const sellChain = requireOption(options.sellChain, "--sell-chain");
  const result = await executeSwap(
    api,
    {
      sellChain,
      sellAsset: requireOption(options.sellAsset, "--sell-asset"),
      buyChain: requireOption(options.buyChain, "--buy-chain"),
      buyAsset: requireOption(options.buyAsset, "--buy-asset"),
      amount: requireOption(options.amount, "--amount"),
      side: choice(options.side, "--side", ["sell", "buy"]),
      senderAddress: requireOption(options.senderAddress, "--sender-address"),
      recipientAddress: requireOption(options.recipientAddress, "--recipient-address"),
    },
    fundingSigner(signingKey, sellChain),
  );
  printJson(result);
  console.error(`\nTrack execution with: bun run swap-status --id ${result.swap.id}`);
});
