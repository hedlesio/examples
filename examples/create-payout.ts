import { authenticatedOptions, parseCommand, uint32 } from "../src/cli.ts";
import { turnkeyCredentials } from "../src/config.ts";
import { completePayoutSigning } from "../src/payout.ts";
import { authenticatedApi, printJson, runExample } from "../src/runtime.ts";
import { createTurnkeyStamper } from "../src/turnkey.ts";
import type { PayoutTransferInput } from "../src/types.ts";

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
        description: "Recipient address; repeat with --amount for a multisend",
        valueName: "address",
        required: true,
        repeatable: true,
      },
      amount: {
        description: "Amount in atomic units per --to in order, or all for a single recipient",
        valueName: "amount",
        required: true,
        repeatable: true,
      },
      reference: {
        description: "Reconciliation reference",
        valueName: "reference",
      },
      destinationTag: {
        description: "XRPL uint32 destination tag (single recipient only)",
        valueName: "tag",
      },
    },
  });
  if (!options) return;

  if (options.to.length !== options.amount.length) {
    throw new Error("--to and --amount must be given the same number of times");
  }
  const destinationTag =
    options.destinationTag === undefined ? undefined : uint32(options.destinationTag, "--destination-tag");
  if (destinationTag !== undefined && options.to.length !== 1) {
    throw new Error("--destination-tag applies to a single recipient");
  }
  const transfers: PayoutTransferInput[] = options.to.map((toAddress, index) => ({
    toAddress,
    amount: options.amount[index] as string,
    ...(destinationTag === undefined ? {} : { destinationTag }),
  }));

  const api = await authenticatedApi(options.apiUrl, options.organizationId);
  const created = await api.createPayout({
    chain: options.chain,
    asset: options.asset,
    fromAddress: options.from,
    transfers,
    ...(options.reference ? { reference: options.reference } : {}),
  });

  if ("id" in created && created.signingRequests.length === 0) {
    printJson(created);
    return;
  }

  const payout = await completePayoutSigning(api, created, createTurnkeyStamper(turnkeyCredentials()));
  printJson(payout);
});
