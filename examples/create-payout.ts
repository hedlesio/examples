import { authenticatedOptions, parseCommand, uint32 } from "../src/cli.ts";
import { turnkeyCredentials } from "../src/config.ts";
import { completePayoutSigning } from "../src/payout.ts";
import { authenticatedApi, printJson, runExample } from "../src/runtime.ts";
import { createTurnkeyStamper } from "../src/turnkey.ts";

await runExample(async () => {
  const options = parseCommand({
    name: "payout",
    description: "Create a payout and sign every opaque signing request it returns.",
    options: {
      ...authenticatedOptions,
      chain: {
        description: "Chain key",
        valueName: "key",
        required: true,
      },
      asset: {
        description: "Asset key moved by every transfer",
        valueName: "key",
        required: true,
      },
      from: {
        description: "Source address funding every transfer",
        valueName: "address",
        required: true,
      },
      to: {
        description: "Recipient address",
        valueName: "address",
        required: true,
      },
      amount: {
        description: "Amount in atomic units, or all",
        valueName: "amount",
        required: true,
      },
      reference: {
        description: "Reconciliation reference",
        valueName: "reference",
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
  const created = await api.createPayout({
    chain: options.chain,
    asset: options.asset,
    fromAddress: options.from,
    transfers: [
      {
        toAddress: options.to,
        amount: options.amount,
        ...(destinationTag === undefined ? {} : { destinationTag }),
      },
    ],
    ...(options.reference ? { reference: options.reference } : {}),
  });

  if ("id" in created && created.signingRequests.length === 0) {
    printJson(created);
    return;
  }

  const payout = await completePayoutSigning(api, created, createTurnkeyStamper(turnkeyCredentials()));
  printJson(payout);
});
