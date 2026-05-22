import { ToolkitApp } from "../types/app";

export const CLOVER_AUTH_REQUEST = "clover:auth-request";
export const CLOVER_AUTH_CONTEXT = "clover:auth-context";
export const CLOVER_AUTH_ERROR = "clover:auth-error";

const CORE_API_PREFIX = "/api/v1/core";
const BUSINESS_API_PREFIX_BY_APP: Record<string, string> = {
  "competitor-analysis": "/api/v1/competitor-analysis",
  "contract-review": "/api/v1/contract-review",
  "rag-web-search": "/api/v1/rag",
};

export interface CloverAuthRequestMessage {
  type: typeof CLOVER_AUTH_REQUEST;
  appCode?: string;
  requestId?: string;
}

export interface CloverAuthContextMessage {
  type: typeof CLOVER_AUTH_CONTEXT;
  requestId: string;
  appCode: string;
  token: string;
  clientId: string;
  apiBaseUrl: string;
}

export interface CloverAuthErrorMessage {
  type: typeof CLOVER_AUTH_ERROR;
  requestId: string;
  appCode: string;
  message: string;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizePlatformRootUrl(value: string) {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    const url = new URL(value, window.location.origin);
    url.search = "";
    url.hash = "";

    const pathname = trimTrailingSlash(url.pathname);
    if (pathname.endsWith(CORE_API_PREFIX)) {
      url.pathname = pathname.slice(0, -CORE_API_PREFIX.length) || "/";
    } else if (pathname.endsWith("/api/v1")) {
      url.pathname = pathname.slice(0, -"/api/v1".length) || "/";
    } else {
      url.pathname = pathname || "/";
    }

    return trimTrailingSlash(url.toString());
  } catch {
    return "";
  }
}

function getPlatformApiRootUrl() {
  const configuredBaseUrl = String(import.meta.env.VITE_PLATFORM_API_BASE_URL || "").trim();
  const proxyTarget = String(import.meta.env.VITE_PLATFORM_API_PROXY_TARGET || "").trim();
  const configuredRoot =
    normalizePlatformRootUrl(configuredBaseUrl) || normalizePlatformRootUrl(proxyTarget);

  if (configuredRoot) {
    return configuredRoot;
  }

  return typeof window === "undefined" ? "" : window.location.origin;
}

export function getIframeOrigin(app: ToolkitApp) {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    return new URL(app.url, window.location.href).origin;
  } catch {
    return "";
  }
}

export function isCloverAuthRequestMessage(data: unknown): data is CloverAuthRequestMessage {
  return isRecord(data) && data.type === CLOVER_AUTH_REQUEST;
}

export function getBusinessProxyApiBaseUrl(appCode: string) {
  const prefix = BUSINESS_API_PREFIX_BY_APP[appCode];
  if (!prefix) {
    return "";
  }

  const platformRoot = getPlatformApiRootUrl();
  if (!platformRoot) {
    return "";
  }

  return `${platformRoot}${prefix}`;
}

export function buildAuthContextMessage(input: {
  requestId: string;
  appCode: string;
  token: string;
  clientId: string;
}): CloverAuthContextMessage | null {
  const apiBaseUrl = getBusinessProxyApiBaseUrl(input.appCode);
  if (!apiBaseUrl) {
    return null;
  }

  return {
    type: CLOVER_AUTH_CONTEXT,
    requestId: input.requestId,
    appCode: input.appCode,
    token: input.token,
    clientId: input.clientId,
    apiBaseUrl,
  };
}

export function buildAuthErrorMessage(input: {
  requestId: string;
  appCode: string;
  message: string;
}): CloverAuthErrorMessage {
  return {
    type: CLOVER_AUTH_ERROR,
    requestId: input.requestId,
    appCode: input.appCode,
    message: input.message,
  };
}
