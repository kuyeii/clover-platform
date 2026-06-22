import { apiClient } from "../../../../shared/api/client";
import type { AnalysisScopeOption, ReviewMeta, ReviewResultPayload } from "../types";

const CONTRACT_REVIEW_API_PREFIX = "/contract-review";

function normalizeContractReviewPath(path: string) {
  const value = String(path || "").trim();
  if (/^https?:\/\//i.test(value)) {
    const url = new URL(value);
    return normalizeContractReviewPath(`${url.pathname}${url.search}`);
  }
  const normalized = value.startsWith("/") ? value : `/${value}`;
  if (normalized.startsWith("/contract-review/")) {
    return normalized;
  }
  if (normalized === "/api") {
    return `${CONTRACT_REVIEW_API_PREFIX}/api`;
  }
  if (normalized.startsWith("/api/")) {
    return `${CONTRACT_REVIEW_API_PREFIX}${normalized}`;
  }
  return `${CONTRACT_REVIEW_API_PREFIX}${normalized}`;
}

export async function getContractReviewApiBase() {
  return CONTRACT_REVIEW_API_PREFIX;
}

export async function contractReviewFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const method = String(init.method || "GET").toUpperCase() as "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  const body = normalizeRequestBody(init.body, init.headers);
  return apiClient.raw(method, normalizeContractReviewPath(path), {
    headers: init.headers,
    body,
    signal: init.signal || undefined,
    credentials: init.credentials,
    cache: init.cache,
    throwOnError: false,
  });
}

export async function contractReviewJsonFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await contractReviewFetch(path, init);
  if (!response.ok) {
    throw await buildContractReviewApiError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const contentType = response.headers.get("Content-Type") || "";
  if (contentType.includes("application/json")) {
    return (await response.json()) as T;
  }
  return (await response.text()) as T;
}

export type ContractReviewConfigPayload = {
  review_side: string;
  contract_type_hint: string;
  analysis_scope?: AnalysisScopeOption | string;
};

export type ContractReviewHistoryApiItem = {
  run_id: string;
  file_name?: string;
  status: ReviewMeta["status"];
  step?: string;
  updated_at?: string;
  document_ready?: boolean;
  download_ready?: boolean;
};

export type RiskMutationPayload = {
  item?: any;
  risk_items?: any[];
  summary?: Record<string, unknown>;
};

// 获取合同审查运行配置；用于初始化审查立场、合同类型和分析范围。
export async function getContractReviewConfig(): Promise<ContractReviewConfigPayload> {
  return contractReviewJsonFetch<ContractReviewConfigPayload>("/api/config");
}

// 获取历史记录列表；limit 控制最多返回条数，返回值只包含历史元数据。
export async function getReviewHistory(limit = 30): Promise<{ items?: ContractReviewHistoryApiItem[] }> {
  return contractReviewJsonFetch<{ items?: ContractReviewHistoryApiItem[] }>(`/api/reviews/history?limit=${encodeURIComponent(String(limit))}`);
}

// 获取单个审查任务状态；runId 是后端生成的运行 ID，返回任务元数据。
export async function getReviewStatus(runId: string, init: RequestInit = {}): Promise<ReviewMeta> {
  return contractReviewJsonFetch<ReviewMeta>(`/api/reviews/${encodeURIComponent(runId)}`, init);
}

// 获取审查结果；后端返回已适配展示的明文结果，不暴露组件层脱敏映射细节。
export async function getReviewResult(runId: string, init: RequestInit = {}): Promise<ReviewResultPayload> {
  return contractReviewJsonFetch<ReviewResultPayload>(`/api/reviews/${encodeURIComponent(runId)}/result`, init);
}

// 获取审查文档响应；调用方负责将响应转换为 File 或触发下载。
export async function getReviewDocumentResponse(runId: string, init: RequestInit = {}): Promise<Response> {
  return contractReviewFetch(`/api/reviews/${encodeURIComponent(runId)}/document`, init);
}

// 创建合同审查任务；form 包含上传文件、审查立场、合同类型和分析范围。
export async function createReview(form: FormData): Promise<{ run_id: string } & Record<string, unknown>> {
  return contractReviewJsonFetch<{ run_id: string } & Record<string, unknown>>("/api/reviews", {
    method: "POST",
    body: form,
  });
}

// 更新单个风险状态；status 支持 pending、accepted、rejected。
export async function patchRiskStatus(
  runId: string,
  riskId: string | number,
  status: "pending" | "accepted" | "rejected",
): Promise<RiskMutationPayload> {
  return contractReviewJsonFetch<RiskMutationPayload>(`/api/reviews/${encodeURIComponent(runId)}/risks/${encodeURIComponent(String(riskId))}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

// 接受 AI 改写；targetText/revisedText 是前端实际定位并确认的文本。
export async function acceptRiskAi(
  runId: string,
  riskId: string | number,
  payload: { revisedText?: string; targetText?: string },
): Promise<RiskMutationPayload> {
  return contractReviewJsonFetch<RiskMutationPayload>(`/api/reviews/${encodeURIComponent(runId)}/risks/${encodeURIComponent(String(riskId))}/ai_accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revised_text: payload.revisedText || "", target_text: payload.targetText || undefined }),
  });
}

// 编辑 AI 改写建议；返回后端归一化后的风险项。
export async function editRiskAi(
  runId: string,
  riskId: string | number,
  revisedText: string,
): Promise<RiskMutationPayload> {
  return contractReviewJsonFetch<RiskMutationPayload>(`/api/reviews/${encodeURIComponent(runId)}/risks/${encodeURIComponent(String(riskId))}/ai_edit`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revised_text: revisedText }),
  });
}

// 编辑 AI 改写建议并保留原始响应；用于兼容旧后端 404 降级判断。
export async function editRiskAiResponse(
  runId: string,
  riskId: string | number,
  revisedText: string,
): Promise<Response> {
  return contractReviewFetch(`/api/reviews/${encodeURIComponent(runId)}/risks/${encodeURIComponent(String(riskId))}/ai_edit`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revised_text: revisedText }),
  });
}

// 拒绝 AI 改写建议；返回更新后的风险项。
export async function rejectRiskAi(runId: string, riskId: string | number): Promise<RiskMutationPayload> {
  return contractReviewJsonFetch<RiskMutationPayload>(`/api/reviews/${encodeURIComponent(runId)}/risks/${encodeURIComponent(String(riskId))}/ai_reject`, {
    method: "POST",
  });
}

// 拒绝 AI 改写建议并保留原始响应；用于兼容旧后端 404 降级判断。
export async function rejectRiskAiResponse(runId: string, riskId: string | number): Promise<Response> {
  return contractReviewFetch(`/api/reviews/${encodeURIComponent(runId)}/risks/${encodeURIComponent(String(riskId))}/ai_reject`, {
    method: "POST",
  });
}

// 生成单个风险的 AI 改写建议；返回更新后的风险项。
export async function applyRiskAi(runId: string, riskId: string | number): Promise<RiskMutationPayload> {
  return contractReviewJsonFetch<RiskMutationPayload>(`/api/reviews/${encodeURIComponent(runId)}/risks/${encodeURIComponent(String(riskId))}/ai_apply`, {
    method: "POST",
  });
}

function normalizeRequestBody(body: BodyInit | null | undefined, headers?: HeadersInit) {
  if (body === undefined || body === null || body instanceof FormData) {
    return body ?? undefined;
  }
  if (typeof body !== "string") {
    return body;
  }
  const contentType = new Headers(headers).get("Content-Type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return body;
  }
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

type ContractReviewErrorEnvelope = {
  detail?: unknown;
  error?: {
    code?: string;
    title?: string;
    message?: string;
    user_message?: string;
    status?: number;
  };
  code?: string;
  message?: string;
};

async function buildContractReviewApiError(response: Response) {
  const rawText = await response.text();
  let payload: ContractReviewErrorEnvelope | null = null;

  try {
    payload = rawText ? (JSON.parse(rawText) as ContractReviewErrorEnvelope) : null;
  } catch {
    payload = null;
  }

  const error = new Error(pickErrorText(payload?.error?.message || payload?.error?.user_message || payload?.message || payload?.detail || rawText) || response.statusText || "请求失败") as Error & {
    title?: string;
    status?: number;
    code?: string;
  };
  error.status = response.status;
  error.code = String(payload?.error?.code || payload?.code || `HTTP_${response.status}`).trim();
  error.title = String(payload?.error?.title || "").trim() || undefined;
  return error;
}

function pickErrorText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value.map((item) => pickErrorText(item)).filter(Boolean).join("；");
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["user_message", "message", "detail", "msg"]) {
      const text = pickErrorText(record[key]);
      if (text) return text;
    }
  }
  return String(value).trim();
}
