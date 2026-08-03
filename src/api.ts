import type {
  ClaimResponse,
  CreateAddressResponse,
  CreateMerchantInput,
  CreateMerchantResponse,
  CreatePayinInput,
  CreatePayoutInput,
  PayinResponse,
  PayoutResponse,
  SessionResponse,
  SignedIdentityRequest,
  SignedTurnkeyActivity,
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

  createMerchant(input: CreateMerchantInput): Promise<CreateMerchantResponse> {
    return this.request("/v1/merchants", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  createAddress(chainType: string, signedRequest?: SignedIdentityRequest): Promise<CreateAddressResponse> {
    return this.request("/v1/addresses", {
      method: "POST",
      body: JSON.stringify({
        chainType,
        ...(signedRequest ? { signedRequest } : {}),
      }),
    });
  }

  createPayin(input: CreatePayinInput): Promise<PayinResponse> {
    return this.request("/v1/payins", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  createPayout(input: CreatePayoutInput): Promise<PayoutResponse> {
    return this.request("/v1/payouts", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  getPayout(payoutId: string): Promise<PayoutResponse> {
    return this.request(`/v1/payouts/${encodeURIComponent(payoutId)}`);
  }

  submitPayoutSignatures(payoutId: string, requests: SignedTurnkeyActivity[]): Promise<PayoutResponse> {
    return this.request(`/v1/payouts/${encodeURIComponent(payoutId)}/signatures`, {
      method: "POST",
      body: JSON.stringify({ requests }),
    });
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
