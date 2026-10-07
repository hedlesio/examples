import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateP256KeyPair } from "@turnkey/crypto";

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const userId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const signingRequestId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const credentials = generateP256KeyPair();
let server: ReturnType<typeof Bun.serve>;
let walletCalls = 0;
let signatureSubmissions: unknown[] = [];

function session() {
  return {
    session: "hp_sess_cli",
    tenantId,
    tenantKind: "merchant",
    userId,
    expiresIn: 3600,
  };
}

function payout(complete: boolean) {
  return {
    id: "payout-cli",
    chain: "chain",
    asset: "asset",
    fromAddress: "from",
    toAddress: "to",
    amount: "1000",
    feeTotal: null,
    kind: "payout",
    status: complete ? "broadcast" : "pending",
    unsignedTx: complete ? null : "unsigned",
    signedTx: null,
    txHash: complete ? "0xhash" : null,
    nonce: null,
    confirmations: 0,
    requiredConfirmations: 1,
    reference: null,
    lastError: null,
    transfers: [
      {
        id: "transfer-cli",
        position: 0,
        kind: "recipient",
        asset: "asset",
        fromAddress: "from",
        toAddress: "to",
        amount: "1000",
        status: "pending",
        error: null,
        createdAt: "2026-07-30T00:00:00.000Z",
        settledAt: null,
      },
    ],
    createdAt: "2026-07-30T00:00:00.000Z",
    broadcastAt: complete ? "2026-07-30T00:00:01.000Z" : null,
    settledAt: null,
    signingRequests: [],
  };
}

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    routes: {
      "/v1/sessions/bootstrap": Response.json({ organizationId: "org-test" }),
      "/v1/sessions": {
        POST: () => Response.json(session()),
      },
      [`/v1/tenants/${tenantId}/claim/begin`]: {
        POST: () =>
          Response.json({
            tenantId,
            tenantName: "Example Merchant",
            tenantKind: "merchant",
          }),
      },
      [`/v1/tenants/${tenantId}/claim/verify-code`]: {
        POST: () => Response.json({ claimTicket: "hp_claim_test", email: "owner@example.com" }),
      },
      [`/v1/tenants/${tenantId}/claim/complete`]: {
        POST: () => Response.json({ tenantId, rootUserId: "turnkey-user", mode: "cosigned" }),
      },
      "/v1/addresses": {
        POST() {
          walletCalls += 1;
          return Response.json({
            id: "address-cli",
            tenant_id: tenantId,
            chainType: "evm",
            address: "0x1234",
            address_kind: "turnkey_wallet_account",
            address_role: "payin",
            status: "available",
            isSignable: false,
            derivation_path: null,
            created_at: "2026-07-30T00:00:00.000Z",
            updated_at: "2026-07-30T00:00:00.000Z",
            deletedAt: null,
            whitelistedAt: null,
            chains: [{ chainKey: "eip155:84532" }],
          });
        },
      },
      "/v1/payins": {
        POST: () =>
          Response.json({
            id: "payin-cli",
            status: "awaiting_payment",
            reference: null,
            chainKey: "chain",
            assetKey: "asset",
            address: "deposit-address",
            addressId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            fromAddress: null,
            expectedAmount: "1000",
            amount: null,
            txHash: null,
            confirmations: 0,
            classification: "matched",
            createdAt: "2026-07-30T00:00:00.000Z",
            confirmedAt: null,
            expiresAt: "2026-07-30T01:00:00.000Z",
          }),
      },
      "/v1/payouts": {
        POST: () =>
          Response.json({
            signingRequests: [
              {
                id: signingRequestId,
                body: "turnkey-payout-activity",
                token: "binding-token",
              },
            ],
          }),
      },
      [`/v1/payouts/${signingRequestId}/signatures`]: {
        async POST(request) {
          signatureSubmissions = (await request.json()) as unknown[];
          return Response.json(payout(true));
        },
      },
    },
  });
});

afterAll(() => {
  server.stop(true);
});

function testEnvironment(overrides: Record<string, string> = {}): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(Bun.env)) {
    if (value !== undefined) environment[name] = value;
  }
  return {
    ...environment,
    HEDLES_API_PUBLIC_KEY: credentials.publicKey,
    HEDLES_API_PRIVATE_KEY: credentials.privateKey,
    HEDLES_SESSION_TOKEN: "",
    ...overrides,
  };
}

async function run(script: string, args: string[], environment: Record<string, string>): Promise<unknown> {
  const child = Bun.spawn(["bun", "run", script, ...args], {
    cwd: `${import.meta.dir}/..`,
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(exitCode, stderr).toBe(0);
  return JSON.parse(stdout);
}

describe("Bun example commands", () => {
  test("run independently through their complete HTTP flows", async () => {
    const sessionResult = (await run(
      "session",
      ["--api-url", `http://127.0.0.1:${server.port}`],
      testEnvironment(),
    )) as { session: string };
    expect(sessionResult.session).toBe("hp_sess_cli");

    const claimResult = (await run(
      "claim",
      [
        "--api-url",
        `http://127.0.0.1:${server.port}`,
        "--tenant-id",
        tenantId,
        "--claim-code",
        "123456",
        "--user-name",
        "Example Owner",
      ],
      testEnvironment(),
    )) as { completed: { tenantId: string }; session: { session: string } };
    expect(claimResult.completed.tenantId).toBe(tenantId);
    expect(claimResult.session.session).toBe("hp_sess_cli");

    const walletResult = (await run(
      "wallet",
      ["--api-url", `http://127.0.0.1:${server.port}`],
      testEnvironment({ HEDLES_SESSION_TOKEN: "hp_sess_cli" }),
    )) as { id: string };
    expect(walletResult.id).toBe("address-cli");
    expect(walletCalls).toBe(1);

    const payinResult = (await run(
      "payin",
      [
        "--api-url",
        `http://127.0.0.1:${server.port}`,
        "--chain",
        "chain",
        "--asset",
        "asset",
        "--amount",
        "1000",
      ],
      testEnvironment(),
    )) as { id: string; classification: string };
    expect(payinResult.id).toBe("payin-cli");
    expect(payinResult.classification).toBe("matched");

    const payoutResult = (await run(
      "payout",
      [
        "--api-url",
        `http://127.0.0.1:${server.port}`,
        "--chain",
        "chain",
        "--asset",
        "asset",
        "--amount",
        "1000",
        "--from",
        "from",
        "--to",
        "to",
      ],
      testEnvironment(),
    )) as { id: string; signingRequests: unknown[] };
    expect(payoutResult.id).toBe("payout-cli");
    expect(payoutResult.signingRequests).toEqual([]);
    expect(signatureSubmissions).toHaveLength(1);
    expect(signatureSubmissions[0]).toMatchObject({
      id: signingRequestId,
      body: "turnkey-payout-activity",
      token: "binding-token",
    });
  });
});
