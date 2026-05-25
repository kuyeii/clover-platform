import { apiClient } from "../../../shared/api/client";
import type {
  ContractReviewConfig,
  ContractReviewHealth,
  ConverterDiagnostics,
  CreateReviewInput,
  CreateReviewResponse,
  DownloadedBlob,
  ReviewHistoryItem,
  ReviewMeta,
  ReviewResultPayload,
  RiskMutationResponse,
} from "../types";

const CONTRACT_REVIEW_API_PREFIX = "/contract-review/api";
const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function fetchContractReviewHealth() {
  return apiClient.get<ContractReviewHealth>(`${CONTRACT_REVIEW_API_PREFIX}/health`, {
    unwrapEnvelope: false,
  });
}

export function fetchContractReviewConfig() {
  return apiClient.get<ContractReviewConfig>(`${CONTRACT_REVIEW_API_PREFIX}/config`, {
    unwrapEnvelope: false,
  });
}

export function fetchConverterDiagnostics() {
  return apiClient.get<ConverterDiagnostics>(`${CONTRACT_REVIEW_API_PREFIX}/diagnostics/converters`, {
    unwrapEnvelope: false,
  });
}

export function createReview(input: CreateReviewInput) {
  const form = new FormData();
  form.append("file", input.file);
  form.append("review_side", input.reviewSide);
  form.append("contract_type_hint", input.contractTypeHint || "service_agreement");
  form.append("analysis_scope", input.analysisScope || "full_detail");

  return apiClient.post<CreateReviewResponse>(`${CONTRACT_REVIEW_API_PREFIX}/reviews`, form, {
    unwrapEnvelope: false,
  });
}

export function fetchReviewHistory(limit = 30) {
  return apiClient
    .get<{ items?: ReviewHistoryItem[] }>(`${CONTRACT_REVIEW_API_PREFIX}/reviews/history`, {
      query: { limit },
      unwrapEnvelope: false,
    })
    .then((payload) => (Array.isArray(payload.items) ? payload.items : []));
}

export function fetchReviewStatus(runId: string) {
  return apiClient.get<ReviewMeta>(`${CONTRACT_REVIEW_API_PREFIX}/reviews/${encodeURIComponent(runId)}`, {
    unwrapEnvelope: false,
  });
}

export function fetchReviewResult(runId: string) {
  return apiClient.get<ReviewResultPayload>(
    `${CONTRACT_REVIEW_API_PREFIX}/reviews/${encodeURIComponent(runId)}/result`,
    { unwrapEnvelope: false },
  );
}

export function patchRiskStatus(runId: string, riskId: string | number, status: "pending" | "accepted" | "rejected") {
  return apiClient.patch<RiskMutationResponse>(
    `${CONTRACT_REVIEW_API_PREFIX}/reviews/${encodeURIComponent(runId)}/risks/${encodeURIComponent(String(riskId))}`,
    { status },
    { unwrapEnvelope: false },
  );
}

export function acceptAllRisks(runId: string) {
  return apiClient.post<RiskMutationResponse>(
    `${CONTRACT_REVIEW_API_PREFIX}/reviews/${encodeURIComponent(runId)}/risks/accept_all`,
    undefined,
    { unwrapEnvelope: false },
  );
}

export function aiApplyRisk(runId: string, riskId: string | number) {
  return apiClient.post<RiskMutationResponse>(
    `${CONTRACT_REVIEW_API_PREFIX}/reviews/${encodeURIComponent(runId)}/risks/${encodeURIComponent(String(riskId))}/ai_apply`,
    undefined,
    { unwrapEnvelope: false },
  );
}

export function aiApplyAllRisks(runId: string) {
  return apiClient.post<RiskMutationResponse>(
    `${CONTRACT_REVIEW_API_PREFIX}/reviews/${encodeURIComponent(runId)}/ai_apply_all`,
    undefined,
    { unwrapEnvelope: false },
  );
}

export function aiAcceptRisk(
  runId: string,
  riskId: string | number,
  body: { revised_text?: string; target_text?: string } = {},
) {
  return apiClient.post<RiskMutationResponse>(
    `${CONTRACT_REVIEW_API_PREFIX}/reviews/${encodeURIComponent(runId)}/risks/${encodeURIComponent(String(riskId))}/ai_accept`,
    body,
    { unwrapEnvelope: false },
  );
}

export function aiEditRisk(runId: string, riskId: string | number, revisedText: string) {
  return apiClient.patch<RiskMutationResponse>(
    `${CONTRACT_REVIEW_API_PREFIX}/reviews/${encodeURIComponent(runId)}/risks/${encodeURIComponent(String(riskId))}/ai_edit`,
    { revised_text: revisedText },
    { unwrapEnvelope: false },
  );
}

export function aiRejectRisk(runId: string, riskId: string | number) {
  return apiClient.post<RiskMutationResponse>(
    `${CONTRACT_REVIEW_API_PREFIX}/reviews/${encodeURIComponent(runId)}/risks/${encodeURIComponent(String(riskId))}/ai_reject`,
    undefined,
    { unwrapEnvelope: false },
  );
}

export async function fetchReviewDocument(runId: string): Promise<DownloadedBlob> {
  const response = await apiClient.raw(
    "GET",
    `${CONTRACT_REVIEW_API_PREFIX}/reviews/${encodeURIComponent(runId)}/document`,
    {
      headers: {
        Accept: `${DOCX_MIME_TYPE}, application/octet-stream`,
      },
    },
  );
  const blob = await response.blob();
  return {
    blob,
    fileName: normalizeDocxFileName(pickFileNameFromDisposition(response.headers.get("Content-Disposition"), `${runId}.docx`)),
  };
}

export async function fetchReviewedDownload(runId: string, fallbackName: string): Promise<DownloadedBlob> {
  const response = await apiClient.raw(
    "GET",
    `${CONTRACT_REVIEW_API_PREFIX}/reviews/${encodeURIComponent(runId)}/download`,
    {
      headers: {
        Accept: `${DOCX_MIME_TYPE}, application/octet-stream`,
      },
    },
  );
  const blob = await response.blob();
  return {
    blob,
    fileName: normalizeDocxFileName(pickFileNameFromDisposition(response.headers.get("Content-Disposition"), fallbackName)),
  };
}

export function saveBlobToDisk(download: DownloadedBlob) {
  const objectUrl = URL.createObjectURL(download.blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = download.fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function pickFileNameFromDisposition(contentDisposition: string | null, fallbackName: string) {
  if (!contentDisposition) {
    return fallbackName;
  }
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }
  const plainMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1] || fallbackName;
}

function normalizeDocxFileName(name: string) {
  const raw = String(name || "contract.docx").trim() || "contract.docx";
  if (/\.docx$/i.test(raw)) {
    return raw;
  }
  const withoutKnownExtension = raw.replace(/\.(pdf|doc)$/i, "");
  return `${withoutKnownExtension || "contract"}.docx`;
}
