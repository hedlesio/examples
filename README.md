# Hedles examples

Small, Bun-first TypeScript scripts for the core Hedles API flows:

- Claim a tenant with a programmatic P-256 API key.
- Exchange a Turnkey-stamped identity proof for a Hedles session token.
- Create a wallet address with the custody-adaptive Turnkey authorization flow.
- Create a pay-in.
- Create and sign a payout, including both possible Turnkey signing stages.

Each example is an independent `bun run` command. Shared HTTP, authentication, and stamping helpers live
under `src/` so the security-sensitive logic has one implementation.

## Requirements

- [Bun](https://bun.sh/) 1.3.14 or newer
- A Hedles tenant and Turnkey P-256 API key
- A claim code if you are claiming a new tenant

The examples default to the isolated development API at `https://api-dev.hedles.io`. Set
`HEDLES_API_URL=https://api.hedles.io` only when you intentionally want to execute against production.
Pay-ins and payouts are real API operations, and all amounts use atomic units.

## Install

```sh
git clone https://github.com/hedlesio/examples.git
cd examples
bun install
cp .env.example .env
```

Bun loads `.env` automatically. Fill only the variables required by the command you want to run.

## 1. Claim a tenant

The programmatic claim flow verifies the emailed one-time code, registers a P-256 API key, completes the
claim, and immediately obtains a Hedles session token.

```sh
HEDLES_TENANT_ID=your-tenant-uuid \
HEDLES_CLAIM_CODE=123456 \
HEDLES_USER_NAME="Example Owner" \
bun run claim
```

If `TURNKEY_API_PUBLIC_KEY` and `TURNKEY_API_PRIVATE_KEY` are both unset, the script generates a new key
pair and prints the private key exactly once. Store it in a secret manager before closing the terminal.
Set both variables to register an existing key pair instead.

`HEDLES_CUSTODY_MODE` defaults to `cosigned`. Set it to `custodial` if Hedles should perform protected
wallet operations without a second tenant signature.

## 2. Obtain a session token

```sh
TURNKEY_API_PUBLIC_KEY=your-compressed-p256-public-key \
TURNKEY_API_PRIVATE_KEY=your-p256-private-key \
bun run session
```

The script:

1. Loads the public Turnkey organization bootstrap from Hedles.
2. Serializes the Turnkey `whoami` body.
3. Signs that exact string with `@turnkey/api-key-stamper`.
4. Exchanges the signed request for a one-hour Hedles bearer token.

Set `TURNKEY_ORGANIZATION_ID` to bypass bootstrap and stamp a specific organization id.

## 3. Create a wallet address

```sh
HEDLES_CHAIN_TYPE=evm bun run wallet
```

Supported chain types are `evm`, `solana`, `bitcoin`, `bitcoin-testnet`, `litecoin`,
`litecoin-testnet`, `xrp`, and `tron`.

The endpoint may create the address directly or return an exact Turnkey activity body for the tenant to
authorize. The example detects that prepared response, injects the API-key stamper, and resubmits the
signed request. Depending on the chain family, the result is the next tenant wallet account or an
allocated pay-in address.

## 4. Create a pay-in

```sh
HEDLES_CHAIN_KEY=your-chain-key \
HEDLES_ASSET_KEY=your-asset-key \
HEDLES_AMOUNT=1000000 \
HEDLES_PAYIN_REFERENCE=invoice-123 \
bun run payin
```

The result includes the deposit address and pay-in lifecycle fields. `HEDLES_PAYIN_EXPIRES_IN` defaults
to 3600 seconds.

The script uses `HEDLES_SESSION_TOKEN` when present. Otherwise it obtains a fresh session with the
Turnkey API key variables, so the pay-in example remains independently runnable.

## 5. Create and sign a payout

```sh
HEDLES_CHAIN_KEY=your-chain-key \
HEDLES_ASSET_KEY=your-asset-key \
HEDLES_FROM_ADDRESS=source-address \
HEDLES_TO_ADDRESS=recipient-address \
HEDLES_AMOUNT=1000000 \
HEDLES_PAYOUT_NOTE=invoice-123 \
bun run payout
```

For XRPL payouts, `HEDLES_PAYOUT_DESTINATION_TAG` accepts an unsigned 32-bit destination tag.

The initial payout response is custody-adaptive. A custodial payout may need no client signature. When
`signing` is present, the script stamps every exact activity body returned by Hedles and submits the
corresponding request id, binding token, body, and Turnkey stamp. It repeats once because some chains can
return a second signing stage.

The reusable flow accepts the stamper as an injected `Stamper` interface:

```ts
const signed = await completePayoutSigning(api, payout, createTurnkeyStamper(credentials));
```

The command-line examples intentionally use API-key stamping because WebAuthn passkeys require a browser
authenticator context.

## Environment variables

| Variable | Used by | Description |
| --- | --- | --- |
| `HEDLES_API_URL` | all | API origin; defaults to the development API |
| `TURNKEY_API_PUBLIC_KEY` | claim/session/wallet/payin/payout | Compressed P-256 public key |
| `TURNKEY_API_PRIVATE_KEY` | claim/session/wallet/payin/payout | 32-byte P-256 private key in hex |
| `TURNKEY_ORGANIZATION_ID` | session/wallet/payin/payout | Optional explicit organization for the signed identity body |
| `HEDLES_SESSION_TOKEN` | wallet/payin/payout | Optional existing bearer token |
| `HEDLES_TENANT_ID` | claim | Tenant UUID from the claim link |
| `HEDLES_CLAIM_CODE` | claim | Emailed one-time verification code |
| `HEDLES_USER_NAME` | claim | Initial owner display name |
| `HEDLES_CUSTODY_MODE` | claim | `cosigned` or `custodial` |
| `HEDLES_CHAIN_TYPE` | wallet | Wallet address family such as `evm`, `solana`, or `xrp` |
| `HEDLES_CHAIN_KEY` | payin/payout | Enabled Hedles chain key |
| `HEDLES_ASSET_KEY` | payin/payout | Enabled Hedles asset key |
| `HEDLES_AMOUNT` | payin/payout | Atomic-unit integer string; payouts also accept `all` |
| `HEDLES_PAYIN_REFERENCE` | payin | Optional reconciliation reference |
| `HEDLES_PAYIN_EXPIRES_IN` | payin | Positive expiry duration in seconds |
| `HEDLES_FROM_ADDRESS` | payout | Source wallet address |
| `HEDLES_TO_ADDRESS` | payout | Destination wallet address |
| `HEDLES_PAYOUT_NOTE` | payout | Optional reconciliation note |
| `HEDLES_PAYOUT_DESTINATION_TAG` | payout | Optional XRPL uint32 destination tag |

## Project structure

```text
examples/
  claim-tenant.ts
  get-session.ts
  create-wallet.ts
  create-payin.ts
  create-payout.ts
src/
  api.ts
  auth.ts
  config.ts
  payout.ts
  runtime.ts
  turnkey.ts
  types.ts
  wallet.ts
tests/
```

## Validate changes

```sh
bun run check
```

This runs strict TypeScript checking, Biome, and the Bun test suite.

## References

- [Hedles development API documentation](https://api-dev.hedles.io/docs)
- [Turnkey API-key stamper documentation](https://docs.turnkey.com/sdks/advanced/api-key-stamper)

## Security

- Never commit `.env`; it is ignored.
- Treat the Turnkey private key and Hedles session token as secrets.
- Never modify or reserialize a prepared payout activity body before stamping it.
- Test financial operations against the development API first.

## License

MIT
