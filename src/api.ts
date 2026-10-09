import type {
  AcceptSwapQuoteInput,
  AddressEntry,
  ClaimResponse,
  CreatePayinInput,
  CreatePayoutInput,
  CreatePayoutResponse,
  Paginated,
  PayinResponse,
  PayoutResponse,
  RequestSwapQuoteInput,
  SessionResponse,
  SignedIdentityRequest,
  SignedTurnkeyActivity,
  SwapQuoteResponse,
  SwapResponse,
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

export interface ListOptions {
  limit?: number;
  offset?: number;
}

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

  bootstrapSession(): Promise<{ organizationId: string }> {
    return this.request("/v1/sessions/bootstrap");
  }

  createSession(signedRequest: SignedIdentityRequest): Promise<SessionResponse> {
    return this.request("/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ signedRequest }),
    });
  }

  beginClaim(tenantId: string): Promise<{ tenantId: string; tenantName: string; tenantKind: string }> {
    return this.request(`/v1/tenants/${encodeURIComponent(tenantId)}/claim/begin`, {
      method: "POST",
    });
  }

  sendClaimCode(tenantId: string): Promise<{ sent: true }> {
    return this.request(`/v1/tenants/${encodeURIComponent(tenantId)}/claim/send-code`, {
      method: "POST",
    });
  }

  verifyClaimCode(tenantId: string, code: string): Promise<{ claimTicket: string; email: string }> {
    return this.request(`/v1/tenants/${encodeURIComponent(tenantId)}/claim/verify-code`, {
      method: "POST",
      body: JSON.stringify({ code }),
    });
  }

  completeClaim(
    tenantId: string,
    input: {
      claimTicket: string;
      userName: string;
      mode: "custodial" | "cosigned";
      credential: {
        type: "apiKey";
        apiKeyPublicKey: string;
        curveType: "API_KEY_CURVE_P256";
      };
    },
  ): Promise<ClaimResponse> {
    return this.request(`/v1/tenants/${encodeURIComponent(tenantId)}/claim/complete`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  createAddress(chainType: string): Promise<AddressEntry> {
    return this.request("/v1/addresses", {
      method: "POST",
      body: JSON.stringify({ chainType }),
    });
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

  // The stamped signing requests are the top-level JSON array. Before the
  // payout exists, `id` is the signing-request id; afterwards it is the payout id.
  submitPayoutSignatures(id: string, requests: SignedTurnkeyActivity[]): Promise<PayoutResponse> {
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

  acceptSwapQuote(input: AcceptSwapQuoteInput): Promise<SwapResponse> {
    return this.request("/v1/swaps", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  getSwap(swapId: string): Promise<SwapResponse> {
    return this.request(`/v1/swaps/${encodeURIComponent(swapId)}`);
  }

  listSwaps(options: ListOptions = {}): Promise<Paginated<SwapResponse>> {
    const query = new URLSearchParams();
    if (options.limit !== undefined) query.set("limit", String(options.limit));
    if (options.offset !== undefined) query.set("offset", String(options.offset));
    const suffix = query.size === 0 ? "" : `?${query}`;
    return this.request(`/v1/swaps${suffix}`);
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
