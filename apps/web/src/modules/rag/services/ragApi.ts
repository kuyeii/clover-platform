import { ApiRequestError, apiClient, getApiBaseUrl } from "../../../shared/api/client";
import { getAccessToken, getClientId } from "../../../shared/auth/token";
import type {
  ConversationsBootstrapPayload,
  Conversation,
  CreateKnowledgeDocumentResult,
  KnowledgeDocumentDetailResponse,
  KnowledgeDocumentsResponse,
  StreamEvent,
} from "../types";

const RAG_API_PREFIX = "/rag/api/v1";

type StreamHandlers = {
  onSession?: (sessionId: string) => void;
  onDelta: (chunk: string) => void;
  onDone: () => void;
  onError: (detail: string) => void;
};

export function fetchRagHealth() {
  return apiClient.get<{ status: string }>(`${RAG_API_PREFIX}/health`, { unwrapEnvelope: false });
}

export function createRagSession() {
  return apiClient.post<{ session_id: string }>(`${RAG_API_PREFIX}/sessions`, undefined, {
    unwrapEnvelope: false,
  });
}

export function fetchConversationsBootstrap(): Promise<ConversationsBootstrapPayload> {
  return apiClient.get<ConversationsBootstrapPayload>(`${RAG_API_PREFIX}/conversations`, {
    unwrapEnvelope: false,
  });
}

export async function putConversationsSync(
  conversations: Conversation[],
  activeConversationId: string,
): Promise<void> {
  await apiClient.put<void>(`${RAG_API_PREFIX}/conversations/sync`, { conversations, activeConversationId }, {
    unwrapEnvelope: false,
  });
}

export async function streamChatCompletion(
  message: string,
  sessionId: string,
  allowSearch: boolean,
  handlers: StreamHandlers,
  signal?: AbortSignal,
  history = "[]",
): Promise<void> {
  const token = getAccessToken();
  const response = await fetch(`${getApiBaseUrl()}${RAG_API_PREFIX}/chat/stream`, {
    method: "POST",
    headers: {
      Accept: "text/event-stream, application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "X-Portal-Client-Id": getClientId(),
    },
    body: JSON.stringify({
      message,
      session_id: sessionId,
      allow_search: allowSearch,
      history,
    }),
    credentials: "include",
    signal,
  });

  if (!response.ok || !response.body) {
    throw await buildStreamResponseError(response);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let completed = false;
  let failed = false;

  const parseBlock = (block: string) => {
    const lines = block.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) {
        continue;
      }
      const payload = trimmed.slice("data:".length).trim();
      if (!payload) {
        continue;
      }
      let event: StreamEvent;
      try {
        event = JSON.parse(payload) as StreamEvent;
      } catch {
        failed = true;
        handlers.onError("流式数据解析失败。");
        return;
      }
      if (event.type === "session" && "session_id" in event) {
        handlers.onSession?.(String(event.session_id || ""));
      } else if (event.type === "delta" && "text" in event) {
        handlers.onDelta(String(event.text || ""));
      } else if (event.type === "done") {
        completed = true;
        handlers.onDone();
      } else if (event.type === "error") {
        failed = true;
        handlers.onError(String("detail" in event ? event.detail || "上游服务错误。" : "上游服务错误。"));
      }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      parseBlock(part);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    parseBlock(buffer);
  }
  if (!completed && !failed) {
    handlers.onDone();
  }
}

export function fetchKnowledgeDocuments(): Promise<KnowledgeDocumentsResponse> {
  return apiClient.get<KnowledgeDocumentsResponse>(`${RAG_API_PREFIX}/knowledge/documents`, {
    unwrapEnvelope: false,
  });
}

export function fetchKnowledgeDocumentDetail(documentId: string): Promise<KnowledgeDocumentDetailResponse> {
  return apiClient.get<KnowledgeDocumentDetailResponse>(
    `${RAG_API_PREFIX}/knowledge/documents/${encodeURIComponent(documentId)}/detail`,
    { unwrapEnvelope: false },
  );
}

export function createTextDocument(name: string, text: string): Promise<CreateKnowledgeDocumentResult> {
  return apiClient.post<CreateKnowledgeDocumentResult>(
    `${RAG_API_PREFIX}/knowledge/documents/create-by-text`,
    { name, text },
    { unwrapEnvelope: false },
  );
}

export function createFileDocument(file: File): Promise<CreateKnowledgeDocumentResult> {
  const form = new FormData();
  form.append("file", file);
  return apiClient.post<CreateKnowledgeDocumentResult>(
    `${RAG_API_PREFIX}/knowledge/documents/create-by-file`,
    form,
    { unwrapEnvelope: false },
  );
}

export async function deleteKnowledgeDocument(documentId: string): Promise<void> {
  await apiClient.delete<void>(`${RAG_API_PREFIX}/knowledge/documents/${encodeURIComponent(documentId)}`, {
    unwrapEnvelope: false,
  });
}

async function buildStreamResponseError(response: Response): Promise<ApiRequestError> {
  let message = `请求失败（HTTP ${response.status}）`;
  try {
    const payload = await response.clone().json();
    message = payload?.detail || payload?.message || payload?.error?.message || message;
  } catch {
    try {
      const text = await response.clone().text();
      if (text.trim()) {
        message = text.trim().slice(0, 300);
      }
    } catch {
      // Keep HTTP status fallback.
    }
  }
  return new ApiRequestError({
    status: response.status,
    code: `HTTP_${response.status}`,
    message,
    requestId: response.headers.get("X-Request-ID"),
  });
}
