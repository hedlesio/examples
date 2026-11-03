import { describe, expect, test } from "bun:test";
import { rm, stat } from "node:fs/promises";
import { cachedSessionToken, obtainSession } from "../src/auth.ts";
import type { BearerSessionResponse, SignedIdentityRequest, Stamper } from "../src/types.ts";

const response: BearerSessionResponse = {
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

test("rejects a browser-only session response in the bearer-token helper", async () => {
  const { session: _session, ...browserResponse } = response;
  const api = {
    async bootstrapSession() {
      return { organizationId: "org", body: "{}", expiresIn: 300 };
    },
    async createSession() {
      return browserResponse;
    },
  };
  const stamper: Stamper = {
    async stamp() {
      return { stampHeaderName: "X-Stamp", stampHeaderValue: "signed" };
    },
  };
  await expect(obtainSession(api, stamper)).rejects.toThrow("bearer session token");
});

describe("cachedSessionToken", () => {
  const login =
    (session: string, expiresIn = 3600) =>
    async () => ({ ...response, session, expiresIn });

  test("shares one session between commands until shortly before it expires", async () => {
    const path = `${Bun.env.TMPDIR ?? "/tmp"}/hedles-session-${crypto.randomUUID()}.json`;
    const now = Date.now();
    expect(await cachedSessionToken(path, login("first"), now)).toBe("first");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await cachedSessionToken(path, login("second"), now + 30 * 60_000)).toBe("first");
    expect(await cachedSessionToken(path, login("third"), now + 56 * 60_000)).toBe("third");
    await rm(path);
  });

  test("logs in again when the cache file is unreadable", async () => {
    const path = `${Bun.env.TMPDIR ?? "/tmp"}/hedles-session-${crypto.randomUUID()}.json`;
    await Bun.write(path, "not json");
    expect(await cachedSessionToken(path, login("fresh"))).toBe("fresh");
    await rm(path);
  });
});
