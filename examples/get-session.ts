import { obtainSession } from "../src/auth.ts";
import { authenticatedOptions, parseCommand } from "../src/cli.ts";
import { apiKeyCredentials } from "../src/config.ts";
import { printJson, publicApi, runExample } from "../src/runtime.ts";
import { createStamper } from "../src/stamper.ts";

await runExample(async () => {
  const options = parseCommand({
    name: "session",
    description: "Create a session from an API identity proof.",
    options: authenticatedOptions,
  });
  if (!options) return;

  const session = await obtainSession(
    publicApi(options.apiUrl),
    createStamper(apiKeyCredentials()),
    options.organizationId,
  );
  printJson(session);
});
