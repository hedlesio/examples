import { obtainSession } from "../src/auth.ts";
import { authenticatedOptions, parseCommand } from "../src/cli.ts";
import { turnkeyCredentials } from "../src/config.ts";
import { printJson, publicApi, runExample } from "../src/runtime.ts";
import { createTurnkeyStamper } from "../src/turnkey.ts";

await runExample(async () => {
  const options = parseCommand({
    name: "session",
    description: "Create a session from an API identity proof.",
    options: authenticatedOptions,
  });
  if (!options) return;

  const session = await obtainSession(
    publicApi(options.apiUrl),
    createTurnkeyStamper(turnkeyCredentials()),
    options.organizationId,
  );
  printJson(session);
});
