import { authenticatedOptions, parseCommand, positiveInteger } from "../src/cli.ts";
import { DEFAULT_POLL, lightningUri, waitForPayinConfirmed } from "../src/lightning.ts";
import { authenticatedApi, printJson, runExample } from "../src/runtime.ts";

await runExample(async () => {
  const options = parseCommand({
    name: "lightning-receive",
    description:
      "Create a Lightning pay-in and print its BOLT11 invoice. Every invoice expires after 30 days; " +
      "cancelling the pay-in does not revoke it.",
    options: {
      ...authenticatedOptions,
      amount: {
        description: "Invoice amount in whole satoshis",
        valueName: "sats",
        required: true,
      },
      reference: {
        description: "Reconciliation reference; repeating it returns the same pay-in and invoice",
        valueName: "reference",
      },
      wait: {
        description: "Seconds to wait for the invoice to be paid; omit to return at once",
        valueName: "seconds",
      },
    },
  });
  if (!options) return;

  const amount = String(positiveInteger(options.amount, "--amount"));
  const waitSeconds = options.wait === undefined ? undefined : positiveInteger(options.wait, "--wait");
  const api = await authenticatedApi(options.apiUrl, options.organizationId);
  const payin = await api.createPayin({
    chain: "lightning",
    asset: "BTC",
    amount,
    ...(options.reference ? { reference: options.reference } : {}),
  });
  if (!payin.invoice) throw new Error(`pay-in ${payin.id} came back without an invoice`);
  if (waitSeconds === undefined) {
    printJson({ ...payin, uri: lightningUri(payin.invoice) });
    return;
  }

  // Progress goes to stderr so stdout stays one JSON document: the confirmed pay-in.
  console.error(`pay-in ${payin.id}\n${lightningUri(payin.invoice)}`);
  console.error(`waiting up to ${waitSeconds}s for payment ${payin.paymentHash}…`);
  printJson(await waitForPayinConfirmed(api, payin.id, { ...DEFAULT_POLL, timeoutMs: waitSeconds * 1000 }));
});
