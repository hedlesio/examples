import { authenticatedOptions, parseCommand } from "../src/cli.ts";
import { apiKeyCredentials } from "../src/config.ts";
import { completePayoutSigning } from "../src/payout.ts";
import { waitForPayout } from "../src/receive.ts";
import { authenticatedApi, printJson, runExample } from "../src/runtime.ts";
import { createStamper } from "../src/stamper.ts";

// Zcash consensus forbids spending mining rewards (transparent coinbase) in a
// transaction with a transparent output, so Hedles pays such funds out in two
// transactions on its own: the first shields them into a one-time note, the
// second pays the recipient from it. The request is an ordinary payout; only
// the signing differs. The first round is one derivation request whose signer
// is a derivation key, then the payout stays pending with no requests while
// Hedles proves the first transaction (usually 15–30 s), then one request per
// input of that transaction. Hedles signs and sends the second transaction.
// For ordinary transparent funds the same command signs the usual single round.
await runExample(async () => {
  const options = parseCommand({
    name: "zcash-payout",
    description:
      "Pay out ZEC, including funds received as mining rewards: sign every round, wait while Hedles prepares the next one, then wait until the payout settles.",
    options: {
      ...authenticatedOptions,
      from: {
        description: "Source Zcash address (t1…) of a Hedles wallet",
        valueName: "address",
        required: true,
      },
      to: {
        description: "Transparent recipient address (t1… or t3…)",
        valueName: "address",
        required: true,
      },
      amount: {
        description: "Amount in zatoshis (1 ZEC = 100000000), or all for the whole balance",
        valueName: "zatoshis",
        required: true,
      },
      reference: {
        description: "Reconciliation reference; repeating it returns the same payout",
        valueName: "reference",
      },
    },
  });
  if (!options) return;

  const api = await authenticatedApi(options.apiUrl, options.organizationId);
  const created = await api.createPayout({
    chain: "zcash",
    asset: "ZEC",
    fromAddress: options.from,
    transfers: [{ toAddress: options.to, amount: options.amount }],
    ...(options.reference ? { reference: options.reference } : {}),
  });
  const [first] = created.signingRequests;
  const flow =
    first && first.signer !== options.from
      ? "mining-reward funds: derivation round, then the first transaction's inputs"
      : "transparent funds: one round";
  console.log(`payout ${created.id}: ${flow}`);

  const signed =
    created.signingRequests.length === 0
      ? created
      : await completePayoutSigning(api, created, createStamper(apiKeyCredentials()));
  console.log(`payout ${signed.id}: ${signed.status}; waiting for settlement`);
  printJson(await waitForPayout(api, signed.id));
});
