import { authenticatedOptions, parseCommand, positiveInteger } from "../src/cli.ts";
import { apiKeyCredentials } from "../src/config.ts";
import {
  createLightningPayout,
  DEFAULT_POLL,
  signLightningPayout,
  waitForPayoutOutcome,
} from "../src/lightning.ts";
import { authenticatedApi, printJson, runExample } from "../src/runtime.ts";
import { createStamper } from "../src/stamper.ts";

await runExample(async () => {
  const options = parseCommand({
    name: "lightning-pay",
    description:
      "Pay a BOLT11 invoice from the tenant's Lightning wallet, sign every round a self-custody " +
      "wallet needs, and wait for the outcome. --payout-id resumes signing an existing payout.",
    options: {
      ...authenticatedOptions,
      invoice: {
        description: "BOLT11 invoice with an amount in whole satoshis",
        valueName: "bolt11",
      },
      payoutId: {
        description: "Existing Lightning payout to finish signing instead of paying a new invoice",
        valueName: "id",
      },
      reference: {
        description: "Reconciliation reference; repeating it returns the same payout",
        valueName: "reference",
      },
      wait: {
        description: "Seconds to wait for the payout to settle or fail",
        valueName: "seconds",
        defaultValue: "120",
      },
    },
  });
  if (!options) return;

  const { invoice, payoutId } = options;
  if ((invoice === undefined) === (payoutId === undefined)) {
    throw new Error("pass exactly one of --invoice or --payout-id");
  }
  const poll = { ...DEFAULT_POLL, timeoutMs: positiveInteger(options.wait, "--wait") * 1000 };
  const api = await authenticatedApi(options.apiUrl, options.organizationId);
  let payout =
    invoice === undefined
      ? await api.getPayout(payoutId ?? "")
      : await createLightningPayout(api, invoice, options.reference);
  if (payout.chain !== "lightning") throw new Error(`payout ${payout.id} is not a Lightning payout`);

  if (payout.status === "pending") {
    payout = await signLightningPayout(api, payout, createStamper(apiKeyCredentials()), poll);
  }
  if (payout.status === "processing") payout = await waitForPayoutOutcome(api, payout.id, poll);
  printJson(payout);
});
