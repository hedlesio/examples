import { describe, expect, test } from "bun:test";
import { obtainSession } from "../src/auth.ts";
import type { SessionResponse, SignedIdentityRequest, Stamper } from "../src/types.ts";

const response: SessionResponse = {
  session: "hp_sess_test",
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  tenantKind: "merchant",
  userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  expiresIn: 3600,
};

describe("obtainSession", () => {
  test("stamps the bootstrap organization with a fresh timestamp", async () => {
    let signedRequest: SignedIdentityRequest | undefined;
    const stamper: Stamper = {
      async stamp(input) {
        const body = JSON.parse(input) as { organizationId: string; timestampMs: string };
        expect(body.organizationId).toBe("org-test");
        expect(Math.abs(Number(body.timestampMs) - Date.now())).toBeLessThan(5_000);
        return { stampHeaderName: "X-Stamp", stampHeaderValue: "signed" };
      },
    };
    const api = {
      async bootstrapSession() {
        return { organizationId: "org-test" };
      },
      async createSession(request: SignedIdentityRequest) {
        signedRequest = request;
        return response;
      },
    };

    expect(await obtainSession(api, stamper)).toEqual(response);
    expect(signedRequest).toMatchObject({ stampHeaderName: "X-Stamp", stampHeaderValue: "signed" });
    expect(JSON.parse(signedRequest?.body ?? "{}")).toMatchObject({ organizationId: "org-test" });
  });

  test("uses an explicit organization id without bootstrapping", async () => {
    const api = {
      async bootstrapSession() {
        throw new Error("bootstrap must not be called");
      },
      async createSession() {
        return response;
      },
    };
    const stamper: Stamper = {
      async stamp(input) {
        expect(JSON.parse(input)).toMatchObject({ organizationId: "org-explicit" });
        return { stampHeaderName: "X-Stamp", stampHeaderValue: "signed" };
      },
    };

    expect(await obtainSession(api, stamper, "org-explicit")).toEqual(response);
  });
});
