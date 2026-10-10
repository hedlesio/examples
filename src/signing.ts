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
): Promise<SignedActivity[]> {
  return Promise.all(
    requests.map(async (request) => {
      const stamp = await stamper.stamp(request.body);
      return {
        id: request.id,
        body: request.body,
        token: request.token,
        stamp: {
          name: stamp.stampHeaderName,
          value: stamp.stampHeaderValue,
        },
      };
    }),
  );
}
