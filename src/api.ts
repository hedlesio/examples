import type {
  AcceptSwapQuoteInput,
  AcceptSwapQuoteResponse,
  AddressBalanceOptions,
  AddressBalanceResponse,
  AddressEntry,
  AddressListOptions,
  AddressPage,
  BeginClaimResponse,
  Chain,
  ClaimResponse,
  CompleteClaimInput,
  CreatePayinInput,
  CreatePayoutInput,
  CreatePayoutResponse,
  ListOptions,
  Paginated,
  PayinResponse,
  PayoutResponse,
  PrepareSwapSigningResponse,
  RequestSwapQuoteInput,
  SessionBootstrapResponse,
  SessionResponse,
  SignedActivity,
  SignedIdentityRequest,
  SignedSwapActivity,
  SignedSwapQuoteInput,
  SubmitSwapSignaturesResponse,
  SwapQuoteResponse,
  SwapResponse,
  VerifyClaimCodeResponse,
} from "./types.ts";

interface ApiErrorBody {
  code?: string;
  message?: string;
  details?: unknown;
}

export class HedlesApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody | string | null,
  ) {
    const detail = typeof body === "string" ? body : (body?.message ?? body?.code ?? "request failed");
    super(`Hedles API returned HTTP ${status}: ${detail}`);
    this.name = "HedlesApiError";
  }
}

export type { ListOptions } from "./types.ts";

export class HedlesApi {
  readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly sessionToken?: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  withSession(sessionToken: string): HedlesApi {
    return new HedlesApi(this.baseUrl, sessionToken);
  }

  bootstrapSession(organizationId?: string): Promise<SessionBootstrapResponse> {
    const query = organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : "";
    return this.request(`/v1/sessions/bootstrap${query}`);
  }

  createSession(signedRequest: SignedIdentityRequest): Promise<SessionResponse> {
    return this.request("/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ signedRequest }),
    });
  }

  beginClaim(tenantId: string): Promise<BeginClaimResponse> {
    return this.request(`/v1/tenants/${encodeURIComponent(tenantId)}/claim/begin`, {
      method: "POST",
    });
  }

  sendClaimCode(tenantId: string): Promise<{ sent: true }> {
    return this.request(`/v1/tenants/${encodeURIComponent(tenantId)}/claim/send-code`, {
      method: "POST",
    });
  }

  verifyClaimCode(tenantId: string, code: string): Promise<VerifyClaimCodeResponse> {
    return this.request(`/v1/tenants/${encodeURIComponent(tenantId)}/claim/verify-code`, {
      method: "POST",
      body: JSON.stringify({ code }),
    });
  }

  completeClaim(tenantId: string, input: CompleteClaimInput): Promise<ClaimResponse> {
    return this.request(`/v1/tenants/${encodeURIComponent(tenantId)}/claim/complete`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  createAddress(chain: Chain): Promise<AddressEntry> {
    return this.request("/v1/addresses", {
      method: "POST",
      body: JSON.stringify({ chain }),
    });
  }

  listAddresses(options: AddressListOptions = {}): Promise<AddressPage> {
    return this.request(`/v1/addresses${queryString(options)}`);
  }

  getAddressBalance(addressId: string, options: AddressBalanceOptions = {}): Promise<AddressBalanceResponse> {
    return this.request(`/v1/addresses/${encodeURIComponent(addressId)}/balance${queryString(options)}`);
  }

  getPayin(payinId: string): Promise<PayinResponse> {
    return this.request(`/v1/payins/${encodeURIComponent(payinId)}`);
  }

  createPayin(input: CreatePayinInput): Promise<PayinResponse> {
    return this.request("/v1/payins", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  createPayout(input: CreatePayoutInput): Promise<CreatePayoutResponse> {
    return this.request("/v1/payouts", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  getPayout(payoutId: string): Promise<PayoutResponse> {
    return this.request(`/v1/payouts/${encodeURIComponent(payoutId)}`);
  }

  submitPayoutSignatures(id: string, requests: SignedActivity[]): Promise<PayoutResponse> {
    return this.request(`/v1/payouts/${encodeURIComponent(id)}/signatures`, {
      method: "POST",
      body: JSON.stringify(requests),
    });
  }

  requestSwapQuote(input: RequestSwapQuoteInput): Promise<SwapQuoteResponse> {
    return this.request("/v1/swaps/quotes", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  getSwapQuote(quoteId: string): Promise<SwapQuoteResponse> {
    return this.request(`/v1/swaps/quotes/${encodeURIComponent(quoteId)}`);
  }

  acceptSwapQuote(input: SignedSwapQuoteInput): Promise<SwapResponse>;
  acceptSwapQuote(input: AcceptSwapQuoteInput): Promise<AcceptSwapQuoteResponse>;
  acceptSwapQuote(input: AcceptSwapQuoteInput): Promise<AcceptSwapQuoteResponse> {
    return this.request("/v1/swaps", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  prepareSwapSigning(input: AcceptSwapQuoteInput): Promise<PrepareSwapSigningResponse> {
    return this.request("/v1/swaps", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  submitSwapSignatures(
    quoteId: string,
    requests: SignedSwapActivity[],
  ): Promise<SubmitSwapSignaturesResponse> {
    return this.request(`/v1/swaps/${encodeURIComponent(quoteId)}/signatures`, {
      method: "POST",
      body: JSON.stringify(requests),
    });
  }

  getSwap(swapId: string): Promise<SwapResponse> {
    return this.request(`/v1/swaps/${encodeURIComponent(swapId)}`);
  }

  listSwaps(options: ListOptions = {}): Promise<Paginated<SwapResponse>> {
    return this.request(`/v1/swaps${queryString(options)}`);
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (init.body) headers.set("Content-Type", "application/json");
    if (this.sessionToken) headers.set("Authorization", `Bearer ${this.sessionToken}`);

    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    const text = await response.text();
    const body = parseBody(text);
    if (!response.ok) throw new HedlesApiError(response.status, errorBody(body));
    return body as T;
  }
}

function queryString(options: object): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(options)) {
    if (value !== undefined) query.set(name, String(value));
  }
  return query.size === 0 ? "" : `?${query}`;
}

function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorBody(body: unknown): ApiErrorBody | string | null {
  if (body === null || typeof body === "string") return body;
  if (typeof body !== "object") return String(body);
  return body as ApiErrorBody;
}
