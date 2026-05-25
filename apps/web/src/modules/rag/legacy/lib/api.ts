import {
  createFileDocument,
  createTextDocument,
  deleteKnowledgeDocument,
  fetchConversationsBootstrap,
  fetchKnowledgeDocumentDetail,
  fetchKnowledgeDocuments,
  putConversationsSync,
  streamChatCompletion,
} from "../../services/ragApi";

export {
  createFileDocument,
  createTextDocument,
  deleteKnowledgeDocument,
  fetchConversationsBootstrap,
  fetchKnowledgeDocumentDetail,
  fetchKnowledgeDocuments,
  putConversationsSync,
  streamChatCompletion,
};

export type {
  ConversationsBootstrapPayload,
  Conversation,
  CreateKnowledgeDocumentResult as CreateTextDocumentResult,
  KnowledgeDocumentDetail,
  KnowledgeDocumentDetailResponse,
  KnowledgeDocumentItem,
  KnowledgeSegmentItem,
  KnowledgeDocumentsResponse,
  StreamEvent,
} from "../../types";
