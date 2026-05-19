import type { Conversation } from "@/types/conversation";

export type StreamEvent =
  | { type: "session"; session_id: string; request_id?: string }
  | { type: "delta"; text: string }
  | { type: "done"; request_id?: string }
  | { type: "error"; detail: string; request_id?: string };

function getApiBase(): string {
  const base = import.meta.env.VITE_API_BASE_URL ?? "";
  return base.replace(/\/$/, "");
}

export type ConversationsBootstrapPayload = {
  conversations: Conversation[];
  activeConversationId: string | null;
};

export async function fetchConversationsBootstrap(): Promise<ConversationsBootstrapPayload> {
  const apiBase = getApiBase();
  const url = `${apiBase}/api/v1/conversations`;
  const res = await fetch(url);
  if (!res.ok) {
    let detail = `请求失败（HTTP ${res.status}）`;
    try {
      const j = (await res.json()) as { detail?: unknown };
      if (typeof j.detail === "string") detail = j.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return (await res.json()) as ConversationsBootstrapPayload;
}

export async function putConversationsSync(
  conversations: Conversation[],
  activeConversationId: string,
): Promise<void> {
  const apiBase = getApiBase();
  const url = `${apiBase}/api/v1/conversations/sync`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversations, activeConversationId }),
  });
  if (!res.ok && res.status !== 204) {
    let detail = `同步失败（HTTP ${res.status}）`;
    try {
      const j = (await res.json()) as { detail?: unknown };
      if (typeof j.detail === "string") detail = j.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
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
  const apiBase = getApiBase();
  const url = `${apiBase}/api/v1/chat/stream`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      session_id: sessionId,
      allow_search: allowSearch,
      history,
    }),
    signal,
  });

  if (!res.ok) {
    handlers.onError(`请求失败（HTTP ${res.status}）`);
    return;
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
  const apiBase = getApiBase();
  const url = `${apiBase}/api/v1/knowledge/documents/${encodeURIComponent(documentId)}/detail`;
  const res = await fetch(url);
  if (!res.ok) {
    let detail = `请求失败（HTTP ${res.status}）`;
    try {
      const j = (await res.json()) as { detail?: unknown };
      if (typeof j.detail === "string") detail = j.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return (await res.json()) as KnowledgeDocumentDetailResponse;
}

export async function fetchKnowledgeDocuments(): Promise<KnowledgeDocumentsResponse> {
  const apiBase = getApiBase();
  const url = `${apiBase}/api/v1/knowledge/documents`;
  const res = await fetch(url);
  if (!res.ok) {
    let detail = `请求失败（HTTP ${res.status}）`;
    try {
      const j = (await res.json()) as { detail?: unknown };
      if (typeof j.detail === "string") detail = j.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return (await res.json()) as KnowledgeDocumentsResponse;
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
  const apiBase = getApiBase();
  const url = `${apiBase}/api/v1/knowledge/documents/create-by-file`;
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(url, {
    method: "POST",
    body,
  });
  if (!res.ok) {
    let detail = `请求失败（HTTP ${res.status}）`;
    try {
      const j = (await res.json()) as { detail?: unknown };
      if (typeof j.detail === "string") detail = j.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return (await res.json()) as CreateTextDocumentResult;
}

export async function createTextDocument(
  name: string,
  text: string,
): Promise<CreateTextDocumentResult> {
  const apiBase = getApiBase();
  const url = `${apiBase}/api/v1/knowledge/documents/create-by-text`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, text }),
  });
  if (!res.ok) {
    let detail = `请求失败（HTTP ${res.status}）`;
    try {
      const j = (await res.json()) as { detail?: unknown };
      if (typeof j.detail === "string") detail = j.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return (await res.json()) as CreateTextDocumentResult;
}

export async function deleteKnowledgeDocument(documentId: string): Promise<void> {
  const apiBase = getApiBase();
  const url = `${apiBase}/api/v1/knowledge/documents/${encodeURIComponent(documentId)}`;
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok && res.status !== 204) {
    let detail = `删除失败（HTTP ${res.status}）`;
    try {
      const j = (await res.json()) as { detail?: unknown };
      if (typeof j.detail === "string") detail = j.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
}
