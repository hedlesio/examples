import { HedlesApiError } from "./api.ts";
import type { SignedActivity, SignedIdentityRequest, SigningRequest, Stamper } from "./types.ts";

export async function stampIdentity(body: string, stamper: Stamper): Promise<SignedIdentityRequest> {
  const stamp = await stamper.stamp(body);
  return {
    body,
    stampHeaderName: stamp.stampHeaderName,
    stampHeaderValue: stamp.stampHeaderValue,
  };
}

// Stamp each request body exactly as received. The server rejects any body
// whose intent differs from the one it prepared.
export async function stampActivities(
  requests: SigningRequest[],
  stamper: Stamper,
): Promise<Extract<SignedActivity, { method: "stampedRequest" }>[]> {
  return Promise.all(
    requests.map(async (request) => {
      const stamp = await stamper.stamp(request.body);
      return {
        id: request.id,
        body: request.body,
        method: request.method,
        stamp: {
          name: stamp.stampHeaderName,
          value: stamp.stampHeaderValue,
        },
      };
    }),
  );
}

export function signingConflict(err: unknown) {
  if (!(err instanceof HedlesApiError) || err.status !== 409) return null;
  if (typeof err.body !== "object" || err.body === null) return null;
  const { details } = err.body;
  return {
    code: err.body.code,
    details:
      typeof details === "object" && details !== null ? Object.fromEntries(Object.entries(details)) : {},
  };
}

export function signingMessageChanged(err: unknown): boolean {
  const body = signingConflict(err);
  const detail = body?.details.detail;
  return (
    body?.code === "broadcast_failed" && typeof detail === "string" && detail.includes("message changed")
  );
}
