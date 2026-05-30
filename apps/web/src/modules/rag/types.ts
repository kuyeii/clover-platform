export type ChatRole = "user" | "assistant";

export interface AssistantSnapshot {
  id: string;
  content: string;
  stopped?: boolean;
}

export interface UserTurnSnapshot {
  userContent: string;
  assistant: AssistantSnapshot;
}

export interface AssistantVariant {
  content: string;
  stopped?: boolean;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  stopped?: boolean;
  editHistory?: UserTurnSnapshot[];
  activeVersionIndex?: number;
  regenerateVersions?: AssistantVariant[];
  activeRegenerateIndex?: number;
}

export interface Conversation {
  id: string;
  title: string;
  sessionId: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  pinnedAt?: number;
}

export interface ConversationsBootstrapPayload {
  conversations: Conversation[];
  activeConversationId: string | null;
}

export type StreamEvent =
  | { type: "session"; session_id: string; request_id?: string }
  | { type: "delta"; text: string }
  | { type: "done"; request_id?: string }
  | { type: "error"; detail: string; request_id?: string }
  | { type: string; [key: string]: unknown };

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
  source_type?: string | null;
  mime_type?: string | null;
  file_size?: number | null;
  parse_status?: "pending" | "parsed" | "failed" | string | null;
  privacy_status?: "pending" | "recognized" | "failed" | string | null;
  has_sensitive?: boolean | null;
  sensitive_count?: number | null;
  sensitive_types?: string[] | null;
  recognition_summary?: {
    counts_by_type?: Record<string, number>;
    truncated?: boolean;
    [key: string]: unknown;
  } | null;
  sync_status?: "pending" | "syncing" | "synced" | "failed" | string | null;
  dify_document_id?: string | null;
  pipt_request_id?: string | null;
  pipt_mapping_count?: number | null;
  last_error?: string | null;
  parsed_at?: number | null;
  synced_at?: number | null;
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
  document?: KnowledgeDocumentItem;
  skipped?: boolean;
  desensitized?: boolean;
  dify_document_id?: string | null;
  mapping_table_count?: number;
  request_id?: string | null;
}
