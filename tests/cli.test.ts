import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bitgo } from "@bitgo/utxo-lib";
import { createStamper, decodeStamp, generateKeyPair, verifyStamp } from "../src/stamper.ts";
import { runCommand } from "./_helpers/cli.ts";
import { fundingFixture } from "./_helpers/funding-psbt.ts";

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const userId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const signingRequestId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const credentials = await generateKeyPair();
let server: ReturnType<typeof Bun.serve>;
const quoteId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const fixture = fundingFixture("dogecoin", 3);
let walletCalls = 0;
let walletBody: unknown;
let payinBody: unknown;
let signatureSubmissions: unknown[] = [];
let payoutBodies: unknown[] = [];
let acceptBodies: unknown[] = [];

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
    chain: "base",
    asset: "asset",
    fromAddress: "from",
    toAddress: "to",
    amount: "1000",
    feeTotal: null,
    executionMode: "atomic",
    status: complete ? "broadcast" : "pending",
    txHash: complete ? "0xhash" : null,
    confirmations: 0,
    requiredConfirmations: 1,
    reference: null,
    lastError: null,
    transfers: [
      {
        id: "transfer-cli",
        position: 0,
        kind: "recipient",
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

function quote() {
  return {
    id: quoteId,
    status: "quoted",
    sellChain: "dogecoin",
    sellAsset: "DOGE",
    buyChain: "bitcoin",
    buyAsset: "BTC",
    sellAmount: "90000",
    quotedBuyAmount: "7273",
    minimumBuyAmount: "7200",
    quotedRate: "0.0000000808",
    venueFundingAddress: fixture.venueAddress,
    fundingMemo: null,
    fundingTransaction: fixture.unsigned,
    signingRequests: [],
    token: "quote-token",
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    createdAt: new Date().toISOString(),
  };
}

function swap() {
  return {
    id: quoteId,
    status: "pending",
    sellChain: "dogecoin",
    sellAsset: "DOGE",
    buyChain: "bitcoin",
    buyAsset: "BTC",
    sellAmount: "90000",
    quotedBuyAmount: "7273",
    minimumBuyAmount: "7200",
    quotedRate: "0.0000000808",
    venueFundingAddress: fixture.venueAddress,
    fundingTxHash: "ab".repeat(32),
    failureReason: null,
    executedAt: null,
    acceptedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
}

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    routes: {
      "/v1/sessions/bootstrap": {
        GET(request) {
          const organizationId = new URL(request.url).searchParams.get("organizationId") ?? "org-test";
          const body = JSON.stringify({
            organizationId,
            timestampMs: Date.now(),
          });
          return Response.json({ organizationId, body, expiresIn: 300 });
        },
      },
      "/v1/sessions": {
        async POST(request) {
          const { signedRequest } = (await request.json()) as {
            signedRequest: { body: string; stampHeaderName: string; stampHeaderValue: string };
          };
          const proof = JSON.parse(signedRequest.body) as { organizationId?: unknown; timestampMs?: unknown };
          if (
            typeof proof.organizationId !== "string" ||
            !proof.organizationId ||
            typeof proof.timestampMs !== "number" ||
            !Number.isSafeInteger(proof.timestampMs) ||
            Math.abs(Date.now() - proof.timestampMs) > 300_000 ||
            decodeStamp(signedRequest.stampHeaderValue).publicKey !== credentials.publicKey ||
            !(await verifyStamp(signedRequest.stampHeaderValue, signedRequest.body))
          )
            return Response.json({ code: "stamp_verification_failed" }, { status: 401 });
          return Response.json(session());
        },
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
        POST: () => Response.json({ tenantId, mode: "cosigned" }),
      },
      "/v1/addresses": {
        async POST(request) {
          walletBody = await request.json();
          walletCalls += 1;
          return Response.json({
            id: "address-cli",
            tenantId,
            address: "0x1234",
            addressRole: "payin",
            status: "available",
            isSignable: false,
            createdAt: "2026-07-30T00:00:00.000Z",
            updatedAt: "2026-07-30T00:00:00.000Z",
            deletedAt: null,
            whitelistedAt: null,
            chains: [{ chain: "base" }],
          });
        },
      },
      "/v1/payins": {
        async POST(request) {
          payinBody = await request.json();
          return Response.json({
            id: "payin-cli",
            status: "awaiting_payment",
            reference: null,
            chain: "base",
            asset: "asset",
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
          });
        },
      },
      "/v1/payouts": {
        async POST(request) {
          payoutBodies.push(await request.json());
          return Response.json({
            ...payout(false),
            signingRequests: [
              {
                id: signingRequestId,
                body: "payout-signing-body",
                method: "stampedRequest",
                signer: "from",
                transaction: "0x0100",
              },
            ],
          });
        },
      },
      "/v1/payouts/payout-cli/signatures": {
        async POST(request) {
          signatureSubmissions = (await request.json()) as unknown[];
          return Response.json(payout(true));
        },
      },
      "/v1/swaps/quotes": {
        POST: () => Response.json(quote(), { status: 201 }),
      },
      [`/v1/swaps/quotes/${quoteId}`]: {
        GET: () => Response.json(quote()),
      },
      "/v1/swaps": {
        GET: () =>
          Response.json({ items: [swap()], total: 1, limit: 20, page: 1, totalPages: 1, hasMore: false }),
        async POST(request) {
          acceptBodies.push(await request.json());
          return Response.json(swap(), { status: 201 });
        },
      },
      [`/v1/swaps/${quoteId}`]: {
        GET: () => Response.json(swap()),
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
    HEDLES_SWAP_SIGNING_KEY: "",
    ...overrides,
  };
}

async function run(script: string, args: string[], environment: Record<string, string>): Promise<unknown> {
  const { stdout, stderr, exitCode } = await runCommand(script, args, environment);
  expect(exitCode, stderr).toBe(0);
  return JSON.parse(stdout);
}

describe("Bun example commands", () => {
  test("session fixture rejects a valid stamp from an unregistered key", async () => {
    const body = JSON.stringify({ organizationId: "org-test", timestampMs: Date.now() });
    const stamp = await createStamper(await generateKeyPair()).stamp(body);
    expect(await verifyStamp(stamp.stampHeaderValue, body)).toBe(true);
    const response = await fetch(`http://127.0.0.1:${server.port}/v1/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signedRequest: { body, ...stamp } }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: "stamp_verification_failed" });
  });

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
    expect(walletBody).toEqual({ chain: "base" });

    const payinResult = (await run(
      "payin",
      [
        "--api-url",
        `http://127.0.0.1:${server.port}`,
        "--chain",
        "base",
        "--asset",
        "asset",
        "--amount",
        "1000",
      ],
      testEnvironment(),
    )) as { id: string; classification: string };
    expect(payinResult.id).toBe("payin-cli");
    expect(payinResult.classification).toBe("matched");
    expect(payinBody).toEqual({ chain: "base", asset: "asset", amount: "1000", expiresIn: 3600 });

    const payoutResult = (await run(
      "payout",
      [
        "--api-url",
        `http://127.0.0.1:${server.port}`,
        "--chain",
        "base",
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
    expect(Object.keys(signatureSubmissions[0] as object).sort()).toEqual(["body", "id", "method", "stamp"]);
    expect(signatureSubmissions[0]).toMatchObject({
      id: signingRequestId,
      body: "payout-signing-body",
      method: "stampedRequest",
    });
  });

  test("payout multisend sends ordered transfers", async () => {
    payoutBodies = [];
    const result = (await run(
      "payout",
      [
        "--api-url",
        `http://127.0.0.1:${server.port}`,
        "--chain",
        "base",
        "--asset",
        "asset",
        "--from",
        "from",
        "--to",
        "to-1",
        "--amount",
        "600",
        "--to",
        "to-2",
        "--amount",
        "400",
        "--reference",
        "invoice-123",
      ],
      testEnvironment(),
    )) as { id: string };
    expect(result.id).toBe("payout-cli");
    expect(payoutBodies).toEqual([
      {
        chain: "base",
        asset: "asset",
        fromAddress: "from",
        transfers: [
          { toAddress: "to-1", amount: "600" },
          { toAddress: "to-2", amount: "400" },
        ],
        reference: "invoice-123",
      },
    ]);
  });

  test("swap commands quote, sign locally, accept, and read back", async () => {
    acceptBodies = [];
    const swapArgs = [
      "--api-url",
      `http://127.0.0.1:${server.port}`,
      "--sell-chain",
      "dogecoin",
      "--sell-asset",
      "DOGE",
      "--buy-chain",
      "bitcoin",
      "--buy-asset",
      "BTC",
      "--amount",
      "90000",
      "--sender-address",
      fixture.senderAddress,
      "--recipient-address",
      "bc1qrecipient",
    ];
    const quoteResult = (await run("swap-quote", swapArgs, testEnvironment())) as { id: string };
    expect(quoteResult.id).toBe(quoteId);

    const swapResult = (await run(
      "swap",
      swapArgs,
      testEnvironment({ HEDLES_SWAP_SIGNING_KEY: fixture.senderWif }),
    )) as { signature: string; swap: { id: string; status: string } };
    expect(swapResult.swap.id).toBe(quoteId);
    expect(swapResult.swap.status).toBe("pending");

    const accepted = acceptBodies[0] as { quoteId: string; token: string; signature: string };
    expect(accepted.quoteId).toBe(quoteId);
    expect(accepted.token).toBe("quote-token");
    const signed = bitgo.createPsbtDecode(accepted.signature, fixture.network);
    expect(signed.validateSignaturesOfAllInputs()).toBe(true);

    const resumed = (await run(
      "swap",
      ["--api-url", `http://127.0.0.1:${server.port}`, "--quote-id", quoteId],
      testEnvironment({ HEDLES_SWAP_SIGNING_KEY: fixture.senderWif }),
    )) as { signature: string };
    expect(resumed.signature).toBe(swapResult.signature);

    const status = (await run(
      "swap-status",
      ["--api-url", `http://127.0.0.1:${server.port}`, "--id", quoteId],
      testEnvironment(),
    )) as { id: string };
    expect(status.id).toBe(quoteId);
    const listed = (await run(
      "swap-status",
      ["--api-url", `http://127.0.0.1:${server.port}`],
      testEnvironment(),
    )) as { total: number };
    expect(listed.total).toBe(1);
  });
});
