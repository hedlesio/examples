import { requiredEnv, turnkeyCredentials } from "../src/config.ts";
import { authenticatedApi, printJson, runExample } from "../src/runtime.ts";
import { createTurnkeyStamper } from "../src/turnkey.ts";
import { createWalletAddress } from "../src/wallet.ts";

await runExample(async () => {
  const address = await createWalletAddress(await authenticatedApi(), requiredEnv("HEDLES_CHAIN_TYPE"), () =>
    createTurnkeyStamper(turnkeyCredentials()),
  );
  printJson(address);
});
