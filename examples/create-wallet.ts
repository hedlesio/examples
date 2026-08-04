import { authenticatedOptions, parseCommand } from "../src/cli.ts";
import { turnkeyCredentials } from "../src/config.ts";
import { authenticatedApi, printJson, runExample } from "../src/runtime.ts";
import { createTurnkeyStamper } from "../src/turnkey.ts";
import { createWalletAddress } from "../src/wallet.ts";

await runExample(async () => {
  const options = parseCommand({
    name: "wallet",
    description: "Create a tenant wallet address.",
    options: {
      ...authenticatedOptions,
      chainType: {
        description: "Wallet address family",
        valueName: "type",
        defaultValue: "evm",
      },
    },
  });
  if (!options) return;

  const address = await createWalletAddress(
    await authenticatedApi(options.apiUrl, options.organizationId),
    options.chainType,
    () => createTurnkeyStamper(turnkeyCredentials()),
  );
  printJson(address);
});
