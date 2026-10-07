import { parseCommand, positiveInteger } from "../src/cli.ts";
import { requiredEnv } from "../src/config.ts";
import { printJson, runExample } from "../src/runtime.ts";
import type { WebhookEvent } from "../src/types.ts";
import {
  DEFAULT_TOLERANCE_SECONDS,
  EVENT_HEADER,
  verifyRequest,
  WebhookVerificationError,
} from "../src/webhooks.ts";

// A delivery is retried until it gets a 2xx, and a replay from the dashboard
// re-sends the original event with its original idempotency key. Both arrive as
// a repeat of an event you may already have processed, so key your side effects
// on the idempotency key rather than on "a request arrived".
const handled = new Set<string>();

function describe(event: WebhookEvent): string {
  switch (event.event) {
    case "payin.pending":
      return `payin ${event.data.payinId} seen in ${event.data.txHash} for ${event.data.amount}`;
    case "payin.confirmed":
      return `payin ${event.data.payinId} confirmed at block ${event.data.blockNumber}`;
    case "payin.expired":
      return `payin ${event.data.payinId} expired unpaid`;
    case "payout.created":
      return `payout ${event.data.payoutId} prepared with ${event.data.transfers.length} transfer(s)`;
    case "payout.broadcast":
      return `payout ${event.data.payoutId} broadcast as ${event.data.txHash}`;
    case "payout.settled":
      return `payout ${event.data.payoutId} settled in ${event.data.txHash} (check each transfer status)`;
    case "payout.failed":
      return `payout ${event.data.payoutId} failed: ${event.data.reason}`;
    case "swap.accepted":
      return `swap ${event.data.swapId} funded by ${event.data.fundingTxHash}`;
    case "swap.executing":
      return `swap ${event.data.swapId} executing after funding ${event.data.fundingTxHash}`;
    case "swap.executed":
      return `swap ${event.data.swapId} executed at ${event.data.executedAt}`;
    case "swap.expired":
      return `swap ${event.data.swapId} expired before its deposit confirmed`;
    case "swap.failed":
      return `swap ${event.data.swapId} failed: ${event.data.reason}`;
  }
}

await runExample(async () => {
  const options = parseCommand({
    name: "webhooks",
    description: "Receive and verify Hedles webhook deliveries.",
    options: {
      port: {
        description: "Port to listen on",
        valueName: "port",
        defaultValue: "8787",
      },
      path: {
        description: "Path that receives deliveries",
        valueName: "path",
        defaultValue: "/webhooks/hedles",
      },
      tolerance: {
        description: "Accepted timestamp skew in seconds",
        valueName: "seconds",
        defaultValue: String(DEFAULT_TOLERANCE_SECONDS),
      },
    },
  });
  if (!options) return;

  const secret = requiredEnv("HEDLES_WEBHOOK_SECRET");
  const tolerance = positiveInteger(options.tolerance, "--tolerance");
  const port = positiveInteger(options.port, "--port");

  const server = Bun.serve({
    port,
    async fetch(request) {
      const url = new URL(request.url);
      if (request.method !== "POST" || url.pathname !== options.path) {
        return new Response("Not found", { status: 404 });
      }

      let delivery: Awaited<ReturnType<typeof verifyRequest>>;
      try {
        delivery = await verifyRequest(request, secret, tolerance);
      } catch (error) {
        if (!(error instanceof WebhookVerificationError)) throw error;
        // 400 tells Hedles the delivery was rejected. It will be retried, so an
        // unverifiable delivery never silently disappears.
        console.error(`rejected: ${error.message}`);
        return Response.json({ error: error.message }, { status: 400 });
      }

      const key = delivery.idempotencyKey;
      if (key && handled.has(key)) {
        console.log(`duplicate ${request.headers.get(EVENT_HEADER)} (${key}), already handled`);
        return Response.json({ received: true, duplicate: true });
      }
      if (key) handled.add(key);

      console.log(describe(delivery.event));
      printJson(delivery.event);

      // Acknowledge first, work afterwards. Delivery times out after 10s, and a
      // slow handler turns a successful event into a retry.
      return Response.json({ received: true });
    },
  });

  console.log(`Listening on http://localhost:${server.port}${options.path}`);
  console.log("Expose it with: cloudflared tunnel --url http://localhost:" + server.port);
});
