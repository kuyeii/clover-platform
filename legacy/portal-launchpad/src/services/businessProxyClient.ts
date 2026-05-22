import { getAuthToken, getClientId } from "./apiClient";

export class BusinessProxyError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = "BusinessProxyError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function isFormDataBody(body: BodyInit | null | undefined): body is FormData {
  return typeof FormData !== "undefined" && body instanceof FormData;
}

function extractError(payload: unknown): { message?: string; code?: string; details?: unknown } {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  const body = payload as {
    detail?: unknown;
    error?: unknown;
    message?: unknown;
  };

  if (body.error && typeof body.error === "object") {
    const error = body.error as { code?: unknown; details?: unknown; message?: unknown };
    return {
      code: typeof error.code === "string" ? error.code : undefined,
      details: error.details,
      message: typeof error.message === "string" ? error.message : undefined,
    };
  }

  if (typeof body.error === "string" && body.error) {
    return { message: body.error };
  }

  if (typeof body.detail === "string" && body.detail) {
    return { message: body.detail };
  }

  if (typeof body.message === "string" && body.message) {
    return { message: body.message };
  }

  return {};
}

function upstreamUnavailableMessage(status: number, message: string) {
  const suffix = message ? `：${message}` : "。";
  return `RAG 知识库上游或 Dify Dataset 暂不可用（HTTP ${status}）${suffix}`;
}

export function shouldFallbackBusinessProxy(error: unknown) {
  return (
    error instanceof BusinessProxyError &&
    (error.status === 0 || error.status === 502 || error.status === 503)
  );
}

export function buildPortalHeaders(init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const body = init.body;

  if (!headers.has("accept")) {
    headers.set("accept", "application/json");
  }

  if (body && !isFormDataBody(body) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  headers.set("x-portal-client-id", getClientId());

  const token = getAuthToken();
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }

  return headers;
}

export async function businessProxyFetch(path: string, init: RequestInit = {}) {
  try {
    return await fetch(path, {
      ...init,
      headers: buildPortalHeaders(init),
      credentials: "include",
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? `RAG 统一代理网络不可用：${error.message}`
        : "RAG 统一代理网络不可用，请确认 apps/api 已启动。";
    throw new BusinessProxyError(message, 0);
  }
}

export async function readBusinessProxyError(response: Response, fallback: string) {
  let extracted: { message?: string; code?: string; details?: unknown } = {};

  try {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      extracted = extractError(await response.json());
    } else {
      const text = (await response.text()).trim();
      if (text) {
        extracted = { message: text };
      }
    }
  } catch {
    extracted = {};
  }

  const rawMessage = extracted.message || fallback || `请求失败（HTTP ${response.status}）`;
  const message =
    response.status === 502 || response.status === 503
      ? upstreamUnavailableMessage(response.status, rawMessage)
      : rawMessage;

  return new BusinessProxyError(message, response.status, extracted.code, extracted.details);
}
