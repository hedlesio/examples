# Hedles API examples

Bun + TypeScript examples for tenant claims, sessions, wallets, pay-ins, and payouts.

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

Authenticated commands use `HEDLES_SESSION_TOKEN` when set; otherwise they create a session with the API
key pair. Wallet creation and cosigned payouts may still need the key pair to sign activities.

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

Signs an identity proof and returns a one-hour Hedles token. Organization bootstrap is automatic;
`--organization-id` overrides it.

### Create a wallet address

```sh
bun run wallet
bun run wallet --chain-type xrp
```

Defaults to `evm`. Supported types: `evm`, `solana`, `bitcoin`, `bitcoin-testnet`, `litecoin`,
`litecoin-testnet`, `xrp`, and `tron`.

### Create a pay-in

```sh
bun run payin \
  --chain your-chain-key \
  --asset your-asset-key \
  --amount 1000000 \
  --reference invoice-123
```

`--reference` is optional; `--expires-in` defaults to 3600 seconds.

### Create and sign a payout

```sh
bun run payout \
  --chain your-chain-key \
  --asset your-asset-key \
  --from source-address \
  --to recipient-address \
  --amount 1000000 \
  --note invoice-123
```

`--note` is optional. XRPL supports `--destination-tag <uint32>`. When required, the command signs each
exact activity body and handles up to two stages.

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
`payout.settled`, `payout.failed`.

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

Runs TypeScript, Biome, and Bun tests.

## Security

- Never commit `.env`.
- Treat private keys and session tokens as secrets.
- Never modify a prepared activity body before signing.
- Test financial operations against development first.

## Links

- [Development API docs](https://api-dev.hedles.io/docs)

MIT
