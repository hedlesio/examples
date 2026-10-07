import { timingSafeEqual } from "node:crypto";
import type { WebhookEvent } from "./types.ts";

export const SIGNATURE_HEADER = "x-hedles-signature";
export const EVENT_HEADER = "x-hedles-event";
export const IDEMPOTENCY_HEADER = "x-hedles-idempotency-key";

export const DEFAULT_TOLERANCE_SECONDS = 300;

export const WEBHOOK_EVENT_TYPES = [
  "payin.pending",
  "payin.confirmed",
  "payin.expired",
  "payout.created",
  "payout.broadcast",
  "payout.settled",
  "payout.failed",
  "swap.accepted",
  "swap.executing",
  "swap.executed",
  "swap.expired",
  "swap.failed",
] as const;

export class WebhookVerificationError extends Error {}

interface ParsedSignatureHeader {
  timestamp: number;
  signatures: string[];
}

// `t=1754481600,v1=<hex>` — v1 may repeat so a secret can be rotated by
// accepting either signature during the overlap.
export function parseSignatureHeader(header: string | null): ParsedSignatureHeader {
  if (!header) throw new WebhookVerificationError("missing X-Hedles-Signature header");

  let timestamp: number | undefined;
  const signatures: string[] = [];

  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "t" && timestamp === undefined) timestamp = Number(value);
    if (key === "v1") signatures.push(value);
  }

  if (timestamp === undefined || !Number.isFinite(timestamp)) {
    throw new WebhookVerificationError("signature header has no valid timestamp");
  }
  if (signatures.length === 0) {
    throw new WebhookVerificationError("signature header has no v1 signature");
  }
  return { timestamp, signatures };
}

export function signPayload(secret: string, timestamp: number, rawBody: string): string {
  const hmac = new Bun.CryptoHasher("sha256", secret);
  hmac.update(`${timestamp}.${rawBody}`);
  return hmac.digest("hex");
}

function matches(expected: string, candidate: string): boolean {
  const expectedBytes = Buffer.from(expected, "utf8");
  const candidateBytes = Buffer.from(candidate, "utf8");
  if (expectedBytes.length !== candidateBytes.length) return false;
  return timingSafeEqual(expectedBytes, candidateBytes);
}

interface VerifyInput {
  rawBody: string;
  signatureHeader: string | null;
  secret: string;
  toleranceSeconds?: number;
  nowSeconds?: number;
}

export function verifySignature(input: VerifyInput): void {
  const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const { timestamp, signatures } = parseSignatureHeader(input.signatureHeader);

  // Rejecting an old timestamp is what stops a captured delivery from being
  // replayed later; the signature alone stays valid forever.
  if (Math.abs(now - timestamp) > tolerance) {
    throw new WebhookVerificationError(`timestamp outside ${tolerance}s tolerance`);
  }

  const expected = signPayload(input.secret, timestamp, input.rawBody);
  if (!signatures.some((signature) => matches(expected, signature))) {
    throw new WebhookVerificationError("signature does not match the request body");
  }
}

function parseEvent(rawBody: string): WebhookEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new WebhookVerificationError("body is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new WebhookVerificationError("body is not a JSON object");
  }
  const event = (parsed as { event?: unknown }).event;
  if (typeof event !== "string" || !WEBHOOK_EVENT_TYPES.includes(event as WebhookEvent["event"])) {
    throw new WebhookVerificationError(`unknown event type: ${String(event)}`);
  }
  return parsed as WebhookEvent;
}

export interface VerifiedDelivery {
  event: WebhookEvent;
  idempotencyKey: string | null;
}

export async function verifyRequest(
  request: Request,
  secret: string,
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
): Promise<VerifiedDelivery> {
  // The signature covers the exact bytes that were sent. Read the body as text
  // and verify before parsing — re-serializing the JSON changes key order and
  // whitespace, and the signature will no longer match.
  const rawBody = await request.text();
  verifySignature({
    rawBody,
    signatureHeader: request.headers.get(SIGNATURE_HEADER),
    secret,
    toleranceSeconds,
  });
  return {
    event: parseEvent(rawBody),
    idempotencyKey: request.headers.get(IDEMPOTENCY_HEADER),
  };
}
