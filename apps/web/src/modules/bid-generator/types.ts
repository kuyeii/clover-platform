export type BidProjectStatus =
  | "uploading"
  | "parsing"
  | "parsing_report"
  | "report_done"
  | "reviewing"
  | "generating_outline"
  | "outline_ready"
  | "tech_proposal"
  | "editing"
  | "generating_content"
  | "tech_done"
  | "bid_assembling"
  | "bid_done"
  | "exporting"
  | "done"
  | string;

export interface BidRequirement {
  id?: string;
  type?: "tech" | "biz" | "score" | string;
  content?: string;
  points?: number | null;
  source_excerpt?: string;
  source_pages?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface BidAnalysisNode {
  id: string;
  label?: string;
  title?: string;
  content?: string;
  parent_id?: string | null;
  parentId?: string | null;
  children?: BidAnalysisNode[];
  [key: string]: unknown;
}

export interface BidOutlineSection {
  id: string;
  title?: string;
  wordCount?: number;
  writingHint?: string;
  keywords?: string[];
  headingLevel?: number;
  children?: BidOutlineSection[];
  [key: string]: unknown;
}

export interface BidProjectTaskRuntime {
  state?: string;
  taskId?: string;
  taskType?: string;
  message?: string;
  progress?: number;
  startedAt?: string;
  cancellable?: boolean;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface BidProjectData {
  id?: string;
  name?: string;
  bidFileName?: string;
  status?: BidProjectStatus;
  createdAt?: string;
  updatedAt?: string;
  bidType?: string;
  summary?: string;
  project_summary?: string;
  pdfUrl?: string;
  pdf_url?: string;
  rawDocument?: string;
  raw_document?: string;
  requirements?: BidRequirement[];
  analysisReport?: BidAnalysisNode[];
  analysis_report?: BidAnalysisNode[];
  analysisV2?: Record<string, unknown>;
  analysis_v2?: Record<string, unknown>;
  outline?: BidOutlineSection[];
  mappingTable?: Record<string, string>;
  mapping_table?: Record<string, string>;
  placeholderManifest?: Record<string, Record<string, string>>;
  placeholder_manifest?: Record<string, Record<string, string>>;
  placeholderPolicy?: Record<string, unknown>;
  placeholder_policy?: Record<string, unknown>;
  imageMap?: Record<string, string | BidImageAsset>;
  image_map?: Record<string, string | BidImageAsset>;
  entityCount?: number;
  entity_count?: number;
  requiredAttachments?: Array<Record<string, unknown>>;
  required_attachments?: Array<Record<string, unknown>>;
  scoringTableTemplate?: Array<Record<string, unknown>>;
  scoring_table_template?: Array<Record<string, unknown>>;
  scoringRows?: Array<Record<string, unknown>>;
  generatedContent?: Record<string, BidGeneratedContent>;
  taskRuntime?: BidProjectTaskRuntime;
  bidAttachmentList?: Array<Record<string, unknown>>;
  bidModules?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface BidProjectRecord {
  id: string;
  name: string;
  status: BidProjectStatus;
  data: BidProjectData;
  created_at?: string;
  updated_at?: string;
}

export interface BidGeneratedContent {
  status?: string;
  content?: string;
  wordCount?: number;
  word_count?: number;
  qualityScore?: number;
  feedback?: string;
  error?: string;
  stage?: string;
  [key: string]: unknown;
}

export interface BidImageAsset {
  abs_path?: string;
  preview_url?: string;
  description?: string;
  [key: string]: unknown;
}

export interface BidExtractResponse {
  bid_type?: string;
  project_summary?: string;
  requirements?: BidRequirement[];
  analysis_report?: BidAnalysisNode[];
  analysis_v2?: Record<string, unknown>;
  mapping_table?: Record<string, string>;
  placeholder_manifest?: Record<string, Record<string, string>>;
  placeholder_policy?: Record<string, unknown>;
  entity_count?: number;
  image_map?: Record<string, string | BidImageAsset>;
  required_attachments?: Array<Record<string, unknown>>;
  scoring_table_template?: Array<Record<string, unknown>>;
  raw_document?: string;
  pdf_url?: string;
  expected_word_count?: number | null;
  expected_chapter_count?: number | null;
  [key: string]: unknown;
}

export interface BidWorkflowStatusItem {
  label?: string;
  env_var?: string;
  configured?: boolean;
  source?: string;
  managed?: boolean;
  lifecycle?: string;
}

export interface BidKnowledgeDocument {
  id: string;
  name: string;
  size?: string;
  uploadTime?: string;
  status?: string;
  chunks?: number;
}

export interface BidKnowledgeResponse {
  dataset_info?: Record<string, unknown>;
  documents?: BidKnowledgeDocument[];
}

export interface BidKnowledgeSyncResponse {
  message?: string;
  status?: string;
  task_id?: string;
  job_id?: string;
}

export interface BidKbSyncJob {
  job_id?: string;
  task_id?: string;
  status?: string;
  started_at?: string;
  total?: number;
  processed?: number;
  failed?: number;
  current_file?: string;
  error?: string;
  [key: string]: unknown;
}

export interface BidTaskStatus {
  task_id?: string;
  status?: string;
  state?: string;
  progress?: number;
  current_stage?: string;
  stages?: string[];
  result?: Record<string, unknown> | null;
  partial_result?: Record<string, unknown> | null;
  partial_events?: Array<Record<string, unknown>>;
  error?: string | null;
  cancelled?: boolean;
  timed_out?: boolean;
  cancellable?: boolean;
  started_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface BidStreamEvent {
  event: string;
  data: Record<string, unknown>;
}

export interface DownloadedBlob {
  blob: Blob;
  fileName: string;
}
