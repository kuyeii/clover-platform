import { apiClient, ApiRequestError, getApiBaseUrl } from "../../../shared/api/client";
import { getAccessToken, getClientId } from "../../../shared/auth/token";

const API_PREFIX = "/competitor-analysis/api";

export interface CompetitorAnalysisInput {
  targetCompanyName: string;
  targetCompanyIntro?: string;
  targetCompanyBusiness?: string;
  targetCompanyConfirmed?: boolean;
  province?: string;
  competitorCompanyName?: string;
  matchMode?: "auto" | "exact";
  resultId?: string;
}

export interface CompetitorItem {
  id: string;
  name: string;
  intro?: string;
  threatScore?: number | null;
  sourceTag?: string;
}

export interface HistoryRecord {
  id: string;
  title?: string;
  mode?: string;
  input?: CompetitorAnalysisInput;
  queryTime?: string;
  createdAt?: string;
  warnings?: string[];
  stateSnapshot?: Record<string, unknown>;
}

export interface StreamEvent {
  type:
    | "analysis_started"
    | "competitors_ready"
    | "target_detail_ready"
    | "competitor_detail_ready"
    | "compare_report_ready"
    | "score_ready"
    | "analysis_finished"
    | "analysis_error"
    | string;
  data: unknown;
}

function requestLegacyJson<T>(path: string, body?: unknown) {
  if (body === undefined) {
    return apiClient.get<T>(`${API_PREFIX}${path}`, { unwrapEnvelope: false });
  }
  return apiClient.post<T>(`${API_PREFIX}${path}`, body, { unwrapEnvelope: false });
}

export async function healthCheck() {
  return requestLegacyJson<{ ok: boolean; service: string }>("/health");
}

export async function listHistory() {
  const payload = await requestLegacyJson<{ items?: HistoryRecord[] }>("/history");
  return Array.isArray(payload.items) ? payload.items : [];
}

export async function getHistoryRecord(id: string) {
  const payload = await requestLegacyJson<{ item?: HistoryRecord }>(`/history/${encodeURIComponent(id)}`);
  return payload.item || null;
}

export async function deleteHistoryRecord(id: string) {
  return apiClient.delete<{ ok: boolean }>(`${API_PREFIX}/history/${encodeURIComponent(id)}`, {
    unwrapEnvelope: false,
  });
}

export function runInputValidationWorkflow(input: Record<string, unknown>) {
  return requestLegacyJson<Record<string, unknown>>("/workflows/validate", input);
}

export function runCompanyNameValidationWorkflow(input: Record<string, unknown>) {
  return requestLegacyJson<Record<string, unknown>>("/workflows/company-name-validate", input);
}

export function runCompanyDetailWorkflow(input: Record<string, unknown>) {
  return requestLegacyJson<Record<string, unknown>>("/workflows/company-detail", input);
}

export function runCompareReportWorkflow(input: Record<string, unknown>) {
  return requestLegacyJson<Record<string, unknown>>("/workflows/compare-report", input);
}

export function runScoreWorkflow(input: Record<string, unknown>) {
  return requestLegacyJson<Record<string, unknown>>("/workflows/score", input);
}

export async function runAnalysis(input: CompetitorAnalysisInput) {
  return requestLegacyJson<{ ok: boolean; item: HistoryRecord; warnings?: string[] }>("/analysis", input);
}

export async function runAnalysisStream(
  input: CompetitorAnalysisInput,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
) {
  const token = getAccessToken();
  const response = await fetch(`${getApiBaseUrl()}/competitor-analysis/api/analysis/stream`, {
    method: "POST",
    headers: {
      Accept: "application/x-ndjson, application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "X-Portal-Client-Id": getClientId(),
    },
    body: JSON.stringify(input),
    credentials: "include",
    signal,
  });

  if (!response.ok || !response.body) {
    let message = `请求失败（HTTP ${response.status}）`;
    try {
      const payload = await response.clone().json();
      message = payload?.message || payload?.error?.message || message;
    } catch {
      // Keep HTTP status fallback.
    }
    throw new ApiRequestError({ status: response.status, code: `HTTP_${response.status}`, message });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      onEvent(JSON.parse(line) as StreamEvent);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    onEvent(JSON.parse(buffer) as StreamEvent);
  }
}
