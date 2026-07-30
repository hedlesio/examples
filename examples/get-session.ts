import { obtainSession } from "../src/auth.ts";
import { optionalEnv, turnkeyCredentials } from "../src/config.ts";
import { printJson, publicApi, runExample } from "../src/runtime.ts";
import { createTurnkeyStamper } from "../src/turnkey.ts";

await runExample(async () => {
  const session = await obtainSession(
    publicApi(),
    createTurnkeyStamper(turnkeyCredentials()),
    optionalEnv("TURNKEY_ORGANIZATION_ID"),
  );
  printJson(session);
});
