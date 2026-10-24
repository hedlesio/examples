import type { components, paths } from "./api-schema.ts";

type Json<T> = T extends { content: { "application/json": infer Body } } ? Body : never;
export type Chain = components["schemas"]["Chain"];
export type SessionResponse = Json<paths["/v1/sessions"]["post"]["responses"][200]>;
export type BearerSessionResponse = SessionResponse & { session: string };
export type SessionBootstrapResponse = Json<paths["/v1/sessions/bootstrap"]["get"]["responses"][200]>;
export type SignedIdentityRequest = Json<paths["/v1/sessions"]["post"]["requestBody"]>["signedRequest"];
export type Stamp = Pick<SignedIdentityRequest, "stampHeaderName" | "stampHeaderValue">;
export interface Stamper {
  stamp(input: string): Promise<Stamp>;
}
export interface ApiKeyCredentials {
  publicKey: string;
  privateKey: string;
}
export type BeginClaimResponse = Json<paths["/v1/tenants/{id}/claim/begin"]["post"]["responses"][200]>;
export type VerifyClaimCodeResponse = Json<
  paths["/v1/tenants/{id}/claim/verify-code"]["post"]["responses"][200]
>;
export type CompleteClaimInput = Json<paths["/v1/tenants/{id}/claim/complete"]["post"]["requestBody"]>;
export type ClaimResponse = Json<paths["/v1/tenants/{id}/claim/complete"]["post"]["responses"][200]>;
export type AddressEntry = Json<paths["/v1/addresses"]["post"]["responses"][201]>;
export type CreatePayinInput = Json<paths["/v1/payins"]["post"]["requestBody"]>;
export type PayinResponse = Json<paths["/v1/payins"]["post"]["responses"][201]>;
export type PayinClassification = PayinResponse["classification"];
export type CreatePayoutInput = Json<paths["/v1/payouts"]["post"]["requestBody"]>;
export type PayoutTransferInput = CreatePayoutInput["transfers"][number];
export type PayoutResponse = Json<paths["/v1/payouts"]["post"]["responses"][201]>;
export type CreatePayoutResponse = PayoutResponse;
export type SigningRequest = PayoutResponse["signingRequests"][number];
export type SignedActivity = Json<paths["/v1/payouts/{id}/signatures"]["post"]["requestBody"]>[number];
export type TransferRow = PayoutResponse["transfers"][number];
export type TransferStatus = TransferRow["status"];
export type PayoutSigningError = NonNullable<PayoutResponse["signingError"]>;
export type RequestSwapQuoteInput = Json<paths["/v1/swaps/quotes"]["post"]["requestBody"]>;
export type SwapQuoteResponse = Json<paths["/v1/swaps/quotes"]["post"]["responses"][201]>;
export type AcceptSwapQuoteInput = Json<paths["/v1/swaps"]["post"]["requestBody"]>;
export type SignedSwapQuoteInput = AcceptSwapQuoteInput & { signature: string };
export type AcceptSwapQuoteResponse = Json<paths["/v1/swaps"]["post"]["responses"][201]>;
export type SwapResponse = Json<paths["/v1/swaps/{id}"]["get"]["responses"][200]>;
type SwapPage = Json<paths["/v1/swaps"]["get"]["responses"][200]>;
export type Paginated<T> = Omit<SwapPage, "items"> & { items: T[] };
export type ListOptions = NonNullable<paths["/v1/swaps"]["get"]["parameters"]["query"]>;
export type WebhookEvent = Json<paths["/v1/webhooks/deliveries/{id}"]["get"]["responses"][200]>["payload"];
export type WebhookTransfer = Extract<WebhookEvent, { event: "payout.created" }>["data"]["transfers"][number];
