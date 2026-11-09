import { obtainSession } from "../src/auth.ts";
import { authenticatedOptions, parseCommand, positiveInteger } from "../src/cli.ts";
import { requiredEnv } from "../src/config.ts";
import {
  createLightningPayout,
  DEFAULT_POLL,
  signLightningPayout,
  waitForPayinConfirmed,
  waitForPayoutOutcome,
} from "../src/lightning.ts";
import { authenticatedApi, printJson, publicApi, runExample } from "../src/runtime.ts";
import { createStamper } from "../src/stamper.ts";

// Development has no public Lightning network: regtest invoices can only be paid
// from another Spark regtest wallet. This pays one tenant's invoice from a second
// tenant, so both directions are exercised without an outside wallet.
await runExample(async () => {
  const options = parseCommand({
    name: "lightning-roundtrip",
    description:
      "Create a Lightning pay-in on the receiving tenant (HEDLES_API_* keys), pay it from the paying " +
      "tenant (HEDLES_PAYER_API_* keys), and wait until the pay-in confirms.",
    options: {
      ...authenticatedOptions,
      payerOrganizationId: {
        description: "Paying tenant's organization ID; auto-discovered if omitted",
        valueName: "id",
      },
      amount: {
        description: "Invoice amount in whole satoshis",
        valueName: "sats",
        defaultValue: "1000",
      },
      wait: {
        description: "Seconds to wait for each side to finish",
        valueName: "seconds",
        defaultValue: "180",
      },
    },
  });
  if (!options) return;

  const amount = String(positiveInteger(options.amount, "--amount"));
  const poll = { ...DEFAULT_POLL, timeoutMs: positiveInteger(options.wait, "--wait") * 1000 };
  const payerStamper = createStamper({
    publicKey: requiredEnv("HEDLES_PAYER_API_PUBLIC_KEY"),
    privateKey: requiredEnv("HEDLES_PAYER_API_PRIVATE_KEY"),
  });

  const receiver = await authenticatedApi(options.apiUrl, options.organizationId);
  const payerLogin = publicApi(options.apiUrl);
  const { session } = await obtainSession(payerLogin, payerStamper, options.payerOrganizationId);
  const payer = payerLogin.withSession(session);

  const reference = `roundtrip-${Date.now()}`;
  const payin = await receiver.createPayin({ chain: "lightning", asset: "BTC", amount, reference });
  if (!payin.invoice) throw new Error(`pay-in ${payin.id} came back without an invoice`);
  console.error(`receiver issued ${amount} sats, payment hash ${payin.paymentHash}`);

  let payout = await createLightningPayout(payer, payin.invoice, reference);
  if (payout.status === "pending") payout = await signLightningPayout(payer, payout, payerStamper, poll);
  if (payout.status === "processing") payout = await waitForPayoutOutcome(payer, payout.id, poll);
  console.error(`payer's payout ${payout.id} is ${payout.status}`);
  if (payout.status !== "settled") {
    printJson(payout);
    throw new Error(`payout ${payout.id} ended ${payout.status}: ${payout.lastError ?? "no reason given"}`);
  }

  const confirmed = await waitForPayinConfirmed(receiver, payin.id, poll);
  printJson({
    paymentHash: payin.paymentHash,
    amount,
    payin: { id: confirmed.id, status: confirmed.status, amount: confirmed.amount },
    payout: {
      id: payout.id,
      status: payout.status,
      amount: payout.amount,
      feeTotal: payout.feeTotal,
      transfers: payout.transfers.map(({ kind, amount: moved, status }) => ({ kind, amount: moved, status })),
    },
  });
});
