export const PLATFORM_API_BASE = "/api/v1";
export const CONTRACT_REVIEW_API_PREFIX = "/contract-review";

export function resolveContractReviewApiBaseForRuntime(base, origin = "http://localhost") {
  const fallback = `${PLATFORM_API_BASE}${CONTRACT_REVIEW_API_PREFIX}`;
  const value = String(base || PLATFORM_API_BASE).replace(/\/$/, "").trim();
  if (!value) return fallback;

  try {
    const url = new URL(value, origin);
    const normalizedPath = url.pathname.replace(/\/+$/, "");
    const moduleBase = `${PLATFORM_API_BASE}${CONTRACT_REVIEW_API_PREFIX}`;
    if (normalizedPath === moduleBase || normalizedPath === `${moduleBase}/api`) {
      if (normalizedPath.endsWith("/api")) {
        url.pathname = moduleBase;
        return /^https?:\/\//i.test(value)
          ? url.toString().replace(/\/$/, "")
          : `${url.pathname}${url.search}${url.hash}`.replace(/\/$/, "");
      }
      return value;
    }
    if (normalizedPath === PLATFORM_API_BASE) {
      url.pathname = `${normalizedPath}${CONTRACT_REVIEW_API_PREFIX}`;
      return /^https?:\/\//i.test(value)
        ? url.toString().replace(/\/$/, "")
        : `${url.pathname}${url.search}${url.hash}`.replace(/\/$/, "");
    }
  } catch {
    // Keep non-URL legacy backend values as-is.
  }

  return value;
}

export function normalizeContractReviewApiPath(path) {
  const value = String(path || "").trim();
  if (!/^https?:\/\//i.test(value)) {
    return value.startsWith("/") ? value : `/${value}`;
  }

  try {
    const url = new URL(value);
    return `${url.pathname}${url.search}`;
  } catch {
    return value;
  }
}

export function buildContractReviewApiUrl(base, path, origin = "http://localhost") {
  return `${resolveContractReviewApiBaseForRuntime(base, origin).replace(/\/$/, "")}${normalizeContractReviewApiPath(path)}`;
}

export function buildContractReviewFallbackHeaders(token, clientId) {
  const headers = {
    "X-Portal-Client-Id": clientId,
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}
