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
  for (const organizationId of [undefined, "org-explicit"]) {
    test(`stamps a fresh bootstrap body unchanged for ${organizationId ?? "the default context"}`, async () => {
      const issued: string[] = [];
      const stamped: string[] = [];
      const submitted: SignedIdentityRequest[] = [];
      const requestedContexts: (string | undefined)[] = [];
      const stamper: Stamper = {
        async stamp(body) {
          stamped.push(body);
          return { stampHeaderName: "X-Stamp", stampHeaderValue: "signed" };
        },
      };
      const api = {
        async bootstrapSession(context?: string) {
          requestedContexts.push(context);
          const resolved = context ?? "org-default";
          const body = `{ "organizationId": "${resolved}", "opaque": "${crypto.randomUUID()}", "timestampMs": ${Date.now()} }`;
          issued.push(body);
          return { organizationId: resolved, body, expiresIn: 300 };
        },
        async createSession(request: SignedIdentityRequest) {
          submitted.push(request);
          return response;
        },
      };
      for (let attempt = 0; attempt < 2; attempt += 1) {
        expect(await obtainSession(api, stamper, organizationId)).toEqual(response);
      }
      expect(requestedContexts).toEqual([organizationId, organizationId]);
      expect(stamped).toEqual(issued);
      expect(submitted.map((request) => request.body)).toEqual(issued);
      expect(issued[0]).not.toBe(issued[1]);
    });
  }

  test("rejects an unusable bootstrap before stamping", async () => {
    const api = {
      async bootstrapSession() {
        return { organizationId: "org", body: "", expiresIn: 300 };
      },
      async createSession() {
        throw new Error("Session must not be submitted");
      },
    };
    const stamper: Stamper = {
      async stamp() {
        throw new Error("Body must not be stamped");
      },
    };
    await expect(obtainSession(api, stamper)).rejects.toThrow(
      "Login bootstrap did not return a signing body",
    );
  });
});
