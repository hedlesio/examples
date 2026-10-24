import { expect, test } from "bun:test";
import { createStamper, generateKeyPair, verifyStamp } from "../src/stamper.ts";
import { runCommand } from "./_helpers/cli.ts";

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type LoginOutcome = "success" | "missing-token" | "rejected" | "unavailable" | "bootstrap-unavailable";

async function claimFixture(generated: boolean, outcome: LoginOutcome) {
  const existing = await generateKeyPair();
  let registeredPublicKey: string | undefined;
  let completed = false;
  let loginWasSigned = false;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path.endsWith("/claim/begin")) {
        return Response.json({ tenantId, tenantName: "Example Merchant", tenantKind: "merchant" });
      }
      if (path.endsWith("/claim/verify-code")) {
        return Response.json({ claimTicket: "ticket", email: "owner@example.test" });
      }
      if (path.endsWith("/claim/complete")) {
        const body = await request.json();
        registeredPublicKey = body.credential.apiKeyPublicKey;
        completed = true;
        return Response.json({ tenantId, mode: "cosigned" });
      }
      if (path === "/v1/sessions/bootstrap") {
        if (outcome === "bootstrap-unavailable")
          return Response.json({ code: "unavailable" }, { status: 503 });
        return Response.json({
          organizationId: "org",
          body: JSON.stringify({ organizationId: "org", timestampMs: Date.now() }),
          expiresIn: 300,
        });
      }
      if (path === "/v1/sessions") {
        const { signedRequest } = await request.json();
        loginWasSigned = await verifyStamp(signedRequest.stampHeaderValue, signedRequest.body);
        if (outcome === "rejected" || outcome === "unavailable") {
          return Response.json({ code: "unavailable" }, { status: outcome === "rejected" ? 401 : 503 });
        }
        return Response.json({
          tenantId,
          tenantKind: "merchant",
          userId: "user",
          expiresIn: 3600,
          ...(outcome === "success" ? { session: "hp_sess_claim" } : {}),
        });
      }
      return new Response("Not found", { status: 404 });
    },
  });
  try {
    const result = await runCommand(
      "claim",
      ["--api-url", `http://127.0.0.1:${server.port}`, "--tenant-id", tenantId, "--claim-code", "123456"],
      {
        ...Bun.env,
        HEDLES_API_PUBLIC_KEY: generated ? "" : existing.publicKey,
        HEDLES_API_PRIVATE_KEY: generated ? "" : existing.privateKey,
        HEDLES_SESSION_TOKEN: "",
      },
    );
    return { ...result, completed, loginWasSigned, registeredPublicKey, existing };
  } finally {
    server.stop(true);
  }
}

for (const outcome of ["missing-token", "rejected", "unavailable", "bootstrap-unavailable"] as const) {
  test(`preserves generated claim credentials after ${outcome}`, async () => {
    const result = await claimFixture(true, outcome);
    expect(result.completed).toBe(true);
    expect(result.exitCode).toBe(1);
    const output = result.stdout.trim() ? JSON.parse(result.stdout) : null;
    expect(Boolean(output?.credentials?.privateKey)).toBe(true);
    expect(output.credentials.publicKey === result.registeredPublicKey).toBe(true);
    const stamp = await createStamper(output.credentials).stamp("recovery-login");
    expect(await verifyStamp(stamp.stampHeaderValue, "recovery-login")).toBe(true);
    expect(output.completed.tenantId).toBe(tenantId);
    expect(output.session).toBeUndefined();
    expect(result.stderr.includes(output.credentials.privateKey)).toBe(false);
    expect(result.stderr).toContain("Store it securely");
  });
}

test("does not disclose environment credentials when login fails", async () => {
  const result = await claimFixture(false, "missing-token");
  expect(result.completed).toBe(true);
  expect(result.exitCode).toBe(1);
  expect(result.loginWasSigned).toBe(true);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("bearer session token");
  expect(result.stderr.includes(result.existing.privateKey)).toBe(false);
});

test("keeps a single complete result after a successful generated-key claim", async () => {
  const result = await claimFixture(true, "success");
  expect(result.exitCode).toBe(0);
  expect(result.loginWasSigned).toBe(true);
  const output = JSON.parse(result.stdout);
  expect(output.session.session).toBe("hp_sess_claim");
  expect(output.credentials.publicKey === result.registeredPublicKey).toBe(true);
  expect(Boolean(output.credentials.privateKey)).toBe(true);
  expect(result.stderr.includes(output.credentials.privateKey)).toBe(false);
});
