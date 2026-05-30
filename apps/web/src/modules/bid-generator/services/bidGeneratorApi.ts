import { ApiRequestError, apiClient, getApiBaseUrl } from "../../../shared/api/client";
import { getAccessToken, getClientId } from "../../../shared/auth/token";
import type {
  BidExtractResponse,
  BidKbSyncJob,
  BidKnowledgeResponse,
  BidKnowledgeSyncResponse,
  BidOutlineSection,
  BidProjectData,
  BidProjectRecord,
  BidStreamEvent,
  BidTaskStatus,
  BidWorkflowStatusItem,
  DownloadedBlob,
} from "../types";

const API_PREFIX = "/bid-generator/api";
const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DIAGRAM_GENERATION_ENABLED = String(import.meta.env.VITE_ENABLE_DIAGRAM_GENERATION || "").toLowerCase() === "true";
const DIAGRAM_MAX_PER_PROJECT = (() => {
  const value = Number(import.meta.env.VITE_MAX_DIAGRAMS || 3);
  return Number.isFinite(value) && value > 0 ? value : 3;
})();

type RequestControl = {
  signal?: AbortSignal;
};

type StreamEventHandler = (event: BidStreamEvent) => void | Promise<void>;

type PlaceholderManifest = Record<string, Record<string, string>>;
type PlaceholderPolicy = Record<string, unknown>;

function findOutlineSection(
  outline: BidOutlineSection[] | undefined | null,
  sectionId: string,
): BidOutlineSection | undefined {
  if (!outline?.length || !sectionId) return undefined;
  for (const section of outline) {
    if (section.id === sectionId) return section;
    const nested = findOutlineSection(section.children, sectionId);
    if (nested) return nested;
  }
  return undefined;
}

function resolveSectionDiagramMeta(
  outline: BidOutlineSection[] | undefined | null,
  sectionId: string,
): { needDiagram: boolean; diagramBrief: string; diagramTypeHint: string; diagramPriority: number } {
  const section = findOutlineSection(outline, sectionId);
  return {
    needDiagram: Boolean(section?.needDiagram ?? section?.need_diagram ?? false),
    diagramBrief: String(section?.diagramBrief ?? section?.diagram_brief ?? "").trim(),
    diagramTypeHint: String(section?.diagramTypeHint ?? section?.diagram_type_hint ?? "architecture").trim() || "architecture",
    diagramPriority: Number(section?.diagramPriority ?? section?.diagram_priority ?? 0) || 0,
  };
}

function buildOutlineNeighborhoodSlice(
  outline: BidOutlineSection[] | undefined | null,
  sectionId: string,
  fallbackOutline: string,
): string {
  if (!outline?.length || !sectionId) return fallbackOutline || "";

  const markCurrent = (title: string, depth: number): string => {
    const indent = depth > 0 ? "  ".repeat(depth) : "";
    return `${indent}[当前] ${title}`;
  };

  for (let i = 0; i < outline.length; i += 1) {
    const section = outline[i];
    if (section.id === sectionId) {
      const lines: string[] = [];
      const sectionStart = Math.max(0, i - 1);
      const sectionEnd = Math.min(outline.length - 1, i + 1);
      for (let index = sectionStart; index <= sectionEnd; index += 1) {
        lines.push(index === i ? markCurrent(outline[index].title || "", 0) : outline[index].title || "");
      }
      for (const child of section.children || []) lines.push(`  ${child.title || ""}`);
      return lines.filter(Boolean).join("\n");
    }

    const children = section.children || [];
    for (let j = 0; j < children.length; j += 1) {
      const child = children[j];
      if (child.id === sectionId) {
        const lines: string[] = [section.title || ""].filter(Boolean);
        const childStart = Math.max(0, j - 1);
        const childEnd = Math.min(children.length - 1, j + 1);
        for (let index = childStart; index <= childEnd; index += 1) {
          const title = children[index].title || "";
          lines.push(index === j ? markCurrent(title, 1) : `  ${title}`);
        }
        for (const grandChild of child.children || []) lines.push(`    ${grandChild.title || ""}`);
        return lines.filter(Boolean).join("\n");
      }

      const grandChildren = child.children || [];
      for (let k = 0; k < grandChildren.length; k += 1) {
        const grandChild = grandChildren[k];
        if (grandChild.id === sectionId) {
          const lines: string[] = [section.title || "", `  ${child.title || ""}`].filter(Boolean);
          const grandChildStart = Math.max(0, k - 1);
          const grandChildEnd = Math.min(grandChildren.length - 1, k + 1);
          for (let index = grandChildStart; index <= grandChildEnd; index += 1) {
            const title = grandChildren[index].title || "";
            lines.push(index === k ? markCurrent(title, 2) : `    ${title}`);
          }
          return lines.filter(Boolean).join("\n");
        }
      }
    }
  }

  return fallbackOutline || "";
}

export function fetchBidHealth(options: RequestControl = {}) {
  return apiClient.get<{ status?: string; service?: string }>("/bid-generator/health", {
    signal: options.signal,
    unwrapEnvelope: false,
  });
}

export function fetchWorkflowStatus(options: RequestControl = {}) {
  return apiClient.get<Record<string, BidWorkflowStatusItem>>(`${API_PREFIX}/config/workflow-status`, {
    signal: options.signal,
    unwrapEnvelope: false,
  });
}

export function fetchAnalysisFramework(options: RequestControl = {}) {
  return apiClient.get<{ framework?: unknown[] } | unknown[]>(`${API_PREFIX}/config/analysis-framework`, {
    signal: options.signal,
    unwrapEnvelope: false,
  });
}

export function fetchSupportedEntities(options: RequestControl = {}) {
  return apiClient.get<{ entities?: Record<string, string>; description?: string }>(`${API_PREFIX}/entities`, {
    signal: options.signal,
    unwrapEnvelope: false,
  });
}

export function listProjects(options: RequestControl = {}) {
  return apiClient.get<BidProjectRecord[]>(`${API_PREFIX}/projects`, {
    signal: options.signal,
    unwrapEnvelope: false,
  });
}

export function getProject(projectId: string, options: RequestControl = {}) {
  return apiClient.get<BidProjectRecord>(`${API_PREFIX}/projects/${encodeURIComponent(projectId)}`, {
    signal: options.signal,
    unwrapEnvelope: false,
  });
}

export function createProject(data: BidProjectData) {
  const projectId = String(data.id || createProjectId());
  const projectName = String(data.name || "未命名标书项目");
  const status = String(data.status || "uploading");
  return apiClient.post<BidProjectRecord>(
    `${API_PREFIX}/projects`,
    {
      id: projectId,
      name: projectName,
      status,
      data: {
        ...data,
        id: projectId,
        name: projectName,
        status,
      },
    },
    { unwrapEnvelope: false },
  );
}

export function updateProject(projectId: string, patch: Partial<Pick<BidProjectRecord, "name" | "status">> & { data?: BidProjectData }) {
  return apiClient.put<BidProjectRecord>(
    `${API_PREFIX}/projects/${encodeURIComponent(projectId)}`,
    patch,
    { unwrapEnvelope: false },
  );
}

export function patchProject(projectId: string, dataPatch: BidProjectData, status?: string, name?: string) {
  return apiClient.patch<BidProjectRecord>(
    `${API_PREFIX}/projects/${encodeURIComponent(projectId)}`,
    {
      ...(name ? { name } : {}),
      ...(status ? { status } : {}),
      data_patch: dataPatch,
    },
    { unwrapEnvelope: false },
  );
}

export async function deleteProject(projectId: string): Promise<void> {
  await apiClient.delete<void>(`${API_PREFIX}/projects/${encodeURIComponent(projectId)}`, {
    unwrapEnvelope: false,
  });
}

export async function deleteProjectCaches(projectId: string): Promise<void> {
  await apiClient.delete<void>(`${API_PREFIX}/projects/${encodeURIComponent(projectId)}/caches`, {
    unwrapEnvelope: false,
  });
}

export function fetchProjectMappings(projectId: string, options: RequestControl = {}) {
  return apiClient.get<{ mappings?: Record<string, string>; count?: number }>(
    `${API_PREFIX}/projects/${encodeURIComponent(projectId)}/mappings`,
    { signal: options.signal, unwrapEnvelope: false },
  );
}

export function desensitizeText(input: {
  text: string;
  profile?: string;
  method?: string;
  targetEntities?: string[];
  sessionId?: string;
  placeholderProtocol?: "legacy" | "strong";
}) {
  return apiClient.post<{
    desensitized_text: string;
    mapping_table?: Record<string, string>;
    placeholder_manifest?: PlaceholderManifest;
    placeholder_policy?: PlaceholderPolicy;
    entity_count?: number;
    entities?: unknown[];
  }>(
    `${API_PREFIX}/desensitize`,
    {
      text: input.text,
      profile: input.profile || "tender",
      method: input.method || "placeholder",
      target_entities: input.targetEntities?.length ? input.targetEntities : undefined,
      session_id: input.sessionId || "apps-web-bid-generator",
      placeholder_protocol: input.placeholderProtocol || "strong",
    },
    { unwrapEnvelope: false },
  );
}

export function restoreText(text: string, sessionId = "apps-web-bid-generator") {
  return apiClient.post<{ restored_text: string; restored_count?: number }>(
    `${API_PREFIX}/restore`,
    { text, session_id: sessionId },
    { unwrapEnvelope: false },
  );
}

export function extractRequirements(input: {
  file: File;
  projectId: string;
  projectName: string;
  enableDesensitize: boolean;
  useVisionParsing: boolean;
}) {
  const form = new FormData();
  form.append("file", input.file);
  form.append("project_id", input.projectId);
  form.append("project_name", input.projectName);
  form.append("enable_desensitize", String(input.enableDesensitize));
  form.append("desensitize_profile", "tender");
  form.append("use_vision_parsing", String(input.useVisionParsing));
  return apiClient.post<BidExtractResponse>(`${API_PREFIX}/projects/extract`, form, {
    unwrapEnvelope: false,
  });
}

export async function streamExtractRequirements(
  input: {
    file: File;
    projectId: string;
    projectName: string;
    enableDesensitize: boolean;
    useVisionParsing: boolean;
  },
  onEvent: StreamEventHandler,
  signal?: AbortSignal,
) {
  const form = new FormData();
  form.append("file", input.file);
  form.append("project_id", input.projectId);
  form.append("project_name", input.projectName);
  form.append("enable_desensitize", String(input.enableDesensitize));
  form.append("desensitize_profile", "tender");
  form.append("use_vision_parsing", String(input.useVisionParsing));
  await streamRequest(`${API_PREFIX}/projects/extract-stream`, { method: "POST", body: form, signal }, onEvent);
}

export async function startAnalyzeTask(projectId: string, selectedNodeIds: string[] = []) {
  const form = new FormData();
  form.append("project_id", projectId);
  if (selectedNodeIds.length) {
    form.append("selected_node_ids", selectedNodeIds.join(","));
  }
  return apiClient.post<{ task_id: string }>(`${API_PREFIX}/tasks/start-analyze`, form, {
    unwrapEnvelope: false,
  });
}

export async function startExtractTask(projectId: string, file: File, projectName: string) {
  const form = new FormData();
  form.append("file", file);
  form.append("project_id", projectId);
  form.append("project_name", projectName);
  form.append("enable_desensitize", "true");
  form.append("desensitize_profile", "tender");
  return apiClient.post<{ task_id: string }>(`${API_PREFIX}/tasks/start-extract`, form, {
    unwrapEnvelope: false,
  });
}

export async function startOutlineTask(project: BidProjectRecord, expectedTotalWords = 0) {
  const data = normalizeProjectData(project);
  const enableDiagrams = DIAGRAM_GENERATION_ENABLED;
  return apiClient.post<{ task_id: string }>(
    `${API_PREFIX}/tasks/start-outline`,
    {
      project_id: project.id,
      requirements: data.requirements || [],
      bid_type: data.bidType || "tech",
      use_knowledge: true,
      analysis_context: buildAnalysisContext(data.analysisReport || data.analysis_report || []),
      expected_total_words: expectedTotalWords,
      enable_diagrams: enableDiagrams,
      max_diagrams: enableDiagrams ? DIAGRAM_MAX_PER_PROJECT : 0,
      structure_heading_seed_json: JSON.stringify(
        (data.analysisV2 as { bid_structure?: { technical_sections?: unknown[] } } | undefined)?.bid_structure?.technical_sections || [],
      ),
      technical_h2_bindings_json: JSON.stringify(
        (data.analysisV2 as { technical_h2_bindings?: unknown[] } | undefined)?.technical_h2_bindings || [],
      ),
      technical_targets_json: JSON.stringify(
        (data.analysisV2 as { technical_targets?: unknown[] } | undefined)?.technical_targets || [],
      ),
    },
    { unwrapEnvelope: false },
  );
}

export async function getTaskStatus(taskId: string, projectId?: string, options: RequestControl = {}) {
  return apiClient.get<BidTaskStatus>(`${API_PREFIX}/tasks/${encodeURIComponent(taskId)}/status`, {
    query: projectId ? { project_id: projectId } : undefined,
    signal: options.signal,
    unwrapEnvelope: false,
  });
}

export async function streamTaskProgress(
  taskId: string,
  projectId: string,
  onEvent: StreamEventHandler,
  signal?: AbortSignal,
) {
  await streamRequest(
    `${API_PREFIX}/tasks/${encodeURIComponent(taskId)}/progress?project_id=${encodeURIComponent(projectId)}`,
    { method: "GET", signal },
    onEvent,
  );
}

export function cancelTask(taskId: string, projectId?: string) {
  return apiClient.post<Record<string, unknown>>(
    `${API_PREFIX}/tasks/${encodeURIComponent(taskId)}/cancel`,
    undefined,
    {
      query: projectId ? { project_id: projectId } : undefined,
      unwrapEnvelope: false,
    },
  );
}

export async function streamGenerateOutline(
  project: BidProjectRecord,
  expectedTotalWords: number,
  onEvent: StreamEventHandler,
  signal?: AbortSignal,
) {
  const data = normalizeProjectData(project);
  const enableDiagrams = DIAGRAM_GENERATION_ENABLED;
  await streamJsonRequest(
    `${API_PREFIX}/projects/generate-outline-stream`,
    {
      project_id: project.id,
      requirements: data.requirements || [],
      bid_type: data.bidType || "tech",
      use_knowledge: true,
      expected_total_words: expectedTotalWords,
      analysis_context: buildAnalysisContext(data.analysisReport || data.analysis_report || []),
      structure_heading_seed_json: JSON.stringify(
        (data.analysisV2 as { bid_structure?: { technical_sections?: unknown[] } } | undefined)?.bid_structure?.technical_sections || [],
      ),
      technical_h2_bindings_json: JSON.stringify(
        (data.analysisV2 as { technical_h2_bindings?: unknown[] } | undefined)?.technical_h2_bindings || [],
      ),
      technical_targets_json: JSON.stringify(
        (data.analysisV2 as { technical_targets?: unknown[] } | undefined)?.technical_targets || [],
      ),
      enable_diagrams: enableDiagrams,
      max_diagrams: enableDiagrams ? DIAGRAM_MAX_PER_PROJECT : 0,
    },
    onEvent,
    signal,
  );
}

export async function streamGenerateContent(
  input: {
    project: BidProjectRecord;
    sectionId: string;
    sectionTitle: string;
    writingHint: string;
    expectedWords: number;
    globalOutline: string;
  },
  onEvent: StreamEventHandler,
  signal?: AbortSignal,
) {
  const data = normalizeProjectData(input.project);
  const enableDiagrams = DIAGRAM_GENERATION_ENABLED;
  const sectionOutlineSlice = buildOutlineNeighborhoodSlice(data.outline, input.sectionId, input.globalOutline);
  const diagramMeta = resolveSectionDiagramMeta(data.outline, input.sectionId);
  await streamJsonRequest(
    `${API_PREFIX}/projects/generate-content-stream`,
    {
      project_id: input.project.id,
      section_id: input.sectionId,
      section_title: input.sectionTitle,
      writing_hint: input.writingHint,
      expected_words: input.expectedWords,
      project_summary: data.summary || data.project_summary || "",
      global_outline: input.globalOutline,
      section_outline_slice: sectionOutlineSlice || input.sectionTitle,
      requires_search: false,
      placeholder_hint: buildPlaceholderHint(
        data.mappingTable || data.mapping_table || {},
        data.placeholderManifest || data.placeholder_manifest || {},
      ),
      analysis_context: buildAnalysisContext(data.analysisReport || data.analysis_report || []),
      generation_strategy: "general",
      enable_diagrams: enableDiagrams,
      max_diagrams: enableDiagrams ? DIAGRAM_MAX_PER_PROJECT : 0,
      need_diagram: enableDiagrams && diagramMeta.needDiagram,
      diagram_brief: enableDiagrams ? diagramMeta.diagramBrief : "",
      diagram_type_hint: diagramMeta.diagramTypeHint,
      diagram_priority: diagramMeta.diagramPriority,
      mapping_table: data.mappingTable || data.mapping_table || {},
      bidder_info: data.bidderInfo || {},
    },
    onEvent,
    signal,
  );
}

export function analyzeNode(projectId: string, nodeId: string, nodeLabel: string, extractionPrompt = "") {
  return streamJsonResponse(`${API_PREFIX}/projects/${encodeURIComponent(projectId)}/analyze-node`, {
    node_id: nodeId,
    node_label: nodeLabel,
    extraction_prompt: extractionPrompt,
  });
}

export function saveAnalysisReport(projectId: string, nodes: unknown[]) {
  return apiClient.post<Record<string, unknown>>(
    `${API_PREFIX}/projects/${encodeURIComponent(projectId)}/analysis-report`,
    { analysis_report: nodes },
    { unwrapEnvelope: false },
  );
}

export function loadAnalysisReport(projectId: string, options: RequestControl = {}) {
  return apiClient.get<{ analysis_report?: unknown[]; analysis_v2?: Record<string, unknown> }>(
    `${API_PREFIX}/projects/${encodeURIComponent(projectId)}/analysis-report`,
    { signal: options.signal, unwrapEnvelope: false },
  );
}

export async function fetchProjectPdf(projectId: string): Promise<DownloadedBlob> {
  const response = await apiClient.raw("GET", `${API_PREFIX}/projects/pdf/${encodeURIComponent(projectId)}`, {
    headers: { Accept: "application/pdf" },
  });
  return {
    blob: await response.blob(),
    fileName: pickFileNameFromDisposition(response.headers.get("Content-Disposition"), `${projectId}.pdf`),
  };
}

export async function fetchProtectedAsset(path: string): Promise<DownloadedBlob> {
  const response = await apiClient.raw("GET", normalizeApiAssetPath(path), {
    headers: { Accept: "image/*, application/octet-stream" },
  });
  return {
    blob: await response.blob(),
    fileName: pickFileNameFromDisposition(response.headers.get("Content-Disposition"), "asset"),
  };
}

export async function fetchSourceDocx(projectId: string): Promise<DownloadedBlob> {
  const response = await apiClient.raw("GET", `${API_PREFIX}/projects/${encodeURIComponent(projectId)}/source-docx`, {
    headers: { Accept: `${DOCX_MIME_TYPE}, application/octet-stream` },
  });
  return {
    blob: await response.blob(),
    fileName: pickFileNameFromDisposition(response.headers.get("Content-Disposition"), `${projectId}.docx`),
  };
}

export async function exportReport(projectName: string, nodes: unknown[]): Promise<DownloadedBlob> {
  const response = await apiClient.raw("POST", `${API_PREFIX}/projects/export-report`, {
    headers: { Accept: "application/pdf", "Content-Type": "application/json" },
    body: { project_name: projectName, nodes },
  });
  return {
    blob: await response.blob(),
    fileName: pickFileNameFromDisposition(response.headers.get("Content-Disposition"), `解析报告_${projectName}.pdf`),
  };
}

export async function exportScoringTable(projectName: string, rows: Array<Record<string, unknown>>): Promise<DownloadedBlob> {
  const response = await apiClient.raw("POST", `${API_PREFIX}/projects/export-scoring-table`, {
    headers: { Accept: `${XLSX_MIME_TYPE}, application/octet-stream`, "Content-Type": "application/json" },
    body: { project_name: projectName, rows },
  });
  return {
    blob: await response.blob(),
    fileName: pickFileNameFromDisposition(response.headers.get("Content-Disposition"), `${projectName}_评分表.xlsx`),
  };
}

export async function forgeDocument(project: BidProjectRecord): Promise<DownloadedBlob> {
  const data = normalizeProjectData(project);
  const sections = buildForgeSections(data);
  const response = await apiClient.raw("POST", `${API_PREFIX}/projects/forge-document`, {
    headers: { Accept: `${DOCX_MIME_TYPE}, application/octet-stream`, "Content-Type": "application/json" },
    body: {
      project_id: project.id,
      project_name: project.name,
      sections,
      scoring_rows: data.scoringRows || [],
      attachments: [],
      mapping_table: data.mappingTable || data.mapping_table || {},
      image_map: data.imageMap || data.image_map || {},
      bidder_info: data.bidderInfo || {},
    },
  });
  return {
    blob: await response.blob(),
    fileName: pickFileNameFromDisposition(response.headers.get("Content-Disposition"), `${project.name}_标书文件.docx`),
  };
}

export function fetchKnowledgeDocuments(options: RequestControl = {}) {
  return apiClient.get<BidKnowledgeResponse>(`${API_PREFIX}/knowledge/documents`, {
    signal: options.signal,
    unwrapEnvelope: false,
  });
}

export function syncKnowledge(docName?: string) {
  return apiClient.post<BidKnowledgeSyncResponse>(
    docName ? `${API_PREFIX}/knowledge/sync/${encodeURIComponent(docName)}` : `${API_PREFIX}/knowledge/sync`,
    undefined,
    { unwrapEnvelope: false },
  );
}

export function startKbSync(input: { filePrefix?: string; llmMode?: string } = {}) {
  return apiClient.post<BidKnowledgeSyncResponse>(
    `${API_PREFIX}/kb/sync`,
    {
      file_prefix: input.filePrefix || "",
      llm_mode: input.llmMode || "augment",
    },
    { unwrapEnvelope: false },
  );
}

export function fetchKbSyncStatus(jobId: string, options: RequestControl = {}) {
  return apiClient.get<BidKbSyncJob>(`${API_PREFIX}/kb/sync-status/${encodeURIComponent(jobId)}`, {
    signal: options.signal,
    unwrapEnvelope: false,
  });
}

export function fetchKbSyncJobs(options: RequestControl = {}) {
  return apiClient.get<{ jobs?: BidKbSyncJob[] }>(`${API_PREFIX}/kb/sync-jobs`, {
    signal: options.signal,
    unwrapEnvelope: false,
  });
}

export function normalizeProjectData(project: BidProjectRecord | null | undefined): BidProjectData {
  if (!project) {
    return {};
  }
  const data = project.data || {};
  return {
    ...data,
    id: data.id || project.id,
    name: data.name || project.name,
    status: data.status || project.status,
    createdAt: data.createdAt || project.created_at,
    updatedAt: data.updatedAt || project.updated_at,
    bidType: data.bidType || (data.bid_type as string | undefined) || "tech",
    summary: data.summary || data.project_summary,
    pdfUrl: data.pdfUrl || data.pdf_url,
    rawDocument: data.rawDocument || data.raw_document,
    requirements: data.requirements || [],
    analysisReport: data.analysisReport || data.analysis_report || [],
    analysisV2: data.analysisV2 || data.analysis_v2,
    mappingTable: data.mappingTable || data.mapping_table || {},
    placeholderManifest: data.placeholderManifest || data.placeholder_manifest || {},
    placeholderPolicy: data.placeholderPolicy || data.placeholder_policy || {},
    imageMap: data.imageMap || data.image_map || {},
    entityCount: Number(data.entityCount ?? data.entity_count ?? 0),
    requiredAttachments: data.requiredAttachments || data.required_attachments || [],
    scoringTableTemplate: data.scoringTableTemplate || data.scoring_table_template || [],
  };
}

export function mergeExtractIntoProject(project: BidProjectRecord, payload: BidExtractResponse, fileName?: string): BidProjectData {
  const current = normalizeProjectData(project);
  return {
    ...current,
    bidFileName: fileName || current.bidFileName,
    status: "report_done",
    bidType: payload.bid_type || current.bidType || "tech",
    summary: payload.project_summary || current.summary || "",
    project_summary: payload.project_summary || current.summary || "",
    requirements: payload.requirements || [],
    analysisReport: payload.analysis_report || [],
    analysis_report: payload.analysis_report || [],
    analysisV2: payload.analysis_v2 || current.analysisV2,
    analysis_v2: payload.analysis_v2 || current.analysisV2,
    mappingTable: payload.mapping_table || {},
    mapping_table: payload.mapping_table || {},
    placeholderManifest: payload.placeholder_manifest || {},
    placeholder_manifest: payload.placeholder_manifest || {},
    placeholderPolicy: payload.placeholder_policy || {},
    placeholder_policy: payload.placeholder_policy || {},
    entityCount: payload.entity_count || 0,
    entity_count: payload.entity_count || 0,
    imageMap: payload.image_map || {},
    image_map: payload.image_map || {},
    requiredAttachments: payload.required_attachments || [],
    required_attachments: payload.required_attachments || [],
    scoringTableTemplate: payload.scoring_table_template || [],
    scoring_table_template: payload.scoring_table_template || [],
    rawDocument: payload.raw_document || "",
    raw_document: payload.raw_document || "",
    pdfUrl: payload.pdf_url || "",
    pdf_url: payload.pdf_url || "",
    updatedAt: new Date().toISOString(),
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

export function createObjectUrlFromDownload(download: DownloadedBlob) {
  return URL.createObjectURL(download.blob);
}

function createProjectId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `bid-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function streamJsonRequest(
  path: string,
  body: Record<string, unknown>,
  onEvent: StreamEventHandler,
  signal?: AbortSignal,
) {
  await streamRequest(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    },
    onEvent,
  );
}

async function streamJsonResponse(path: string, body: Record<string, unknown>) {
  const events: BidStreamEvent[] = [];
  await streamJsonRequest(path, body, (event) => {
    events.push(event);
  });
  return events;
}

async function streamRequest(path: string, init: RequestInit, onEvent: StreamEventHandler) {
  const token = getAccessToken();
  const headers = new Headers(init.headers);
  if (!headers.has("Accept")) {
    headers.set("Accept", "text/event-stream, application/json");
  }
  headers.set("X-Portal-Client-Id", getClientId());
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(buildUrl(path), {
    ...init,
    headers,
    credentials: "include",
  });

  if (!response.ok || !response.body) {
    throw await buildStreamResponseError(response);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  const parseBlock = async (block: string) => {
    const event = parseSseBlock(block);
    if (event) {
      await onEvent(event);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      await parseBlock(part);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    await parseBlock(buffer);
  }
}

function parseSseBlock(block: string): BidStreamEvent | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim() || "message";
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }
  if (!dataLines.length) {
    return null;
  }
  const rawData = dataLines.join("\n");
  try {
    return { event, data: JSON.parse(rawData) as Record<string, unknown> };
  } catch {
    return { event, data: { text: rawData } };
  }
}

async function buildStreamResponseError(response: Response): Promise<ApiRequestError> {
  let message = `请求失败（HTTP ${response.status}）`;
  try {
    const payload = await response.clone().json();
    message = payload?.detail || payload?.message || payload?.error?.message || message;
  } catch {
    try {
      const text = await response.clone().text();
      if (text.trim()) {
        message = text.trim().slice(0, 300);
      }
    } catch {
      // Keep HTTP status fallback.
    }
  }
  return new ApiRequestError({
    status: response.status,
    code: `HTTP_${response.status}`,
    message,
    requestId: response.headers.get("X-Request-ID"),
  });
}

function buildUrl(path: string) {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  return `${getApiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

function normalizeApiAssetPath(path: string) {
  const value = String(path || "").trim();
  if (!value) {
    return `${API_PREFIX}/extracted-images/missing`;
  }
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      return `${url.pathname}${url.search}`;
    } catch {
      return value;
    }
  }
  if (value.startsWith("/api/v1/bid-generator/")) {
    return value.slice("/api/v1".length);
  }
  if (value.startsWith("/api/")) {
    return `${API_PREFIX}${value.slice("/api".length)}`;
  }
  return value.startsWith("/") ? value : `${API_PREFIX}/${value}`;
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

function buildAnalysisContext(nodes: unknown[]) {
  const lines: string[] = [];
  const visit = (items: unknown[]) => {
    for (const item of items) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const node = item as { label?: unknown; title?: unknown; content?: unknown; children?: unknown };
      const label = String(node.label || node.title || "解析节点");
      const content = String(node.content || "").trim();
      if (content) {
        lines.push(`### ${label}\n${content}`);
      }
      if (Array.isArray(node.children)) {
        visit(node.children);
      }
    }
  };
  visit(nodes);
  const value = lines.join("\n\n---\n\n");
  return value.length > 6000 ? `${value.slice(0, 6000)}\n\n...` : value;
}

function buildPlaceholderHint(mappingTable: Record<string, string>, manifest: PlaceholderManifest = {}) {
  const tokens = Object.keys(manifest || {}).length ? Object.keys(manifest) : Object.keys(mappingTable || {});
  if (!tokens.length) {
    return "";
  }
  const sample = tokens.slice(0, 8).join("、");
  const suffix = tokens.length > 8 ? " ..." : "";
  const contextRows = tokens.slice(0, 80).map((token) => {
    const meta = manifest[token] || {};
    const sourceContext = String(meta.source_context || "").trim();
    const tokenContext = String(meta.source_context_with_token || "").trim();
    const row: Record<string, string> = {
      token,
      entity_type: String(meta.entity_type || ""),
      role: String(meta.role || ""),
    };
    if (sourceContext) row.source_context = sourceContext;
    if (tokenContext) row.source_context_with_token = tokenContext;
    return row;
  });
  return [
    `文中含 ${tokens.length} 个本地脱敏占位符，统一使用 @@PIPT:v1:e000001:kxxxxxxxx@@ 强 token 样式，兼容历史 {{__PIPT_类型_序号__}} 格式。`,
    "这些 token 只代表安全语义，不包含真实敏感值；输出必须逐字原样保留，禁止改写、缩写、翻译、拆分或重新编号。",
    "可以参考 PIPT_TOKEN_CONTEXT_JSON 理解每个 token 的实体类型和上下文；引用时必须输出 token 本身。",
    `PIPT_ALLOWED_PLACEHOLDERS_JSON:${JSON.stringify(tokens)}`,
    `PIPT_TOKEN_CONTEXT_JSON:${JSON.stringify(contextRows)}`,
    sample ? `当前 token 示例：${sample}${suffix}` : "",
  ].filter(Boolean).join("\n");
}

function buildForgeSections(data: BidProjectData) {
  const generated = data.generatedContent || {};
  const sections = Object.entries(generated)
    .filter(([, value]) => String(value?.content || "").trim())
    .map(([id, value]) => ({
      id,
      title: id,
      content: String(value?.content || ""),
      heading_level: 2,
    }));

  if (sections.length) {
    return sections;
  }

  return flattenOutline(data.outline || []).map((section) => ({
    id: section.id,
    title: section.title || section.id,
    content: section.writingHint || section.title || "",
    heading_level: Number(section.headingLevel || 2),
    title_only: !section.writingHint,
  }));
}

function flattenOutline(items: Array<{ id: string; title?: string; writingHint?: string; headingLevel?: number; children?: unknown[] }>) {
  const out: Array<{ id: string; title?: string; writingHint?: string; headingLevel?: number }> = [];
  const visit = (nodes: typeof items) => {
    for (const node of nodes) {
      out.push(node);
      if (Array.isArray(node.children)) {
        visit(node.children as typeof items);
      }
    }
  };
  visit(items);
  return out;
}
