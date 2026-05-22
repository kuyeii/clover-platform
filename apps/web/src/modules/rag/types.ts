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
