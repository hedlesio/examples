import { optionalEnv, positiveIntegerEnv, requiredEnv } from "../src/config.ts";
import { authenticatedApi, printJson, runExample } from "../src/runtime.ts";

await runExample(async () => {
  const api = await authenticatedApi();
  const reference = optionalEnv("HEDLES_PAYIN_REFERENCE");
  const expiresIn = positiveIntegerEnv("HEDLES_PAYIN_EXPIRES_IN", 3600);
  const payin = await api.createPayin({
    chainKey: requiredEnv("HEDLES_CHAIN_KEY"),
    assetKey: requiredEnv("HEDLES_ASSET_KEY"),
    amount: requiredEnv("HEDLES_AMOUNT"),
    ...(reference ? { reference } : {}),
    ...(expiresIn ? { expiresIn } : {}),
  });
  printJson(payin);
});
