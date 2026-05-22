import type { Conversation } from "@/types/conversation";
import {
  PortalBridgeAuthError,
  getPortalAuthContext,
} from "./portalBridge";

export type StreamEvent =
  | { type: "session"; session_id: string; request_id?: string }
  | { type: "delta"; text: string }
  | { type: "done"; request_id?: string }
  | { type: "error"; detail: string; request_id?: string };

type ApiTarget = {
  baseUrl: string;
  headers: Record<string, string>;
  isPlatformApi: boolean;
};

type ApiRequestError = Error & {
  status?: number;
  isPlatformApiRequest?: boolean;
};

let hasWarnedLegacyFallback = false;

function getLegacyApiBase(): string {
  const base = import.meta.env.VITE_API_BASE_URL ?? "";
  return base.replace(/\/$/, "");
}

function joinApiUrl(base: string, path: string) {
  return `${base.replace(/\/$/, "")}${path}`;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function createApiRequestError(
  message: string,
  status: number,
  isPlatformApiRequest: boolean,
): ApiRequestError {
  const error = new Error(message) as ApiRequestError;
  error.status = status;
  error.isPlatformApiRequest = isPlatformApiRequest;
  return error;
}

function isRetriablePlatformFailure(error: unknown) {
  const requestError = error as ApiRequestError;
  return (
    Boolean(requestError?.isPlatformApiRequest) &&
    (requestError.status === 0 ||
      requestError.status === 502 ||
      requestError.status === 503)
  );
}

function isSafeFallbackMethod(init: RequestInit = {}) {
  const method = String(init.method || "GET").toUpperCase();
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

function warnLegacyFallback(error: unknown) {
  if (hasWarnedLegacyFallback) {
    return;
  }
  hasWarnedLegacyFallback = true;
  const message = error instanceof Error && error.message ? error.message : "platform api unavailable";
  console.warn("RAG apps/api 代理不可用，回退到 legacy backend。", message);
}

async function resolveApiTarget(): Promise<ApiTarget> {
  const legacyBaseUrl = getLegacyApiBase();
  const context = await getPortalAuthContext();
  if (context) {
    return {
      baseUrl: context.apiBaseUrl,
      headers: {
        Authorization: `Bearer ${context.token}`,
        "X-Portal-Client-Id": context.clientId,
      },
      isPlatformApi: true,
    };
  }

  return {
    baseUrl: legacyBaseUrl,
    headers: {},
    isPlatformApi: false,
  };
}

function legacyApiTarget(): ApiTarget {
  return {
    baseUrl: getLegacyApiBase(),
    headers: {},
    isPlatformApi: false,
  };
}

function mergeHeaders(target: ApiTarget, headers?: HeadersInit) {
  const merged = new Headers(headers);
  for (const [name, value] of Object.entries(target.headers)) {
    merged.set(name, value);
  }
  return merged;
}

async function fetchWithTarget(
  path: string,
  init: RequestInit,
  target: ApiTarget,
): Promise<Response> {
  try {
    return await fetch(joinApiUrl(target.baseUrl, path), {
      ...init,
      headers: mergeHeaders(target, init.headers),
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    const message =
      error instanceof Error && error.message
        ? `请求失败：${error.message}`
        : "请求失败，请稍后重试。";
    throw createApiRequestError(message, 0, target.isPlatformApi);
  }
}

async function readErrorDetail(response: Response, fallbackPrefix = "请求失败") {
  let detail = `${fallbackPrefix}（HTTP ${response.status}）`;
  try {
    const payload = (await response.clone().json()) as {
      detail?: unknown;
      message?: unknown;
      error?: { message?: unknown };
    };
    if (typeof payload.detail === "string") {
      detail = payload.detail;
    } else if (typeof payload.error?.message === "string") {
      detail = payload.error.message;
    } else if (typeof payload.message === "string") {
      detail = payload.message;
    }
  } catch {
    /* ignore */
  }
  return detail;
}

async function resolveApiTargetWithFallback(): Promise<ApiTarget> {
  try {
    return await resolveApiTarget();
  } catch (error) {
    if (error instanceof PortalBridgeAuthError) {
      throw error;
    }
    return legacyApiTarget();
  }
}

async function requestJsonWithTarget<T>(
  path: string,
  init: RequestInit,
  target: ApiTarget,
  errorPrefix = "请求失败",
): Promise<T> {
  const res = await fetchWithTarget(path, init, target);
  if (!res.ok) {
    throw createApiRequestError(
      await readErrorDetail(res, errorPrefix),
      res.status,
      target.isPlatformApi,
    );
  }
  return (await res.json()) as T;
}

async function requestJson<T>(
  path: string,
  init: RequestInit = {},
  errorPrefix = "请求失败",
): Promise<T> {
  const target = await resolveApiTargetWithFallback();
  try {
    return await requestJsonWithTarget<T>(path, init, target, errorPrefix);
  } catch (error) {
    if (!isRetriablePlatformFailure(error) || !isSafeFallbackMethod(init)) {
      throw error;
    }
    warnLegacyFallback(error);
    return requestJsonWithTarget<T>(path, init, legacyApiTarget(), errorPrefix);
  }
}

export type ConversationsBootstrapPayload = {
  conversations: Conversation[];
  activeConversationId: string | null;
};

export async function fetchConversationsBootstrap(): Promise<ConversationsBootstrapPayload> {
  return requestJson<ConversationsBootstrapPayload>("/api/v1/conversations");
}

export async function putConversationsSync(
  conversations: Conversation[],
  activeConversationId: string,
): Promise<void> {
  const target = await resolveApiTargetWithFallback();
  const init: RequestInit = {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversations, activeConversationId }),
  };

  const syncWithTarget = async (targetToUse: ApiTarget) => {
    const res = await fetchWithTarget("/api/v1/conversations/sync", init, targetToUse);
    if (!res.ok && res.status !== 204) {
      throw createApiRequestError(
        await readErrorDetail(res, "同步失败"),
        res.status,
        targetToUse.isPlatformApi,
      );
    }
  };

  try {
    await syncWithTarget(target);
  } catch (error) {
    if (!isRetriablePlatformFailure(error) || !isSafeFallbackMethod(init)) {
      throw error;
    }
    warnLegacyFallback(error);
    await syncWithTarget(legacyApiTarget());
  }
}

export async function streamChatCompletion(
  message: string,
  sessionId: string,
  allowSearch: boolean,
  handlers: {
    onSession?: (sessionId: string) => void;
    onDelta: (chunk: string) => void;
    onDone: () => void;
    onError: (detail: string) => void;
  },
  signal?: AbortSignal,
  /** JSON 字符串：已完成对话轮次，新建会话无历史时为 `"[]"` */
  history: string = "[]",
): Promise<void> {
  const target = await resolveApiTargetWithFallback();

  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      session_id: sessionId,
      allow_search: allowSearch,
      history,
    }),
    signal,
  };

  try {
    await streamChatCompletionWithTarget(init, handlers, target);
  } catch (error) {
    if (!isRetriablePlatformFailure(error) || !isSafeFallbackMethod(init)) {
      throw error;
    }
    warnLegacyFallback(error);
    await streamChatCompletionWithTarget(init, handlers, legacyApiTarget());
  }
}

async function streamChatCompletionWithTarget(
  init: RequestInit,
  handlers: {
    onSession?: (sessionId: string) => void;
    onDelta: (chunk: string) => void;
    onDone: () => void;
    onError: (detail: string) => void;
  },
  target: ApiTarget,
): Promise<void> {
  const res = await fetchWithTarget("/api/v1/chat/stream", init, target);

  if (!res.ok) {
    throw createApiRequestError(
      await readErrorDetail(res, "请求失败"),
      res.status,
      target.isPlatformApi,
    );
  }

  const reader = res.body?.getReader();
  if (!reader) {
    handlers.onError("无法读取响应流");
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  const parseBlock = (block: string) => {
    const lines = block.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice("data:".length).trim();
      if (!payload) continue;
      let evt: StreamEvent;
      try {
        evt = JSON.parse(payload) as StreamEvent;
      } catch {
        handlers.onError("流式数据解析失败");
        return;
      }
      if (evt.type === "session") {
        handlers.onSession?.(evt.session_id);
      } else if (evt.type === "delta") {
        handlers.onDelta(evt.text);
      } else if (evt.type === "done") {
        handlers.onDone();
      } else if (evt.type === "error") {
        handlers.onError(evt.detail || "上游服务错误");
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      parseBlock(part);
    }
  }
  if (buffer.trim()) {
    parseBlock(buffer);
  }
}

export type KnowledgeDocumentItem = {
  id: string;
  name: string;
  description: string | null;
  display_status?: string | null;
  indexing_status?: string | null;
};

export type KnowledgeDocumentsResponse = {
  documents: KnowledgeDocumentItem[];
  total: number;
};

export type KnowledgeDocumentDetail = {
  id: string | null;
  name: string | null;
  data_source_type: string | null;
  created_from: string | null;
  word_count: number | null;
  tokens: number | null;
  hit_count: number | null;
  indexing_status: string | null;
  display_status: string | null;
  doc_form: string | null;
  doc_language: string | null;
  segment_count: number | null;
  average_segment_length: number | null;
  indexing_latency: number | null;
  created_at: number | null;
  updated_at: number | null;
  completed_at: number | null;
  doc_metadata: unknown;
  upload_file: {
    name?: string | null;
    size?: number | null;
    extension?: string | null;
    mime_type?: string | null;
  } | null;
  enabled: boolean | null;
  error: string | null;
};

export type KnowledgeSegmentItem = {
  id: string | null;
  position: number | null;
  content: string;
  word_count: number | null;
  tokens: number | null;
  hit_count: number | null;
  status: string | null;
  keywords: string[];
};

export type KnowledgeDocumentDetailResponse = {
  document: KnowledgeDocumentDetail;
  segments: KnowledgeSegmentItem[];
  segment_total: number;
};

export async function fetchKnowledgeDocumentDetail(
  documentId: string,
): Promise<KnowledgeDocumentDetailResponse> {
  return requestJson<KnowledgeDocumentDetailResponse>(
    `/api/v1/knowledge/documents/${encodeURIComponent(documentId)}/detail`,
  );
}

export async function fetchKnowledgeDocuments(): Promise<KnowledgeDocumentsResponse> {
  return requestJson<KnowledgeDocumentsResponse>("/api/v1/knowledge/documents");
}

export type CreateTextDocumentResult = {
  ok: boolean;
  document_id: string;
  name: string;
  batch: string;
  indexing_status: string;
};

/** 与 create-by-text 成功响应结构一致 */
export async function createFileDocument(
  file: File,
): Promise<CreateTextDocumentResult> {
  const body = new FormData();
  body.append("file", file);
  return requestJson<CreateTextDocumentResult>("/api/v1/knowledge/documents/create-by-file", {
    method: "POST",
    body,
  });
}

export async function createTextDocument(
  name: string,
  text: string,
): Promise<CreateTextDocumentResult> {
  return requestJson<CreateTextDocumentResult>("/api/v1/knowledge/documents/create-by-text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, text }),
  });
}

export async function deleteKnowledgeDocument(documentId: string): Promise<void> {
  const target = await resolveApiTargetWithFallback();
  const path = `/api/v1/knowledge/documents/${encodeURIComponent(documentId)}`;

  const deleteWithTarget = async (targetToUse: ApiTarget) => {
    const res = await fetchWithTarget(path, { method: "DELETE" }, targetToUse);
    if (!res.ok && res.status !== 204) {
      throw createApiRequestError(
        await readErrorDetail(res, "删除失败"),
        res.status,
        targetToUse.isPlatformApi,
      );
    }
  };

  try {
    await deleteWithTarget(target);
  } catch (error) {
    if (!isRetriablePlatformFailure(error) || !isSafeFallbackMethod({ method: "DELETE" })) {
      throw error;
    }
    warnLegacyFallback(error);
    await deleteWithTarget(legacyApiTarget());
  }
}
