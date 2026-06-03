import { ApiRequestError, apiClient, getApiBaseUrl } from "../../../shared/api/client";
import { getAccessToken, getClientId } from "../../../shared/auth/token";
import type {
  BidExtractResponse,
  BidKbSyncJob,
  BidKnowledgeImageAsset,
  BidKnowledgeResponse,
  BidOutlineSection,
  BidPiptAuditLog,
  BidProjectData,
  BidProjectRecord,
  BidStreamEvent,
  BidTaskStatus,
  BidTemplateConfig,
  BidWorkflowStatusItem,
  DownloadedBlob,
  PiptGatewayPostprocessResult,
  PiptGatewayPreprocessResult,
  PiptGatewayStatus,
  PiptGatewayValidation,
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

export function fetchPiptGatewayStatus(options: RequestControl = {}) {
  return apiClient.get<PiptGatewayStatus>("/pipt-gateway/status", {
    signal: options.signal,
  });
}

/**
 * 校验文本中的 PIPT 占位符完整性。
 * @param input.text 待校验文本。
 * @param input.placeholderManifest 可选预期占位符清单，用于发现缺失或额外 token。
 * @returns 占位符校验结果，不执行脱敏或还原。
 */
export function validatePiptGatewayPlaceholders(input: {
  text: string;
  placeholderManifest?: Record<string, Record<string, string>>;
  requestId?: string;
  moduleCode?: string;
  purpose?: string;
  mode?: string;
}) {
  return apiClient.post<PiptGatewayValidation>("/pipt-gateway/validate-placeholders", {
    text: input.text,
    placeholder_manifest: input.placeholderManifest,
    request_id: input.requestId,
    module_code: input.moduleCode || "bid-generator",
    purpose: input.purpose || "placeholder_validation",
    mode: input.mode || "compatibility",
  });
}

/**
 * 统一平台 PIPT 预处理。
 * compatibility 模式只生成 manifest/policy，不改写文本；strong 模式由后端执行统一脱敏与 vault 写入。
 */
export function preprocessPiptGatewayPayload(input: {
  text: string;
  enabled?: boolean;
  mode?: "compatibility" | "strong";
  requestId?: string;
  moduleCode?: string;
  purpose?: string;
  mappingTable?: Record<string, string>;
  targetEntities?: string[];
  llmMode?: "verify_only" | "augment" | "full";
}) {
  return apiClient.post<PiptGatewayPreprocessResult>("/pipt-gateway/preprocess", {
    text: input.text,
    enabled: Boolean(input.enabled),
    mode: input.mode || "compatibility",
    request_id: input.requestId,
    module_code: input.moduleCode || "bid-generator",
    purpose: input.purpose || "llm_external_call",
    mapping_table: input.mappingTable,
    target_entities: input.targetEntities,
    llm_mode: input.llmMode,
  });
}

/**
 * 统一平台 PIPT 后处理。
 * 用于校验 LLM 输出中的占位符是否完整；strong 模式可由后端按 request_id 尝试恢复。
 */
export function postprocessPiptGatewayPayload(input: {
  text: string;
  requestId?: string;
  moduleCode?: string;
  purpose?: string;
  mode?: "compatibility" | "strong";
  placeholderManifest?: Record<string, Record<string, string>>;
}) {
  return apiClient.post<PiptGatewayPostprocessResult>("/pipt-gateway/postprocess", {
    text: input.text,
    request_id: input.requestId,
    module_code: input.moduleCode || "bid-generator",
    purpose: input.purpose || "llm_output_validation",
    mode: input.mode || "compatibility",
    placeholder_manifest: input.placeholderManifest,
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

export function extractRequirements(input: {
  file: File;
  projectId?: string;
  projectName: string;
  enableDesensitize: boolean;
  desensitizeProfile?: string;
  useVisionParsing: boolean;
}) {
  const form = new FormData();
  form.append("file", input.file);
  if (input.projectId) {
    form.append("project_id", input.projectId);
  }
  form.append("project_name", input.projectName);
  form.append("enable_desensitize", String(input.enableDesensitize));
  form.append("desensitize_profile", input.desensitizeProfile || "tender");
  form.append("use_vision_parsing", String(input.useVisionParsing));
  return apiClient.post<BidExtractResponse>(`${API_PREFIX}/projects/extract`, form, {
    unwrapEnvelope: false,
  });
}

export function reExtractRequirements(input: { projectId: string; projectName: string }) {
  return apiClient.post<BidExtractResponse>(
    `${API_PREFIX}/projects/re-extract`,
    {
      project_id: input.projectId,
      project_name: input.projectName,
    },
    { unwrapEnvelope: false },
  );
}

/**
 * 读取标书系统配置和当前大纲模板。
 * @param options.signal 可选取消信号。
 * @param options.templateName 可选模板文件名；为空时由后端返回默认模板。
 * @returns 当前配置、模板内容、可用模板列表和当前模板名。
 */
export function fetchTemplateConfig(options: RequestControl & { templateName?: string } = {}) {
  return apiClient.get<BidTemplateConfig>(`${API_PREFIX}/config/template`, {
    query: options.templateName ? { template_name: options.templateName } : undefined,
    signal: options.signal,
    unwrapEnvelope: false,
  });
}

/**
 * 更新标书大纲模板。
 * @param templateName 模板文件名。
 * @param templateDict 模板内容。
 * @returns 后端保存状态。
 */
export function updateTemplateConfig(templateName: string, templateDict: unknown) {
  return apiClient.put<{ status?: string; message?: string }>(
    `${API_PREFIX}/config/template`,
    {
      template_name: templateName,
      template_dict: templateDict,
    },
    { unwrapEnvelope: false },
  );
}

/**
 * 删除标书大纲模板。
 * @param templateName 模板文件名。
 * @returns 后端删除状态。
 */
export function deleteTemplateConfig(templateName: string) {
  return apiClient.delete<{ status?: string; message?: string }>(`${API_PREFIX}/config/template`, {
    query: { template_name: templateName },
    unwrapEnvelope: false,
  });
}

/**
 * 更新标书全局配置。
 * @param configDict 全局配置字典。
 * @returns 后端保存状态。
 */
export function updateGlobalConfig(configDict: unknown) {
  return apiClient.put<{ status?: string; message?: string }>(
    `${API_PREFIX}/config/global`,
    { config_dict: configDict },
    { unwrapEnvelope: false },
  );
}

export function fetchSupportedEntities(options: RequestControl = {}) {
  return apiClient.get<{ entities?: Record<string, string>; description?: string }>(`${API_PREFIX}/entities`, {
    signal: options.signal,
    unwrapEnvelope: false,
  });
}

/**
 * 读取标书 PIPT 审计日志。
 * @param options.limit 返回条数上限，后端会限制到安全范围。
 * @param options.projectId 可选项目 ID 过滤。
 * @param options.taskId 可选任务 ID 过滤。
 * @param options.sessionId 可选会话 ID 过滤。
 * @param options.operation 可选操作类型过滤。
 * @param options.status 可选状态过滤。
 * @returns 审计记录列表；记录不包含敏感明文。
 */
export function fetchPiptAuditLogs(
  options: RequestControl & {
    limit?: number;
    projectId?: string;
    taskId?: string;
    sessionId?: string;
    operation?: string;
    status?: string;
  } = {},
) {
  return apiClient.get<{ items?: BidPiptAuditLog[]; count?: number; limit?: number }>(`${API_PREFIX}/pipt-audit-logs`, {
    query: {
      limit: options.limit || 20,
      project_id: options.projectId || undefined,
      task_id: options.taskId || undefined,
      session_id: options.sessionId || undefined,
      operation: options.operation || undefined,
      status: options.status || undefined,
    },
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

/**
 * 批量 upsert 标书项目记录。
 * @param projects 项目记录数组；每项需要包含 id/name/status/data。
 * @returns 后端统计的新增与更新数量。
 */
export function batchUpsertProjects(projects: BidProjectRecord[]) {
  return apiClient.post<{ created?: number; updated?: number }>(
    `${API_PREFIX}/projects/batch`,
    projects.map((project) => ({
      id: project.id,
      name: project.name,
      status: project.status,
      data: project.data,
    })),
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

export function fetchProjectDocBlocks(projectId: string, options: RequestControl = {}) {
  return apiClient.get<{ blocks?: Array<Record<string, unknown>>; total_blocks?: number; snapshot_only?: boolean }>(
    `${API_PREFIX}/projects/${encodeURIComponent(projectId)}/doc-blocks`,
    { signal: options.signal, unwrapEnvelope: false },
  );
}

/**
 * 上传并缓存项目 PDF。
 * @param projectId 项目 ID，用于写入统一后端 PDF 缓存路径。
 * @param file PDF 文件；该接口只缓存文件，不触发解析、脱敏或生成任务。
 * @returns 后端返回的 PDF 访问地址和提示信息。
 */
export function uploadProjectPdf(projectId: string, file: File) {
  const form = new FormData();
  form.append("project_id", projectId);
  form.append("file", file);
  return apiClient.post<{ pdf_url?: string; message?: string }>(`${API_PREFIX}/projects/upload-pdf`, form, {
    unwrapEnvelope: false,
  });
}

/**
 * 标书脱敏兼容路由。
 * 该端点由 apps/api 原生路由承载；底层识别引擎仍通过统一 PIPT provider 适配 legacy DesensitizeEngine。
 * 新版原生组件不要新增调用；需要平台 PIPT 状态或能力时使用 /pipt-gateway/* 对应 Service。
 */
export function legacyDesensitizeText(input: {
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

/**
 * Legacy 标书还原路由。
 * 该端点仍由 legacy router 承载，不能作为统一后端 PIPT 完成接入的证据。
 */
export function legacyRestoreText(text: string, sessionId = "apps-web-bid-generator") {
  return apiClient.post<{ restored_text: string; restored_count?: number }>(
    `${API_PREFIX}/restore`,
    { text, session_id: sessionId },
    { unwrapEnvelope: false },
  );
}

/**
 * Legacy 需求提取路由。
 * 该端点仍由 legacy router 承载，且会触发 legacy 解析和脱敏流程；原生页面不要新增调用。
 */
export function legacyExtractRequirements(input: {
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

/**
 * Legacy 流式需求提取路由。
 * 该端点仍由 legacy router 承载，SSE 事件格式暂由 legacy TaskManager 决定。
 */
export async function legacyStreamExtractRequirements(
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

/**
 * 启动分析后台任务。
 * 路由由 apps/api 原生拥有；任务编排与结果持久化已在统一后端执行。
 */
export async function startAnalyzeTask(projectId: string, selectedNodeIds: string[] = [], options: RequestControl = {}) {
  const form = new FormData();
  form.append("project_id", projectId);
  if (selectedNodeIds.length) {
    form.append("selected_node_ids", selectedNodeIds.join(","));
  }
  return apiClient.post<{ task_id: string }>(`${API_PREFIX}/tasks/start-analyze`, form, {
    signal: options.signal,
    unwrapEnvelope: false,
  });
}

/**
 * 启动提取后台任务。
 * 路由由 apps/api 原生拥有；任务运行态仍复用兼容 TaskManager 存储。
 */
export async function startExtractTask(input: {
  projectId: string;
  file: File;
  projectName: string;
  enableDesensitize?: boolean;
  desensitizeProfile?: string;
  useVisionParsing?: boolean;
}) {
  const form = new FormData();
  form.append("file", input.file);
  form.append("project_id", input.projectId);
  form.append("project_name", input.projectName);
  form.append("enable_desensitize", String(input.enableDesensitize !== false));
  form.append("desensitize_profile", input.desensitizeProfile || "tender");
  form.append("use_vision_parsing", String(Boolean(input.useVisionParsing)));
  return apiClient.post<{ task_id: string }>(`${API_PREFIX}/tasks/start-extract`, form, {
    unwrapEnvelope: false,
  });
}

/**
 * 启动正文生成后台任务。
 * @param body 已按 legacy 任务契约组装好的正文生成入参。
 * @returns 后端任务 ID。
 */
export function startContentTask(body: Record<string, unknown>) {
  return apiClient.post<{ task_id: string }>(`${API_PREFIX}/tasks/start-content`, body, {
    unwrapEnvelope: false,
  });
}

/**
 * 启动正文重生成后台任务。
 * @param body 已按 legacy 任务契约组装好的正文重生成入参。
 * @returns 后端任务 ID。
 */
export function startContentRewriteTask(body: Record<string, unknown>) {
  return apiClient.post<{ task_id: string }>(`${API_PREFIX}/tasks/start-content-rewrite`, body, {
    unwrapEnvelope: false,
  });
}

/**
 * 启动分组正文生成后台任务。
 * @param body 已按 legacy 任务契约组装好的分组生成入参。
 * @returns 后端任务 ID。
 */
export function startContentGroupTask(body: Record<string, unknown>) {
  return apiClient.post<{ task_id: string }>(`${API_PREFIX}/tasks/start-content-group`, body, {
    unwrapEnvelope: false,
  });
}

/**
 * 启动分组评估后台任务。
 * @param body 已按 legacy 任务契约组装好的分组评估入参。
 * @returns 后端任务 ID。
 */
export function startGroupReviewTask(body: Record<string, unknown>) {
  return apiClient.post<{ task_id: string }>(`${API_PREFIX}/tasks/start-group-review`, body, {
    unwrapEnvelope: false,
  });
}

/**
 * 启动图表批量生成后台任务。
 * @param input.projectId 项目 ID。
 * @param input.diagramRequests 图表补写请求列表。
 * @param input.signal 可选取消信号。
 * @returns 后端任务 ID。
 */
export function startDiagramBatchTask(input: {
  projectId: string;
  diagramRequests: unknown[];
  signal?: AbortSignal;
}) {
  return apiClient.post<{ task_id: string }>(
    `${API_PREFIX}/tasks/start-diagram-batch`,
    {
      project_id: input.projectId,
      diagram_requests: input.diagramRequests,
      enable_diagrams: true,
    },
    {
      signal: input.signal,
      unwrapEnvelope: false,
    },
  );
}

/**
 * 启动大纲后台任务。
 * 路由由 apps/api 原生拥有；执行链已迁到统一后端，保留 legacy 兼容请求契约。
 */
export async function startOutlineTask(project: BidProjectRecord, expectedTotalWords = 0) {
  const data = normalizeProjectData(project);
  const enableDiagrams = DIAGRAM_GENERATION_ENABLED;
  const outlineTaskOverrides = (data.outlineTaskOverrides as {
    scoring_details_json?: string;
    outline_batch_strategy?: string;
    outline_auto_parallel_threshold?: number;
  } | undefined) || {};
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
      scoring_details_json: outlineTaskOverrides.scoring_details_json || "",
      outline_batch_strategy: outlineTaskOverrides.outline_batch_strategy,
      outline_auto_parallel_threshold: outlineTaskOverrides.outline_auto_parallel_threshold,
    },
    { unwrapEnvelope: false },
  );
}

/**
 * 查询任务状态。
 * 路由由 apps/api 原生拥有；状态仍会叠加兼容 TaskManager 的进程内运行态。
 */
export async function getTaskStatus(
  taskId: string,
  projectId?: string,
  options: RequestControl & { afterEventId?: number } = {},
) {
  return apiClient.get<BidTaskStatus>(`${API_PREFIX}/tasks/${encodeURIComponent(taskId)}/status`, {
    query: {
      project_id: projectId || undefined,
      after_event_id: options.afterEventId,
    },
    signal: options.signal,
    unwrapEnvelope: false,
  });
}

/**
 * 打开任务进度 SSE 原始响应。
 * @param taskId 后台任务 ID。
 * @param projectId 项目 ID；用于后端定位兼容运行态。
 * @param signal 可选取消信号。
 * @returns 原始 SSE Response，供 legacy UI 继续按原协议读取。
 */
export function fetchTaskProgressResponse(taskId: string, projectId: string, signal?: AbortSignal) {
  return apiClient.raw("GET", `${API_PREFIX}/tasks/${encodeURIComponent(taskId)}/progress`, {
    query: projectId ? { project_id: projectId } : undefined,
    headers: { Accept: "text/event-stream, application/json" },
    signal,
  });
}

/**
 * 监听任务进度 SSE。
 * 路由由 apps/api 原生拥有；事件流继续保持 legacy 兼容协议。
 */
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

/**
 * 取消后台任务。
 * 路由由 apps/api 原生拥有；保留 Dify stop 与兼容 runtime 同步语义。
 */
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

/**
 * 读取图表 artifact 文本内容。
 * @param diagramId 图表 artifact ID。
 * @param extension artifact 扩展名，当前支持 svg/mmd。
 * @param projectId 可选项目 ID，用于后端定位项目缓存。
 * @returns artifact 文本内容。
 */
export async function fetchDiagramArtifactText(
  diagramId: string,
  extension: "svg" | "mmd",
  projectId?: string,
) {
  const response = await apiClient.raw(
    "GET",
    `${API_PREFIX}/diagram-artifacts/${encodeURIComponent(diagramId)}.${extension}`,
    {
      query: projectId ? { project_id: projectId } : undefined,
      headers: {
        Accept: extension === "svg" ? "image/svg+xml,text/plain,*/*" : "text/plain,*/*",
      },
    },
  );
  return response.text();
}

/**
 * 兼容流式大纲生成路由。
 * 该端点由 apps/api 持有 legacy SSE 契约；原生页面不要新增调用。
 */
export async function legacyStreamGenerateOutline(
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

/**
 * 兼容流式正文生成路由。
 * 该端点由 apps/api 持有 legacy SSE 契约；原生页面不要新增调用。
 */
export async function legacyStreamGenerateContent(
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

export function generateOutline(input: {
  projectId?: string;
  requirements: unknown[];
  bidType?: string;
  difyApiKey?: string;
  useKnowledge?: boolean;
  analysisContext?: string;
  structureHeadingSeedJson?: string;
  technicalH2BindingsJson?: string;
  technicalTargetsJson?: string;
  expectedTotalWords?: number;
  enableDiagrams?: boolean;
  maxDiagrams?: number;
}) {
  return apiClient.post<{ sections?: BidOutlineSection[] }>(
    `${API_PREFIX}/projects/generate-outline`,
    {
      project_id: input.projectId,
      requirements: input.requirements || [],
      bid_type: input.bidType || "tech",
      dify_api_key: input.difyApiKey,
      use_knowledge: Boolean(input.useKnowledge),
      analysis_context: input.analysisContext || "",
      structure_heading_seed_json: input.structureHeadingSeedJson || "",
      technical_h2_bindings_json: input.technicalH2BindingsJson || "",
      technical_targets_json: input.technicalTargetsJson || "",
      expected_total_words: input.expectedTotalWords,
      enable_diagrams: input.enableDiagrams,
      max_diagrams: input.maxDiagrams,
    },
    { unwrapEnvelope: false },
  );
}

export function generateContent(input: {
  projectId: string;
  sectionId: string;
  sectionTitle: string;
  writingHint: string;
  keywords?: string;
  expectedWords: number;
  projectSummary?: string;
  globalOutline: string;
  sectionOutlineSlice?: string;
  requiresSearch: boolean;
  placeholderHint?: string;
  analysisContext?: string;
  generationStrategy?: string;
  enableDiagrams?: boolean;
  maxDiagrams?: number;
  needDiagram?: boolean;
  diagramBrief?: string;
  diagramTypeHint?: string;
  diagramPriority?: number;
  mappingTable?: Record<string, string>;
  bidderInfo?: Record<string, unknown>;
}) {
  return apiClient.post<{
    content?: string;
    word_count?: number;
    quality_score?: number;
    feedback?: string;
  }>(
    `${API_PREFIX}/projects/generate-content`,
    {
      project_id: input.projectId,
      section_id: input.sectionId,
      section_title: input.sectionTitle,
      writing_hint: input.writingHint,
      keywords: input.keywords,
      expected_words: input.expectedWords,
      project_summary: input.projectSummary || "",
      global_outline: input.globalOutline,
      section_outline_slice: input.sectionOutlineSlice || "",
      requires_search: input.requiresSearch,
      placeholder_hint: input.placeholderHint || "",
      analysis_context: input.analysisContext || "",
      generation_strategy: input.generationStrategy || "general",
      enable_diagrams: input.enableDiagrams,
      max_diagrams: input.maxDiagrams,
      need_diagram: input.needDiagram,
      diagram_brief: input.diagramBrief || "",
      diagram_type_hint: input.diagramTypeHint || "architecture",
      diagram_priority: input.diagramPriority || 0,
      mapping_table: input.mappingTable || {},
      bidder_info: input.bidderInfo || {},
    },
    { unwrapEnvelope: false },
  );
}

export function buildScoringTable(input: {
  projectId: string;
  scoreRequirements: unknown[];
  scoringTableTemplate?: unknown[];
}) {
  return apiClient.post<{ rows?: Array<Record<string, unknown>> }>(
    `${API_PREFIX}/projects/build-scoring-table`,
    {
      project_id: input.projectId,
      score_requirements: input.scoreRequirements || [],
      scoring_table_template: input.scoringTableTemplate || [],
    },
    { unwrapEnvelope: false },
  );
}

export function fillScoringRow(input: {
  rowId: string;
  indicator: string;
  maxScore: number;
  criteria: string;
  projectSummary?: string;
  requirementsContext?: string;
}) {
  return apiClient.post<{
    self_response?: string;
    self_comment?: string;
    evidence_refs?: string[];
  }>(
    `${API_PREFIX}/projects/fill-scoring-row`,
    {
      row_id: input.rowId,
      indicator: input.indicator,
      max_score: input.maxScore,
      criteria: input.criteria,
      project_summary: input.projectSummary || "",
      requirements_context: input.requirementsContext || "",
    },
    { unwrapEnvelope: false },
  );
}

export function generateAttachment(input: {
  attachmentType: string;
  attachmentName: string;
  attachmentDesc: string;
  projectId: string;
  orgName?: string;
  legalRep?: string;
  projectLead?: string;
  phone?: string;
  docDate?: string;
  projectName?: string;
  recipient?: string;
  bidNo?: string;
  agentName?: string;
  agentId?: string;
}) {
  return apiClient.post<{ label?: string; content?: string }>(
    `${API_PREFIX}/projects/generate-attachment`,
    {
      attachment_type: input.attachmentType,
      attachment_name: input.attachmentName,
      attachment_desc: input.attachmentDesc,
      project_id: input.projectId,
      org_name: input.orgName || "",
      legal_rep: input.legalRep || "",
      project_lead: input.projectLead || "",
      phone: input.phone || "",
      doc_date: input.docDate || "",
      project_name: input.projectName || "",
      recipient: input.recipient || "",
      bid_no: input.bidNo || "",
      agent_name: input.agentName || "",
      agent_id: input.agentId || "",
    },
    { unwrapEnvelope: false },
  );
}

export function generateBlueprint(input: {
  projectId: string;
  bidType?: string;
  projectSummary?: string;
  requirements?: unknown[];
  outline?: unknown[];
}) {
  return apiClient.post<{ blueprint?: Record<string, unknown> }>(
    `${API_PREFIX}/projects/generate-blueprint`,
    {
      project_id: input.projectId,
      bid_type: input.bidType || "tech",
      project_summary: input.projectSummary || "",
      requirements: input.requirements || [],
      outline: input.outline || [],
    },
    { unwrapEnvelope: false },
  );
}

/**
 * 兼容单节点分析路由。
 * 该端点由 apps/api 持有 legacy SSE 契约；原生页面当前只读写分析报告快照。
 */
export function legacyAnalyzeNode(projectId: string, nodeId: string, nodeLabel: string, extractionPrompt = "") {
  return streamJsonResponse(`${API_PREFIX}/projects/${encodeURIComponent(projectId)}/analyze-node`, {
    node_id: nodeId,
    node_label: nodeLabel,
    extraction_prompt: extractionPrompt,
  });
}

/**
 * 打开单节点分析 SSE 原始响应。
 * @param projectId 项目 ID。
 * @param nodeId 解析框架节点 ID。
 * @param nodeLabel 节点标题。
 * @param extractionPrompt 节点提取提示词。
 * @returns 原始 SSE Response，保留 legacy UI 的逐 chunk 渲染行为。
 */
export function fetchAnalyzeNodeResponse(projectId: string, nodeId: string, nodeLabel: string, extractionPrompt = "") {
  return apiClient.raw("POST", `${API_PREFIX}/projects/${encodeURIComponent(projectId)}/analyze-node`, {
    headers: { Accept: "text/event-stream, application/json", "Content-Type": "application/json" },
    body: {
      node_id: nodeId,
      node_label: nodeLabel,
      extraction_prompt: extractionPrompt,
    },
  });
}

/**
 * 保存项目分析报告快照。
 * @param projectId 项目 ID。
 * @param nodes 已存在的分析报告节点数组；该接口只持久化快照，不触发报告生成或导出。
 * @returns 后端保存结果。
 */
export function saveAnalysisReport(projectId: string, nodes: unknown[]) {
  return apiClient.post<Record<string, unknown>>(
    `${API_PREFIX}/projects/${encodeURIComponent(projectId)}/analysis-report`,
    { analysis_report: nodes },
    { unwrapEnvelope: false },
  );
}

/**
 * 读取项目分析报告快照。
 * @param projectId 项目 ID。
 * @param options.signal 可选取消信号。
 * @returns 分析报告节点数组及 analysis_v2 结构化字段。
 */
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

/**
 * 读取受保护资源 Blob。
 * @param path 后端返回的 `/api/...`、`/api/v1/bid-generator/...` 或完整 URL 路径。
 * @returns 资源 Blob，调用方负责创建和释放 object URL。
 */
export async function fetchProtectedAssetBlob(path: string): Promise<Blob> {
  const response = await apiClient.raw("GET", normalizeApiAssetPath(path), {
    headers: { Accept: "*/*" },
  });
  return response.blob();
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

/**
 * 导出解析报告 PDF。
 * 路由由 apps/api 原生拥有，但 PDF 生成当前仍通过 legacy adapter 保留原样式。
 */
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

/**
 * 导出评分表 Excel。
 * 路由由 apps/api 原生拥有，但 Excel 生成当前仍通过 legacy adapter 保留原样式。
 */
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

/**
 * 组装导出标书 DOCX。
 * 路由由 apps/api 原生拥有，但 DocumentForge 当前仍通过 legacy adapter 执行。
 */
export async function forgeDocument(
  project: BidProjectRecord,
  explicitSections?: Array<Record<string, unknown>>,
): Promise<DownloadedBlob> {
  const data = normalizeProjectData(project);
  const sections = Array.isArray(explicitSections) && explicitSections.length ? explicitSections : buildForgeSections(data);
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

export function fetchKnowledgeImages(options: RequestControl & { limit?: number } = {}) {
  return apiClient.get<{ items?: BidKnowledgeImageAsset[]; total?: number }>(`${API_PREFIX}/knowledge/images`, {
    query: { limit: options.limit || 50 },
    signal: options.signal,
    unwrapEnvelope: false,
  });
}

/**
 * 更新标书知识库图片资产元数据。
 * @param imageHash 图片内容哈希，用于定位知识库图片资产。
 * @param patch 图片说明、分类、摘要、标签或校对状态的局部更新。
 * @returns 更新后的图片资产。
 */
export function updateKnowledgeImage(
  imageHash: string,
  patch: Partial<Pick<BidKnowledgeImageAsset, "caption" | "image_type" | "summary" | "tags" | "caption_status">>,
) {
  return apiClient.patch<BidKnowledgeImageAsset>(
    `${API_PREFIX}/knowledge/images/${encodeURIComponent(imageHash)}`,
    patch,
    { unwrapEnvelope: false },
  );
}

/**
 * 查询 KB 同步任务状态。
 * 路由由 apps/api 原生拥有，但状态仍可能叠加 legacy TaskManager 进程内信息。
 */
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

export function extractBidAttachment(input: {
  projectId: string;
  startLocator: string;
  endLocator: string;
  attachmentName: string;
}) {
  return apiClient.post<{
    html?: string;
    attachment_name?: string;
    paragraph_count?: number;
    resolved_start_locator?: string;
    resolved_end_locator?: string;
  }>(
    `${API_PREFIX}/bid-attachment/extract`,
    {
      project_id: input.projectId,
      start_locator: input.startLocator,
      end_locator: input.endLocator,
      attachment_name: input.attachmentName,
    },
    { unwrapEnvelope: false },
  );
}

export function rebuildLocator(projectId: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  return apiClient.post<{ blocks?: number; locators?: number }>(
    `${API_PREFIX}/projects/${encodeURIComponent(projectId)}/rebuild-locator`,
    form,
    { unwrapEnvelope: false },
  );
}

export function extractBidAttachmentByBlocks(input: {
  projectId: string;
  attachmentName: string;
  startBlockId: string;
  endBlockId: string;
}) {
  return apiClient.post<{
    html?: string;
    attachment_name?: string;
    paragraph_count?: number;
    start_block_id?: string;
    end_block_id?: string;
    snapshot_only?: boolean;
  }>(
    `${API_PREFIX}/bid-attachment/extract-by-block`,
    {
      project_id: input.projectId,
      attachment_name: input.attachmentName,
      start_block_id: input.startBlockId,
      end_block_id: input.endBlockId,
    },
    { unwrapEnvelope: false },
  );
}

export function testBidAttachmentLocators(projectId: string) {
  return apiClient.get<{
    total_locators?: number;
    preview?: Array<{ locator?: string; body_idx?: number; snippet?: string }>;
  }>(
    `${API_PREFIX}/bid-attachment/test-locators`,
    {
      query: { project_id: projectId },
      unwrapEnvelope: false,
    },
  );
}

export async function extractBidAttachmentDocxByBlocks(input: {
  projectId: string;
  attachmentName: string;
  startBlockId: string;
  endBlockId: string;
}): Promise<DownloadedBlob> {
  const response = await apiClient.raw("POST", `${API_PREFIX}/bid-attachment/extract-by-block-docx`, {
    headers: { Accept: `${DOCX_MIME_TYPE}, application/octet-stream`, "Content-Type": "application/json" },
    body: {
      project_id: input.projectId,
      attachment_name: input.attachmentName,
      start_block_id: input.startBlockId,
      end_block_id: input.endBlockId,
    },
  });
  return {
    blob: await response.blob(),
    fileName: pickFileNameFromDisposition(response.headers.get("Content-Disposition"), `${input.attachmentName || "attachment"}.docx`),
  };
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
