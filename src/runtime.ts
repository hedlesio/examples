import { HedlesApi, HedlesApiError } from "./api.ts";
import { resolveSessionToken } from "./auth.ts";
import { DEFAULT_API_URL } from "./config.ts";

export function publicApi(apiUrl = DEFAULT_API_URL): HedlesApi {
  return new HedlesApi(apiUrl);
}

export async function authenticatedApi(
  apiUrl = DEFAULT_API_URL,
  organizationId?: string,
): Promise<HedlesApi> {
  const api = publicApi(apiUrl);
  return api.withSession(await resolveSessionToken(api, organizationId));
}

export async function runExample(work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    if (error instanceof HedlesApiError) {
      console.error(
        JSON.stringify(
          {
            error: error.message,
            status: error.status,
            body: error.body,
          },
          null,
          2,
        ),
      );
      process.exitCode = 1;
      return;
    }

    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}
