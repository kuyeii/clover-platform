import { getApiBaseUrl } from "../../shared/api/client";
import { getAccessToken, getClientId } from "../../shared/auth/token";
import type { ModuleCode, PortalModule } from "../../shared/types/portal";

export const CLOVER_AUTH_REQUEST = "clover:auth-request";
export const CLOVER_AUTH_CONTEXT = "clover:auth-context";
export const CLOVER_AUTH_ERROR = "clover:auth-error";

const BUSINESS_API_PREFIX_BY_APP: Record<ModuleCode, string> = {
  "bid-generator": "/bid-generator",
  "competitor-analysis": "/competitor-analysis",
  "contract-review": "/contract-review",
  "rag-web-search": "/rag",
};

interface CloverAuthRequestMessage {
  type: typeof CLOVER_AUTH_REQUEST;
  appCode?: string;
  requestId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isCloverAuthRequestMessage(data: unknown): data is CloverAuthRequestMessage {
  return isRecord(data) && data.type === CLOVER_AUTH_REQUEST;
}

export function getIframeOrigin(iframeUrl: string) {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    return new URL(iframeUrl, window.location.href).origin;
  } catch {
    return "";
  }
}

export function buildAuthContextMessage(input: {
  requestId: string;
  appCode: ModuleCode;
  token: string;
}) {
  const prefix = BUSINESS_API_PREFIX_BY_APP[input.appCode];
  if (!prefix) {
    return null;
  }
  const apiBaseUrl = new URL(getApiBaseUrl(), window.location.origin).toString().replace(/\/+$/, "");
  return {
    type: CLOVER_AUTH_CONTEXT,
    requestId: input.requestId,
    appCode: input.appCode,
    token: input.token,
    clientId: getClientId(),
    apiBaseUrl: `${apiBaseUrl}${prefix}`,
  };
}

export function buildAuthErrorMessage(input: { requestId: string; appCode: string; message: string }) {
  return {
    type: CLOVER_AUTH_ERROR,
    requestId: input.requestId,
    appCode: input.appCode,
    message: input.message,
  };
}

export function resolveIframeUrl(module: PortalModule, runtimeUrl?: string) {
  return runtimeUrl || "";
}

export function getCurrentAuthTokenForIframe() {
  return getAccessToken() || "";
}
