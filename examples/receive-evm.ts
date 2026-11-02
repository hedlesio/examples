import { authenticatedOptions, choice, parseCommand } from "../src/cli.ts";
import { apiKeyCredentials } from "../src/config.ts";
import { receiveAndSweep } from "../src/receive.ts";
import { authenticatedApi, printJson, runExample } from "../src/runtime.ts";
import { createStamper } from "../src/stamper.ts";

const EVM_CHAINS = ["ethereum", "base", "polygon"] as const;

// Each EVM payin gets its own deposit address. It accepts the native asset
// and tokens alike; the sweep moves its balance in one transaction whose gas
// the omnibus pays, so the deposit address never needs native gas.
await runExample(async () => {
  const options = parseCommand({
    name: "receive-evm",
    description:
      "Receive a payment on an EVM chain and sweep it to the omnibus: create a payin, wait until it is confirmed, then sign the sweep payout and wait until it settles.",
    options: {
      ...authenticatedOptions,
      chain: {
        description: "ethereum, base, or polygon",
        valueName: "chain",
        defaultValue: "base",
      },
      asset: {
        description: "Asset key, e.g. USDC, USDT, ETH, or POL",
        valueName: "asset",
        defaultValue: "USDC",
      },
      amount: {
        description: "Expected amount in atomic units (USDC has 6 decimals, ETH 18)",
        valueName: "amount",
        required: true,
      },
      reference: {
        description: "Reconciliation reference for the payin",
        valueName: "reference",
      },
      sweepTo: {
        description: "Sweep destination (defaults to the tenant's omnibus on the chain)",
        valueName: "address",
      },
    },
  });
  if (!options) return;

  const api = await authenticatedApi(options.apiUrl, options.organizationId);
  printJson(
    await receiveAndSweep(
      api,
      {
        chain: choice(options.chain, "--chain", EVM_CHAINS),
        asset: options.asset,
        amount: options.amount,
        ...(options.reference ? { reference: options.reference } : {}),
        ...(options.sweepTo ? { sweepTo: options.sweepTo } : {}),
      },
      createStamper(apiKeyCredentials()),
    ),
  );
});
