import { getAccessToken } from "../auth/token";

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export type ApiClientOptions = {
  baseUrl?: string;
  getToken?: () => string | null;
  fetchImpl?: typeof fetch;
};

export type RequestOptions = {
  token?: string | null;
  headers?: HeadersInit;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  signal?: AbortSignal;
};

export type ApiErrorDetails = {
  status: number;
  code: string;
  message: string;
  details?: unknown;
  requestId?: string | null;
  response?: unknown;
};

type ErrorEnvelope = {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
  code?: string;
  message?: string;
  detail?: string;
  details?: unknown;
  request_id?: string;
};

const DEFAULT_API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api/v1";

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId?: string | null;
  readonly response?: unknown;

  constructor(error: ApiErrorDetails) {
    super(error.message);
    this.name = "ApiRequestError";
    this.status = error.status;
    this.code = error.code;
    this.details = error.details;
    this.requestId = error.requestId;
    this.response = error.response;
  }
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly getToken?: () => string | null;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = trimTrailingSlash(options.baseUrl || DEFAULT_API_BASE_URL);
    this.getToken = options.getToken;
    this.fetchImpl = options.fetchImpl || fetch;
  }

  get<T>(path: string, options: Omit<RequestOptions, "body"> = {}) {
    return this.request<T>("GET", path, options);
  }

  post<T>(path: string, body?: unknown, options: Omit<RequestOptions, "body"> = {}) {
    return this.request<T>("POST", path, { ...options, body });
  }

  patch<T>(path: string, body?: unknown, options: Omit<RequestOptions, "body"> = {}) {
    return this.request<T>("PATCH", path, { ...options, body });
  }

  delete<T>(path: string, options: RequestOptions = {}) {
    return this.request<T>("DELETE", path, options);
  }

  async request<T>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<T> {
    const token = options.token ?? this.getToken?.() ?? null;
    const headers = new Headers(options.headers);

    headers.set("Accept", "application/json");
    if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
    }
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    const response = await this.fetchImpl(buildUrl(this.baseUrl, path, options.query), {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });

    if (!response.ok) {
      throw await buildApiError(response);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const contentType = response.headers.get("Content-Type") || "";
    if (contentType.includes("application/json")) {
      return response.json() as Promise<T>;
    }

    return response.text() as Promise<T>;
  }
}

async function buildApiError(response: Response): Promise<ApiRequestError> {
  const requestId = response.headers.get("X-Request-ID");
  const contentType = response.headers.get("Content-Type") || "";
  let payload: ErrorEnvelope | undefined;

  if (contentType.includes("application/json")) {
    try {
      payload = await response.json() as ErrorEnvelope;
    } catch {
      payload = undefined;
    }
  }

  const message =
    payload?.error?.message ||
    payload?.message ||
    payload?.detail ||
    response.statusText ||
    "API request failed";

  return new ApiRequestError({
    status: response.status,
    code: payload?.error?.code || payload?.code || `HTTP_${response.status}`,
    message,
    details: payload?.error?.details || payload?.details,
    requestId: requestId || payload?.request_id || null,
    response: payload,
  });
}

function buildUrl(baseUrl: string, path: string, query?: RequestOptions["query"]): string {
  const target = path.startsWith("http://") || path.startsWith("https://")
    ? new URL(path)
    : new URL(`${baseUrl}/${trimLeadingSlash(path)}`, window.location.origin);

  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      target.searchParams.set(key, String(value));
    }
  });

  return target.toString();
}

function trimLeadingSlash(value: string): string {
  return value.replace(/^\/+/, "");
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export const apiClient = new ApiClient({
  getToken: getAccessToken,
});
