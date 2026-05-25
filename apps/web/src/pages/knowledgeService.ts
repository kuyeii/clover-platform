import { apiClient } from "../shared/api/client";
import type {
  CreateKnowledgeDocumentResult,
  KnowledgeDocumentDetailResponse,
  KnowledgeDocumentsResponse,
} from "../modules/rag/types";

export type {
  KnowledgeDocumentDetailResponse,
  KnowledgeDocumentItem,
} from "../modules/rag/types";

const RAG_KNOWLEDGE_API_PREFIX = "/rag/api/v1";

export type DownloadDocumentResult = {
  blob: Blob;
  filename: string;
};

export function fetchKnowledgeDocuments(): Promise<KnowledgeDocumentsResponse> {
  return apiClient.get<KnowledgeDocumentsResponse>(`${RAG_KNOWLEDGE_API_PREFIX}/knowledge/documents`, {
    unwrapEnvelope: false,
  });
}

export function fetchKnowledgeDocumentDetail(
  documentId: string,
): Promise<KnowledgeDocumentDetailResponse> {
  return apiClient.get<KnowledgeDocumentDetailResponse>(
    `${RAG_KNOWLEDGE_API_PREFIX}/knowledge/documents/${encodeURIComponent(documentId)}/detail`,
    { unwrapEnvelope: false },
  );
}

export function createTextDocument(name: string, text: string): Promise<CreateKnowledgeDocumentResult> {
  return apiClient.post<CreateKnowledgeDocumentResult>(
    `${RAG_KNOWLEDGE_API_PREFIX}/knowledge/documents/create-by-text`,
    { name, text },
    { unwrapEnvelope: false },
  );
}

export function createFileDocument(file: File): Promise<CreateKnowledgeDocumentResult> {
  const formData = new FormData();
  formData.append("file", file);
  return apiClient.post<CreateKnowledgeDocumentResult>(
    `${RAG_KNOWLEDGE_API_PREFIX}/knowledge/documents/create-by-file`,
    formData,
    { unwrapEnvelope: false },
  );
}

export async function deleteKnowledgeDocument(documentId: string): Promise<void> {
  await apiClient.delete<void>(
    `${RAG_KNOWLEDGE_API_PREFIX}/knowledge/documents/${encodeURIComponent(documentId)}`,
    { unwrapEnvelope: false },
  );
}

function filenameFromDisposition(header: string | null, fallbackFilename: string): string {
  const utf8Filename = header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const asciiFilename = header?.match(/filename="([^"]+)"/i)?.[1];
  return utf8Filename ? decodeURIComponent(utf8Filename) : asciiFilename || fallbackFilename;
}

export async function downloadKnowledgeDocument(
  documentId: string,
  format: "markdown" | "json" = "markdown",
): Promise<DownloadDocumentResult> {
  const fallbackFilename = `knowledge-document.${format === "json" ? "json" : "md"}`;
  const response = await apiClient.raw(
    "GET",
    `${RAG_KNOWLEDGE_API_PREFIX}/knowledge/documents/${encodeURIComponent(documentId)}/download`,
    {
      query: { format },
      headers: {
        Accept: "application/octet-stream,*/*",
      },
    },
  );
  return {
    blob: await response.blob(),
    filename: filenameFromDisposition(response.headers.get("content-disposition"), fallbackFilename),
  };
}
