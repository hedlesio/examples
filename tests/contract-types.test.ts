import { expect, test } from "bun:test";
import type {
  AddressEntry,
  CreatePayinInput,
  PayoutResponse,
  RequestSwapQuoteInput,
  SignedActivity,
} from "../src/types.ts";

function compileContracts(address: AddressEntry, payout: PayoutResponse) {
  const payin: CreatePayinInput = { chain: "base", asset: "USDC", amount: "1000" };
  const quote: RequestSwapQuoteInput = {
    sellChain: "bitcoin",
    sellAsset: "BTC",
    buyChain: "ethereum",
    buyAsset: "USDC",
    amount: "1000",
    senderAddress: "sender",
    recipientAddress: "recipient",
  };
  // @ts-expect-error Atomic amounts are decimal strings.
  payin.amount = 1000;
  // @ts-expect-error Internal network identifiers are not public chains.
  payin.chain = "eip155:1";
  // @ts-expect-error Address creation returns ISO strings.
  address.createdAt = new Date();
  // @ts-expect-error Address statuses are a closed enum.
  address.status = "disabled";
  // @ts-expect-error Payout signing has no continuation token.
  payout.signingRequests[0]?.token;
  // @ts-expect-error Every submission declares its supported signing method.
  const submission: SignedActivity = { id: "id", body: "{}", stamp: { name: "X-Stamp", value: "value" } };
  return { payin, quote, submission };
}

test("request defaults and wire types stay bound to OpenAPI", () => {
  expect(compileContracts).toBeFunction();
});
