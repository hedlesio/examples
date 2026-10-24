# Hedles API examples

Bun + TypeScript examples for tenant claims, sessions, wallets, pay-ins, payouts, and swaps.

## Quick start

Requires [Bun](https://bun.sh/) 1.3.14+, a Hedles tenant, and either a session token or P-256 API key.

```sh
git clone https://github.com/hedlesio/examples.git
cd examples
bun install
cp .env.example .env
```

Secrets live in `.env`; operation inputs are CLI flags. Run any command with `--help`.

Commands default to `https://api-dev.hedles.io`. Production operations are real: pass
`--api-url https://api.hedles.io` only intentionally. Amounts use atomic units.

## Authentication

| Variable | Purpose |
| --- | --- |
| `HEDLES_SESSION_TOKEN` | Existing bearer token |
| `HEDLES_API_PUBLIC_KEY` | Compressed P-256 public key |
| `HEDLES_API_PRIVATE_KEY` | 32-byte P-256 private key in hex |
| `HEDLES_WEBHOOK_SECRET` | Signing secret of the webhook endpoint |
| `HEDLES_SWAP_SIGNING_KEY` | WIF or 32-byte hex private key of the UTXO address that funds swaps |

Authenticated commands use `HEDLES_SESSION_TOKEN` when set; otherwise they create a session with the API
key pair. Signing needs nothing beyond WebCrypto: a stamp is an ECDSA P-256 signature over the exact bytes
of a body, encoded as base64url JSON `{ publicKey, scheme, signature }` with the
DER-encoded signature in hex. `src/stamper.ts` is the whole implementation, including key generation and a
verifier you can port to another language. These examples fetch `/v1/sessions/bootstrap` before each
login and stamp its exact `body` string without parsing or rebuilding it. Bootstrap uses the gateway
clock and returns `expiresIn: 300` for the login-proof freshness window. Login sends the stamp as
`stampHeaderName: "X-Stamp"` and `stampHeaderValue` inside `signedRequest`, alongside the exact body;
it does not add `X-Stamp` as an HTTP header on the gateway request.

The gateway accepts a signed JSON body containing a nonempty `organizationId` and an integer
`timestampMs` in Unix milliseconds within five minutes of its clock, including the future bound.
Use bootstrap's returned `body` as the recommended signing input; stamp and submit it unchanged
instead of constructing provider-specific fields locally. Existing valid locally constructed proofs
remain compatible. The gateway rejects timestamp-less, string-valued, fractional, unsafe, stale,
or excessively future-dated proofs. Additional opaque fields remain compatible.

Freshness is stateless. A valid proof may be reused within the accepted clock window, and every accepted
login may issue a separate one-hour session after provider verification and tenant/user checks. Because
the clock window is symmetric, a maximally future-dated proof can span approximately ten minutes of total
acceptance. The proof window and session lifetime are independent: proof expiry does not invalidate an
already-issued session. Fetch and stamp a fresh bootstrap body after expiry; bootstrap and login
responses are `no-store`. Cosigned payouts always need the key pair to stamp their signing requests.

These examples use the timestamped bootstrap response from
[hyperpay PR #910](https://github.com/hedlesio/hyperpay/pull/910). Deploy a gateway returning that response
before using this examples revision; no database migration is required. Coordinate timestamp-capable
gateway, dashboard, and integrator updates, and refresh already-open dashboard bundles after the new
Pages build is promoted. Clients that already construct fresh `{organizationId, timestampMs}` bodies
remain supported.

## Commands

### Claim a tenant

```sh
bun run claim \
  --tenant-id your-tenant-uuid \
  --claim-code 123456 \
  --user-name "Example Owner"
```

Defaults: owner name to the verified email and custody mode to `cosigned`. Use
`--custody-mode custodial` for Hedles-authorized wallet operations.

If no API keys are configured, the command generates a pair and prints the private key once. Store it
immediately.

### Create a session

```sh
bun run session
```

Stamps a fresh server-clock login body and returns a one-hour Hedles token. Bootstrap runs on every
login, including when `--organization-id` selects a known organization for a credential registered in
multiple organizations.

### Create a wallet address

```sh
bun run wallet
bun run wallet --chain xrpl
```

Defaults to `base`. Use canonical chain names: `ethereum`, `polygon`, `base`, `solana`, `bitcoin`,
`litecoin`, `bitcoin-cash`, `dogecoin`, `zcash`, `xrpl`, and `tron`. The gateway selects the concrete
network for its environment; internal network keys and wallet family names are not API chain values.

### Create a pay-in

```sh
bun run payin \
  --chain base \
  --asset USDC \
  --amount 1000000 \
  --reference invoice-123
```

`--reference` is optional; `--expires-in` defaults to 3600 seconds. The response includes a
`classification` (`matched`, `pending`, or `expired`) telling you whether the observed funds matched an
active payment request.

### Create and sign a payout

```sh
bun run payout \
  --chain base \
  --asset USDC \
  --from source-address \
  --to recipient-address \
  --amount 1000000 \
  --reference invoice-123
```

`--reference` is optional. XRPL supports `--destination-tag <uint32>`. Repeat `--to` and `--amount` in pairs
for a multisend from an EVM or Zcash omnibus; `all` sweeps the balance for a single recipient.

A payout is one single-asset transaction: `POST /v1/payouts` takes a top-level `chain`, `asset`, and
`fromAddress` plus one or more `transfers` (`toAddress`, `amount`, optional `destinationTag`). It never
accepts signatures. When client signing is required, the response carries opaque `signingRequests`
(`id`, `signer`, `transaction`, `method`, `body`); review `transaction`, stamp each exact `body`, and
submit `{ id, method, body, stamp: { name, value } }` items as the top-level array to
`POST /v1/payouts/:id/signatures`. Use the payout id returned by creation for every round, including
first-use EVM authorization followed by transaction signing. Payout signing does not use a token. Repeat until `signingRequests` is
empty. The command drives this loop for you. Recipient and fee movements come back as flat `transfers`
rows; a settled payout means the transaction settled, so inspect each transfer's own status.

### Receive and verify webhooks

```sh
bun run webhooks
bun run webhooks --port 9000 --path /hooks
```

Runs a receiver on `http://localhost:8787/webhooks/hedles` that verifies every delivery before acting on it.
Register the endpoint with `POST /v1/webhooks` (`url`, `events`, and a `secret` of at least 32 characters), and
put that same secret in `HEDLES_WEBHOOK_SECRET`. To reach a local receiver from the API, expose it with
`cloudflared tunnel --url http://localhost:8787` and register the tunnel URL.

Each delivery carries three headers:

| Header | Meaning |
| --- | --- |
| `X-Hedles-Signature` | `t=<unix seconds>,v1=<hex>` |
| `X-Hedles-Event` | Event type, e.g. `payin.confirmed` |
| `X-Hedles-Idempotency-Key` | Stable across retries and replays of the same event |

`v1` is `HMAC-SHA256(secret, "<t>.<raw body>")` in hex. Verification, in `src/webhooks.ts`, is four steps:

1. Read the **raw** body as text. Re-serializing the parsed JSON changes key order and whitespace, and the
   signature no longer matches.
2. Reject a `t` outside a 300-second tolerance. The signature never expires on its own, so the timestamp check
   is what prevents a captured delivery from being replayed later.
3. Recompute the HMAC over `` `${t}.${rawBody}` `` and compare it in constant time.
4. Only then parse the JSON and act on it.

Delivery is at-least-once. A non-2xx response or a response slower than 10 seconds is retried up to 6 attempts
(1m, 5m, 30m, 2h, 8h), and an operator can replay a delivery from the dashboard — every one of those repeats
carries the original idempotency key, so key side effects on it. Acknowledge with a 2xx immediately and do the
work afterwards.

Events: `payin.pending`, `payin.confirmed`, `payin.expired`, `payout.created`, `payout.broadcast`,
`payout.settled`, `payout.failed`, `swap.accepted`, `swap.executing`, `swap.executed`, `swap.expired`,
`swap.failed`, `omnibus.low_gas`. Payloads are a discriminated union on `event` (see `src/types.ts`);
payout payloads carry the per-movement `transfers` array, so check each transfer's status rather than
assuming every movement settled.

### Swap between assets

A swap is a request-for-quote flow that never takes custody of your keys. Request a firm quote:

```sh
bun run swap-quote \
  --sell-chain bitcoin --sell-asset BTC \
  --buy-chain ethereum --buy-asset USDT \
  --amount 100000 --side sell \
  --sender-address bc1qYourSendingAddress \
  --recipient-address 0xYourReceivingAddress
```

Supported directed pairs are `DOGE`, `LTC`, and `ZEC` into `BTC` or `USDT` (Ethereum), and `BTC` into
`USDT`. Zcash is transparent-address only, and route availability is dynamic.

The quote returns firm terms (`sellAmount`, `quotedBuyAmount`, `minimumBuyAmount`, `quotedRate`), the
`venueFundingAddress` (plus `fundingMemo` where the chain needs one), an unsigned `fundingTransaction`
already built to pay it (a PSBT for UTXO sell chains), a binding `token`, and an `expiresAt` deadline.
`--side buy`, which fixes the bought leg instead, currently answers `501 not_implemented` — fix the sold
leg. Swap routing covers mainnet pairs; a pair the venue cannot route (including testnet chains) is
rejected with `400 swap_pair_not_supported`.

Sign the `fundingTransaction` with the wallet that controls `--sender-address` — amount, destination, and
memo are fixed by construction — then accept before the quote expires. If that wallet's key is at hand, one
command does quote, local signature, and acceptance:

```sh
HEDLES_SWAP_SIGNING_KEY=<wif or hex> bun run swap \
  --sell-chain dogecoin --sell-asset DOGE \
  --buy-chain bitcoin --buy-asset BTC \
  --amount 8000000000 \
  --sender-address DYourDogeAddress \
  --recipient-address bc1qYourReceivingAddress
```

`src/swap.ts` decodes the PSBT with `@bitgo/utxo-lib` on the sell chain's network (Bitcoin, Litecoin,
Dogecoin, Bitcoin Cash, Zcash, and their testnets), adds input signatures, and leaves everything else
untouched. `bun run swap --quote-id <id>` signs and accepts a quote you already hold. To sign elsewhere,
post the signed PSBT yourself:

```sh
bun run swap-accept \
  --quote-id <id> --token <token> \
  --signature <signed funding transaction>
```

The signed payload must come from the quote's exact `fundingTransaction`; the API proves the unsigned
transaction is unchanged, validates and finalizes every input, then broadcasts it. A retry must resubmit
the same signed bytes rather than signing again. Track the returned swap via `GET /v1/swaps/:id` through
`pending`, `executing`, and `executed` — a swap whose deposit never confirms before the deadline ends
`expired`, and other terminal errors end `failed` with a bounded `failureReason`. `bun run swap-status --id
<id>` reads one swap (its id matches the quote's) and `bun run swap-status` lists recent ones. An expired
quote cannot be accepted — request a fresh one rather than re-signing stale bytes.

## Shared options

| Option | Default |
| --- | --- |
| `--api-url` | `https://api-dev.hedles.io` |
| `--organization-id` | Auto-discovered |
| `--help` | Prints command options |

## Development

```sh
bun run check
```

Runs TypeScript, Biome, and Bun tests. API request/response types for every published endpoint are
generated in `src/api-schema.ts`; the client aliases those contracts in `src/types.ts`. Runtime chain
and webhook event choices are generated from the same schema. Regenerate from a gateway OpenAPI
export after server contract changes:

```sh
bun run generate:api /path/to/openapi.json
bun run check
```

This snapshot follows the Hyperpay API contract audit based on main `87a38f8c` (2026-10-24).
The generator pins its own TypeScript 5 printer because the application uses the TypeScript 7
compiler. The generator dependencies are only installed when regenerating, not at runtime.

## Security

- Never commit `.env`.
- Treat private keys, session tokens, and the swap signing key as secrets.
- Never modify a prepared activity body before signing.
- Test financial operations against development first.

## Links

- [Development API docs](https://api-dev.hedles.io/docs)

MIT
