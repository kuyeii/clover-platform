import { fetchRuntimeApps } from "./apiClient";

export type KnowledgeDocumentItem = {
  id: string;
  name: string;
  description: string | null;
  display_status?: string | null;
  indexing_status?: string | null;
  data_source_type?: string | null;
  word_count?: number | null;
  tokens?: number | null;
  segment_count?: number | null;
  enabled?: boolean | null;
  created_at?: number | null;
  updated_at?: number | null;
};

export type KnowledgeDocumentsResponse = {
  documents: KnowledgeDocumentItem[];
  total: number;
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

export type KnowledgeDocumentDetailResponse = {
  document: KnowledgeDocumentDetail;
  segments: KnowledgeSegmentItem[];
  segment_total: number;
};

export type CreateDocumentResult = {
  ok: boolean;
  document_id: string;
  name: string;
  batch: string;
  indexing_status: string;
};

export type DownloadDocumentResult = {
  blob: Blob;
  filename: string;
};

type CachedRuntimeApp = {
  code?: string;
  id?: string;
  url?: string;
  backendUrl?: string;
  backend_url?: string;
  healthUrl?: string;
  health_url?: string;
};

const RUNTIME_APPS_STORAGE_KEY = "portal.launchpad.runtimeApps.v1";
let runtimeKnowledgeApiBase: string | null = null;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function baseFromHealthUrl(healthUrl?: string): string {
  if (!healthUrl) return "";
  return healthUrl.replace(/\/api\/v1\/health\/?$/, "").replace(/\/health\/?$/, "");
}

function resolveRagBackendBase(apps: CachedRuntimeApp[]): string {
  const ragApp = apps.find((app) => (app.id || app.code) === "rag-web-search");
  if (!ragApp) return "";
  return trimTrailingSlash(
    ragApp.backendUrl ||
      ragApp.backend_url ||
      baseFromHealthUrl(ragApp.healthUrl || ragApp.health_url) ||
      "",
  );
}

function getCachedRagBackendBase(): string {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    const raw = window.sessionStorage.getItem(RUNTIME_APPS_STORAGE_KEY);
    if (!raw) return "";
    const apps = JSON.parse(raw) as CachedRuntimeApp[];
    return Array.isArray(apps) ? resolveRagBackendBase(apps) : "";
  } catch {
    return "";
  }
}

async function fetchRagBackendBase(): Promise<string> {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    const apps = await fetchRuntimeApps();
    const base = resolveRagBackendBase(apps);
    if (base) {
      runtimeKnowledgeApiBase = base;
    }
    return base;
  } catch {
    return "";
  }
}

async function getApiBase(): Promise<string> {
  const env = import.meta.env;
  const base =
    env.VITE_KNOWLEDGE_API_BASE_URL ||
    runtimeKnowledgeApiBase ||
    getCachedRagBackendBase() ||
    (await fetchRagBackendBase()) ||
    env.VITE_API_BASE_URL ||
    "";
  return trimTrailingSlash(String(base));
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown; message?: unknown };
    if (typeof body.detail === "string" && body.detail) return body.detail;
    if (typeof body.message === "string" && body.message) return body.message;
  } catch {
    // 忽略非 JSON 错误体，保留统一错误文案。
  }
  return fallback;
}

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(fallback);
  }
  return (await response.json()) as T;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${await getApiBase()}${path}`, init);
  if (!response.ok) {
    throw new Error(await readError(response, `请求失败（HTTP ${response.status}）`));
  }
  return readJson<T>(response, "知识库接口返回了非 JSON 响应，请确认 RAG 后端已启动。");
}

export function fetchKnowledgeDocuments(): Promise<KnowledgeDocumentsResponse> {
  return requestJson<KnowledgeDocumentsResponse>("/api/v1/knowledge/documents");
}

export function fetchKnowledgeDocumentDetail(
  documentId: string,
): Promise<KnowledgeDocumentDetailResponse> {
  return requestJson<KnowledgeDocumentDetailResponse>(
    `/api/v1/knowledge/documents/${encodeURIComponent(documentId)}/detail`,
  );
}

export function createTextDocument(name: string, text: string): Promise<CreateDocumentResult> {
  return requestJson<CreateDocumentResult>("/api/v1/knowledge/documents/create-by-text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, text }),
  });
}

export function createFileDocument(file: File): Promise<CreateDocumentResult> {
  const body = new FormData();
  body.append("file", file);
  return requestJson<CreateDocumentResult>("/api/v1/knowledge/documents/create-by-file", {
    method: "POST",
    body,
  });
}

export async function deleteKnowledgeDocument(documentId: string): Promise<void> {
  const response = await fetch(
    `${await getApiBase()}/api/v1/knowledge/documents/${encodeURIComponent(documentId)}`,
    { method: "DELETE" },
  );
  if (!response.ok && response.status !== 204) {
    throw new Error(await readError(response, `删除失败（HTTP ${response.status}）`));
  }
}

export async function downloadKnowledgeDocument(
  documentId: string,
  format: "markdown" | "json" = "markdown",
): Promise<DownloadDocumentResult> {
  const response = await fetch(
    `${await getApiBase()}/api/v1/knowledge/documents/${encodeURIComponent(documentId)}/download?format=${format}`,
  );
  if (!response.ok) {
    throw new Error(await readError(response, `下载失败（HTTP ${response.status}）`));
  }

  const header = response.headers.get("content-disposition") ?? "";
  const utf8Filename = header.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const asciiFilename = header.match(/filename="([^"]+)"/i)?.[1];
  const filename = utf8Filename
    ? decodeURIComponent(utf8Filename)
    : asciiFilename || `knowledge-document.${format === "json" ? "json" : "md"}`;

  return { blob: await response.blob(), filename };
}
