// Request stamping with nothing but WebCrypto.
//
// A stamp is an ECDSA P-256 signature over the exact bytes of a request body,
// delivered in the `X-Stamp` header as base64url(JSON) of:
//
//   { publicKey: <compressed P-256 point, hex, 66 chars>,
//     scheme:    "SIGNATURE_SCHEME_TK_API_P256",
//     signature: <DER-encoded ECDSA signature over SHA-256(body), hex> }
//
// The public key is the one registered at claim time. Sign the body you were
// handed byte for byte; any change to it invalidates the stamp.

import type { ApiKeyCredentials, Stamp, Stamper } from "./types.ts";

export const STAMP_HEADER_NAME = "X-Stamp";
export const STAMP_SCHEME = "SIGNATURE_SCHEME_TK_API_P256";

// secp256r1 (P-256) field prime and curve constant b, used only to recover the
// y coordinate from a compressed public key so WebCrypto can import the pair.
const P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
const B = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn;

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    b = (b * b) % modulus;
    e >>= 1n;
  }
  return result;
}

function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.replace(/^0x/i, "");
  if (normalized.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(normalized)) {
    throw new Error("expected a hexadecimal string");
  }
  return Uint8Array.from(Buffer.from(normalized, "hex"));
}

function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function fromBase64url(text: string): Uint8Array {
  return Uint8Array.from(Buffer.from(text, "base64url"));
}

function bigintToBytes(value: bigint, length: number): Uint8Array {
  return hexToBytes(value.toString(16).padStart(length * 2, "0"));
}

// 0x02/0x03 || x  ->  { x, y }. P ≡ 3 (mod 4), so sqrt(a) = a^((P+1)/4).
export function decompressPublicKey(compressedHex: string): { x: Uint8Array; y: Uint8Array } {
  const bytes = hexToBytes(compressedHex);
  if (bytes.length !== 33 || (bytes[0] !== 0x02 && bytes[0] !== 0x03)) {
    throw new Error("public key must be a 33-byte compressed P-256 point");
  }
  const x = BigInt(`0x${bytesToHex(bytes.subarray(1))}`);
  if (x >= P) throw new Error("public key x coordinate is out of range");
  const rhs = (modPow(x, 3n, P) - 3n * x + B) % P;
  const y = modPow((rhs + P) % P, (P + 1n) / 4n, P);
  if ((y * y) % P !== (rhs + P) % P) throw new Error("public key is not on the P-256 curve");
  const wantOdd = bytes[0] === 0x03;
  const chosen = (y & 1n) === 1n ? (wantOdd ? y : P - y) : wantOdd ? P - y : y;
  return { x: bigintToBytes(x, 32), y: bigintToBytes(chosen, 32) };
}

// 0x04 || x || y  ->  0x02/0x03 || x
export function compressPublicKey(uncompressed: Uint8Array): string {
  if (uncompressed.length !== 65 || uncompressed[0] !== 0x04) {
    throw new Error("expected a 65-byte uncompressed P-256 point");
  }
  const x = uncompressed.subarray(1, 33);
  const y = uncompressed.subarray(33, 65);
  const prefix = (y[31] as number) & 1 ? 0x03 : 0x02;
  return bytesToHex(Uint8Array.from([prefix, ...x]));
}

// WebCrypto yields r || s (64 bytes); the stamp carries DER.
function derInteger(value: Uint8Array): Uint8Array {
  let start = 0;
  while (start < value.length - 1 && value[start] === 0) start += 1;
  let body = value.subarray(start);
  if ((body[0] as number) & 0x80) body = Uint8Array.from([0, ...body]);
  return Uint8Array.from([0x02, body.length, ...body]);
}

export function rawSignatureToDer(raw: Uint8Array): Uint8Array {
  if (raw.length !== 64) throw new Error("expected a 64-byte r||s signature");
  const r = derInteger(raw.subarray(0, 32));
  const s = derInteger(raw.subarray(32, 64));
  return Uint8Array.from([0x30, r.length + s.length, ...r, ...s]);
}

export function derSignatureToRaw(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30) throw new Error("expected a DER sequence");
  let offset = 2;
  const readInteger = (): Uint8Array => {
    if (der[offset] !== 0x02) throw new Error("expected a DER integer");
    const length = der[offset + 1] as number;
    const value = der.subarray(offset + 2, offset + 2 + length);
    offset += 2 + length;
    const trimmed = value.length > 32 ? value.subarray(value.length - 32) : value;
    const padded = new Uint8Array(32);
    padded.set(trimmed, 32 - trimmed.length);
    return padded;
  };
  const r = readInteger();
  const s = readInteger();
  return Uint8Array.from([...r, ...s]);
}

export function normalizePrivateKey(privateKey: string): string {
  const normalized = privateKey.trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error("HEDLES_API_PRIVATE_KEY must be a 32-byte hexadecimal P-256 private key");
  }
  return normalized;
}

function privateJwk(credentials: ApiKeyCredentials): JsonWebKey {
  const { x, y } = decompressPublicKey(credentials.publicKey);
  return {
    kty: "EC",
    crv: "P-256",
    x: base64url(x),
    y: base64url(y),
    d: base64url(hexToBytes(normalizePrivateKey(credentials.privateKey))),
  };
}

export async function generateKeyPair(): Promise<ApiKeyCredentials> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const [raw, jwk] = await Promise.all([
    crypto.subtle.exportKey("raw", pair.publicKey),
    crypto.subtle.exportKey("jwk", pair.privateKey),
  ]);
  if (!jwk.d) throw new Error("generated key has no private scalar");
  return {
    publicKey: compressPublicKey(new Uint8Array(raw)),
    privateKey: bytesToHex(fromBase64url(jwk.d)),
  };
}

export function createStamper(credentials: ApiKeyCredentials): Stamper {
  const jwk = privateJwk(credentials);
  const keyPromise = crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
  ]);
  return {
    async stamp(body: string): Promise<Stamp> {
      const key = await keyPromise;
      const raw = await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        key,
        Buffer.from(body, "utf8"),
      );
      const envelope = {
        publicKey: credentials.publicKey,
        scheme: STAMP_SCHEME,
        signature: bytesToHex(rawSignatureToDer(new Uint8Array(raw))),
      };
      return {
        stampHeaderName: STAMP_HEADER_NAME,
        stampHeaderValue: base64url(Buffer.from(JSON.stringify(envelope), "utf8")),
      };
    },
  };
}

export interface StampEnvelope {
  publicKey: string;
  scheme: string;
  signature: string;
}

export function decodeStamp(headerValue: string): StampEnvelope {
  return JSON.parse(Buffer.from(fromBase64url(headerValue)).toString("utf8")) as StampEnvelope;
}

// Verifies a stamp against the public key it names. Useful for tests and for
// anyone implementing the stamp in another language.
export async function verifyStamp(headerValue: string, body: string): Promise<boolean> {
  const envelope = decodeStamp(headerValue);
  if (envelope.scheme !== STAMP_SCHEME) return false;
  const { x, y } = decompressPublicKey(envelope.publicKey);
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x: base64url(x), y: base64url(y) },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    Buffer.from(derSignatureToRaw(hexToBytes(envelope.signature))),
    Buffer.from(body, "utf8"),
  );
}
