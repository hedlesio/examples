import { describe, expect, test } from "bun:test";
import { ApiKeyStamper } from "@turnkey/api-key-stamper";
import {
  compressPublicKey,
  createStamper,
  decodeStamp,
  decompressPublicKey,
  derSignatureToRaw,
  generateKeyPair,
  rawSignatureToDer,
  STAMP_HEADER_NAME,
  STAMP_SCHEME,
  verifyStamp,
} from "../src/stamper.ts";

const body = JSON.stringify({ organizationId: "org-test", timestampMs: "1760000000000" });

describe("stamper", () => {
  test("generates a compressed P-256 key pair in the registered format", async () => {
    const pair = await generateKeyPair();
    expect(pair.publicKey).toMatch(/^0[23][0-9a-f]{64}$/);
    expect(pair.privateKey).toMatch(/^[0-9a-f]{64}$/);
    const { x, y } = decompressPublicKey(pair.publicKey);
    expect(compressPublicKey(Uint8Array.from([0x04, ...x, ...y]))).toBe(pair.publicKey);
  });

  test("produces a stamp that verifies and names the key", async () => {
    const pair = await generateKeyPair();
    const stamp = await createStamper(pair).stamp(body);
    expect(stamp.stampHeaderName).toBe(STAMP_HEADER_NAME);
    const envelope = decodeStamp(stamp.stampHeaderValue);
    expect(envelope).toEqual({
      publicKey: pair.publicKey,
      scheme: STAMP_SCHEME,
      signature: expect.any(String),
    });
    expect(envelope.signature).toMatch(/^30[0-9a-f]+$/);
    expect(await verifyStamp(stamp.stampHeaderValue, body)).toBe(true);
    expect(await verifyStamp(stamp.stampHeaderValue, `${body} `)).toBe(false);
  });

  // The reference SDK stamper is a dev dependency only, kept to prove the
  // envelope is interchangeable in both directions.
  test("is interchangeable with the reference SDK stamper", async () => {
    const pair = await generateKeyPair();
    const sdk = await new ApiKeyStamper({
      apiPublicKey: pair.publicKey,
      apiPrivateKey: pair.privateKey,
    }).stamp(body);
    const ours = await createStamper(pair).stamp(body);
    expect(ours.stampHeaderName).toBe(sdk.stampHeaderName);
    const a = decodeStamp(sdk.stampHeaderValue);
    const b = decodeStamp(ours.stampHeaderValue);
    expect(Object.keys(a)).toEqual(Object.keys(b));
    expect(a.publicKey).toBe(b.publicKey);
    expect(a.scheme).toBe(b.scheme);
    expect(await verifyStamp(sdk.stampHeaderValue, body)).toBe(true);
    expect(await verifyStamp(ours.stampHeaderValue, body)).toBe(true);
  });

  test("round-trips DER and raw signatures, including high-bit padding", () => {
    const raw = new Uint8Array(64);
    raw.fill(0xff, 0, 32);
    raw.fill(0x01, 32, 64);
    const der = rawSignatureToDer(raw);
    expect(der[0]).toBe(0x30);
    expect(derSignatureToRaw(der)).toEqual(raw);
  });

  test("rejects malformed keys", () => {
    expect(() => decompressPublicKey("04ab")).toThrow("33-byte compressed");
    expect(() => createStamper({ publicKey: "02".padEnd(66, "0"), privateKey: "zz" })).toThrow(
      "32-byte hexadecimal",
    );
  });
});
