import { HedlesApi, HedlesApiError } from "./api.ts";
import { resolveSessionToken } from "./auth.ts";
import { apiUrl } from "./config.ts";

export function publicApi(): HedlesApi {
  return new HedlesApi(apiUrl());
}

export async function authenticatedApi(): Promise<HedlesApi> {
  const api = publicApi();
  return api.withSession(await resolveSessionToken(api));
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
