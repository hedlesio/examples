import { authenticatedOptions, parseCommand, uint32 } from "../src/cli.ts";
import { turnkeyCredentials } from "../src/config.ts";
import { completePayoutSigning } from "../src/payout.ts";
import { authenticatedApi, printJson, runExample } from "../src/runtime.ts";
import { createTurnkeyStamper } from "../src/turnkey.ts";

await runExample(async () => {
  const options = parseCommand({
    name: "payout",
    description: "Create and sign a payout.",
    options: {
      ...authenticatedOptions,
      chain: {
        description: "Chain key",
        valueName: "key",
        required: true,
      },
      asset: {
        description: "Asset key",
        valueName: "key",
        required: true,
      },
      from: {
        description: "Source address",
        valueName: "address",
        required: true,
      },
      to: {
        description: "Destination address",
        valueName: "address",
        required: true,
      },
      amount: {
        description: "Amount in atomic units, or all",
        valueName: "amount",
        required: true,
      },
      note: {
        description: "Reconciliation note",
        valueName: "note",
      },
      destinationTag: {
        description: "XRPL uint32 destination tag",
        valueName: "tag",
      },
    },
  });
  if (!options) return;

  const api = await authenticatedApi(options.apiUrl, options.organizationId);
  const destinationTag =
    options.destinationTag === undefined ? undefined : uint32(options.destinationTag, "--destination-tag");
  const payout = await api.createPayout({
    chain: options.chain,
    asset: options.asset,
    fromAddress: options.from,
    toAddress: options.to,
    amount: options.amount,
    ...(options.note ? { note: options.note } : {}),
    ...(destinationTag === undefined ? {} : { destinationTag }),
  });

  if (!payout.signing) {
    printJson(payout);
    return;
  }

  const signed = await completePayoutSigning(api, payout, createTurnkeyStamper(turnkeyCredentials()));
  printJson(signed);
});
