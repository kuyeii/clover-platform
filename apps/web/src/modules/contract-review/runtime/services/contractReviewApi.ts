import { apiClient } from "../../../../shared/api/client";

const CONTRACT_REVIEW_API_PREFIX = "/contract-review";

function normalizeContractReviewPath(path: string) {
  const value = String(path || "").trim();
  if (/^https?:\/\//i.test(value)) {
    const url = new URL(value);
    return normalizeContractReviewPath(`${url.pathname}${url.search}`);
  }
  const normalized = value.startsWith("/") ? value : `/${value}`;
  if (normalized.startsWith("/contract-review/")) {
    return normalized;
  }
  if (normalized === "/api") {
    return `${CONTRACT_REVIEW_API_PREFIX}/api`;
  }
  if (normalized.startsWith("/api/")) {
    return `${CONTRACT_REVIEW_API_PREFIX}${normalized}`;
  }
  return `${CONTRACT_REVIEW_API_PREFIX}${normalized}`;
}

export async function getContractReviewApiBase() {
  return CONTRACT_REVIEW_API_PREFIX;
}

export async function contractReviewFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const method = String(init.method || "GET").toUpperCase() as "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  const body = normalizeRequestBody(init.body, init.headers);
  return apiClient.raw(method, normalizeContractReviewPath(path), {
    headers: init.headers,
    body,
    signal: init.signal || undefined,
    credentials: init.credentials,
  });
}

export async function contractReviewJsonFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await contractReviewFetch(path, init);
  return (await response.json()) as T;
}

function normalizeRequestBody(body: BodyInit | null | undefined, headers?: HeadersInit) {
  if (body === undefined || body === null || body instanceof FormData) {
    return body ?? undefined;
  }
  if (typeof body !== "string") {
    return body;
  }
  const contentType = new Headers(headers).get("Content-Type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return body;
  }
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}
