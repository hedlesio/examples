import { describe, expect, test } from "bun:test";
import {
  parseSignatureHeader,
  signPayload,
  verifyRequest,
  verifySignature,
  WebhookVerificationError,
} from "../src/webhooks.ts";

const SECRET = "whsec_example_secret_at_least_32_chars";
const NOW = 1_754_481_600;
const BODY = JSON.stringify({
  event: "payin.confirmed",
  data: {
    payinId: "5f1b0a4e-2c3d-4f5a-9b8c-7d6e5f4a3b2c",
    txHash: "0xabc",
    blockNumber: 21_000_000,
    confirmations: 12,
    chain: "eip155:11155111",
    fromAddress: "0xdef",
  },
});

function header(body = BODY, timestamp = NOW, secret = SECRET): string {
  return `t=${timestamp},v1=${signPayload(secret, timestamp, body)}`;
}

function deliveryRequest(overrides: { body?: string; signature?: string; key?: string } = {}): Request {
  const body = overrides.body ?? BODY;
  return new Request("https://merchant.example/webhooks/hedles", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hedles-Signature": overrides.signature ?? header(body),
      "X-Hedles-Event": "payin.confirmed",
      "X-Hedles-Idempotency-Key": overrides.key ?? "evt_2f4c1a9b7e30",
    },
    body,
  });
}

describe("webhook signature header", () => {
  test("parses the timestamp and every v1 signature", () => {
    expect(parseSignatureHeader("t=1754481600,v1=aaaa,v1=bbbb")).toEqual({
      timestamp: 1_754_481_600,
      signatures: ["aaaa", "bbbb"],
    });
  });

  test("rejects a missing or incomplete header", () => {
    expect(() => parseSignatureHeader(null)).toThrow("missing X-Hedles-Signature header");
    expect(() => parseSignatureHeader("v1=aaaa")).toThrow("signature header has no valid timestamp");
    expect(() => parseSignatureHeader("t=1754481600")).toThrow("signature header has no v1 signature");
  });
});

describe("webhook verification", () => {
  test("accepts a signature produced with the endpoint secret", () => {
    expect(() =>
      verifySignature({ rawBody: BODY, signatureHeader: header(), secret: SECRET, nowSeconds: NOW }),
    ).not.toThrow();
  });

  test("accepts either signature while a secret is being rotated", () => {
    const rotating = `t=${NOW},v1=${signPayload("previous-secret", NOW, BODY)},v1=${signPayload(SECRET, NOW, BODY)}`;
    expect(() =>
      verifySignature({ rawBody: BODY, signatureHeader: rotating, secret: SECRET, nowSeconds: NOW }),
    ).not.toThrow();
  });

  test("rejects a body that changed after it was signed", () => {
    const tampered = BODY.replace("21000000", "21000001");
    expect(() =>
      verifySignature({ rawBody: tampered, signatureHeader: header(), secret: SECRET, nowSeconds: NOW }),
    ).toThrow(WebhookVerificationError);
  });

  test("rejects a signature made with another secret", () => {
    expect(() =>
      verifySignature({
        rawBody: BODY,
        signatureHeader: header(BODY, NOW, "someone-elses-secret"),
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).toThrow("signature does not match the request body");
  });

  test("rejects a captured delivery replayed outside the tolerance", () => {
    expect(() =>
      verifySignature({
        rawBody: BODY,
        signatureHeader: header(BODY, NOW - 3600),
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).toThrow("timestamp outside 300s tolerance");
  });
});

describe("webhook request handling", () => {
  test("returns the parsed event and idempotency key", async () => {
    const delivery = await verifyRequest(deliveryRequest(), SECRET, Number.MAX_SAFE_INTEGER);
    expect(delivery.idempotencyKey).toBe("evt_2f4c1a9b7e30");
    expect(delivery.event.event).toBe("payin.confirmed");
    expect(delivery.event.data).toMatchObject({ confirmations: 12 });
  });

  test("accepts a swap lifecycle event", async () => {
    const body = JSON.stringify({
      event: "swap.executed",
      data: {
        swapId: "6a2b0c4d-1e2f-4a5b-9c8d-7e6f5a4b3c2d",
        sellAmount: "1000",
        quotedBuyAmount: "990",
        minimumBuyAmount: "980",
        quotedRate: "0.99",
        executedAt: "2026-07-30T00:05:00.000Z",
      },
    });
    const delivery = await verifyRequest(deliveryRequest({ body }), SECRET, Number.MAX_SAFE_INTEGER);
    expect(delivery.event.event).toBe("swap.executed");
  });

  test("rejects an unknown event type and a non-JSON body", async () => {
    const unknown = JSON.stringify({ event: "payin.reversed", data: {} });
    expect(
      verifyRequest(deliveryRequest({ body: unknown }), SECRET, Number.MAX_SAFE_INTEGER),
    ).rejects.toThrow("unknown event type: payin.reversed");
    expect(
      verifyRequest(deliveryRequest({ body: "not json" }), SECRET, Number.MAX_SAFE_INTEGER),
    ).rejects.toThrow("body is not valid JSON");
  });
});
