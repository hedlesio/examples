import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateP256KeyPair } from "@turnkey/crypto";

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const userId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const credentials = generateP256KeyPair();
let server: ReturnType<typeof Bun.serve>;
let walletPhase = 0;

function session() {
  return {
    session: "hp_sess_cli",
    tenantId,
    tenantKind: "merchant",
    userId,
    expiresIn: 3600,
  };
}

function payout(signing: boolean) {
  return {
    id: "payout-cli",
    chain: "chain",
    asset: "asset",
    fromAddress: "from",
    toAddress: "to",
    amount: "1000",
    kind: "direct",
    status: signing ? "prepared" : "broadcast",
    unsignedTx: signing ? "unsigned" : null,
    txHash: signing ? null : "0xhash",
    note: null,
    createdAt: "2026-07-30T00:00:00.000Z",
    broadcastAt: signing ? null : "2026-07-30T00:00:01.000Z",
    settledAt: null,
    signing: signing
      ? {
          stage: "evm",
          requests: [
            {
              id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
              body: "turnkey-payout-activity",
              token: "binding-token",
              authorization: { required: 2, received: 0, remaining: 2, approvers: [] },
            },
          ],
        }
      : null,
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
        async POST(request) {
          const body = (await request.json()) as { signedRequest?: unknown };
          walletPhase += 1;
          if (!body.signedRequest) {
            return Response.json({ prepared: { body: "turnkey-wallet-activity" } });
          }
          return Response.json({
            id: "address-cli",
            tenant_id: tenantId,
            chainType: "evm",
            address: "0x1234",
            address_role: "payin",
            status: "available",
            isSignable: false,
            derivation_path: null,
            created_at: "2026-07-30T00:00:00.000Z",
            updated_at: "2026-07-30T00:00:00.000Z",
            deletedAt: null,
            chains: [{ chainKey: "base-sepolia" }],
          });
        },
      },
      "/v1/payins": {
        POST: () =>
          Response.json({
            id: "payin-cli",
            status: "pending",
            reference: null,
            metadata: null,
            chainKey: "chain",
            assetKey: "asset",
            address: "deposit-address",
            expectedAmount: "1000",
            amount: null,
            txHash: null,
            confirmations: 0,
            createdAt: "2026-07-30T00:00:00.000Z",
            confirmedAt: null,
            expiresAt: "2026-07-30T01:00:00.000Z",
          }),
      },
      "/v1/payouts": {
        POST: () => Response.json(payout(true)),
      },
      "/v1/payouts/payout-cli/signatures": {
        POST: () => Response.json(payout(false)),
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
    expect(walletPhase).toBe(2);

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
    )) as { id: string };
    expect(payinResult.id).toBe("payin-cli");

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
    )) as { id: string; signing: unknown };
    expect(payoutResult.id).toBe("payout-cli");
    expect(payoutResult.signing).toBeNull();
  });
});
