import { apiClient } from "../shared/api/client";

export interface KnowledgeDocumentItem {
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
}

export interface KnowledgeDocumentsResponse {
  documents: KnowledgeDocumentItem[];
  total: number;
}

export interface KnowledgeDocumentDetail {
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
}

export interface KnowledgeSegmentItem {
  id: string | null;
  position: number | null;
  content: string;
  word_count: number | null;
  tokens: number | null;
  hit_count: number | null;
  status: string | null;
  keywords: string[];
}

export interface KnowledgeDocumentDetailResponse {
  document: KnowledgeDocumentDetail;
  segments: KnowledgeSegmentItem[];
  segment_total: number;
}

export interface CreateKnowledgeDocumentResult {
  ok: boolean;
  document_id: string;
  name: string;
  batch: string;
  indexing_status: string;
}

export interface KnowledgeDownloadResult {
  blob: Blob;
  filename: string;
}

const KNOWLEDGE_API_PREFIX = "/rag/api/v1/knowledge";

// 查询共享知识库文档列表，返回文档元数据和总数。
export function fetchKnowledgeDocuments(): Promise<KnowledgeDocumentsResponse> {
  return apiClient.get<KnowledgeDocumentsResponse>(`${KNOWLEDGE_API_PREFIX}/documents`, {
    unwrapEnvelope: false,
  });
}

// 查询单个知识库文档详情，包含文档元数据和分段内容。
export function fetchKnowledgeDocumentDetail(documentId: string): Promise<KnowledgeDocumentDetailResponse> {
  return apiClient.get<KnowledgeDocumentDetailResponse>(
    `${KNOWLEDGE_API_PREFIX}/documents/${encodeURIComponent(documentId)}/detail`,
    { unwrapEnvelope: false },
  );
}

// 以文本方式创建知识库文档，入参为文档名和正文，返回索引任务结果。
export function createTextDocument(name: string, text: string): Promise<CreateKnowledgeDocumentResult> {
  return apiClient.post<CreateKnowledgeDocumentResult>(
    `${KNOWLEDGE_API_PREFIX}/documents/create-by-text`,
    { name, text },
    { unwrapEnvelope: false },
  );
}

// 上传文件创建知识库文档，入参为浏览器 File 对象，返回索引任务结果。
export function createFileDocument(file: File): Promise<CreateKnowledgeDocumentResult> {
  const form = new FormData();
  form.append("file", file);
  return apiClient.post<CreateKnowledgeDocumentResult>(
    `${KNOWLEDGE_API_PREFIX}/documents/create-by-file`,
    form,
    { unwrapEnvelope: false },
  );
}

// 删除指定知识库文档，入参为文档 ID，无返回体。
export async function deleteKnowledgeDocument(documentId: string): Promise<void> {
  await apiClient.delete<void>(`${KNOWLEDGE_API_PREFIX}/documents/${encodeURIComponent(documentId)}`, {
    unwrapEnvelope: false,
  });
}

// 下载指定知识库文档，入参为文档 ID 和导出格式，返回二进制文件与文件名。
export async function downloadKnowledgeDocument(
  documentId: string,
  format: "markdown" | "txt" = "markdown",
): Promise<KnowledgeDownloadResult> {
  const response = await apiClient.raw("GET", `${KNOWLEDGE_API_PREFIX}/documents/${encodeURIComponent(documentId)}/download`, {
    query: { format },
    headers: { Accept: "text/markdown, text/plain, application/octet-stream" },
  });
  const blob = await response.blob();
  const filename = resolveFilename(response.headers.get("Content-Disposition")) || `knowledge-${documentId}.${format === "markdown" ? "md" : "txt"}`;
  return { blob, filename };
}

function resolveFilename(contentDisposition: string | null): string {
  if (!contentDisposition) {
    return "";
  }
  const encoded = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
  return contentDisposition.match(/filename="?([^";]+)"?/i)?.[1] || "";
}
