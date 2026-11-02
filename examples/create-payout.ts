import { CHAINS } from "../src/api-values.ts";
import { authenticatedOptions, choice, parseCommand, uint32 } from "../src/cli.ts";
import { apiKeyCredentials } from "../src/config.ts";
import { completePayoutSigning } from "../src/payout.ts";
import { authenticatedApi, printJson, runExample } from "../src/runtime.ts";
import { createStamper } from "../src/stamper.ts";
import type { OnChainPayoutChain, PayoutTransferInput } from "../src/types.ts";

// Lightning payouts pay a BOLT11 invoice instead of listing transfers.
const ON_CHAIN_CHAINS = CHAINS.filter((chain): chain is OnChainPayoutChain => chain !== "lightning");

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
      memo: {
        description:
          "OP_RETURN memo on Bitcoin, Litecoin, Dogecoin or Bitcoin Cash (single fixed-amount recipient)",
        valueName: "text",
      },
      additionalFrom: {
        description:
          "Another source address spent in full in the same transaction (BTC, LTC, DOGE, BCH; repeatable)",
        valueName: "address",
        repeatable: true,
      },
      externalKey: {
        description:
          "WIF or 32-byte hex key of an --additional-from address Hedles does not control (repeatable)",
        valueName: "key",
        repeatable: true,
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
  if (options.memo !== undefined && options.to.length !== 1) {
    throw new Error("--memo applies to a single recipient");
  }
  const transfers: PayoutTransferInput[] = options.to.map((toAddress, index) => ({
    toAddress,
    amount: options.amount[index] as string,
    ...(destinationTag === undefined ? {} : { destinationTag }),
    ...(options.memo === undefined ? {} : { memo: options.memo }),
  }));

  const api = await authenticatedApi(options.apiUrl, options.organizationId);
  const created = await api.createPayout({
    chain: choice(options.chain, "--chain", ON_CHAIN_CHAINS),
    asset: options.asset,
    fromAddress: options.from,
    ...(options.additionalFrom.length > 0 ? { additionalFromAddresses: options.additionalFrom } : {}),
    transfers,
    ...(options.reference ? { reference: options.reference } : {}),
  });

  if (created.signingRequests.length === 0) {
    printJson(created);
    return;
  }

  const payout = await completePayoutSigning(
    api,
    created,
    createStamper(apiKeyCredentials()),
    options.externalKey,
  );
  printJson(payout);
});
