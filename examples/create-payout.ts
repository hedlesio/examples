import { optionalEnv, requiredEnv, turnkeyCredentials, uint32Env } from "../src/config.ts";
import { completePayoutSigning } from "../src/payout.ts";
import { authenticatedApi, printJson, runExample } from "../src/runtime.ts";
import { createTurnkeyStamper } from "../src/turnkey.ts";

await runExample(async () => {
  const api = await authenticatedApi();
  const note = optionalEnv("HEDLES_PAYOUT_NOTE");
  const destinationTag = uint32Env("HEDLES_PAYOUT_DESTINATION_TAG");
  const payout = await api.createPayout({
    chain: requiredEnv("HEDLES_CHAIN_KEY"),
    asset: requiredEnv("HEDLES_ASSET_KEY"),
    fromAddress: requiredEnv("HEDLES_FROM_ADDRESS"),
    toAddress: requiredEnv("HEDLES_TO_ADDRESS"),
    amount: requiredEnv("HEDLES_AMOUNT"),
    ...(note ? { note } : {}),
    ...(destinationTag === undefined ? {} : { destinationTag }),
  });

  if (!payout.signing) {
    printJson(payout);
    return;
  }

  const signed = await completePayoutSigning(api, payout, createTurnkeyStamper(turnkeyCredentials()));
  printJson(signed);
});
