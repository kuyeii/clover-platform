export type ReviewSideOption = "甲方" | "乙方";
export type AnalysisScopeOption = "full_detail" | "high_risk_only";
export type ReviewRunStatus = "queued" | "running" | "completed" | "failed" | string;
export type RiskStatus = "pending" | "accepted" | "rejected" | "ai_applied" | string;
export type AiRewriteDecision = "proposed" | "accepted" | "rejected" | string;

export interface ContractReviewHealth {
  status?: string;
  service?: string;
  [key: string]: unknown;
}

export interface ContractReviewConfig {
  review_side?: ReviewSideOption | string;
  contract_type_hint?: string;
  analysis_scope?: AnalysisScopeOption | string;
  analysis_scope_label?: string;
  [key: string]: unknown;
}

export interface ConverterDiagnostics {
  libreoffice?: unknown;
  pdf2docx?: unknown;
  pymupdf?: unknown;
  [key: string]: unknown;
}

export interface ReviewMeta {
  run_id: string;
  status: ReviewRunStatus;
  file_name?: string;
  review_side?: string;
  contract_type_hint?: string;
  analysis_scope?: AnalysisScopeOption | string;
  analysis_scope_label?: string;
  step?: string;
  progress?: number;
  message?: string;
  error?: string;
  warning?: string;
  error_code?: string;
  error_detail?: string;
  document_ready?: boolean;
  original_format?: string;
  working_file_name?: string;
  converted?: boolean;
  updated_at?: string;
}

export interface ReviewHistoryItem {
  run_id: string;
  file_name?: string;
  status: ReviewRunStatus;
  step?: string;
  updated_at?: string;
  document_ready?: boolean;
}

export interface Clause {
  clause_uid?: string;
  segment_id?: string;
  segment_title?: string;
  clause_id?: string;
  display_clause_id?: string;
  clause_title?: string;
  clause_text?: string;
  clause_kind?: string;
  source_excerpt?: string;
  [key: string]: unknown;
}

export interface AiRewritePayload {
  state?: string;
  edit_type?: string;
  target_text?: string;
  revised_text?: string;
  rationale?: string;
  comment_text?: string;
  applied_at?: string;
  created_at?: string;
  workflow_kind?: string;
  patch_ops?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface RiskItem {
  risk_id: number | string;
  dimension?: string;
  risk_label?: string;
  risk_level?: "high" | "medium" | "low" | string;
  issue?: string;
  basis?: string;
  basis_minimal?: string;
  basis_summary?: string;
  evidence_text?: string;
  suggestion?: string;
  suggestion_minimal?: string;
  suggestion_optimized?: string;
  evidence_confidence?: number | null;
  quality_flags?: string[];
  related_clause_ids?: string[];
  related_clause_uids?: string[];
  clause_id?: string;
  anchor_text?: string;
  status?: RiskStatus;
  clause_uid?: string;
  clause_uids?: string[];
  display_clause_ids?: string[];
  is_multi_clause_risk?: boolean;
  risk_source_type?: string;
  ai_apply?: AiRewritePayload;
  ai_rewrite?: AiRewritePayload;
  ai_rewrite_decision?: AiRewriteDecision;
  accepted_patch?: unknown;
  [key: string]: unknown;
}

export interface ReviewResultPayload {
  run_id: string;
  status: ReviewRunStatus;
  file_name?: string;
  review_side?: string;
  contract_type_hint?: string;
  analysis_scope?: AnalysisScopeOption | string;
  analysis_scope_label?: string;
  merged_clauses?: Clause[];
  risk_result_validated?: {
    is_valid?: boolean;
    error_message?: string;
    risk_result?: {
      risk_items?: RiskItem[];
    };
  };
  download_ready?: boolean;
  download_url?: string | null;
  [key: string]: unknown;
}

export interface CreateReviewInput {
  file: File;
  reviewSide: ReviewSideOption;
  contractTypeHint: string;
  analysisScope: AnalysisScopeOption;
}

export interface CreateReviewResponse {
  run_id: string;
  status: ReviewRunStatus;
}

export interface RiskMutationResponse {
  ok: boolean;
  item?: RiskItem;
  risk_items?: RiskItem[];
  summary?: Record<string, number>;
}

export interface DownloadedBlob {
  blob: Blob;
  fileName: string;
}
