import { getAccessToken, getClientId } from "../auth/token";

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export type ApiClientOptions = {
  baseUrl?: string;
  getToken?: () => string | null;
  fetchImpl?: typeof fetch;
  onUnauthorized?: () => void;
};

export type RequestOptions = {
  token?: string | null;
  headers?: HeadersInit;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  signal?: AbortSignal;
  credentials?: RequestCredentials;
  unwrapEnvelope?: boolean;
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
  private onUnauthorized?: () => void;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = trimTrailingSlash(options.baseUrl || DEFAULT_API_BASE_URL);
    this.getToken = options.getToken;
    this.fetchImpl = options.fetchImpl || fetch;
    this.onUnauthorized = options.onUnauthorized;
  }

  setUnauthorizedHandler(handler?: () => void) {
    this.onUnauthorized = handler;
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
    headers.set("X-Portal-Client-Id", getClientId());
    if (options.body !== undefined && !(options.body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    const response = await this.fetchImpl(buildUrl(this.baseUrl, path, options.query), {
      method,
      headers,
      body:
        options.body === undefined
          ? undefined
          : options.body instanceof FormData
            ? options.body
            : JSON.stringify(options.body),
      credentials: options.credentials ?? "include",
      signal: options.signal,
    });

    if (!response.ok) {
      const error = await buildApiError(response);
      if (error.status === 401) {
        this.onUnauthorized?.();
      }
      throw error;
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const contentType = response.headers.get("Content-Type") || "";
    if (contentType.includes("application/json")) {
      const payload = await response.json();
      if (options.unwrapEnvelope === false) {
        return payload as T;
      }
      if (payload?.success === true && "data" in payload) {
        return payload.data as T;
      }
      if (payload?.success === false) {
        throw new ApiRequestError({
          status: response.status,
          code: payload?.error?.code || "API_ERROR",
          message: payload?.error?.message || "请求失败，请稍后重试。",
          details: payload?.error?.details,
          requestId: payload?.request_id || response.headers.get("X-Request-ID"),
          response: payload,
        });
      }
      return payload as T;
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

export function getApiBaseUrl() {
  return trimTrailingSlash(DEFAULT_API_BASE_URL);
}

export function getPlatformCoreApiBaseUrl() {
  const base = getApiBaseUrl();
  return base.endsWith("/core") ? base : `${base}/core`;
}

export function getWebSocketBaseUrl() {
  const explicit = import.meta.env.VITE_WS_BASE_URL;
  if (explicit) {
    return trimTrailingSlash(String(explicit));
  }

  if (/^https?:\/\//i.test(getApiBaseUrl())) {
    try {
      const url = new URL(getApiBaseUrl());
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.pathname = "/ws/core";
      url.search = "";
      url.hash = "";
      return trimTrailingSlash(url.toString());
    } catch {
      // Fall through to current origin.
    }
  }

  if (typeof window === "undefined") {
    return "";
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/core`;
}

export function getAppUsageWebSocketUrl() {
  return `${getWebSocketBaseUrl()}/app-usage`;
}
