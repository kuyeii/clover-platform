/**
 * 项目管理服务 — LocalStorage 实现
 * 数据结构与后端接口对齐，联调时只需替换此文件的实现
 */

import { extractCoreWritingIntent } from './writingHintService';
import { DiagramServiceError, diagramService, type DiagramRequest, type DiagramSectionResult } from './diagramService';
import {
    buildScoringTable as buildScoringTableApi,
    batchUpsertProjects as batchUpsertProjectsApi,
    createProject as createProjectApi,
    deleteProject as deleteProjectApi,
    deleteProjectCaches as deleteProjectCachesApi,
    extractBidAttachment as extractBidAttachmentApi,
    extractBidAttachmentByBlocks as extractBidAttachmentByBlocksApi,
    extractBidAttachmentDocxByBlocks as extractBidAttachmentDocxByBlocksApi,
    extractRequirements as extractRequirementsApi,
    exportScoringTable as exportScoringTableApi,
    exportReport as exportReportApi,
    fetchAnalyzeNodeResponse,
    fetchTaskProgressResponse,
    fillScoringRow as fillScoringRowApi,
    fetchAnalysisFramework as fetchAnalysisFrameworkApi,
    fetchKnowledgeDocuments as fetchKnowledgeDocumentsApi,
    fetchProjectDocBlocks as fetchProjectDocBlocksApi,
    fetchSourceDocx as fetchSourceDocxApi,
    fetchWorkflowStatus as fetchWorkflowStatusApi,
    forgeDocument as forgeDocumentApi,
    generateAttachment as generateAttachmentApi,
    generateBlueprint as generateBlueprintApi,
    generateContent as generateContentApi,
    generateOutline as generateOutlineApi,
    getProject as getProjectApi,
    getTaskStatus as getTaskStatusApi,
    listProjects as listProjectsApi,
    loadAnalysisReport as loadAnalysisReportApi,
    patchProject as patchProjectApi,
    reExtractRequirements as reExtractRequirementsApi,
    rebuildLocator as rebuildLocatorApi,
    saveAnalysisReport as saveAnalysisReportApi,
    saveBlobToDisk,
    startAnalyzeTask as startAnalyzeTaskApi,
    startContentGroupTask,
    startContentRewriteTask,
    startContentTask,
    startExtractTask as startExtractTaskApi,
    startGroupReviewTask,
    startOutlineTask as startOutlineTaskApi,
    cancelTask as cancelTaskApi,
    testBidAttachmentLocators as testBidAttachmentLocatorsApi,
    updateProject as updateProjectApi,
} from '../../services/bidGeneratorApi';

const DIAGRAM_GENERATION_ENABLED = String(import.meta.env.VITE_ENABLE_DIAGRAM_GENERATION || '').toLowerCase() === 'true';
const _diagramMaxFromEnv = Number(import.meta.env.VITE_MAX_DIAGRAMS || 3);
const DIAGRAM_MAX_PER_PROJECT = Number.isFinite(_diagramMaxFromEnv) && _diagramMaxFromEnv > 0 ? _diagramMaxFromEnv : 3;

// ─── 投标人信息（per-project，存在项目对象里）—————————————————
export interface BidderInfo {
    orgName: string;          // 投标单位全称
    legalRep: string;         // 法定代表人
    projectLead: string;      // 项目负责人
    phone: string;            // 联系电话
    docDate: string;          // 文件编制日期（YYYY-MM-DD）
}

export interface ProjectTaskRuntime {
    state: 'queued' | 'running' | 'cancelling' | 'cancelled' | 'succeeded' | 'failed' | 'timed_out' | 'idle' | 'error';
    taskId?: string;
    taskType?: 'extract' | 'analyze' | 'outline' | 'content' | 'diagram' | string;
    message?: string;
    progress?: number;
    startedAt?: string;
    cancellable?: boolean;
    updatedAt?: string;
}

export interface GroupReviewState {
    status: 'idle' | 'generating' | 'done' | 'error';
    feedback: string;
    qualityScore?: number;
    error?: string;
    stage?: string;
    updatedAt?: string;
}

type PlaceholderManifest = Record<string, Record<string, string>>;
type PlaceholderPolicy = Record<string, unknown>;

function buildPlaceholderContextRows(
    tokens: string[],
    manifest: PlaceholderManifest = {},
): Array<Record<string, string>> {
    return tokens.slice(0, 80).map((token) => {
        const meta = manifest[token] || {};
        const sourceContext = String(meta.source_context || '').trim();
        const tokenContext = String(meta.source_context_with_token || '').trim();
        const row: Record<string, string> = {
            token,
            entity_type: String(meta.entity_type || ''),
            role: String(meta.role || ''),
        };
        if (sourceContext) row.source_context = sourceContext;
        if (tokenContext) row.source_context_with_token = tokenContext;
        return row;
    });
}

export interface ProjectBusyMeta {
    busy: boolean;
    runtimeBusy: boolean;
    taskKeys: string[];
    activeTaskType?: ProjectTaskRuntime['taskType'];
    activeRuntimeState?: ProjectTaskRuntime['state'];
    busyContentBlockIds: string[];
}

// ────────────────────── 类型定义 ──────────────────────


export type ProjectStatus =
    // ── 上传与解析 ──
    | 'uploading'           // 用户上传文件中
    | 'parsing'             // 后端解析文件（旧兼容）
    | 'parsing_report'      // 阶段①：按预设框架结构化解析中
    | 'report_done'         // 阶段①完成，等待进入技术方案
    // ── 技术方案 ──
    | 'reviewing'           // 用户核对提取的需求（旧兼容）
    | 'generating_outline'  // AI 生成大纲
    | 'outline_ready'       // 大纲已生成，用户可在大纲页查看/编辑；点「下一步」再进入技术方案
    | 'tech_proposal'       // 阶段②：技术方案制作中
    | 'editing'             // 用户编辑大纲、附件、自评表及提示词
    | 'generating_content'  // AI 生成具体章节内容
    | 'tech_done'           // 阶段②完成
    // ── 投标文件编排 ──
    | 'bid_assembling'      // 阶段④：投标文件汇总编排中
    | 'bid_done'            // 阶段④完成
    // ── 导出 ──
    | 'exporting'           // 阶段⑤：导出中
    | 'done';               // 全部完成

export interface RequirementItem {
    id: string;
    type: 'tech' | 'biz' | 'score';
    content: string;
    points?: number;
}

export interface AnalysisScoreItem {
    id: string;
    name: string;
    max_score: number;
    criteria: string;
    score_tag: 'tech' | 'biz' | 'mixed';
}

export interface AnalysisProjectInfo {
    overview: string;
    basic_info: Record<string, string>;
    scoring_items: AnalysisScoreItem[];
    scoring_total: number;
}

export interface AnalysisTargetNode {
    id: string;
    label: string;
    content: string;
}

export interface AnalysisStructureHeading {
    id: string;
    title: string;
    level: number;
    category: 'attachments' | 'technical' | 'business' | 'generic';
    source: 'llm' | 'score_item' | 'system' | 'manual' | 'derived';
    source_node_id?: string;
    source_title?: string;
    score_tag?: 'tech' | 'biz' | 'mixed' | '';
    score_item_id?: string;
    max_score?: number;
    criteria?: string;
    criteria_excerpt?: string;
    related_target_ids?: string[];
    priority_weight?: number;
    generation_strategy?: 'general' | 'response_special' | 'objective_special' | string;
    generation_mode?: 'llm' | 'derived' | 'system' | string;
    response_candidate?: boolean;
    generates_from_self?: boolean;
    start_block_id?: string;
    end_block_id?: string;
    start_locator?: string;
    end_locator?: string;
    anchor_confidence?: number;
    editable_ops?: string[];
    deleted?: boolean;
    children?: AnalysisStructureHeading[];
}

export interface AnalysisV2 {
    schema_version: number;
    project_info: AnalysisProjectInfo;
    technical_targets: AnalysisTargetNode[];
    enable_response_branch?: boolean;
    technical_h2_bindings?: Array<Record<string, unknown>>;
    bid_structure: {
        attachments: AnalysisStructureHeading[];
        technical_sections: AnalysisStructureHeading[];
        business_sections: AnalysisStructureHeading[];
    };
}

// ─── 结构化解析节点（对应预设框架每个节点）──────────────────────────
export interface AnalysisNode {
    id: string;
    label: string;            // 框架标签，如"资质要求"
    content: string;          // 从招标文件中提取的对应内容
    parentId?: string;        // 父节点 ID（根节点无此字段）
    extractionPrompt?: string; // LLM 提取提示词（配置于 analysis_framework.json）
    numbered?: boolean;        // 是否由前端自动对每个段落加序号（默认 false）
    children?: AnalysisNode[];
}

// ─── 解析报告上下文工具函数（大纲生成 / 内容生成共用）──────────────────────

/** 递归收集所有叶子节点内容（有内容的）*/
function _collectLeafNodes(nodes: AnalysisNode[]): AnalysisNode[] {
    const result: AnalysisNode[] = [];
    for (const n of nodes) {
        if (n.children?.length) result.push(..._collectLeafNodes(n.children));
        else if (n.content?.trim()) result.push(n);
    }
    return result;
}

export function getTechnicalStructureHeadings(analysisV2?: AnalysisV2 | null): AnalysisStructureHeading[] {
    return (analysisV2?.bid_structure?.technical_sections || []).filter(item => !item.deleted);
}

export function getBusinessStructureHeadings(analysisV2?: AnalysisV2 | null): AnalysisStructureHeading[] {
    return (analysisV2?.bid_structure?.business_sections || []).filter(item => !item.deleted);
}

export function buildStructureHeadingSeedJson(analysisV2?: AnalysisV2 | null): string {
    const headings = getTechnicalStructureHeadings(analysisV2).map(item => ({
        id: item.id,
        title: item.title,
        level: item.level,
        score_tag: item.score_tag || 'tech',
        score_item_id: item.score_item_id || '',
        max_score: item.max_score || 0,
        criteria: item.criteria || '',
        related_target_ids: item.related_target_ids || [],
        priority_weight: item.priority_weight || 0,
        generation_strategy: item.generation_strategy || 'general',
        response_candidate: Boolean(item.response_candidate),
        generates_from_self: Boolean(item.generates_from_self || item.generation_strategy === 'response_special'),
    }));
    return headings.length ? JSON.stringify(headings, null, 2) : '';
}

export function buildTechnicalH2BindingsJson(analysisV2?: AnalysisV2 | null): string {
    const bindings = (analysisV2?.technical_h2_bindings || [])
        .filter(Boolean);
    if (bindings.length) return JSON.stringify(bindings, null, 2);
    return buildStructureHeadingSeedJson(analysisV2);
}

export function buildTechnicalTargetsJson(analysisV2?: AnalysisV2 | null): string {
    const targets = (analysisV2?.technical_targets || []).map(item => ({
        id: item.id,
        label: item.label,
        content: item.content,
    }));
    return targets.length ? JSON.stringify(targets, null, 2) : '';
}

/**
 * 从解析报告 V2 的技术结构 heading 生成大纲首屏骨架（仅 H2）。
 * 用于“先展示结构，再等待 Dify 回填 H3/元数据”的过渡态。
 */
export function buildInitialOutlineFromTechnicalHeadings(analysisV2?: AnalysisV2 | null): OutlineSection[] {
    const headings = getTechnicalStructureHeadings(analysisV2);
    const usedIds = new Set<string>();
    const uniqueId = (rawId: string, idx: number): string => {
        const base = (rawId || `tech_h2_${idx + 1}`).trim() || `tech_h2_${idx + 1}`;
        let id = base;
        let n = 1;
        while (usedIds.has(id)) id = `${base}_dup${n++}`;
        usedIds.add(id);
        return id;
    };
    return headings.map((item, idx) => ({
        id: uniqueId(item.id, idx),
        title: item.title || `技术章节 ${idx + 1}`,
        wordCount: 0,
        writingHint: '',
        keywords: [],
        relatedAnalysisIds: item.related_target_ids?.filter(Boolean) as string[] || [],
        needDiagram: false,
        diagramBrief: '',
        diagramPlan: { enabled: false, brief: '' },
        headingLevel: 2,
        generationStrategy: item.generation_strategy || 'general',
        generatesFromSelf: Boolean(item.generates_from_self || item.generation_strategy === 'response_special'),
        children: [],
    }));
}

/**
 * 判断大纲是否已经从“仅 H2 骨架”升级为可用结果。
 * 取消/异常收敛时不能只看 outline.length，否则生成前置骨架会被误判为 outline_ready。
 */
export function hasCompletedOutline(outline?: OutlineSection[] | null): boolean {
    if (!Array.isArray(outline) || outline.length === 0) return false;
    return outline.some((section) => {
        const children = Array.isArray(section.children) ? section.children : [];
        if (children.length > 0) return true;
        return Number(section.wordCount || 0) > 0 || Boolean(String(section.writingHint || '').trim());
    });
}

/**
 * 大纲生成专用：提炼解析报告中最高价值的节点，返回结构化上下文字符串。
 * 优先级：评分标准 > 技术要求 > 实施与交付约束 > 参数指标 > 项目背景 > 其他。
 * 总长度上限 4000 字符。
 */
export function buildAnalysisContextForOutline(analysisReport: AnalysisNode[]): string {
    // 按优先级收集解析报告叶节点，每个节点附带角色标注
    const PRIORITY_IDS = ['scoring_details', 'resp_tech', 'resp_substance', 'resp_param', 'proj_overview', 'proj_basic'];
    // 角色标注：告诉大纲生成器每个部分的作用
    const ROLE_HINTS: Record<string, string> = {
        scoring_details: '[大纲权重参考] 评分标准决定各章节字数权重分配，分值越高的项目应分配更多篇幅',
        resp_tech: '[技术章节内容参考] 直接对应技术方案核心章节的编写要求',
        resp_substance: '[实质性响应] 必须在对应章节覆盖的强制性技术要求',
        resp_param: '[参数响应参考] 技术参数和指标章节的内容来源',
        proj_overview: '[项目背景参考] 帮助确定总体技术响应的切入方式',
        proj_basic: '[项目基础信息] 用于补足工期、交付物、采购方式等硬条件',
    };
    const allLeaves = _collectLeafNodes(analysisReport);
    const sections: string[] = [];
    const used = new Set<string>();
    for (const id of PRIORITY_IDS) {
        const node = allLeaves.find(n => n.id === id);
        if (node?.content?.trim()) {
            const hint = ROLE_HINTS[id] || '';
            // 标题中不嵌入 [id:xxx]，避免 LLM 在 writingHint 中照搬
            sections.push(`### ${node.label}\n${hint ? `> ${hint}\n` : ''}\n${node.content.trim()}`);
            used.add(id);
        }
    }
    for (const node of allLeaves) {
        if (!used.has(node.id) && node.content?.trim()) sections.push(`### ${node.label}\n\n${node.content.trim()}`);
    }
    let ctx = sections.join('\n\n---\n\n');
    if (ctx.length > 6000) ctx = ctx.slice(0, 6000) + '\n\n…（内容已截断）';

    // 附加节点 ID 映射表（供 LLM 在 relatedAnalysisIds JSON 字段中引用，不要嵌入 writingHint 文本）
    const idList = allLeaves.filter(n => n.content?.trim()).map(n => `${n.id}: ${n.label}`).join('\n');
    ctx += `\n\n---\n【可用解析报告节点 ID 映射表】\n如需关联解析节点，请仅在 relatedAnalysisIds 数组字段中引用以下 ID，不要在 writingHint 文本中嵌入 [id:xxx] 标记。\n${idList}`;

    return ctx;
}

/**
 * 兼容历史 relatedAnalysisIds：旧节点 ID 会映射到当前 V2 解析框架节点。
 * 注意：该映射仅用于读取历史数据，不作为新大纲生成的推荐 ID。
 */
const ANALYSIS_ID_ALIASES: Record<string, string[]> = {
    eval_criteria: ['scoring_details'],
    eval_method: ['scoring_details'],
    invalid_items: ['resp_substance', 'structure_attachments'],
    qual_cert: ['proj_basic'],
    qual_perf: ['proj_overview'],
    qual_fin: ['proj_basic'],
    form_toc: ['structure_attachments'],
    form_format: ['structure_attachments'],
    form_other: ['structure_attachments'],
};

function _expandAnalysisIds(ids: Iterable<string>): string[] {
    const expanded: string[] = [];
    const seen = new Set<string>();
    for (const rawId of ids) {
        const id = String(rawId || '').trim();
        if (!id) continue;
        const candidates = [id, ...(ANALYSIS_ID_ALIASES[id] || [])];
        for (const item of candidates) {
            if (item && !seen.has(item)) {
                seen.add(item);
                expanded.push(item);
            }
        }
    }
    return expanded;
}

/**
 * 内容生成专用：根据章节标题关键词，智能匹配最相关的解析节点（最多3个，2000字符上限）。
 * 仅作降级兜底，优先使用 matchAnalysisNodesByIds。
 */
export function matchAnalysisNodesToSection(sectionTitle: string, analysisReport: AnalysisNode[]): string {
    const title = sectionTitle.toLowerCase();
    const allLeaves = _collectLeafNodes(analysisReport);
    const KEYWORD_MAP: Record<string, string[]> = {
        '技术': ['resp_tech', 'resp_param', 'scoring_details'],
        '方案': ['resp_tech', 'resp_substance', 'scoring_details'],
        '评分': ['scoring_details'],
        '资质': ['proj_basic'],
        '业绩': ['proj_overview'],
        '服务': ['resp_tech', 'resp_param'],
        '人员': ['resp_param', 'resp_substance'],
        '进度': ['resp_tech', 'resp_param'],
        '实施': ['resp_tech', 'resp_substance'],
        '价格': ['scoring_details'],
        '安全': ['resp_tech', 'resp_substance'],
        '废标': ['resp_substance', 'structure_attachments'],
        '形式': ['structure_attachments'],
    };
    const matchedIds = new Set<string>();
    for (const [kw, ids] of Object.entries(KEYWORD_MAP)) {
        if (title.includes(kw)) _expandAnalysisIds(ids).forEach(id => matchedIds.add(id));
    }
    if (matchedIds.size === 0) ['resp_tech', 'scoring_details'].forEach(id => matchedIds.add(id));
    const sections: string[] = [];
    for (const id of matchedIds) {
        const node = allLeaves.find(n => n.id === id);
        if (node?.content?.trim()) sections.push(`### ${node.label}\n\n${node.content.trim()}`);
        if (sections.length >= 3) break;
    }
    let ctx = sections.join('\n\n---\n\n');
    if (ctx.length > 2000) ctx = ctx.slice(0, 2000) + '\n\n…（截断）';
    return ctx;
}

/**
 * 内容生成专用：按 relatedAnalysisIds 精确查找解析节点并拼接上下文。
 * 比关键词匹配更准确，优先使用。最多取4个节点，3000字符上限。
 */
export function matchAnalysisNodesByIds(ids: string[], analysisReport: AnalysisNode[]): string {
    const allLeaves = _collectLeafNodes(analysisReport);
    const sections: string[] = [];
    for (const id of _expandAnalysisIds(ids || [])) {
        const node = allLeaves.find(n => n.id === id);
        if (node?.content?.trim()) sections.push(`### ${node.label}\n\n${node.content.trim()}`);
        if (sections.length >= 4) break;
    }
    let ctx = sections.join('\n\n---\n\n');
    if (ctx.length > 3000) ctx = ctx.slice(0, 3000) + '\n\n…（截断）';
    return ctx;
}


/**
 * 返回结构化的匹配解析节点（供 OutlineGenerator 关联面板使用）。
 * 最多返回 5 个匹配节点。
 */
export function matchAnalysisNodesStructured(sectionTitle: string, analysisReport: AnalysisNode[]): { id: string; label: string; content: string }[] {
    const title = sectionTitle.toLowerCase();
    const allLeaves = _collectLeafNodes(analysisReport);
    const KEYWORD_MAP: Record<string, string[]> = {
        '技术': ['resp_tech', 'resp_param', 'scoring_details'],
        '方案': ['resp_tech', 'resp_substance', 'scoring_details'],
        '评分': ['scoring_details'],
        '资质': ['proj_basic'],
        '业绩': ['proj_overview'],
        '服务': ['resp_tech', 'resp_param'],
        '人员': ['resp_param', 'resp_substance'],
        '进度': ['resp_tech', 'resp_param'],
        '实施': ['resp_tech', 'resp_substance'],
        '价格': ['scoring_details'],
        '安全': ['resp_tech', 'resp_substance'],
        '废标': ['resp_substance', 'structure_attachments'],
        '形式': ['structure_attachments'],
        '背景': ['resp_tech', 'scoring_details'],
        '咨询': ['resp_tech', 'resp_substance'],
        '数据': ['resp_tech', 'resp_param'],
        '产业': ['resp_tech', 'resp_substance'],
    };
    const matchedIds = new Set<string>();
    for (const [kw, ids] of Object.entries(KEYWORD_MAP)) {
        if (title.includes(kw)) _expandAnalysisIds(ids).forEach(id => matchedIds.add(id));
    }
    if (matchedIds.size === 0) ['resp_tech', 'scoring_details'].forEach(id => matchedIds.add(id));
    const results: { id: string; label: string; content: string }[] = [];
    for (const id of matchedIds) {
        const node = allLeaves.find(n => n.id === id);
        if (node?.content?.trim()) results.push({ id: node.id, label: node.label, content: node.content.trim() });
        if (results.length >= 5) break;
    }
    return results;
}

// ─── 技术方案规模配置（进入大纲生成前用户输入）──────────────────────
export interface TechProposalConfig {
    totalWords?: number;       // 预期总字数（undefined = AI 自动决定）
    enableDiagrams?: boolean;  // 是否启用图表生成（当前禁用）
    maxDiagrams?: number;      // 项目总图表上限（当前固定为 0）
}


// ─── 技术条款响应/偏离表行 ────────────────────────────────────────
export interface DeviationRow {
    id: string;
    clauseNo: string;         // 条款编号，如"3.1.2"
    requirement: string;      // 招标文件要求原文
    response: 'full' | 'partial' | 'deviate' | 'na';
    comment: string;          // 说明/备注
}

/** 大纲三级标题（与后端 OutlineThirdLevel 对齐，可选） */
export interface OutlineThirdLevelRef {
    id: string;
    title: string;
    wordCount?: number;
    writingHint?: string;
    keywords?: string[];
    headingLevel?: number;
}

export interface OutlineSubSection {
    id: string;
    title: string;  // X.X 格式二级标题
    wordCount: number;
    writingHint?: string; // AI 写作引导提示词（小节）
    keywords?: string[];  // 本子章节的核心关键词组
    relatedAnalysisIds?: string[]; // 关联的解析报告节点 ID（由 LLM 在大纲生成时输出）
    needDiagram?: boolean; // 是否需要图表
    diagramBrief?: string; // 图表描述（用于图表工作流）
    diagramPlan?: {
        enabled: boolean;
        brief: string;
        typeHint?: 'architecture' | 'flowchart' | 'org-chart' | 'data-flow' | 'logic';
        priority?: number;
    };
    headingLevel?: number;
    generationStrategy?: 'general' | 'response_special' | 'objective_special' | string;
    generatesFromSelf?: boolean;
    /** 三级小节（可选，用于目录树与定位切片） */
    children?: OutlineThirdLevelRef[];
}

export interface OutlineSection {
    id: string;
    title: string;          // 第X章：标题
    wordCount: number;      // 本章总字数
    writingHint: string;    // AI 写作引导提示词（仅一级标题有）
    keywords?: string[];    // 本章节的核心关键词组
    relatedAnalysisIds?: string[]; // 关联的解析报告节点 ID（由 LLM 在大纲生成时输出）
    needDiagram?: boolean; // 是否需要图表
    diagramBrief?: string; // 图表描述（用于图表工作流）
    diagramPlan?: {
        enabled: boolean;
        brief: string;
        typeHint?: 'architecture' | 'flowchart' | 'org-chart' | 'data-flow' | 'logic';
        priority?: number;
    };
    headingLevel?: number;
    generationStrategy?: 'general' | 'response_special' | 'objective_special' | string;
    generatesFromSelf?: boolean;
    children: OutlineSubSection[];
}

/**
 * 树形全局大纲文本：一级下挂二级、三级缩进，供内容生成约束编号体系。
 * 无项目大纲时回退为模板块扁平序号列表。
 */
export function buildTreeGlobalOutline(
    outline: OutlineSection[] | undefined | null,
    fallbackBlocks: { title: string }[],
): string {
    if (outline?.length) {
        const lines: string[] = [];
        for (const sec of outline) {
            lines.push(sec.title);
            for (const sub of sec.children || []) {
                lines.push(`  ${sub.title}`);
                const h3 = sub.children;
                if (h3?.length) {
                    for (const t of h3) {
                        if (t.title) lines.push(`    ${t.title}`);
                    }
                }
            }
        }
        return lines.join('\n');
    }
    return fallbackBlocks.map((b, i) => `${i + 1}. ${b.title}`).join('\n');
}

/**
 * 当前章节在大纲中的层级路径（父级 → 本级），用于写作提示；无匹配则返回空串。
 */
export function buildSectionOutlineSlice(
    outline: OutlineSection[] | undefined | null,
    sectionId: string,
): string {
    if (!outline?.length || !sectionId) return '';
    for (const sec of outline) {
        if (sec.id === sectionId) {
            return sec.title;
        }
        for (const sub of sec.children || []) {
            if (sub.id === sectionId) {
                return `${sec.title}\n  ${sub.title}`;
            }
            const h3list = sub.children;
            if (h3list?.length) {
                for (const h3 of h3list) {
                    if (h3.id === sectionId) {
                        return `${sec.title}\n  ${sub.title}\n    ${h3.title}`;
                    }
                }
            }
        }
    }
    return '';
}

/**
 * 仅保留“当前章节邻域”的大纲上下文，避免把整本大纲传入正文生成。
 * 说明：这里按结构切片而非按字符截断，优先保障章节定位准确度。
 */
export function buildOutlineNeighborhoodSlice(
    outline: OutlineSection[] | undefined | null,
    sectionId: string,
    fallbackOutline: string,
): string {
    if (!outline?.length || !sectionId) return fallbackOutline || '';

    const markCurrent = (title: string, depth: number): string => {
        const indent = depth > 0 ? '  '.repeat(depth) : '';
        return `${indent}[当前] ${title}`;
    };

    for (let i = 0; i < outline.length; i++) {
        const sec = outline[i];
        if (sec.id === sectionId) {
            const lines: string[] = [];
            const secStart = Math.max(0, i - 1);
            const secEnd = Math.min(outline.length - 1, i + 1);
            for (let s = secStart; s <= secEnd; s++) {
                lines.push(s === i ? markCurrent(outline[s].title, 0) : outline[s].title);
            }
            for (const sub of sec.children || []) lines.push(`  ${sub.title}`);
            return lines.join('\n');
        }

        const subs = sec.children || [];
        for (let j = 0; j < subs.length; j++) {
            const sub = subs[j];
            if (sub.id === sectionId) {
                const lines: string[] = [sec.title];
                const subStart = Math.max(0, j - 1);
                const subEnd = Math.min(subs.length - 1, j + 1);
                for (let t = subStart; t <= subEnd; t++) {
                    lines.push(t === j ? markCurrent(subs[t].title, 1) : `  ${subs[t].title}`);
                }
                for (const h3 of sub.children || []) lines.push(`    ${h3.title}`);
                return lines.join('\n');
            }

            const h3List = sub.children || [];
            for (let k = 0; k < h3List.length; k++) {
                const h3 = h3List[k];
                if (h3.id === sectionId) {
                    const lines: string[] = [sec.title, `  ${sub.title}`];
                    const h3Start = Math.max(0, k - 1);
                    const h3End = Math.min(h3List.length - 1, k + 1);
                    for (let u = h3Start; u <= h3End; u++) {
                        lines.push(u === k ? markCurrent(h3List[u].title, 2) : `    ${h3List[u].title}`);
                    }
                    return lines.join('\n');
                }
            }
        }
    }
    return fallbackOutline || '';
}

/**
 * 内容生成解析上下文：优先 relatedAnalysisIds 精确匹配；命中不足时回退关键词匹配。
 * 避免仅因 ID 失配导致上下文为空，损伤生成准确度。
 */
function buildResponseSpecialAnalysisContext(analysisReport: AnalysisNode[], relatedIds: string[] | undefined): string {
    const preferred = ['resp_tech', 'resp_param', 'resp_substance', 'scoring_details'];
    const preciseIds = Array.isArray(relatedIds) ? relatedIds : [];
    const mergedIds = Array.from(new Set([
        ..._expandAnalysisIds(preciseIds),
        ..._expandAnalysisIds(preferred),
    ]));
    const preciseCtx = matchAnalysisNodesByIds(mergedIds, analysisReport).trim();
    if (preciseCtx) return preciseCtx;
    return matchAnalysisNodesByIds(preferred, analysisReport).trim();
}

function resolveAnalysisContextForContent(
    sectionTitle: string,
    analysisReport: AnalysisNode[],
    relatedIds: string[] | undefined,
    generationStrategy: string = 'general',
): string {
    if (generationStrategy === 'response_special') {
        return buildResponseSpecialAnalysisContext(analysisReport, relatedIds);
    }
    const hasRelatedIds = Array.isArray(relatedIds) && relatedIds.length > 0;
    if (hasRelatedIds) {
        const preciseCtx = matchAnalysisNodesByIds(relatedIds, analysisReport).trim();
        if (preciseCtx.length >= 120) return preciseCtx;
    }
    return matchAnalysisNodesToSection(sectionTitle, analysisReport);
}

/**
 * 保守动态检索开关：
 * - 用户手动关闭则始终关闭；
 * - 仅当“精确节点较充分 + 本章无明显外部时效需求”时自动关闭联网检索。
 */
function resolveRequiresSearch(
    userChoice: boolean,
    relatedIds: string[] | undefined,
    analysisContext: string,
    sectionTitle: string,
    keywords: string,
    writingHint: string,
    generationStrategy: string = 'general',
): boolean {
    if (generationStrategy === 'response_special') return false;
    if (!userChoice) return false;
    const ids = Array.isArray(relatedIds) ? relatedIds : [];
    const contextLen = (analysisContext || '').trim().length;
    const localEvidenceEnough = ids.length >= 2 && contextLen >= 1200;
    const externalSignal = /(最新|政策|规范|标准|国标|行标|白皮书|版本|厂商|选型|对标|公开资料|截至|\d{4}年)/i
        .test([sectionTitle, keywords, writingHint].filter(Boolean).join('\n'));
    if (localEvidenceEnough && !externalSignal) return false;
    return true;
}

function flattenOutlineSections(outline?: OutlineSection[] | null): (OutlineSection | OutlineSubSection)[] {
    if (!Array.isArray(outline) || outline.length === 0) return [];
    const all: (OutlineSection | OutlineSubSection)[] = [];
    outline.forEach((section) => {
        all.push(section);
        (section.children || []).forEach((child) => all.push(child));
    });
    return all;
}

function resolveSectionDiagramMeta(
    outline: OutlineSection[] | undefined,
    sectionId: string,
    fallback?: {
        generationStrategy?: string;
        needDiagram?: boolean;
        diagramBrief?: string;
        diagramTypeHint?: string;
        diagramPriority?: number;
    },
): {
    matched?: OutlineSection | OutlineSubSection;
    generationStrategy: string;
    needDiagram: boolean;
    diagramBrief: string;
    diagramTypeHint: string;
    diagramPriority: number;
} {
    const matched = flattenOutlineSections(outline).find((section) => section.id === sectionId);
    const hit = matched as any;
    const plan = hit?.diagramPlan || hit?.diagram_plan || {};
    const generationStrategy = String(
        hit?.generationStrategy
        || hit?.generation_strategy
        || fallback?.generationStrategy
        || 'general',
    );
    if (!DIAGRAM_GENERATION_ENABLED) {
        return {
            matched,
            generationStrategy,
            needDiagram: false,
            diagramBrief: '',
            diagramTypeHint: 'architecture',
            diagramPriority: 0,
        };
    }
    return {
        matched,
        generationStrategy,
        needDiagram: Boolean(
            hit?.needDiagram
            ?? hit?.need_diagram
            ?? plan.enabled
            ?? fallback?.needDiagram
            ?? false,
        ),
        diagramBrief: String(
            hit?.diagramBrief
            ?? hit?.diagram_brief
            ?? plan.brief
            ?? fallback?.diagramBrief
            ?? '',
        ).trim(),
        diagramTypeHint: String(
            plan.typeHint
            || plan.type_hint
            || fallback?.diagramTypeHint
            || 'architecture',
        ),
        diagramPriority: Number(plan.priority ?? fallback?.diagramPriority ?? 0),
    };
}

type BatchGenerationBlock = {
    id: string;
    title: string;
    writingHint: string;
    keywords?: string;
    expectedWords: number;
    requiresSearch: boolean;
    generationStrategy?: string;
    parentHeadingId?: string;
    parentHeadingTitle?: string;
    needDiagram?: boolean;
    diagramBrief?: string;
    diagramTypeHint?: string;
    diagramPriority?: number;
};

type ContentGenerationResult = {
    content?: string;
    wordCount: number;
    qualityScore?: number;
    feedback?: string;
    replaceReport?: { placeholder: string; original: string }[];
    placeholderWarning?: PlaceholderWarning;
    diagramError?: string;
    diagramUpdate?: boolean;
    diagramRequest?: DiagramRequest;
};

export type PlaceholderWarning = {
    code?: string;
    message?: string;
    illegal_count?: number;
    unresolved_count?: number;
    has_illegal_placeholder?: boolean;
    has_unresolved_placeholder?: boolean;
};

type BatchGenerationUnit =
    | { kind: 'single'; key: string; blocks: [BatchGenerationBlock] }
    | { kind: 'group'; key: string; groupId: string; groupTitle: string; blocks: BatchGenerationBlock[] };

function buildContentGenerationUnits(blocks: BatchGenerationBlock[]): BatchGenerationUnit[] {
    const grouped = new Map<string, BatchGenerationBlock[]>();
    const groupTitles = new Map<string, string>();
    const orderedKeys: string[] = [];

    for (const block of blocks) {
        const strategy = String(block.generationStrategy || 'general');
        if (!block.parentHeadingId || strategy === 'response_special') {
            orderedKeys.push(`single:${block.id}`);
            continue;
        }
        if (!grouped.has(block.parentHeadingId)) {
            orderedKeys.push(`group:${block.parentHeadingId}`);
            grouped.set(block.parentHeadingId, []);
            groupTitles.set(block.parentHeadingId, block.parentHeadingTitle || `分组 ${block.parentHeadingId}`);
        }
        grouped.get(block.parentHeadingId)!.push(block);
    }

    return orderedKeys.map((key) => {
        if (key.startsWith('single:')) {
            const blockId = key.slice('single:'.length);
            const block = blocks.find(item => item.id === blockId)!;
            return { kind: 'single', key, blocks: [block] } as BatchGenerationUnit;
        }
        const groupId = key.slice('group:'.length);
        const members = grouped.get(groupId) || [];
        if (members.length <= 1) {
            return { kind: 'single', key: `single:${members[0].id}`, blocks: [members[0]] } as BatchGenerationUnit;
        }
        return {
            kind: 'group',
            key,
            groupId,
            groupTitle: groupTitles.get(groupId) || `分组 ${groupId}`,
            blocks: members,
        } as BatchGenerationUnit;
    });
}

function normalizeDiagramSectionResult(row: DiagramSectionResult): ContentGenerationResult {
    return {
        content: applyPlaceholderReportToContent(row.content || '', row.replace_report || []),
        wordCount: Number(row.word_count || 0),
        qualityScore: row.quality_score,
        feedback: row.feedback,
        replaceReport: row.replace_report || [],
        placeholderWarning: normalizePlaceholderWarning((row as any).placeholder_warning ?? (row as any).placeholderWarning),
        diagramError: extractDiagramErrorMessage(row.diagram_error),
        diagramUpdate: true,
    };
}

function normalizePlaceholderWarning(value: unknown): PlaceholderWarning | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const raw = value as Record<string, unknown>;
    const message = String(raw.message || '').trim() || '模型生成发生错误，请手动修改异常文本或重新生成。';
    const illegalCount = Number(raw.illegal_count ?? raw.illegalCount ?? 0);
    const unresolvedCount = Number(raw.unresolved_count ?? raw.unresolvedCount ?? 0);
    return {
        code: String(raw.code || 'placeholder_restore_warning'),
        message,
        illegal_count: Number.isFinite(illegalCount) ? illegalCount : 0,
        unresolved_count: Number.isFinite(unresolvedCount) ? unresolvedCount : 0,
        has_illegal_placeholder: Boolean(raw.has_illegal_placeholder ?? raw.hasIllegalPlaceholder),
        has_unresolved_placeholder: Boolean(raw.has_unresolved_placeholder ?? raw.hasUnresolvedPlaceholder),
    };
}

function waitForDiagramQueue(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
        }
        const timer = window.setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            window.clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

async function startDiagramBatchWithRetry(
    projectId: string,
    requests: DiagramRequest[],
    handlers: { onStage?: (stage: string) => void },
    signal?: AbortSignal,
): Promise<string> {
    const retryDelays = [2000, 4000, 8000, 12000, 15000, 15000, 15000, 15000, 15000, 15000];
    for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
        try {
            return await diagramService.startDiagramBatch(projectId, requests, signal);
        } catch (error) {
            const isLimit = error instanceof DiagramServiceError
                && error.status === 409
                && (!error.code || error.code === 'TASK_LIMIT_REACHED');
            if (!isLimit || attempt >= retryDelays.length || signal?.aborted) throw error;
            const delay = retryDelays[attempt];
            handlers.onStage?.(`🎨 图表队列等待空闲（${Math.round(delay / 1000)}秒后重试）`);
            setLocalTaskRuntime(projectId, {
                state: 'queued',
                taskId: `diagram_wait_${projectId}`,
                taskType: 'diagram',
                message: '图表队列等待空闲',
                progress: 0,
                cancellable: false,
            });
            await waitForDiagramQueue(delay, signal);
        }
    }
    throw new Error('图表队列启动失败');
}

async function runDiagramBatchQueue(
    projectId: string,
    requests: DiagramRequest[],
    handlers: {
        onStage?: (stage: string) => void;
        onSectionDone?: (sectionId: string, result: ContentGenerationResult) => void;
    },
    signal?: AbortSignal,
): Promise<void> {
    const validRequests = requests.filter(req => req.need_diagram && req.diagram_brief?.trim());
    if (validRequests.length === 0 || signal?.aborted) return;

    let taskId = '';
    const deliveredSections = new Set<string>();
    const deliverSection = (sectionId: string, result: ContentGenerationResult) => {
        if (!sectionId || deliveredSections.has(sectionId)) return;
        deliveredSections.add(sectionId);
        handlers.onSectionDone?.(sectionId, result);
    };
    const deliverPendingDiagramErrors = (message: string) => {
        validRequests.forEach((req) => {
            if (!req.section_id || deliveredSections.has(req.section_id)) return;
            handlers.onSectionDone?.(req.section_id, {
                content: req.base_content || '',
                wordCount: Number(req.expected_words || 0),
                qualityScore: req.quality_score,
                feedback: req.feedback,
                replaceReport: req.replace_report || [],
                placeholderWarning: normalizePlaceholderWarning((req as any).placeholder_warning ?? (req as any).placeholderWarning),
                diagramError: message,
                diagramUpdate: true,
            });
        });
    };
    try {
        handlers.onStage?.(`🎨 图表队列启动（${validRequests.length} 张）`);
        setLocalTaskRuntime(projectId, {
            state: 'queued',
            taskId: `diagram_wait_${projectId}`,
            taskType: 'diagram',
            message: '图表队列等待启动',
            progress: 0,
            cancellable: false,
        });
        taskId = await startDiagramBatchWithRetry(projectId, validRequests, handlers, signal);
        setLocalTaskRuntime(projectId, {
            state: 'running',
            taskId,
            taskType: 'diagram',
            message: '图表队列生成中',
            progress: 0,
            cancellable: true,
        });
        let lastEventId = 0;
        let lastStage = '';
        let pollMs = 2000;
        while (!signal?.aborted) {
            await waitForDiagramQueue(pollMs, signal);
            if (signal?.aborted) break;
            const status = await diagramService.getDiagramTaskStatus(taskId, projectId, lastEventId);
            if (status.current_stage && status.current_stage !== lastStage) {
                lastStage = status.current_stage;
                handlers.onStage?.(lastStage);
            }
            for (const event of status.partial_events || []) {
                lastEventId = Math.max(lastEventId, Number(event.event_id || 0));
                if (event.phase === 'diagram_section_done' && event.section_id) {
                    deliverSection(event.section_id, normalizeDiagramSectionResult(event));
                }
            }
            if (typeof status.last_partial_event_id === 'number') {
                lastEventId = Math.max(lastEventId, status.last_partial_event_id);
            }
            if (status.status === 'done' && status.result) {
                const result = status.result as any;
                const sections = Array.isArray(result.sections) ? result.sections : [result];
                sections.forEach((row: DiagramSectionResult) => {
                    if (row?.section_id) deliverSection(row.section_id, normalizeDiagramSectionResult(row));
                });
                setLocalTaskRuntime(projectId, {
                    state: 'succeeded',
                    taskId,
                    taskType: 'diagram',
                    message: '',
                    progress: 100,
                    cancellable: false,
                });
                break;
            }
            if (status.cancelled || status.status === 'cancelled') break;
            if (status.timed_out || status.status === 'timeout' || status.status === 'error') {
                const message = status.error || (status.timed_out || status.status === 'timeout' ? '图表生成超时，已保留正文' : '图表生成失败，已保留正文');
                console.warn('[diagram batch] diagram queue ended without full success', message);
                deliverPendingDiagramErrors(message);
                setLocalTaskRuntime(projectId, {
                    state: status.timed_out || status.status === 'timeout' ? 'timed_out' : 'failed',
                    taskId,
                    taskType: 'diagram',
                    message,
                    progress: 100,
                    cancellable: false,
                });
                break;
            }
            pollMs = Math.min(5000, pollMs + 500);
        }
    } catch (e) {
        if (!signal?.aborted) {
            console.warn('[diagram batch] diagram queue failed', e);
            deliverPendingDiagramErrors('图表队列启动失败，已保留正文');
            setLocalTaskRuntime(projectId, {
                state: 'failed',
                taskId: taskId || `diagram_wait_${projectId}`,
                taskType: 'diagram',
                message: '图表队列启动失败',
                progress: 100,
                cancellable: false,
            });
        }
    } finally {
        if (signal?.aborted && taskId) {
            void diagramService.cancelDiagramTask(taskId, projectId);
        }
        if (signal?.aborted) {
            setLocalTaskRuntime(projectId, {
                state: 'cancelled',
                taskId: taskId || `diagram_wait_${projectId}`,
                taskType: 'diagram',
                message: '',
                progress: 100,
                cancellable: false,
            });
        }
    }
}

/** 将 replace_report 中的占位符替换为原文（流式展示与落盘时与后端脱敏结果对齐） */
export function applyPlaceholderReportToContent(
    text: string,
    report?: { placeholder: string; original: string; status?: string }[],
): string {
    if (!text || !report?.length) return text;
    let out = text;
    for (const row of report) {
        if (!row?.placeholder) continue;
        if (row.status && row.status !== 'success') continue;
        let original = String(row.original ?? '').trim();
        if (original.startsWith('**') && original.endsWith('**') && original.length > 4) {
            original = original.slice(2, -2).trim();
        }
        out = out.split(row.placeholder).join(original);
    }
    return out;
}

function extractDiagramErrorMessage(raw: any): string | undefined {
    if (!raw) return undefined;
    if (typeof raw === 'string') {
        const text = raw.trim();
        return text || undefined;
    }
    if (typeof raw === 'object') {
        const text = String(raw.message || raw.detail || raw.error || '').trim();
        return text || undefined;
    }
    return undefined;
}

function extractDiagramSkipMessage(raw: any): string | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const reasons = Array.isArray(raw.reasons)
        ? raw.reasons.map((item: unknown) => String(item || '').trim()).filter(Boolean)
        : [];
    if (!reasons.length) return undefined;
    const workflow = String(raw.workflow || 'diagram_generator').trim();
    return `图表未生成：${workflow} 跳过（${reasons.join('；')}）`;
}

// ─── 自评评分表行 ────────────────────────────────────────
export interface ScoringRow {
    id: string;
    indicator: string;       // 评分指标名
    maxScore: number;        // 最高分值
    criteria: string;        // 评分标准说明
    selfResponse: 'full' | 'partial' | 'none' | ''; // full=响应，partial=部分响应
    selfComment: string;     // 自评说明
    // 证明材料：文件路径占位符列表，gateway-forge 阶段注入真实文件
    evidenceRefs: string[];
}

// ─── 投标文件模块 ────────────────────────────────────────
export interface BidModule {
    id: string;
    name: string;                        // "投标函" / "法人授权委托书"
    source: 'extracted' | 'ai_generated' | 'manual';
    moduleKind?: 'attachment' | 'technical' | 'business';
    templateContent: string;             // 模板原文 HTML
    filledContent?: string;              // 填写后内容
    fillStatus: 'unfilled' | 'partial' | 'filled';
    enabled: boolean;                    // 是否纳入最终文件
    linkedSections?: string[];           // 关联技术方案章节 ID
    isTechProposalLink?: boolean;        // 标记该模块是否作为技术方案生成内容导出挂载点
    headingLevel?: number;               // 导出层级：附件/技术/商务为主标题，技术正文由 outline 决定
    structureHeadingId?: string;         // analysis_v2 结构 heading id
    structureCategory?: 'attachments' | 'technical' | 'business' | 'generic';
    locatorStart?: string;               // 原文切片起始定位符
    locatorEnd?: string;                 // 原文切片终止定位符
    startBlockId?: string;               // 块级锚点起始 block_id
    endBlockId?: string;                 // 块级锚点终止 block_id
    sourceAttachmentName?: string;       // 源附件名称（目录条目）
    order: number;
}

// ─── 附件提取要求 ────────────────────────────────────────
export interface AttachmentRequirement {
    id: string;
    name: string;
    description: string;
    type: string;
}

// ─── 全局蓝图 ──────────────────────────────────────────────
export interface BlueprintData {
    positioning: string;
    strategy: string;
    highlights: string[];
    writing_style: string;
}

// ─── 投标文件附件目录条目 ────────────────────────────────────
export interface BidAttachmentItem {
    /** 附件名称，如《投标函》《法人授权书》 */
    name: string;
    /** 起始段落定位符，如 "P0045" */
    start_locator: string;
    /** 终止段落定位符，如 "P0067" */
    end_locator: string;
    /** 可选：块级锚点起始 block_id */
    start_block_id?: string;
    /** 可选：块级锚点终止 block_id */
    end_block_id?: string;
    /** 简述 */
    description?: string;
}

export interface DocBlockItem {
    block_id: string;
    locator: string;
    body_idx: number;
    type: 'paragraph' | 'table';
    text: string;
}

export interface DocBlocksResponse {
    blocks: DocBlockItem[];
    snapshotOnly: boolean;
}

export interface KnowledgeDocumentInfo {
    id: string;
    name: string;
    size: string;
    uploadTime: string;
    status: 'success' | 'indexing' | 'failed';
    chunks: number;
}

export interface Project {
    id: string;
    name: string;                        // 项目名（通常取自招标文件名）
    bidFileName: string;                 // 原始文件名
    status: ProjectStatus;
    createdAt: string;                   // ISO 时间字符串
    updatedAt: string;
    // ── 阶段①：解析报告 ──────────────────────────────
    analysisReport?: AnalysisNode[];     // 结构化解析报告（预设框架树）
    analysisV2?: AnalysisV2;             // V2 解析主结构
    pdfUrl?: string;                     // 招标文件 PDF 预览 URL（后端转 PDF 后返回）
    requirements?: RequirementItem[];    // 旧兼容：平铺需求列表
    // ── 项目基础信息 ──────────────────────────────────
    templateYamlId?: string;             // 绑定的 standard.yaml 模板名
    bidType?: string;                    // 标书类别（tech|business）
    summary?: string;                    // 项目摘要
    blueprint?: BlueprintData;           // 全局指导蓝图
    // ── 阶段②：技术方案 ──────────────────────────────
    targetConfig?: TechProposalConfig;   // 用户输入的规模配置（字数/页数）
    outline?: OutlineSection[];          // AI 生成的大纲（含一级+二级标题）
    // ── 脱敏相关（绝不上传至外部服务）────────────────
    mappingTable?: Record<string, string>; // { '{{__PIPT_name_1__}}': '张三' }
    placeholderManifest?: PlaceholderManifest; // 安全占位符说明，不含敏感明文
    placeholderPolicy?: PlaceholderPolicy;     // 外部模型占位符保留策略
    imageMap?: Record<string, string | { abs_path: string; preview_url: string; description?: string }>;  // 图片映射表
    // 旧格式：{ '{{IMG_0001}}': '/abs/path' }
    // 新格式：{ '{{IMG_0001}}': {abs_path, preview_url, description} }
    entityCount?: number;                // 识别出敏感实体的数量
    // ── 投标人信息 ────────────────────────────────────
    bidderInfo?: BidderInfo;             // per-project，仅存于 localStorage
    taskRuntime?: ProjectTaskRuntime;    // 后端任务运行态，用于项目锁与超时恢复
    groupReviews?: Record<string, GroupReviewState>;
    // ── 附件与评分表 ──────────────────────────────────
    requiredAttachments?: AttachmentRequirement[];
    scoringTableTemplate?: any[];        // 从招标文件提取出的评分表结构
    scoringRows?: ScoringRow[];          // 自评评分表（per-project，本地保存）
    // ── 阶段③：投标文件编排 ──────────────────────────
    bidModules?: BidModule[];            // 投标文件模块列表
    bidAttachmentList?: BidAttachmentItem[]; // 投标文件附件目录（来自 DocAnalysis 解析）
    // ── 生成内容缓存 ──────────────────────────────────
    generatedContent?: Record<string, {
        status: 'idle' | 'queued' | 'generating' | 'done' | 'error' | 'cancelled';
        content: string;
        wordCount: number;
        qualityScore?: number;
        feedback?: string;
        diagramError?: string;
        placeholderWarning?: PlaceholderWarning;
        error?: string;
        stage?: string;         // 当前工作流阶段，重连时恢复展示
        previousContent?: string;
        previousWordCount?: number;
        // 版本化内容历史（首版生成/编辑版/重生成版）
        versions?: Array<{
            id: string;
            label: string;
            type: 'generated' | 'edited' | 'regenerated';
            content: string;
            wordCount: number;
            createdAt: string;
        }>;
        activeVersionId?: string;
        originalVersionId?: string; // 首次生成版本 ID，用于一键复原
        lockedVersionId?: string;   // 章节锁定版本（导出优先使用）
    }>;
}

function toBidProjectRecord(project: Project) {
    return {
        id: project.id,
        name: project.name,
        status: project.status,
        data: project as unknown as Record<string, unknown>,
    };
}

function toProjectDataPayload(project: Project): Record<string, unknown> {
    return project as unknown as Record<string, unknown>;
}

function toLegacyProject(record: { id?: string; name?: string; status?: string; data?: Record<string, unknown>; created_at?: string; updated_at?: string }): Project {
    const data = (record.data || {}) as Partial<Project>;
    const now = new Date().toISOString();
    return {
        ...data,
        id: String(data.id || record.id || ''),
        name: String(data.name || record.name || '未命名标书项目'),
        bidFileName: String(data.bidFileName || data.name || record.name || '未命名标书项目'),
        status: (data.status || record.status || 'uploading') as ProjectStatus,
        createdAt: String(data.createdAt || record.created_at || now),
        updatedAt: String(data.updatedAt || record.updated_at || now),
    } as Project;
}

function toAnalysisNodeList(nodes: unknown[] | undefined): AnalysisNode[] {
    if (!Array.isArray(nodes)) return [];
    return nodes.map((node: any) => ({
        id: String(node?.id || ''),
        label: String(node?.label || node?.title || ''),
        content: String(node?.content || ''),
        parentId: node?.parentId ? String(node.parentId) : undefined,
        extractionPrompt: node?.extractionPrompt ? String(node.extractionPrompt) : undefined,
        numbered: node?.numbered === true,
        children: Array.isArray(node?.children) ? toAnalysisNodeList(node.children) : undefined,
    })).filter((node) => node.id);
}

function toRequirementItems(items: unknown[] | undefined): RequirementItem[] {
    if (!Array.isArray(items)) return [];
    return items.map((item: any, index: number) => ({
        id: String(item?.id || `req_${index + 1}`),
        type: item?.type === 'biz' || item?.type === 'score' ? item.type : 'tech',
        content: String(item?.content || ''),
        points: typeof item?.points === 'number' ? item.points : undefined,
    })).filter((item) => item.content);
}

function toAttachmentRequirements(items: unknown[] | undefined): AttachmentRequirement[] | undefined {
    if (!Array.isArray(items) || items.length === 0) return undefined;
    return items.map((item: any, index) => ({
        id: String(item?.id || `attachment_${index + 1}`),
        name: String(item?.name || item?.attachment_name || `附件${index + 1}`),
        description: String(item?.description || item?.attachment_desc || ''),
        type: String(item?.type || item?.attachment_type || 'generic'),
    }));
}

function toKnowledgeDocumentInfoList(items: unknown[] | undefined): KnowledgeDocumentInfo[] {
    if (!Array.isArray(items)) return [];
    return items.map((item: any) => ({
        id: String(item?.id || ''),
        name: String(item?.name || ''),
        size: String(item?.size || ''),
        uploadTime: String(item?.uploadTime || item?.upload_time || ''),
        status: (String(item?.status || 'indexing') as KnowledgeDocumentInfo['status']),
        chunks: Number(item?.chunks || 0),
    })).filter((item) => item.id && item.name);
}

function toOutlineSections(sections: unknown[] | undefined): OutlineSection[] {
    if (!Array.isArray(sections)) return [];
    return sections.map((section: any) => ({
        id: String(section?.id || ''),
        title: String(section?.title || ''),
        wordCount: Number(section?.wordCount ?? section?.word_count ?? 0),
        writingHint: String(section?.writingHint ?? section?.writing_hint ?? ''),
        keywords: Array.isArray(section?.keywords) ? section.keywords.map((item: unknown) => String(item)) : [],
        relatedAnalysisIds: Array.isArray(section?.relatedAnalysisIds) ? section.relatedAnalysisIds.map((item: unknown) => String(item)) : undefined,
        needDiagram: Boolean(section?.needDiagram ?? section?.need_diagram ?? false),
        diagramBrief: String(section?.diagramBrief ?? section?.diagram_brief ?? ''),
        headingLevel: Number(section?.headingLevel ?? section?.heading_level ?? 2),
        generationStrategy: String(section?.generationStrategy ?? section?.generation_strategy ?? 'general'),
        generatesFromSelf: Boolean(section?.generatesFromSelf ?? section?.generates_from_self ?? false),
        children: Array.isArray(section?.children)
            ? section.children.map((child: any) => ({
                id: String(child?.id || ''),
                title: String(child?.title || ''),
                wordCount: Number(child?.wordCount ?? child?.word_count ?? 0),
                writingHint: String(child?.writingHint ?? child?.writing_hint ?? ''),
                keywords: Array.isArray(child?.keywords) ? child.keywords.map((item: unknown) => String(item)) : [],
                relatedAnalysisIds: Array.isArray(child?.relatedAnalysisIds) ? child.relatedAnalysisIds.map((item: unknown) => String(item)) : undefined,
                needDiagram: Boolean(child?.needDiagram ?? child?.need_diagram ?? false),
                diagramBrief: String(child?.diagramBrief ?? child?.diagram_brief ?? ''),
                headingLevel: Number(child?.headingLevel ?? child?.heading_level ?? 2),
                generationStrategy: String(child?.generationStrategy ?? child?.generation_strategy ?? 'general'),
                generatesFromSelf: Boolean(child?.generatesFromSelf ?? child?.generates_from_self ?? false),
                children: Array.isArray(child?.children)
                    ? child.children.map((grandChild: any) => ({
                        id: String(grandChild?.id || ''),
                        title: String(grandChild?.title || ''),
                    })).filter((grandChild: any) => grandChild.id)
                    : undefined,
            })).filter((child: any) => child.id)
            : [],
    })).filter((section) => section.id);
}

function toBidderInfoRecord(value: BidderInfo | undefined): Record<string, unknown> | undefined {
    if (!value) return undefined;
    return {
        orgName: value.orgName,
        legalRep: value.legalRep,
        projectLead: value.projectLead,
        phone: value.phone,
        docDate: value.docDate,
    };
}

function normalizeLocator(value: string): string {
    return String(value || '')
        .trim()
        .replace(/^\[+|\]+$/g, '')
        .toUpperCase();
}

function normalizeBlockId(value: string): string {
    return String(value || '').trim().toUpperCase();
}

function buildAttachmentMatchKey(input: {
    locatorStart?: string;
    locatorEnd?: string;
    startBlockId?: string;
    endBlockId?: string;
    name?: string;
}): string {
    const ls = normalizeLocator(input.locatorStart || '');
    const le = normalizeLocator(input.locatorEnd || '');
    if (ls || le) return `loc:${ls}__${le}`;
    const bs = normalizeBlockId(input.startBlockId || '');
    const be = normalizeBlockId(input.endBlockId || '');
    if (bs || be) return `blk:${bs}__${be}`;
    const nm = String(input.name || '').trim();
    return nm ? `name:${nm}` : '';
}

function buildAttachmentModuleId(item: BidAttachmentItem, idx: number): string {
    const start = normalizeLocator(item.start_locator) || normalizeBlockId(item.start_block_id || '');
    const end = normalizeLocator(item.end_locator) || normalizeBlockId(item.end_block_id || '');
    const name = String(item.name || '')
        .trim()
        .toLowerCase()
        .replace(/[^\w\u4e00-\u9fa5]+/g, '_')
        .replace(/^_+|_+$/g, '');

    // 仅用起点会导致同锚点模块 ID 冲突，需合并终点和名称；再附 idx 兜底确保唯一。
    const base = [start, end, name || `idx_${idx + 1}`]
        .filter(Boolean)
        .join('__');
    return `att_${base || `idx_${idx + 1}`}`;
}

function buildStructureModuleId(prefix: string, headingId: string, idx: number): string {
    const safe = String(headingId || '')
        .trim()
        .toLowerCase()
        .replace(/[^\w\u4e00-\u9fa5]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return `${prefix}_${safe || `idx_${idx + 1}`}`;
}

function normalizeHeadingTitle(value: string): string {
    return String(value || '')
        .trim()
        .replace(/\s+/g, '')
        .toLowerCase();
}

function findOutlineSectionByHeading(
    heading: AnalysisStructureHeading,
    outline: OutlineSection[] | undefined,
): OutlineSection | null {
    if (!outline?.length) return null;
    const byId = outline.find((item) => item.id === heading.id);
    if (byId) return byId;
    const titleKey = normalizeHeadingTitle(heading.title);
    if (!titleKey) return null;
    return outline.find((item) => normalizeHeadingTitle(item.title) === titleKey) || null;
}

function resolveDoneContentCount(
    sectionIds: string[],
    generatedContent: Project['generatedContent'],
): { done: number; total: number } {
    let done = 0;
    for (const id of sectionIds) {
        if (generatedContent?.[id]?.status === 'done') done += 1;
    }
    return { done, total: sectionIds.length };
}

function resolveStructureFillStatus(
    htmlContent: string,
    sectionIds: string[],
    generatedContent: Project['generatedContent'],
): BidModule['fillStatus'] {
    if (htmlContent.trim()) return 'filled';
    if (!sectionIds.length) return 'unfilled';
    const { done, total } = resolveDoneContentCount(sectionIds, generatedContent);
    if (done === 0) return 'unfilled';
    if (done >= total) return 'filled';
    return 'partial';
}

export function buildBidModulesFromAttachmentList(attachments: BidAttachmentItem[]): BidModule[] {
    return (attachments || []).map((item, idx) => ({
        id: buildAttachmentModuleId(item, idx),
        name: item.name || `附件${idx + 1}`,
        source: 'extracted' as const,
        moduleKind: 'attachment',
        templateContent: '',
        fillStatus: 'unfilled' as const,
        enabled: true,
        order: idx,
        headingLevel: 1,
        structureCategory: 'attachments',
        locatorStart: normalizeLocator(item.start_locator),
        locatorEnd: normalizeLocator(item.end_locator),
        startBlockId: normalizeBlockId(item.start_block_id || '') || undefined,
        endBlockId: normalizeBlockId(item.end_block_id || '') || undefined,
        sourceAttachmentName: item.name || '',
        isTechProposalLink: false,
    }));
}

export function syncBidModulesFromAttachmentList(
    existingModules: BidModule[] | undefined,
    attachments: BidAttachmentItem[],
): BidModule[] {
    if (!existingModules?.length) {
        return buildBidModulesFromAttachmentList(attachments);
    }
    if (!attachments.length) {
        return existingModules
            .filter(item => item.source !== 'extracted')
            .map((item, idx) => ({ ...item, order: idx }));
    }

    const nextAttachmentModules = buildBidModulesFromAttachmentList(attachments);
    const nextById = new Map<string, BidModule>();
    const nextByKey = new Map<string, BidModule>();
    const nextByName = new Map<string, BidModule>();
    for (const next of nextAttachmentModules) {
        if (next.id) nextById.set(next.id, next);
        const key = buildAttachmentMatchKey({
            locatorStart: next.locatorStart || '',
            locatorEnd: next.locatorEnd || '',
            startBlockId: next.startBlockId || '',
            endBlockId: next.endBlockId || '',
            name: next.sourceAttachmentName || next.name,
        });
        if (key) nextByKey.set(key, next);
        const nameKey = String(next.sourceAttachmentName || next.name || '').trim();
        if (nameKey && !nextByName.has(nameKey)) nextByName.set(nameKey, next);
    }

    // 以用户已编排模块为主，目录重提取仅做锚点同步，避免覆盖手动新增/删除结果。
    const synced = existingModules.map((prev, idx) => {
        if (prev.source !== 'extracted') {
            return { ...prev, order: idx };
        }
        const key = buildAttachmentMatchKey({
            locatorStart: prev.locatorStart || '',
            locatorEnd: prev.locatorEnd || '',
            startBlockId: prev.startBlockId || '',
            endBlockId: prev.endBlockId || '',
            name: prev.sourceAttachmentName || prev.name,
        });
        const nameKey = String(prev.sourceAttachmentName || prev.name || '').trim();
        const next = nextById.get(prev.id) || nextByKey.get(key) || nextByName.get(nameKey);
        if (!next) {
            return { ...prev, order: idx };
        }
        return {
            ...next,
            id: prev.id || next.id,
            name: prev.name || next.name,
            enabled: prev.enabled ?? true,
            templateContent: prev.templateContent || '',
            filledContent: prev.filledContent,
            fillStatus: prev.fillStatus || next.fillStatus,
            isTechProposalLink: prev.isTechProposalLink ?? false,
            order: idx,
        };
    });

    const existingIds = new Set(synced.map(item => item.id));
    const appended = nextAttachmentModules
        .filter(item => !existingIds.has(item.id))
        .map((item, idx) => ({
            ...item,
            order: synced.length + idx,
        }));

    return [...synced, ...appended];
}

function buildStructuredBidModules(
    analysisV2: AnalysisV2,
    existingModules: BidModule[] | undefined,
    outline: OutlineSection[] | undefined,
    generatedContent: Project['generatedContent'],
): BidModule[] {
    const existingByStructureId = new Map<string, BidModule>();
    const existingById = new Map<string, BidModule>();
    for (const item of existingModules || []) {
        if (item.structureHeadingId) existingByStructureId.set(item.structureHeadingId, item);
        existingById.set(item.id, item);
    }

    const ordered: BidModule[] = [];
    const pushModule = (next: BidModule, structureId?: string) => {
        const existing = (structureId && existingByStructureId.get(structureId))
            || existingById.get(next.id);
        const htmlContent = existing?.filledContent || existing?.templateContent || next.filledContent || next.templateContent || '';
        const linkedSections = next.linkedSections || existing?.linkedSections || [];
        ordered.push({
            ...next,
            enabled: existing?.enabled ?? next.enabled,
            templateContent: existing?.templateContent || next.templateContent || '',
            filledContent: existing?.filledContent || next.filledContent,
            fillStatus: resolveStructureFillStatus(htmlContent, linkedSections, generatedContent),
            linkedSections,
            isTechProposalLink: false,
            locatorStart: next.locatorStart || existing?.locatorStart,
            locatorEnd: next.locatorEnd || existing?.locatorEnd,
            startBlockId: next.startBlockId || existing?.startBlockId,
            endBlockId: next.endBlockId || existing?.endBlockId,
            sourceAttachmentName: next.sourceAttachmentName || existing?.sourceAttachmentName,
        });
    };

    (analysisV2.bid_structure.attachments || [])
        .filter(item => !item.deleted)
        .forEach((item, idx) => {
            pushModule({
                id: buildStructureModuleId('bid_att', item.id, idx),
                name: item.title || item.source_title || `附件${idx + 1}`,
                source: 'extracted',
                moduleKind: 'attachment',
                structureCategory: 'attachments',
                structureHeadingId: item.id,
                headingLevel: 1,
                templateContent: '',
                fillStatus: 'unfilled',
                enabled: true,
                locatorStart: normalizeLocator(item.start_locator || ''),
                locatorEnd: normalizeLocator(item.end_locator || ''),
                startBlockId: normalizeBlockId(item.start_block_id || '') || undefined,
                endBlockId: normalizeBlockId(item.end_block_id || '') || undefined,
                sourceAttachmentName: item.source_title || item.title || '',
                order: ordered.length,
            }, item.id);
        });

    getTechnicalStructureHeadings(analysisV2).forEach((item, idx) => {
        const outlineSection = findOutlineSectionByHeading(item, outline);
        const linkedSections = outlineSection?.children?.map(child => child.id).filter(Boolean) || [];
        if (!linkedSections.length && outlineSection?.id) linkedSections.push(outlineSection.id);
        pushModule({
            id: buildStructureModuleId('bid_tech', item.id, idx),
            name: item.title,
            source: 'ai_generated',
            moduleKind: 'technical',
            structureCategory: 'technical',
            structureHeadingId: item.id,
            headingLevel: 1,
            templateContent: '',
            fillStatus: 'unfilled',
            enabled: true,
            linkedSections,
            order: ordered.length,
        }, item.id);
    });

    getBusinessStructureHeadings(analysisV2).forEach((item, idx) => {
        pushModule({
            id: buildStructureModuleId('bid_biz', item.id, idx),
            name: item.title,
            source: 'manual',
            moduleKind: 'business',
            structureCategory: 'business',
            structureHeadingId: item.id,
            headingLevel: 1,
            templateContent: '',
            fillStatus: 'unfilled',
            enabled: true,
            order: ordered.length,
        }, item.id);
    });

    const rankMap = new Map<string, number>();
    (existingModules || [])
        .slice()
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .forEach((item, idx) => {
            if (item.structureHeadingId) rankMap.set(`s:${item.structureHeadingId}`, idx);
            rankMap.set(`i:${item.id}`, idx);
        });

    const resolveRank = (item: BidModule, fallback: number) => {
        if (item.structureHeadingId) {
            const byStructure = rankMap.get(`s:${item.structureHeadingId}`);
            if (byStructure !== undefined) return byStructure;
        }
        const byId = rankMap.get(`i:${item.id}`);
        if (byId !== undefined) return byId;
        return 10000 + fallback;
    };

    const sortByRank = (items: BidModule[]) =>
        items
            .map((item, idx) => ({ item, rank: resolveRank(item, idx) }))
            .sort((a, b) => a.rank - b.rank)
            .map((entry) => entry.item);

    const attachments = sortByRank(ordered.filter((item) => item.moduleKind === 'attachment'));
    const technical = sortByRank(ordered.filter((item) => item.moduleKind === 'technical'));
    const business = sortByRank(ordered.filter((item) => item.moduleKind === 'business'));
    const others = sortByRank(ordered.filter((item) => !item.moduleKind));

    return [...attachments, ...technical, ...business, ...others].map((item, idx) => ({ ...item, order: idx }));
}

export function syncBidModulesForProject(
    project: Pick<Project, 'analysisV2' | 'bidAttachmentList' | 'outline' | 'generatedContent' | 'bidModules'>,
    preferredModules?: BidModule[],
): BidModule[] {
    if (project.analysisV2?.schema_version) {
        return buildStructuredBidModules(
            project.analysisV2,
            preferredModules ?? project.bidModules,
            project.outline,
            project.generatedContent,
        );
    }
    return syncBidModulesFromAttachmentList(
        preferredModules ?? project.bidModules,
        project.bidAttachmentList || [],
    );
}

// ────────────────────── 常量 ──────────────────────

const STORAGE_KEY = 'proengine_projects';
let writeQueue: Promise<void> = Promise.resolve();
const projectChangeListeners = new Set<() => void>();
const RUNTIME_DONE_STATES = new Set(['succeeded', 'cancelled', 'failed', 'timed_out']);
const ACTIVE_RUNTIME_STATES = new Set(['queued', 'running', 'cancelling']);
const ACTIVE_CONTENT_STATES = new Set(['queued', 'generating']);

export const buildContentTaskStorageKey = (projectId: string, sectionId: string): string =>
    `content_task_${projectId}_${sectionId}`;

export const getContentTaskStorageCandidates = (projectId: string, sectionId: string): string[] =>
    [
        buildContentTaskStorageKey(projectId, sectionId),
        // 兼容旧版本键，迁移完成后可删除
        `content_task_${sectionId}`,
    ];

function isActiveRuntimeState(state?: string): boolean {
    return ACTIVE_RUNTIME_STATES.has(String(state || '').trim());
}

function isActiveContentState(status?: string): boolean {
    return ACTIVE_CONTENT_STATES.has(String(status || '').trim());
}

function getProjectTaskStorageKeys(projectId: string): string[] {
    const keys: string[] = [];
    const exactKeys = [
        `outline_task_${projectId}`,
        `proengine_analyze_task_${projectId}`,
        `extract_task_${projectId}`,
    ];
    for (const key of exactKeys) {
        if (localStorage.getItem(key)) keys.push(key);
    }
    Object.keys(localStorage).forEach((key) => {
        if (key.startsWith(`content_task_${projectId}_`) && localStorage.getItem(key)) {
            keys.push(key);
        }
    });
    return Array.from(new Set(keys));
}

function recoverGeneratedContentState(
    state: NonNullable<Project['generatedContent']>[string],
): NonNullable<Project['generatedContent']>[string] {
    if (state.previousContent?.trim()) {
        return {
            ...state,
            status: 'done',
            content: state.previousContent,
            wordCount: state.previousWordCount || Number(state.wordCount || 0),
            error: undefined,
            stage: undefined,
        };
    }
    return {
        ...state,
        status: 'idle',
        content: '',
        wordCount: 0,
        error: undefined,
        stage: undefined,
    };
}

function normalizeRecoveredProjectStatus(project: Project): ProjectStatus {
    if (project.status === 'generating_outline') {
        return hasCompletedOutline(project.outline) ? 'outline_ready' : 'report_done';
    }
    if (project.status === 'generating_content') {
        return 'editing';
    }
    if (project.status === 'parsing_report' && (project.analysisV2?.schema_version || project.analysisReport?.length)) {
        return 'report_done';
    }
    return project.status;
}

function buildRecoveredGeneratedContent(
    project: Project,
    keepBusyBlockIds: Set<string> = new Set(),
): NonNullable<Project['generatedContent']> | undefined {
    if (!project.generatedContent) return undefined;
    let changed = false;
    const next = Object.fromEntries(
        Object.entries(project.generatedContent).map(([blockId, state]) => {
            if (!isActiveContentState(state?.status) || keepBusyBlockIds.has(blockId)) {
                return [blockId, state];
            }
            changed = true;
            return [blockId, recoverGeneratedContentState(state)];
        }),
    ) as NonNullable<Project['generatedContent']>;
    return changed ? next : undefined;
}

function deriveActiveTaskType(project: Project, taskKeys: string[]): ProjectTaskRuntime['taskType'] | undefined {
    if (isActiveRuntimeState(project.taskRuntime?.state)) {
        return project.taskRuntime?.taskType;
    }
    if (taskKeys.some((key) => key.startsWith(`content_task_${project.id}_`))) return 'content';
    if (taskKeys.includes(`outline_task_${project.id}`)) return 'outline';
    if (taskKeys.includes(`proengine_analyze_task_${project.id}`) || taskKeys.includes(`extract_task_${project.id}`)) {
        return project.taskRuntime?.taskType === 'extract' ? 'extract' : 'analyze';
    }
    const busyBlocks = Object.entries(project.generatedContent || {}).filter(([, state]) => isActiveContentState(state?.status));
    if (busyBlocks.length > 0) return 'content';
    return undefined;
}

function getProjectBusyMetaInternal(project: Project | null | undefined): ProjectBusyMeta {
    if (!project?.id) {
        return {
            busy: false,
            runtimeBusy: false,
            taskKeys: [],
            busyContentBlockIds: [],
        };
    }
    const runtimeBusy = isActiveRuntimeState(project.taskRuntime?.state);
    const taskKeys = getProjectTaskStorageKeys(project.id);
    const busyContentBlockIds = Object.entries(project.generatedContent || {})
        .filter(([, state]) => isActiveContentState(state?.status))
        .map(([blockId]) => blockId);
    const activeTaskType = deriveActiveTaskType(project, taskKeys);
    return {
        busy: runtimeBusy || taskKeys.length > 0 || busyContentBlockIds.length > 0 || project.status === 'uploading' || project.status === 'parsing',
        runtimeBusy,
        taskKeys,
        activeTaskType,
        activeRuntimeState: runtimeBusy ? project.taskRuntime?.state : undefined,
        busyContentBlockIds,
    };
}

// ────────────────────── 本地缓存层 ──────────────────────

function loadAll(): Project[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw
            ? (JSON.parse(raw) as Project[]).map(normalizeProjectCachedData)
            : [];
    } catch {
        return [];
    }
}

function pickLegacyActiveVersion(state: NonNullable<Project['generatedContent']>[string]): {
    content: string;
    wordCount: number;
} {
    if (Array.isArray(state?.versions) && state.versions.length > 0) {
        const active = state.versions.find((item) => item.id === state.activeVersionId);
        if (active) {
            return {
                content: String(active.content || ''),
                wordCount: Number(active.wordCount || 0),
            };
        }
    }
    if (typeof state?.content === 'string' && state.content.trim()) {
        return {
            content: state.content,
            wordCount: Number(state.wordCount || 0),
        };
    }
    if (!Array.isArray(state?.versions) || state.versions.length === 0) {
        return { content: '', wordCount: 0 };
    }
    const fallback = state.versions[state.versions.length - 1];
    return {
        content: String(fallback?.content || ''),
        wordCount: Number(fallback?.wordCount || 0),
    };
}

function normalizeGeneratedContentState(
    state: NonNullable<Project['generatedContent']>[string],
): NonNullable<Project['generatedContent']>[string] {
    const visible = pickLegacyActiveVersion(state);
    const versions = Array.isArray(state?.versions) ? state.versions : [];
    const fallbackPrevious = versions.length > 1 ? versions[versions.length - 2] : null;
    const previousContent = typeof state?.previousContent === 'string' && state.previousContent.trim()
        ? state.previousContent
        : String(fallbackPrevious?.content || '');
    const previousWordCount = typeof state?.previousWordCount === 'number'
        ? state.previousWordCount
        : Number(fallbackPrevious?.wordCount || 0);
    return {
        ...state,
        content: visible.content,
        wordCount: visible.wordCount,
        previousContent,
        previousWordCount,
    };
}

function coerceOutlineWordCount(item: any, fallback = 0): number {
    const raw = item?.wordCount ?? item?.word_count ?? item?.expectedWordCount ?? item?.expected_word_count ?? fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

function normalizeOutlineDiagramPlan(item: any): OutlineSection['diagramPlan'] {
    const plan = item?.diagramPlan ?? item?.diagram_plan;
    if (!plan || typeof plan !== 'object') return undefined;
    return {
        enabled: Boolean(plan.enabled),
        brief: String(plan.brief || ''),
        typeHint: plan.typeHint ?? plan.type_hint,
        priority: typeof plan.priority === 'number' ? plan.priority : undefined,
    };
}

/**
 * 归一化大纲节点，隔离 Dify/历史缓存中 children 缺失、snake_case 字段混用等脏数据。
 */
function normalizeOutlineData(outline?: OutlineSection[] | null): OutlineSection[] | undefined {
    if (!Array.isArray(outline)) return outline || undefined;
    return outline
        .filter((section: any) => section && typeof section === 'object')
        .map((section: any, sectionIndex) => ({
            ...section,
            id: String(section.id || `section_${sectionIndex + 1}`),
            title: String(section.title || `技术章节 ${sectionIndex + 1}`),
            wordCount: coerceOutlineWordCount(section, 0),
            writingHint: String(section.writingHint ?? section.writing_hint ?? ''),
            keywords: Array.isArray(section.keywords) ? section.keywords.map((kw: any) => String(kw)).filter(Boolean) : [],
            relatedAnalysisIds: Array.isArray(section.relatedAnalysisIds ?? section.related_analysis_ids)
                ? (section.relatedAnalysisIds ?? section.related_analysis_ids).map((id: any) => String(id)).filter(Boolean)
                : [],
            needDiagram: Boolean(section.needDiagram ?? section.need_diagram ?? false),
            diagramBrief: String(section.diagramBrief ?? section.diagram_brief ?? ''),
            diagramPlan: normalizeOutlineDiagramPlan(section),
            headingLevel: Number(section.headingLevel ?? section.heading_level ?? 2) || 2,
            generationStrategy: String(section.generationStrategy ?? section.generation_strategy ?? 'general'),
            generatesFromSelf: Boolean(section.generatesFromSelf ?? section.generates_from_self ?? false),
            children: Array.isArray(section.children)
                ? section.children
                    .filter((child: any) => child && typeof child === 'object')
                    .map((child: any, childIndex: number) => ({
                        ...child,
                        id: String(child.id || `${section.id || `section_${sectionIndex + 1}`}_child_${childIndex + 1}`),
                        title: String(child.title || `子章节 ${childIndex + 1}`),
                        wordCount: coerceOutlineWordCount(child, 0),
                        writingHint: String(child.writingHint ?? child.writing_hint ?? ''),
                        keywords: Array.isArray(child.keywords) ? child.keywords.map((kw: any) => String(kw)).filter(Boolean) : [],
                        relatedAnalysisIds: Array.isArray(child.relatedAnalysisIds ?? child.related_analysis_ids)
                            ? (child.relatedAnalysisIds ?? child.related_analysis_ids).map((id: any) => String(id)).filter(Boolean)
                            : [],
                        needDiagram: Boolean(child.needDiagram ?? child.need_diagram ?? false),
                        diagramBrief: String(child.diagramBrief ?? child.diagram_brief ?? ''),
                        diagramPlan: normalizeOutlineDiagramPlan(child),
                        headingLevel: Number(child.headingLevel ?? child.heading_level ?? 3) || 3,
                        generationStrategy: String(child.generationStrategy ?? child.generation_strategy ?? section.generationStrategy ?? section.generation_strategy ?? 'general'),
                        generatesFromSelf: Boolean(child.generatesFromSelf ?? child.generates_from_self ?? false),
                        children: Array.isArray(child.children)
                            ? child.children
                                .filter((leaf: any) => leaf && typeof leaf === 'object')
                                .map((leaf: any, leafIndex: number) => ({
                                    ...leaf,
                                    id: String(leaf.id || `${child.id || `child_${childIndex + 1}`}_leaf_${leafIndex + 1}`),
                                    title: String(leaf.title || `三级标题 ${leafIndex + 1}`),
                                    wordCount: coerceOutlineWordCount(leaf, 0),
                                    writingHint: String(leaf.writingHint ?? leaf.writing_hint ?? ''),
                                    keywords: Array.isArray(leaf.keywords) ? leaf.keywords.map((kw: any) => String(kw)).filter(Boolean) : [],
                                    headingLevel: Number(leaf.headingLevel ?? leaf.heading_level ?? 4) || 4,
                                }))
                            : [],
                    }))
                : [],
        }));
}

function buildPrivacyPlaceholderHint(
    mappingTable: Record<string, string> = {},
    manifest: PlaceholderManifest = {},
): string {
    const tokens = Object.keys(manifest || {}).length ? Object.keys(manifest) : Object.keys(mappingTable || {});
    if (!tokens.length) return '';
    const sample = tokens.slice(0, 8).join('、');
    const suffix = tokens.length > 8 ? ' ...' : '';
    const contextRows = buildPlaceholderContextRows(tokens, manifest);
    return [
        `文中含 ${tokens.length} 个本地脱敏占位符，统一使用 @@PIPT:v1:e000001:kxxxxxxxx@@ 强 token 样式，兼容历史 {{__PIPT_类型_序号__}} 格式。`,
        `这些 token 只代表安全语义，不包含真实敏感值；输出必须逐字原样保留，禁止改写、缩写、翻译、拆分或重新编号。`,
        `可以参考 PIPT_TOKEN_CONTEXT_JSON 理解每个 token 的实体类型和上下文；引用时必须输出 token 本身。`,
        `PIPT_ALLOWED_PLACEHOLDERS_JSON:${JSON.stringify(tokens)}`,
        `PIPT_TOKEN_CONTEXT_JSON:${JSON.stringify(contextRows)}`,
        `当前 token 示例：${sample}${suffix}`,
    ].join('\n');
}

function buildContentPlaceholderContext(project?: Project) {
    const mappingTable = project?.mappingTable || {};
    const privacyHint = buildPrivacyPlaceholderHint(mappingTable, project?.placeholderManifest || {});
    return {
        mappingTable,
        bidderMappingTable: {},
        placeholderHint: privacyHint,
    };
}

function normalizeProjectCachedData(project: Project): Project {
    const outline = normalizeOutlineData(project?.outline);
    if (!project?.generatedContent) {
        return outline === project?.outline ? project : { ...project, outline };
    }
    const generatedContent = Object.fromEntries(
        Object.entries(project.generatedContent).map(([blockId, state]) => [
            blockId,
            normalizeGeneratedContentState(state),
        ]),
    );
    return {
        ...project,
        outline,
        generatedContent,
    };
}

function saveAll(projects: Project[]): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
    projectChangeListeners.forEach((listener) => {
        try {
            listener();
        } catch (err) {
            console.warn('[projectService] project change listener error:', err);
        }
    });
}

// ────────────────────── 服务器同步层 ──────────────────────

function normalizeRuntimeState(state?: string): ProjectTaskRuntime['state'] {
    switch ((state || '').trim()) {
        case 'queued':
        case 'running':
        case 'cancelling':
        case 'cancelled':
        case 'succeeded':
        case 'failed':
        case 'timed_out':
            return state as ProjectTaskRuntime['state'];
        case 'idle':
            return 'succeeded';
        case 'error':
            return 'failed';
        default:
            return 'failed';
    }
}

function normalizeProjectFromServer(raw: Project): Project {
    const normalizedProject = normalizeProjectCachedData(raw);
    const rt = normalizedProject?.taskRuntime;
    if (!rt) return normalizedProject;
    const normalized: ProjectTaskRuntime = {
        ...rt,
        state: normalizeRuntimeState(rt.state),
        progress: typeof rt.progress === 'number' ? rt.progress : 0,
        startedAt: rt.startedAt || rt.updatedAt || new Date().toISOString(),
        updatedAt: rt.updatedAt || new Date().toISOString(),
        cancellable: typeof rt.cancellable === 'boolean'
            ? rt.cancellable
            : (rt.state === 'queued' || rt.state === 'running' || rt.state === 'cancelling'),
    };
    // 终态不可取消，避免前端误判
    if (RUNTIME_DONE_STATES.has(normalized.state)) {
        normalized.cancellable = false;
    }
    return { ...normalizedProject, taskRuntime: normalized };
}

function mapExtractStageProgress(stage: string): { step: number; label: string; percent: number } {
    const s = (stage || '').trim();
    if (!s) return { step: 0, label: '准备中...', percent: 0 };

    if (s.includes('解析文档结构') || s.includes('文档结构解析完成')) {
        return {
            step: 0,
            label: s.includes('完成') ? '解析文档结构完成' : '解析文档结构',
            percent: s.includes('完成') ? 36 : 18,
        };
    }

    if (
        s.includes('隐私脱敏处理中')
        || s.includes('脱敏完成')
        || s.includes('脱敏跳过')
        || s.includes('跳过脱敏')
    ) {
        return {
            step: 1,
            label: s.includes('处理中') ? '隐私脱敏处理' : '隐私脱敏完成',
            percent: s.includes('处理中') ? 58 : 76,
        };
    }

    if (s.includes('预处理完成')) {
        return { step: 2, label: '提取关键信息', percent: 96 };
    }

    return { step: 2, label: '提取关键信息', percent: 88 };
}

/** 整项目快照同步（仅用于创建/迁移场景） */
function syncProjectSnapshotToServer(project: Project): void {
    enqueueWrite(async () => {
        let proj: any;
        try {
            proj = await createProjectApi(toProjectDataPayload(project) as any);
        } catch {
            proj = await updateProjectCompat(project.id, {
                name: project.name,
                status: project.status,
                data: toProjectDataPayload(project),
            });
        }
        if (proj?.id) applyServerProjectToLocal(normalizeProjectFromServer((proj?.data || proj) as Project));
    }, '[sync] 后端同步失败:');
}

/** 字段级 patch 同步（默认路径，避免整对象覆盖） */
function syncProjectPatchToServer(
    projectId: string,
    patch: Partial<Omit<Project, 'id' | 'createdAt'>>,
    fallbackMeta?: { name?: string; status?: string },
): void {
    enqueueWrite(async () => {
        const proj = await patchProjectApi(
            projectId,
            patch as unknown as any,
            fallbackMeta?.status,
            fallbackMeta?.name,
        );
        if (proj?.id) applyServerProjectToLocal(normalizeProjectFromServer((proj?.data || proj) as Project));
    }, '[sync] 项目 patch 失败:');
}

/** 后台删除服务器上的项目缓存（PDF 等） */
function deleteProjectFromServer(id: string): void {
    enqueueWrite(async () => {
        // 1) 删除 SQLite 项目记录（project_routes.py），短重试应对瞬时锁冲突
        let projectDeleteOk = false;
        for (let i = 0; i < 3; i += 1) {
            try {
                await deleteProjectApi(id);
                projectDeleteOk = true;
                break;
            } catch {
                // ignore and retry
            }
            if (i < 2) {
                await new Promise(resolve => setTimeout(resolve, 250 * (i + 1)));
            }
        }
        if (!projectDeleteOk) throw new Error('project delete failed after retries');

        // 2) 删除文件/内存缓存（routes.py）
        try {
            await deleteProjectCachesApi(id);
        } catch (error) {
            if (!(error instanceof Error)) {
                throw error;
            }
        }
        // 删除后回读一次后端，确保本地缓存与后端最终一致
        const serverProjects = await fetchServerProjects({ waitForWrites: false });
        if (serverProjects) {
            saveAll(serverProjects);
        } else {
            // 网络异常时兜底：至少保证本地不会把已删项目回显
            saveAll(loadAll().filter(p => p.id !== id));
        }
    }, '[sync] 服务器删除失败:');
}

function enqueueWrite(task: () => Promise<void>, logPrefix: string): void {
    writeQueue = writeQueue
        .then(task)
        .catch(err => console.warn(logPrefix, err));
}

function applyServerProjectToLocal(proj: Project): void {
    const normalized = normalizeProjectFromServer(proj);
    const local = loadAll();
    const idx = local.findIndex(p => p.id === normalized.id);
    if (idx >= 0) local[idx] = normalized;
    else local.push(normalized);
    saveAll(local);
}

async function fetchServerProjects(options?: { waitForWrites?: boolean }): Promise<Project[] | null> {
    try {
        if (options?.waitForWrites !== false) {
            await writeQueue;
        }
        const rows: any[] = await listProjectsApi();
        return rows.map((sp: any) => normalizeProjectFromServer((sp?.data || sp) as Project));
    } catch {
        return null;
    }
}

async function fetchServerProject(id: string): Promise<Project | null> {
    try {
        await writeQueue;
        const row: any = await getProjectApi(id);
        return normalizeProjectFromServer((row?.data || row) as Project);
    } catch {
        return null;
    }
}

function setLocalTaskRuntime(
    projectId: string,
    runtime: {
        state: ProjectTaskRuntime['state'];
        taskId: string;
        taskType?: ProjectTaskRuntime['taskType'];
        message?: string;
        progress?: number;
        cancellable?: boolean;
    },
): void {
    const latest = projectService.getById(projectId);
    if (!latest) return;
    const now = new Date().toISOString();
    const prev = latest.taskRuntime;
    const nextTaskId = String(runtime.taskId || prev?.taskId || '').trim();
    if (!nextTaskId) return;
    const state = runtime.state;
    projectService.update(projectId, {
        taskRuntime: {
            state,
            taskId: nextTaskId,
            taskType: runtime.taskType || prev?.taskType || 'content',
            message: runtime.message ?? '',
            progress: runtime.progress ?? (state === 'succeeded' ? 100 : 0),
            startedAt: prev?.taskId === nextTaskId ? (prev.startedAt || now) : now,
            cancellable: runtime.cancellable ?? (state === 'queued' || state === 'running' || state === 'cancelling'),
            updatedAt: now,
        },
    });
}


/** 从服务器拉取项目并覆盖本地缓存（后端为 SSOT） */
async function syncFromServer(): Promise<void> {
    const serverProjects = await fetchServerProjects();
    if (serverProjects && serverProjects.length > 0) {
        saveAll(serverProjects);
        return;
    }

    // 仅当后端空库时，才将历史本地数据做一次回填迁移。
    const local = loadAll();
    if (!local.length) return;
    const migrated = await migrateToServer();
    if (!migrated) return;
    const afterMigrate = await fetchServerProjects();
    if (afterMigrate && afterMigrate.length > 0) {
        saveAll(afterMigrate);
    }
}

/** 将本地所有项目批量推送到服务器（首次迁移用） */
async function migrateToServer(): Promise<{ created: number; updated: number } | null> {
    try {
        const all = loadAll();
        if (!all.length) return null;
        const payload = all.map(p => ({ id: p.id, name: p.name, status: p.status, data: p })) as any[];
        const result = await batchUpsertProjectsApi(payload);
        return {
            created: Number(result.created || 0),
            updated: Number(result.updated || 0),
        };
    } catch { /* 静默 */ }
    return null;
}

async function updateProjectCompat(projectId: string, patch: { name?: string; status?: string; data?: Record<string, unknown> }) {
    return updateProjectApi(projectId, patch as any);
}

// ────────────────────── Service API ──────────────────────

export const projectService = {
    /** 订阅项目缓存变更（用于跨组件实时同步） */
    subscribe(listener: () => void): () => void {
        projectChangeListeners.add(listener);
        return () => {
            projectChangeListeners.delete(listener);
        };
    },

    /** 获取所有项目（按创建时间倒序） */
    getAll(): Project[] {
        return loadAll().sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
    },

    /** 根据 ID 获取单个项目 */
    getById(id: string): Project | undefined {
        return loadAll().find(p => p.id === id);
    },

    /** 创建新项目（上传文件后立即调用，初始状态为 parsing） */
    create(file: File): Project {
        const now = new Date().toISOString();
        const project: Project = {
            id: `proj_${Date.now()}`,
            name: file.name.replace(/\.\w+$/, ''), // 去掉扩展名作为初始名称
            bidFileName: file.name,
            status: 'parsing',
            createdAt: now,
            updatedAt: now,
        };
        const all = loadAll();
        saveAll([...all, project]);
        syncProjectSnapshotToServer(project);
        return project;
    },

    /** 更新项目部分字段 */
    update(id: string, patch: Partial<Omit<Project, 'id' | 'createdAt'>>): Project | null {
        const all = loadAll();
        const idx = all.findIndex(p => p.id === id);
        if (idx === -1) return null;
        const normalizedPatch: Partial<Omit<Project, 'id' | 'createdAt'>> = { ...patch };
        const mergedPreview: Project = {
            ...all[idx],
            ...normalizedPatch,
            updatedAt: all[idx].updatedAt,
        };
        if (
            normalizedPatch.analysisV2
            || normalizedPatch.outline
            || normalizedPatch.generatedContent
            || normalizedPatch.bidModules
            || Array.isArray(normalizedPatch.bidAttachmentList)
        ) {
            normalizedPatch.bidModules = syncBidModulesForProject(
                mergedPreview,
                normalizedPatch.bidModules ?? all[idx].bidModules,
            );
        }
        const updated: Project = {
            ...all[idx],
            ...normalizedPatch,
            updatedAt: new Date().toISOString(),
        };
        all[idx] = updated;
        saveAll(all);
        syncProjectPatchToServer(id, normalizedPatch, {
            name: Object.prototype.hasOwnProperty.call(normalizedPatch, 'name') ? updated.name : undefined,
            status: Object.prototype.hasOwnProperty.call(normalizedPatch, 'status') ? updated.status : undefined,
        });
        return updated;
    },

    /**
     * 强制将项目变更立即写入后端（用于锚点等关键手动编辑场景）。
     * 说明：先更新本地，再同步后端；后端失败时抛错，由调用方决定 UI 反馈策略。
     */
    async updateAndPersist(
        id: string,
        patch: Partial<Omit<Project, 'id' | 'createdAt'>>,
    ): Promise<Project | null> {
        const updated = this.update(id, patch);
        if (!updated) return null;

        let lastError: Error | null = null;
        for (let i = 0; i < 3; i += 1) {
            try {
                const proj = await patchProjectApi(
                    id,
                    patch as Record<string, unknown>,
                    Object.prototype.hasOwnProperty.call(patch, 'status') ? updated.status : undefined,
                    Object.prototype.hasOwnProperty.call(patch, 'name') ? updated.name : undefined,
                );
                if (proj?.id) applyServerProjectToLocal(toLegacyProject(proj));
                return updated;
            } catch (err) {
                lastError = err as Error;
                if (i < 2) await new Promise(resolve => setTimeout(resolve, 200 * (i + 1)));
            }
        }

        throw lastError || new Error('persist failed');
    },

    /** 删除项目 */
    delete(id: string): void {
        saveAll(loadAll().filter(p => p.id !== id));
        deleteProjectFromServer(id);
    },

    /** 从服务器拉取项目数据合并到本地（App 启动时调用） */
    syncFromServer,

    /** 将本地数据批量推送到服务器（首次迁移用） */
    migrateToServer,

    /** 查询任务状态（后端标准状态机） */
    async getTaskStatus(taskId: string, projectId?: string): Promise<any> {
        const data = await getTaskStatusApi(taskId, projectId);
        if (!data?.state && data?.status) {
            data.state = normalizeRuntimeState(data.status);
        }
        return data;
    },

    getProjectBusyMeta(project: Project | null | undefined): ProjectBusyMeta {
        return getProjectBusyMetaInternal(project);
    },

    async repairZombieLocks(
        projectId?: string,
        options?: { forceLocalDiagramWait?: boolean },
    ): Promise<{ checked: number; cleared: number; active: number }> {
        const targets = loadAll().filter((proj) => !projectId || proj.id === projectId);
        let checked = 0;
        let cleared = 0;
        let active = 0;

        for (const target of targets) {
            let latest = this.getById(target.id) || target;
            const busyMeta = getProjectBusyMetaInternal(latest);
            const taskKeyMap = new Map<string, string[]>();
            let projectHasActiveTasks = false;

            for (const key of busyMeta.taskKeys) {
                const taskId = String(localStorage.getItem(key) || '').trim();
                if (!taskId) continue;
                const rows = taskKeyMap.get(taskId) || [];
                rows.push(key);
                taskKeyMap.set(taskId, rows);
            }
            if (isActiveRuntimeState(latest.taskRuntime?.state) && latest.taskRuntime?.taskId) {
                const runtimeTaskId = String(latest.taskRuntime.taskId).trim();
                if (runtimeTaskId && !taskKeyMap.has(runtimeTaskId)) {
                    taskKeyMap.set(runtimeTaskId, []);
                }
            }

            const keepBusyBlockIds = new Set<string>();
            let runtimeStatePatch: Partial<ProjectTaskRuntime> | null = null;

            for (const [taskId, keys] of taskKeyMap.entries()) {
                if (taskId.startsWith('diagram_wait_') && latest.taskRuntime?.taskId === taskId) {
                    if (options?.forceLocalDiagramWait) {
                        runtimeStatePatch = {
                            ...latest.taskRuntime,
                            state: 'timed_out',
                            message: '本地图表等待态已手动清理',
                            cancellable: false,
                            updatedAt: new Date().toISOString(),
                        };
                    } else {
                        projectHasActiveTasks = true;
                        active += 1;
                    }
                    continue;
                }
                checked += 1;
                try {
                    const data = await this.getTaskStatus(taskId, latest.id);
                    const state = normalizeRuntimeState(data?.state || data?.status);
                    if (isActiveRuntimeState(state)) {
                        projectHasActiveTasks = true;
                        active += 1;
                        keys.forEach((key) => {
                            if (key.startsWith(`content_task_${latest.id}_`)) {
                                const blockId = key.slice(`content_task_${latest.id}_`.length);
                                if (blockId) keepBusyBlockIds.add(blockId);
                            }
                        });
                        continue;
                    }
                    keys.forEach((key) => {
                        localStorage.removeItem(key);
                        cleared += 1;
                    });
                    if (latest.taskRuntime?.taskId === taskId && isActiveRuntimeState(latest.taskRuntime?.state)) {
                        runtimeStatePatch = {
                            ...latest.taskRuntime,
                            state,
                            message: data?.error || '',
                            cancellable: false,
                            updatedAt: new Date().toISOString(),
                        };
                    }
                } catch {
                    keys.forEach((key) => {
                        localStorage.removeItem(key);
                        cleared += 1;
                    });
                    if (latest.taskRuntime?.taskId === taskId && isActiveRuntimeState(latest.taskRuntime?.state)) {
                        runtimeStatePatch = {
                            ...latest.taskRuntime,
                            state: 'timed_out',
                            message: '任务不存在或已过期，已清理本地锁',
                            cancellable: false,
                            updatedAt: new Date().toISOString(),
                        };
                    }
                }
            }

            if (taskKeyMap.size === 0 && isActiveRuntimeState(latest.taskRuntime?.state)) {
                runtimeStatePatch = {
                    ...latest.taskRuntime,
                    state: 'timed_out',
                    message: '任务标识缺失，已清理本地锁',
                    cancellable: false,
                    updatedAt: new Date().toISOString(),
                };
            }

            latest = this.getById(target.id) || latest;
            const nextBusyMeta = getProjectBusyMetaInternal(latest);
            const recoveredGeneratedContent = buildRecoveredGeneratedContent(latest, keepBusyBlockIds);
            const patch: Partial<Omit<Project, 'id' | 'createdAt'>> = {};
            let shouldPatch = false;

            if (runtimeStatePatch) {
                patch.taskRuntime = runtimeStatePatch as ProjectTaskRuntime;
                shouldPatch = true;
            } else if (!nextBusyMeta.runtimeBusy && latest.taskRuntime && RUNTIME_DONE_STATES.has(normalizeRuntimeState(latest.taskRuntime.state))) {
                patch.taskRuntime = {
                    ...latest.taskRuntime,
                    cancellable: false,
                    updatedAt: new Date().toISOString(),
                };
                shouldPatch = true;
            }

            if (recoveredGeneratedContent) {
                patch.generatedContent = recoveredGeneratedContent;
                shouldPatch = true;
            }

            const willRemainBusy = projectHasActiveTasks || latest.status === 'uploading' || latest.status === 'parsing';
            if (!willRemainBusy) {
                const nextStatus = normalizeRecoveredProjectStatus(latest);
                if (nextStatus !== latest.status) {
                    patch.status = nextStatus;
                    shouldPatch = true;
                }
            }

            if (shouldPatch) {
                this.update(latest.id, patch);
            }
        }

        return { checked, cleared, active };
    },

    /** 打开通用任务进度 SSE（outline/extract/content 等） */
    async openTaskProgressStream(taskId: string, projectId: string, signal?: AbortSignal): Promise<Response> {
        return fetchTaskProgressResponse(taskId, projectId, signal);
    },

    /**
     * 启动大纲后台任务（start-outline），并写入本地运行态。
     * 返回 taskId 供页面重连 progress SSE。
     */
    async startOutlineTask(projectId: string): Promise<{ taskId: string }> {
        const proj = this.getById(projectId);
        if (!proj) throw new Error('项目不存在，无法启动大纲任务');
        this.update(projectId, {
            status: 'generating_outline',
            taskRuntime: {
                state: 'queued',
                taskId: proj.taskRuntime?.taskId,
                taskType: 'outline',
                message: '大纲任务排队中',
                progress: 0,
                startedAt: proj.taskRuntime?.startedAt || new Date().toISOString(),
                cancellable: true,
                updatedAt: new Date().toISOString(),
            },
        });
        const requirements = (proj.requirements || []) as any[];
        const bidType = (proj as any).bidType || 'tech';
        const targetConfig = proj.targetConfig;
        const analysisContext = proj.analysisReport?.length
            ? buildAnalysisContextForOutline(proj.analysisReport)
            : '';
        const structureHeadingSeedJson = buildStructureHeadingSeedJson(proj.analysisV2);
        const technicalH2BindingsJson = buildTechnicalH2BindingsJson(proj.analysisV2);
        const technicalTargetsJson = buildTechnicalTargetsJson(proj.analysisV2);
        const technicalHeadingCount = (proj.analysisV2?.technical_h2_bindings || []).length
            || (proj.analysisV2?.bid_structure?.technical_sections || []).filter((item: any) => Number(item?.level || 2) === 2).length;

        const scoringDetailsJson = (() => {
            const report = proj.analysisReport || [];
            const findNode = (nodes: any[]): string => {
                for (const n of nodes) {
                    if (n.id === 'scoring_details' && n.content) return n.content;
                    if (n.children?.length) {
                        const r = findNode(n.children);
                        if (r) return r;
                    }
                }
                return '';
            };
            return findNode(report);
        })();

        const outlineBatchStrategy = (() => {
            if (technicalHeadingCount <= 1) return 'single';
            if (technicalHeadingCount <= 4) return 'force_parallel';
            return 'auto';
        })();

        try {
            const resp = await startOutlineTaskApi(
                toBidProjectRecord({
                    ...proj,
                    requirements,
                    bidType,
                    analysisReport: proj.analysisReport,
                    analysisV2: proj.analysisV2,
                    outlineTaskOverrides: {
                        scoring_details_json: scoringDetailsJson,
                        outline_batch_strategy: outlineBatchStrategy,
                        outline_auto_parallel_threshold: 4,
                    },
                } as Project & { outlineTaskOverrides: Record<string, unknown> }),
                targetConfig?.totalWords || 0,
            );
            const taskId = String(resp?.task_id || '').trim();
            if (!taskId) throw new Error('启动大纲任务失败：后端未返回 task_id');

            localStorage.setItem(`outline_task_${projectId}`, taskId);
            this.update(projectId, {
                status: 'generating_outline',
                taskRuntime: {
                    state: 'running',
                    taskId,
                    taskType: 'outline',
                    message: outlineBatchStrategy === 'single' ? '大纲生成中' : '大纲并发生成中',
                    progress: 0,
                    startedAt: new Date().toISOString(),
                    cancellable: true,
                    updatedAt: new Date().toISOString(),
                },
            });
            return { taskId };
        } catch (error) {
            this.update(projectId, {
                taskRuntime: {
                    ...(this.getById(projectId)?.taskRuntime || {}),
                    state: 'failed',
                    taskType: 'outline',
                    message: error instanceof Error ? error.message : '启动大纲任务失败',
                    progress: 0,
                    cancellable: false,
                    updatedAt: new Date().toISOString(),
                },
            });
            throw error;
        }
    },

    /** 请求取消任务：等待后端完成取消收敛 */
    async cancelTask(taskId: string, projectId?: string): Promise<any> {
        return cancelTaskApi(taskId, projectId);
    },

    /** 调用后端 Dify API 提取项目需求（含脱敏预处理） */
    async extractRequirements(projectId: string, file: File): Promise<Project | null> {
        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('project_name', file.name.replace(/\.\w+$/, ''));

            const enableDesensitize = true;
            const desensitizeProfile = 'tender';
            const useVision = true;
            formData.append('enable_desensitize', String(enableDesensitize));
            formData.append('desensitize_profile', desensitizeProfile);
            formData.append('use_vision_parsing', String(useVision));

            const response = await extractRequirementsApi({
                file,
                projectName: file.name.replace(/\.\w+$/, ''),
                enableDesensitize,
                desensitizeProfile,
                useVisionParsing: useVision,
            });

            return this.update(projectId, {
                status: 'report_done',        // 进入新工作流：解析完成，等待进入技术方案
                requirements: toRequirementItems(response.requirements),
                // 结构化解析报告（新）
                analysisReport: response.analysis_report?.length
                    ? toAnalysisNodeList(response.analysis_report)
                    : undefined,
                analysisV2: response.analysis_v2?.schema_version
                    ? response.analysis_v2 as unknown as AnalysisV2
                    : undefined,
                // PDF 预览 URL — 后端返回相对路径，需拼上后端 origin 才能在 iframe 加载
                pdfUrl: response.pdf_url
                    ? `${(import.meta.env.VITE_API_URL || 'http://localhost:5000/api').replace(/\/api$/, '')}${response.pdf_url}`
                    : undefined,
                bidType: response.bid_type,
                summary: response.project_summary,
                mappingTable: response.mapping_table || {},
                placeholderManifest: response.placeholder_manifest || {},
                placeholderPolicy: response.placeholder_policy || {},
                imageMap: response.image_map as Record<string, string | { abs_path: string; preview_url: string; description?: string }> || {},
                entityCount: response.entity_count || 0,
                requiredAttachments: response.required_attachments?.length
                    ? toAttachmentRequirements(response.required_attachments)
                    : undefined,
                scoringTableTemplate: response.scoring_table_template?.length
                    ? response.scoring_table_template
                    : undefined,
            });
        } catch (error) {
            console.error('Failed to extract requirements via API', error);
            throw error;
        }
    },

    /**
     * SSE 版解析（后台任务模式）— 防刷新中断
     * 后端 POST /tasks/start-extract → 返回 task_id
     * 前端 GET /tasks/{task_id}/progress → SSE 推送进度
     */
    async extractRequirementsStream(
        projectId: string,
        file: File,
        callbacks: {
            onProgress?: (data: { step: number; label: string; percent: number }) => void;
            onResult?: (data: any) => void;
            onError?: (data: { message: string }) => void;
        }
    ): Promise<Project | null> {
        const enableDesensitize = true;
        const desensitizeProfile = 'tender';
        const useVision = true;

        // 发起后台任务
        const { task_id } = await startExtractTaskApi({
            projectId,
            file,
            projectName: file.name.replace(/\.\w+$/, ''),
            enableDesensitize,
            desensitizeProfile,
            useVisionParsing: useVision,
        });
        localStorage.setItem(`extract_task_${projectId}`, task_id);
        // 与 analyze 任务使用统一键，便于全局锁与刷新恢复逻辑复用
        localStorage.setItem(`proengine_analyze_task_${projectId}`, task_id);
        this.update(projectId, {
            taskRuntime: {
                state: 'running',
                taskId: task_id,
                taskType: 'extract',
                message: '文档预处理中',
                progress: 0,
                startedAt: new Date().toISOString(),
                cancellable: true,
                updatedAt: new Date().toISOString(),
            },
        });

        let resultData: any = null;
        try {
            // 连接 SSE 进度
            const response = await fetchTaskProgressResponse(task_id, projectId);

            const reader = response.body?.getReader();
            if (!reader) throw new Error('无法获取响应流');

            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const events = buffer.split('\n\n');
                buffer = events.pop() || '';

                for (const eventBlock of events) {
                    if (!eventBlock.trim()) continue;
                    for (const line of eventBlock.split('\n')) {
                        if (!line.startsWith('data: ')) continue;
                        try {
                            const parsed = JSON.parse(line.slice(6));
                            if (parsed.error) {
                                callbacks.onError?.({ message: parsed.error });
                                throw new Error(parsed.error);
                            } else if (parsed.cancelled) {
                                callbacks.onError?.({ message: '任务已取消' });
                                throw new Error('__cancelled__');
                            } else if (parsed.stage) {
                                // 阶段进度：将后端 stage 映射为 ProjectCreator 三步进度
                                callbacks.onProgress?.(mapExtractStageProgress(parsed.stage));
                            } else if (parsed.done || parsed.raw_document !== undefined || parsed.analysis_report !== undefined) {
                                // 完成结果
                                resultData = parsed;
                                callbacks.onResult?.(parsed);
                            }
                        } catch (e) {
                            if (e instanceof Error && (e.message.includes('解析') || e.message.includes('脱敏') || e.message.includes('失败'))) throw e;
                            console.warn('SSE 数据解析失败:', line, e);
                        }
                    }
                }
            }
        } catch (error) {
            this.update(projectId, {
                taskRuntime: {
                    state: error instanceof Error && error.message === '__cancelled__' ? 'cancelled' : 'failed',
                    taskId: task_id,
                    taskType: 'extract',
                    message: error instanceof Error && error.message === '__cancelled__'
                        ? '已取消'
                        : (error instanceof Error ? error.message : '文档预处理失败'),
                    progress: 0,
                    startedAt: new Date().toISOString(),
                    cancellable: false,
                    updatedAt: new Date().toISOString(),
                },
            });
            throw error;
        } finally {
            localStorage.removeItem(`extract_task_${projectId}`);
            localStorage.removeItem(`proengine_analyze_task_${projectId}`);
        }

        // 用 result 数据更新项目
        if (resultData) {
            // 仅当项目还没有 targetConfig 时才写入 AI 预估值，不覆盖用户已手动配置过的
            const existingProject = loadAll().find(p => p.id === projectId);
            const hasExistingConfig = !!existingProject?.targetConfig?.totalWords;
            const aiTargetConfig = (!hasExistingConfig && resultData.expected_word_count)
                ? {
                    totalWords: resultData.expected_word_count ?? undefined,
                }
                : undefined;

            return this.update(projectId, {
                status: 'report_done',
                requirements: resultData.requirements || [],
                analysisReport: resultData.analysis_report?.length
                    ? resultData.analysis_report : undefined,
                analysisV2: resultData.analysis_v2?.schema_version
                    ? resultData.analysis_v2 : undefined,
                pdfUrl: resultData.pdf_url
                    ? `${(import.meta.env.VITE_API_URL || 'http://localhost:5000/api').replace(/\/api$/, '')}${resultData.pdf_url}`
                    : undefined,
                bidType: resultData.bid_type,
                summary: resultData.project_summary,
                mappingTable: resultData.mapping_table || {},
                placeholderManifest: resultData.placeholder_manifest || {},
                placeholderPolicy: resultData.placeholder_policy || {},
                imageMap: resultData.image_map || {},
                entityCount: resultData.entity_count || 0,
                requiredAttachments: resultData.required_attachments?.length
                    ? resultData.required_attachments : undefined,
                scoringTableTemplate: resultData.scoring_table_template?.length
                    ? resultData.scoring_table_template : undefined,
                // AI 评估的推荐规模，预填弹窗用（仅在用户未手动配置时写入）
                ...(aiTargetConfig && { targetConfig: aiTargetConfig }),
                taskRuntime: {
                    state: 'succeeded',
                    taskId: task_id,
                    taskType: 'extract',
                    message: '',
                    progress: 100,
                    startedAt: new Date().toISOString(),
                    cancellable: false,
                    updatedAt: new Date().toISOString(),
                },
            });
        }
        this.update(projectId, {
            taskRuntime: {
                state: 'succeeded',
                taskId: task_id,
                taskType: 'extract',
                message: '',
                progress: 100,
                startedAt: new Date().toISOString(),
                cancellable: false,
                updatedAt: new Date().toISOString(),
            },
        });
        return null;
    },

    /** 使用已脱敏缓存重新提取需求（无需重新上传解析） */
    async reExtractRequirements(projectId: string): Promise<Project | null> {
        try {
            const proj = loadAll().find(p => p.id === projectId);
            if (!proj) throw new Error('Project not found');

            const response = await reExtractRequirementsApi({
                projectId,
                projectName: proj.name,
            });

            return this.update(projectId, {
                status: 'reviewing',
                requirements: toRequirementItems(response.requirements),
                bidType: response.bid_type,
                summary: response.project_summary,
                // 这里 mappingTable 那些通常不变，或者按后端返回更新也行
                // 后端 re-extract 会透传返回空的 mapping_table，前端这里选择不覆盖之前的（这很重要）
                // 我们就不在此更新 mappingTable 和 entityCount 了，保留 extract 时留下的状态
                requiredAttachments: response.required_attachments?.length
                    ? toAttachmentRequirements(response.required_attachments)
                    : undefined,
                scoringTableTemplate: response.scoring_table_template?.length
                    ? response.scoring_table_template
                    : undefined,
            });
        } catch (error) {
            console.error('Failed to re-extract requirements via API', error);
            throw error;
        }
    },

    /** 更新项目的投标人信息（仅存于 localStorage，主动不上传服务器） */
    updateBidderInfo(projectId: string, bidderInfo: BidderInfo): Project | null {
        return this.update(projectId, { bidderInfo }) ?? null;
    },

    /** 获取预设解析框架配置（含每个节点的 extractionPrompt）*/
    async getAnalysisFramework(): Promise<{ framework: AnalysisNode[], raw: any }> {
        try {
            const resp: any = await fetchAnalysisFrameworkApi();
            // 将后端 JSON 转换为前端 AnalysisNode 格式
            const convert = (nodes: any[]): AnalysisNode[] =>
                (nodes || []).map(n => ({
                    id: n.id,
                    label: n.label,
                    content: n.content || '',
                    extractionPrompt: n.extractionPrompt || '',
                    numbered: n.numbered === true,
                    children: n.children ? convert(n.children) : undefined,
                }));
            return { framework: convert(resp.framework || []), raw: resp };
        } catch (e) {
            console.warn('获取解析框架失败，使用默认配置', e);
            return { framework: [], raw: null };
        }
    },


    /** 导出解析报告 PDF（后端生成） */
    async exportReportPdf(projectName: string, nodes: any[]): Promise<void> {
        saveBlobToDisk(await exportReportApi(projectName, nodes));
    },

    /**
     * 解析报告 SSE 生成 — 逐节点调用 Dify 提取并流式推送
     * 使用 fetch + ReadableStream（因为需要 POST，EventSource 仅支持 GET）
     */
    /** 启动解析报告后台任务并监听进度（支持断连重连） */
    async analyzeDocument(
        projectId: string,
        callbacks: {
            onProgress?: (data: { phase: string; message: string; current?: number; total?: number }) => void;
            onNodeComplete?: (data: { node_id: string; label: string; content: string }) => void;
            onBidAttachments?: (data: BidAttachmentItem[]) => void;
            onAnalysisV2?: (data: AnalysisV2) => void;
            onStructureStage?: (data: { phase?: string; label?: string }) => void;
            onError?: (data: { node_id?: string; label?: string; error: string }) => void;
            onComplete?: (data: { total_nodes: number; success_count: number }) => void;
        },
        selectedNodeIds?: string[],
        signal?: AbortSignal,
    ): Promise<void> {
        const storageKey = `proengine_analyze_task_${projectId}`;
        const currentRuntime = this.getById(projectId)?.taskRuntime;

        this.update(projectId, {
            taskRuntime: {
                state: 'queued',
                taskId: currentRuntime?.taskId,
                taskType: 'analyze',
                message: '解析任务排队中',
                progress: 0,
                startedAt: currentRuntime?.startedAt || new Date().toISOString(),
                cancellable: true,
                updatedAt: new Date().toISOString(),
            },
        });

        // ── 1. 发起后台任务，获取 task_id ──
        const formData = new FormData();
        formData.append('project_id', projectId);
        if (selectedNodeIds?.length) {
            formData.append('selected_node_ids', selectedNodeIds.join(','));
        }

        try {
            const { task_id } = await startAnalyzeTaskApi(projectId, selectedNodeIds || [], { signal });

            // 存 task_id 供断线重连
            localStorage.setItem(storageKey, task_id);
            this.update(projectId, {
                taskRuntime: {
                    state: 'running',
                    taskId: task_id,
                    taskType: 'analyze',
                    message: '解析报告生成中',
                    progress: 0,
                    startedAt: new Date().toISOString(),
                    cancellable: true,
                    updatedAt: new Date().toISOString(),
                },
            });

            // ── 2. 监听 progress SSE（复用通用进度流） ──
            await this._listenAnalyzeProgress(task_id, storageKey, projectId, callbacks, signal);
        } catch (error) {
            this.update(projectId, {
                taskRuntime: {
                    ...(this.getById(projectId)?.taskRuntime || {}),
                    state: 'failed',
                    taskType: 'analyze',
                    message: error instanceof Error ? error.message : '解析任务启动失败',
                    progress: 0,
                    cancellable: false,
                    updatedAt: new Date().toISOString(),
                },
            });
            throw error;
        }
    },

    /** 重连已有 analyze 任务（刷新/切换后恢复） */
    async reconnectAnalyzeTask(
        taskId: string,
        projectId: string,
        callbacks: {
            onProgress?: (data: { phase: string; message: string }) => void;
            onNodeComplete?: (data: { node_id: string; label: string; content: string }) => void;
            onBidAttachments?: (data: BidAttachmentItem[]) => void;
            onAnalysisV2?: (data: AnalysisV2) => void;
            onStructureStage?: (data: { phase?: string; label?: string }) => void;
            onError?: (data: { error: string }) => void;
            onComplete?: (data: { total_nodes: number; success_count: number }) => void;
        },
        signal?: AbortSignal,
    ): Promise<void> {
        const storageKey = `proengine_analyze_task_${projectId}`;
        await this._listenAnalyzeProgress(taskId, storageKey, projectId, callbacks, signal);
    },

    /** 内部：监听 analyze task 的 progress SSE */
    async _listenAnalyzeProgress(
        taskId: string,
        storageKey: string,
        projectId: string,
        callbacks: {
            onProgress?: (data: any) => void;
            onNodeComplete?: (data: { node_id: string; label: string; content: string }) => void;
            onBidAttachments?: (data: BidAttachmentItem[]) => void;
            onAnalysisV2?: (data: AnalysisV2) => void;
            onStructureStage?: (data: { phase?: string; label?: string }) => void;
            onError?: (data: any) => void;
            onComplete?: (data: any) => void;
        },
        signal?: AbortSignal,
    ): Promise<void> {

        let response: Response;
        try {
            response = await fetchTaskProgressResponse(taskId, projectId, signal);
        } catch (error) {
            const status = typeof (error as any)?.status === 'number' ? (error as any).status : 0;
            if (status === 404) {
                localStorage.removeItem(storageKey);
                console.warn(`[analyze reconnect] 任务 ${taskId} 已过期（后端重启？），已清除缓存`);
                return;
            }
            console.warn(`[analyze reconnect] 进度连接失败: ${status || 'unknown'}`);
            return;
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('无法获取响应流');
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const events = buffer.split('\n\n');
                buffer = events.pop() || '';

                for (const eventBlock of events) {
                    if (!eventBlock.trim()) continue;
                    let eventType = 'message';
                    let eventData = '';
                    for (const line of eventBlock.split('\n')) {
                        if (line.startsWith('event: ')) eventType = line.slice(7).trim();
                        else if (line.startsWith('data: ')) eventData = line.slice(6);
                    }
                    if (!eventData) continue;
                    try {
                        const parsed = JSON.parse(eventData);
                        if (parsed.error) {
                            // 任务失败/取消：清除 task_id
                            localStorage.removeItem(storageKey);
                            this.update(projectId, {
                                taskRuntime: {
                                    state: 'failed',
                                    taskId,
                                    taskType: 'analyze',
                                    message: parsed.error || '',
                                    progress: 0,
                                    cancellable: false,
                                    updatedAt: new Date().toISOString(),
                                },
                            });
                            callbacks.onError?.(parsed);
                        } else if (parsed.cancelled) {
                            // 用户主动取消：静默清理
                            localStorage.removeItem(storageKey);
                            this.update(projectId, {
                                taskRuntime: {
                                    state: 'cancelled',
                                    taskId,
                                    taskType: 'analyze',
                                    message: '',
                                    progress: 0,
                                    cancellable: false,
                                    updatedAt: new Date().toISOString(),
                                },
                            });
                            callbacks.onComplete?.({ total_nodes: 0, success_count: 0, cancelled: true });
                        } else if (parsed.done || parsed.success_count !== undefined) {
                            // done 结果
                            localStorage.removeItem(storageKey);
                            const latest = await fetchServerProject(projectId);
                            if (latest?.id) applyServerProjectToLocal(latest);
                            else {
                                this.update(projectId, {
                                    taskRuntime: {
                                        state: 'succeeded',
                                        taskId,
                                        taskType: 'analyze',
                                        message: '',
                                        progress: 100,
                                        cancellable: false,
                                        updatedAt: new Date().toISOString(),
                                    },
                                });
                            }
                            callbacks.onComplete?.(parsed);
                        } else if (eventType === 'node_complete') {
                            callbacks.onNodeComplete?.(parsed);
                        } else if (eventType === 'bid_attachments') {
                            callbacks.onBidAttachments?.(parsed);
                        } else if (eventType === 'analysis_v2') {
                            callbacks.onAnalysisV2?.(parsed as AnalysisV2);
                        } else if (eventType === 'structure_stage') {
                            callbacks.onStructureStage?.(parsed);
                            callbacks.onProgress?.({ phase: 'structure', message: parsed.label || parsed.phase || '结构生成中' });
                        } else if (parsed.stage || parsed.text) {
                            callbacks.onProgress?.({ phase: 'analyzing', message: parsed.stage || parsed.text });
                        }
                    } catch (e) {
                        console.warn('[analyzeDocument] SSE 数据解析失败:', eventData, e);
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    },



    /** 单节点重新提取（不影响其他节点） */
    async analyzeNode(
        projectId: string,
        nodeId: string,
        nodeLabel: string,
        extractionPrompt: string,
        onChunk?: (partial: string) => void,
        onBidAttachments?: (items: BidAttachmentItem[]) => void,
    ): Promise<{ content: string } | null> {

        const res = await fetchAnalyzeNodeResponse(projectId, nodeId, nodeLabel, extractionPrompt);

        // SSE 流式读取
        const reader = res.body?.getReader();
        if (!reader) throw new Error('无法读取响应流');
        const decoder = new TextDecoder();
        let buffer = '';
        let finalContent = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split('\n\n');
            buffer = parts.pop() ?? '';
            for (const part of parts) {
                for (const line of part.split('\n')) {
                    if (!line.startsWith('data: ')) continue;
                    try {
                        const ev = JSON.parse(line.slice(6));
                        if (ev.type === 'chunk' && ev.text) {
                            finalContent += ev.text;
                            onChunk?.(finalContent);
                        } else if (ev.type === 'bid_attachments' && Array.isArray(ev.items)) {
                            onBidAttachments?.(ev.items as BidAttachmentItem[]);
                        } else if (ev.type === 'done') {
                            finalContent = ev.content ?? finalContent;
                        } else if (ev.type === 'error') {
                            throw new Error(ev.message || '提取失败');
                        }
                    } catch { /* 忽略非 JSON 行 */ }
                }
            }
        }
        return { content: finalContent };
    },


    /** 持久化解析报告到后端 */
    async saveAnalysisReport(projectId: string, nodes: AnalysisNode[]): Promise<void> {
        try {
            await saveAnalysisReportApi(projectId, nodes);
        } catch (e) {
            console.warn('[persist] 解析报告保存失败（可忽略）:', e);
        }
    },

    /** 从后端读取解析报告 */
    async loadAnalysisReport(projectId: string): Promise<AnalysisNode[]> {
        try {
            const data = await loadAnalysisReportApi(projectId);
            if (data.analysis_v2?.schema_version) {
                projectService.update(projectId, { analysisV2: data.analysis_v2 as unknown as AnalysisV2 });
            }
            return toAnalysisNodeList(data.analysis_report);
        } catch {
            return [];
        }
    },

    /** 调用后端 Dify 大纲生成工作流，自动注入 analysisReport 解析上下文 */
    async generateOutline(
        requirements: RequirementItem[],
        bidType: string,
        outlineDifyApiKey: string,
        useKnowledgeBase: boolean = false,
        projectId?: string,
        targetConfig?: TechProposalConfig
    ): Promise<OutlineSection[]> {
        // 读取解析报告，构建全量解析上下文（优先注入评分标准、技术要求、废标项）
        let analysisContext = '';
        let structureHeadingSeedJson = '';
        let technicalH2BindingsJson = '';
        let technicalTargetsJson = '';
        if (projectId) {
            const proj = projectService.getById(projectId);
            if (proj?.analysisReport?.length) {
                analysisContext = buildAnalysisContextForOutline(proj.analysisReport);
            }
            structureHeadingSeedJson = buildStructureHeadingSeedJson(proj?.analysisV2);
            technicalH2BindingsJson = buildTechnicalH2BindingsJson(proj?.analysisV2);
            technicalTargetsJson = buildTechnicalTargetsJson(proj?.analysisV2);
        }
        const response = await generateOutlineApi({
            projectId,
            requirements,
            bidType,
            difyApiKey: outlineDifyApiKey,
            useKnowledge: useKnowledgeBase,
            analysisContext,
            structureHeadingSeedJson,
            technicalH2BindingsJson,
            technicalTargetsJson,
            expectedTotalWords: targetConfig?.totalWords,
            enableDiagrams: DIAGRAM_GENERATION_ENABLED,
            maxDiagrams: DIAGRAM_GENERATION_ENABLED ? DIAGRAM_MAX_PER_PROJECT : 0,
        });
        return toOutlineSections(response.sections);
    },

    /** 调用后端 Dify content_writer 工作流生成章节正文 */
    async generateContent(params: {
        projectId: string;
        sectionId: string;
        sectionTitle: string;
        writingHint: string;
        keywords?: string; // 来自大纲的一级标题检索关键词
        expectedWords: number;
        globalOutline: string; // 新增全局大纲参数
        requiresSearch: boolean;
        generationStrategy?: string;
        needDiagram?: boolean;
        diagramBrief?: string;
        diagramTypeHint?: string;
        diagramPriority?: number;
    }): Promise<{ content: string; wordCount: number; qualityScore?: number; feedback?: string }> {
        // 从 localStorage 读取项目概况。如果有全局蓝图则组装蓝图，否则降级使用简单 summary。
        const projects = loadAll();
        const proj = projects.find(p => p.id === params.projectId);

        let projectSummary = proj?.summary || '';
        if (proj?.blueprint) {
            const bp = proj.blueprint;
            projectSummary = `【项目核心定位】\n${bp.positioning}\n\n【整体投标策略】\n${bp.strategy}\n\n【差异化亮点】\n${bp.highlights.map(h => `- ${h}`).join('\n')}\n\n【写作语体基调】\n${bp.writing_style}`;
        }
        const { mappingTable, bidderMappingTable, placeholderHint } = buildContentPlaceholderContext(proj);

        // 优先用大纲中的 relatedAnalysisIds 精确查解析节点；无 ID 时降级为关键词模糊匹配
        let analysisContext = '';
        let relatedIds: string[] = [];
        let generationStrategy = String(params.generationStrategy || 'general');
        const diagramMeta = resolveSectionDiagramMeta(proj?.outline, params.sectionId, {
            generationStrategy,
            needDiagram: params.needDiagram,
            diagramBrief: params.diagramBrief,
            diagramTypeHint: params.diagramTypeHint,
            diagramPriority: params.diagramPriority,
        });
        generationStrategy = diagramMeta.generationStrategy;
        if (proj?.analysisReport?.length) {
            relatedIds = diagramMeta.matched?.relatedAnalysisIds || [];
            analysisContext = resolveAnalysisContextForContent(
                params.sectionTitle,
                proj.analysisReport,
                relatedIds,
                generationStrategy,
            );
        }

        const sectionOutlineSlice = buildSectionOutlineSlice(proj?.outline, params.sectionId);
        const scopedGlobalOutline = buildOutlineNeighborhoodSlice(proj?.outline, params.sectionId, params.globalOutline);
        const runtimeSectionOutlineSlice = scopedGlobalOutline || sectionOutlineSlice;
        const coreWritingHint = extractCoreWritingIntent(params.writingHint);
        const requiresSearch = resolveRequiresSearch(
            params.requiresSearch,
            relatedIds,
            analysisContext,
            params.sectionTitle,
            params.keywords || '',
            coreWritingHint,
            generationStrategy,
        );

        const response = await generateContentApi({
            projectId: params.projectId,
            sectionId: params.sectionId,
            sectionTitle: params.sectionTitle,
            writingHint: coreWritingHint,
            keywords: params.keywords,
            expectedWords: params.expectedWords,
            projectSummary,
            globalOutline: scopedGlobalOutline,
            sectionOutlineSlice: runtimeSectionOutlineSlice,
            requiresSearch: requiresSearch,
            placeholderHint,
            analysisContext,
            generationStrategy,
            enableDiagrams: DIAGRAM_GENERATION_ENABLED,
            maxDiagrams: DIAGRAM_MAX_PER_PROJECT,
            needDiagram: DIAGRAM_GENERATION_ENABLED && diagramMeta.needDiagram,
            diagramBrief: DIAGRAM_GENERATION_ENABLED ? diagramMeta.diagramBrief : '',
            diagramTypeHint: diagramMeta.diagramTypeHint,
            diagramPriority: diagramMeta.diagramPriority,
            mappingTable: { ...mappingTable, ...bidderMappingTable },
            bidderInfo: toBidderInfoRecord(proj?.bidderInfo),
        });
        return {
            content: response.content || '',
            wordCount: response.word_count || 0,
            qualityScore: response.quality_score, // 来自 Dify Self-Refine 节点的打分（若配置）
            feedback: response.feedback,          // LLM 给出的评语或修改建议
        };
    },

    /**
     * 内容生成（后台任务 + 轮询模式）— 防刷新中断
     * POST /tasks/start-content → 返回 task_id
     * GET /tasks/{task_id}/status → 轮询获取状态和结果
     */
    generateContentStream(params: {
        projectId: string;
        sectionId: string;
        sectionTitle: string;
        writingHint: string;
        keywords?: string;
        expectedWords: number;
        globalOutline: string;
        /** 可选；不传则根据项目 outline 与 sectionId 自动计算 */
        sectionOutlineSlice?: string;
        requiresSearch: boolean;
        generationStrategy?: string;
        needDiagram?: boolean;
        diagramBrief?: string;
        diagramTypeHint?: string;
        diagramPriority?: number;
    }, callbacks: {
        onChunk: (text: string) => void;
        onStage: (stage: string) => void;
        onDone: (result: ContentGenerationResult) => void;
        onError: (err: string) => void;
    }): AbortController {
        const controller = new AbortController();

        // 构建请求体
        const projects = loadAll();
        const proj = projects.find(p => p.id === params.projectId);
        let projectSummary = proj?.summary || '';
        if (proj?.blueprint) {
            const bp = proj.blueprint;
            projectSummary = `【项目核心定位】\n${bp.positioning}\n\n【整体投标策略】\n${bp.strategy}\n\n【差异化亮点】\n${bp.highlights.map(h => `- ${h}`).join('\n')}\n\n【写作语体基调】\n${bp.writing_style}`;
        }
        const { mappingTable, bidderMappingTable, placeholderHint } = buildContentPlaceholderContext(proj);

        // 构建 image_map_hint：仅传占位符 + VLM 描述，不暴露服务器绝对路径给 Dify
        const imageMapHint = Object.entries(proj?.imageMap ?? {})
            .map(([k, v]) => {
                const desc = typeof v === 'string' ? '' : (v.description ?? '');
                return desc ? `${k}: ${desc}` : '';
            })
            .filter(Boolean)
            .join('\n');

        // 优先用大纲中的 relatedAnalysisIds 精确查解析节点；无 ID 时降级为关键词模糊匹配
        let analysisContext = '';
        let relatedIds: string[] = [];
        let generationStrategy = String(params.generationStrategy || 'general');
        const diagramMeta = resolveSectionDiagramMeta(proj?.outline, params.sectionId, {
            generationStrategy,
            needDiagram: params.needDiagram,
            diagramBrief: params.diagramBrief,
            diagramTypeHint: params.diagramTypeHint,
            diagramPriority: params.diagramPriority,
        });
        generationStrategy = diagramMeta.generationStrategy;
        if (proj?.analysisReport?.length) {
            relatedIds = diagramMeta.matched?.relatedAnalysisIds || [];
            analysisContext = resolveAnalysisContextForContent(
                params.sectionTitle,
                proj.analysisReport,
                relatedIds,
                generationStrategy,
            );
        }

        const enableDiagrams = DIAGRAM_GENERATION_ENABLED;
        const maxDiagrams = DIAGRAM_MAX_PER_PROJECT;
        const needDeferredDiagram =
            enableDiagrams && maxDiagrams > 0 && diagramMeta.needDiagram && diagramMeta.diagramBrief.trim().length > 0;

        const sectionOutlineSlice =
            params.sectionOutlineSlice !== undefined
                ? params.sectionOutlineSlice
                : buildSectionOutlineSlice(proj?.outline, params.sectionId);
        const scopedGlobalOutline = buildOutlineNeighborhoodSlice(proj?.outline, params.sectionId, params.globalOutline);
        const runtimeSectionOutlineSlice = scopedGlobalOutline || sectionOutlineSlice;
        const coreWritingHint = extractCoreWritingIntent(params.writingHint);
        const requiresSearch = resolveRequiresSearch(
            params.requiresSearch,
            relatedIds,
            analysisContext,
            params.sectionTitle,
            params.keywords || '',
            coreWritingHint,
            generationStrategy,
        );

        const requestBody = {
            project_id: params.projectId,
            section_id: params.sectionId,
            section_title: params.sectionTitle,
            writing_hint: coreWritingHint,
            keywords: params.keywords,
            expected_words: params.expectedWords,
            project_summary: projectSummary,
            global_outline: scopedGlobalOutline,
            section_outline_slice: runtimeSectionOutlineSlice,
            requires_search: requiresSearch,
            placeholder_hint: placeholderHint,
            analysis_context: analysisContext,  // 精确注入招标文件解析上下文
            generation_strategy: generationStrategy,
            // 传递可用图片清单供 AI 在正文中引用（若为空则 Dify 流会忽略）
            image_map_hint: imageMapHint,
            // 占位符回填兜底（后端优先查 DB，未命中则用该映射）
            mapping_table: { ...mappingTable, ...bidderMappingTable },
            bidder_info: proj?.bidderInfo ?? {},
            // 结构化图表入参（来自大纲）
            enable_diagrams: enableDiagrams,
            max_diagrams: maxDiagrams,
            need_diagram: enableDiagrams && diagramMeta.needDiagram,
            diagram_brief: enableDiagrams ? diagramMeta.diagramBrief : '',
            diagram_type_hint: diagramMeta.diagramTypeHint,
            diagram_priority: diagramMeta.diagramPriority,
            defer_diagram: false,
        };
        const taskStorageKey = buildContentTaskStorageKey(params.projectId, params.sectionId);

        // 异步启动后台任务 + 轮询
        (async () => {
            try {
                // 发起后台任务
                const { task_id } = await startContentTask(requestBody);
                localStorage.setItem(taskStorageKey, task_id);
                localStorage.removeItem(`content_task_${params.sectionId}`);
                setLocalTaskRuntime(params.projectId, {
                    state: 'running',
                    taskId: task_id,
                    taskType: 'content',
                    message: params.sectionTitle ? `${params.sectionTitle} 正文生成中` : '正文生成中',
                    progress: 0,
                    cancellable: true,
                });
                callbacks.onStage(`🚀 任务已提交（${task_id.slice(0, 8)}）`);

                // 轮询任务状态（首轮快，后续平滑）
                let lastStage = '';
                let pollMs = 2000;
                let lastPartialSig = '';
                while (!controller.signal.aborted) {
                    await new Promise(r => setTimeout(r, pollMs));
                    if (controller.signal.aborted) break;

                    try {
                        const taskStatus = await getTaskStatusApi(task_id, params.projectId);

                        // 推送阶段变化
                        if (taskStatus.current_stage && taskStatus.current_stage !== lastStage) {
                            lastStage = taskStatus.current_stage;
                            callbacks.onStage(lastStage);
                        }

                        // 进行中阶段性结果：正文先到先展示，图表后到再增量覆盖
                        const pr = taskStatus.partial_result as any;
                        if (pr?.partial && pr.content) {
                            const sig = `${pr.phase || 'partial'}:${pr.word_count || 0}:${(pr.content || '').length}:${pr.diagrams_count || 0}`;
                            if (sig !== lastPartialSig) {
                                callbacks.onChunk(
                                    applyPlaceholderReportToContent(pr.content, pr.replace_report),
                                );
                                if (pr.phase === 'text_ready') {
                                    callbacks.onStage(
                                        needDeferredDiagram
                                            ? '✅ 正文已就绪，独立图表任务将随后启动'
                                            : '✅ 正文已生成',
                                    );
                                } else if (pr.phase === 'diagram_ready') {
                                    callbacks.onStage(`✅ 图表已完成（${pr.diagrams_count || 0} 张）`);
                                }
                                lastPartialSig = sig;
                            }
                        }

                        if (taskStatus.status === 'done' && taskStatus.result) {
                            const r = taskStatus.result as {
                                content?: string;
                                word_count?: number;
                                quality_score?: number;
                                feedback?: string;
                                replace_report?: { placeholder: string; original: string }[];
                                placeholder_warning?: PlaceholderWarning;
                                diagram_deferred?: boolean;
                                diagram_request?: DiagramRequest;
                                diagram_error?: unknown;
                                diagram_skip?: unknown;
                                diagram_specs?: unknown;
                            };
                            const diagramError = extractDiagramErrorMessage(r.diagram_error)
                                || extractDiagramSkipMessage(r.diagram_skip);
                            if (diagramError) {
                                console.warn('[content task] diagram generation degraded to text-only result', {
                                    projectId: params.projectId,
                                    sectionId: params.sectionId,
                                    taskId: task_id,
                                    diagram_error: r.diagram_error,
                                });
                                callbacks.onStage('⚠️ 图表生成失败，已保留正文');
                            }
                            const displayContent = applyPlaceholderReportToContent(
                                r.content || '',
                                r.replace_report,
                            );
                            if (r.content) callbacks.onChunk(displayContent);
                            setLocalTaskRuntime(params.projectId, {
                                state: 'succeeded',
                                taskId: task_id,
                                taskType: 'content',
                                message: '',
                                progress: 100,
                                cancellable: false,
                            });
                            const diagramRequest = needDeferredDiagram && r.diagram_deferred
                                ? {
                                    project_id: params.projectId,
                                    section_id: params.sectionId,
                                    section_title: params.sectionTitle,
                                    base_content: r.content || '',
                                    writing_hint: coreWritingHint,
                                    keywords: params.keywords,
                                    global_outline: scopedGlobalOutline,
                                    section_outline_slice: runtimeSectionOutlineSlice,
                                    expected_words: params.expectedWords,
                                    analysis_context: analysisContext,
                                    mapping_table: { ...mappingTable, ...bidderMappingTable },
                                    enable_diagrams: enableDiagrams,
                                    max_diagrams: maxDiagrams,
                                    need_diagram: diagramMeta.needDiagram,
                                    diagram_brief: diagramMeta.diagramBrief,
                                    diagram_type_hint: diagramMeta.diagramTypeHint,
                                    diagram_specs: r.diagram_specs,
                                    quality_score: r.quality_score,
                                    feedback: r.feedback,
                                    replace_report: r.replace_report || [],
                                } satisfies DiagramRequest
                                : undefined;
                            callbacks.onDone({
                                content: displayContent,
                                wordCount: r.word_count || 0,
                                qualityScore: r.quality_score,
                                feedback: r.feedback,
                                replaceReport: r.replace_report || [],
                                placeholderWarning: normalizePlaceholderWarning(r.placeholder_warning),
                                diagramError,
                                diagramRequest,
                            });
                            localStorage.removeItem(taskStorageKey);
                            localStorage.removeItem(`content_task_${params.sectionId}`);
                            break;
                        }

                        if (taskStatus.status === 'cancelled' || taskStatus.cancelled) {
                            // 用户主动取消：静默处理，不走 error 通道
                            setLocalTaskRuntime(params.projectId, {
                                state: 'cancelled',
                                taskId: task_id,
                                taskType: 'content',
                                message: '已取消',
                                cancellable: false,
                            });
                            callbacks.onError('__cancelled__');
                            localStorage.removeItem(taskStorageKey);
                            localStorage.removeItem(`content_task_${params.sectionId}`);
                            break;
                        }

                        if (taskStatus.status === 'timeout' || taskStatus.timed_out) {
                            setLocalTaskRuntime(params.projectId, {
                                state: 'timed_out',
                                taskId: task_id,
                                taskType: 'content',
                                message: taskStatus.error || '生成超时，已自动解除任务锁',
                                cancellable: false,
                            });
                            callbacks.onError(taskStatus.error || '生成超时，已自动解除任务锁');
                            localStorage.removeItem(taskStorageKey);
                            localStorage.removeItem(`content_task_${params.sectionId}`);
                            break;
                        }

                        if (taskStatus.status === 'error') {
                            setLocalTaskRuntime(params.projectId, {
                                state: 'failed',
                                taskId: task_id,
                                taskType: 'content',
                                message: taskStatus.error || '生成失败',
                                cancellable: false,
                            });
                            callbacks.onError(taskStatus.error || '生成失败');
                            localStorage.removeItem(taskStorageKey);
                            localStorage.removeItem(`content_task_${params.sectionId}`);
                            break;
                        }
                        // 任务仍在运行：逐步放宽轮询间隔，降低服务压力
                        pollMs = Math.min(5000, pollMs + 500);
                    } catch (error) {
                        if ((error as any)?.status === 404) {
                            setLocalTaskRuntime(params.projectId, {
                                state: 'timed_out',
                                taskId: task_id,
                                taskType: 'content',
                                message: '任务不存在或已过期',
                                cancellable: false,
                            });
                            localStorage.removeItem(taskStorageKey);
                            localStorage.removeItem(`content_task_${params.sectionId}`);
                            callbacks.onError('任务不存在或已过期');
                            break;
                        }
                    }
                }
            } catch (e: any) {
                if (e.name !== 'AbortError') callbacks.onError(e.message || '生成失败');
            }
        })();

        return controller;
    },

    /** 对已生成正文执行独立图表补写；只跑 diagram batch，不重新生成正文。 */
    generateDiagramBatch(
        projectId: string,
        requests: DiagramRequest[],
        callbacks: {
            onStage?: (stage: string) => void;
            onSectionDone?: (sectionId: string, result: ContentGenerationResult) => void;
        },
        signal?: AbortSignal,
    ): Promise<void> {
        return runDiagramBatchQueue(projectId, requests, callbacks, signal);
    },

    generateContentRewriteStream(params: {
        projectId: string;
        sectionId: string;
        sectionTitle: string;
        currentContent: string;
        rewriteInstruction: string;
        expectedWords: number;
        globalOutline: string;
    }, callbacks: {
        onStage: (stage: string) => void;
        onDone: (result: {
            content: string;
            wordCount: number;
            qualityScore?: number;
            feedback?: string;
            replaceReport?: { placeholder: string; original: string }[];
            placeholderWarning?: PlaceholderWarning;
            diagramError?: string;
            diagramUpdate?: boolean;
        }) => void;
        onError: (err: string) => void;
    }): AbortController {
        const controller = new AbortController();
        const projects = loadAll();
        const proj = projects.find(p => p.id === params.projectId);
        let projectSummary = proj?.summary || '';
        if (proj?.blueprint) {
            const bp = proj.blueprint;
            projectSummary = `【项目核心定位】\n${bp.positioning}\n\n【整体投标策略】\n${bp.strategy}\n\n【差异化亮点】\n${bp.highlights.map(h => `- ${h}`).join('\n')}\n\n【写作语体基调】\n${bp.writing_style}`;
        }
        const { mappingTable, bidderMappingTable, placeholderHint } = buildContentPlaceholderContext(proj);

        let analysisContext = '';
        let generationStrategy = 'general';
        if (proj?.analysisReport?.length) {
            const allOutlineSections: (OutlineSection | OutlineSubSection)[] = [];
            (proj.outline || []).forEach((s: OutlineSection) => {
                allOutlineSections.push(s);
                s.children?.forEach((c: OutlineSubSection) => allOutlineSections.push(c));
            });
            const matched = allOutlineSections.find(s => s.id === params.sectionId);
            const relatedIds = matched?.relatedAnalysisIds || [];
            generationStrategy = String((matched as any)?.generationStrategy || (matched as any)?.generation_strategy || 'general');
            analysisContext = resolveAnalysisContextForContent(
                params.sectionTitle,
                proj.analysisReport,
                relatedIds,
                generationStrategy,
            );
        }

        const sectionOutlineSlice = buildSectionOutlineSlice(proj?.outline, params.sectionId);
        const scopedGlobalOutline = buildOutlineNeighborhoodSlice(proj?.outline, params.sectionId, params.globalOutline);
        const runtimeSectionOutlineSlice = scopedGlobalOutline || sectionOutlineSlice;
        const taskStorageKey = buildContentTaskStorageKey(params.projectId, params.sectionId);
        const requestBody = {
            project_id: params.projectId,
            section_id: params.sectionId,
            section_title: params.sectionTitle,
            current_content: params.currentContent,
            rewrite_instruction: params.rewriteInstruction,
            expected_words: params.expectedWords,
            project_summary: projectSummary,
            global_outline: scopedGlobalOutline,
            section_outline_slice: runtimeSectionOutlineSlice,
            placeholder_hint: placeholderHint,
            analysis_context: analysisContext,
            generation_strategy: generationStrategy,
            mapping_table: { ...mappingTable, ...bidderMappingTable },
            bidder_info: proj?.bidderInfo ?? {},
        };

        (async () => {
            try {
                const { task_id } = await startContentRewriteTask(requestBody);
                localStorage.setItem(taskStorageKey, task_id);
                localStorage.removeItem(`content_task_${params.sectionId}`);
                setLocalTaskRuntime(params.projectId, {
                    state: 'running',
                    taskId: task_id,
                    taskType: 'content',
                    message: params.sectionTitle ? `${params.sectionTitle} 重生成中` : '正文重生成中',
                    progress: 0,
                    cancellable: true,
                });
                callbacks.onStage(`🚀 重生成任务已提交（${task_id.slice(0, 8)}）`);

                let lastStage = '';
                let pollMs = 2000;
                while (!controller.signal.aborted) {
                    await new Promise(r => setTimeout(r, pollMs));
                    if (controller.signal.aborted) break;
                    try {
                        const taskStatus = await getTaskStatusApi(task_id, params.projectId);
                        if (taskStatus.current_stage && taskStatus.current_stage !== lastStage) {
                            lastStage = taskStatus.current_stage;
                            callbacks.onStage(lastStage);
                        }
                        if (taskStatus.status === 'done' && taskStatus.result) {
                            const result = taskStatus.result as any;
                            setLocalTaskRuntime(params.projectId, {
                                state: 'succeeded',
                                taskId: task_id,
                                taskType: 'content',
                                message: '',
                                progress: 100,
                                cancellable: false,
                            });
                            callbacks.onDone({
                                content: applyPlaceholderReportToContent(result.content || '', result.replace_report || []),
                                wordCount: result.word_count || 0,
                                qualityScore: result.quality_score,
                                feedback: result.feedback,
                                replaceReport: result.replace_report || [],
                                placeholderWarning: normalizePlaceholderWarning(result.placeholder_warning),
                            });
                            localStorage.removeItem(taskStorageKey);
                            localStorage.removeItem(`content_task_${params.sectionId}`);
                            break;
                        }
                        if (taskStatus.status === 'cancelled' || taskStatus.cancelled) {
                            setLocalTaskRuntime(params.projectId, {
                                state: 'cancelled',
                                taskId: task_id,
                                taskType: 'content',
                                message: '已取消',
                                cancellable: false,
                            });
                            callbacks.onError('__cancelled__');
                            localStorage.removeItem(taskStorageKey);
                            localStorage.removeItem(`content_task_${params.sectionId}`);
                            break;
                        }
                        if (taskStatus.status === 'timeout' || taskStatus.timed_out) {
                            setLocalTaskRuntime(params.projectId, {
                                state: 'timed_out',
                                taskId: task_id,
                                taskType: 'content',
                                message: taskStatus.error || '重生成超时，已自动解除任务锁',
                                cancellable: false,
                            });
                            callbacks.onError(taskStatus.error || '重生成超时，已自动解除任务锁');
                            localStorage.removeItem(taskStorageKey);
                            localStorage.removeItem(`content_task_${params.sectionId}`);
                            break;
                        }
                        if (taskStatus.status === 'error') {
                            setLocalTaskRuntime(params.projectId, {
                                state: 'failed',
                                taskId: task_id,
                                taskType: 'content',
                                message: taskStatus.error || '重生成失败',
                                cancellable: false,
                            });
                            callbacks.onError(taskStatus.error || '重生成失败');
                            localStorage.removeItem(taskStorageKey);
                            localStorage.removeItem(`content_task_${params.sectionId}`);
                            break;
                        }
                        pollMs = Math.min(5000, pollMs + 500);
                    } catch (error) {
                        if ((error as any)?.status === 404) {
                            setLocalTaskRuntime(params.projectId, {
                                state: 'timed_out',
                                taskId: task_id,
                                taskType: 'content',
                                message: '重生成任务不存在或已过期',
                                cancellable: false,
                            });
                            localStorage.removeItem(taskStorageKey);
                            localStorage.removeItem(`content_task_${params.sectionId}`);
                            callbacks.onError('重生成任务不存在或已过期');
                            break;
                        }
                    }
                }
            } catch (e: any) {
                if (e.name !== 'AbortError') callbacks.onError(e.message || '重生成失败');
            }
        })();

        return controller;
    },

    generateContentGroupStream(params: {
        projectId: string;
        groupId: string;
        groupTitle: string;
        blocks: BatchGenerationBlock[];
        globalOutline: string;
    }, callbacks: {
        onStage: (stage: string) => void;
        onSectionDone: (result: {
            sectionId: string;
            content: string;
            wordCount: number;
            qualityScore?: number;
            feedback?: string;
            replaceReport?: { placeholder: string; original: string }[];
            placeholderWarning?: PlaceholderWarning;
            diagramError?: string;
            diagramUpdate?: boolean;
            diagramRequest?: DiagramRequest;
        }) => void;
        onSectionFailed?: (sectionId: string, error: string) => void;
        onDone: (result: {
            sections: Array<{
                sectionId: string;
                content: string;
                wordCount: number;
                qualityScore?: number;
                feedback?: string;
                replaceReport?: { placeholder: string; original: string }[];
                placeholderWarning?: PlaceholderWarning;
                diagramError?: string;
                diagramRequest?: DiagramRequest;
                diagramUpdate?: boolean;
            }>;
            failedSections?: Array<{
                sectionId: string;
                error: string;
            }>;
        }) => void;
        onError: (err: string) => void;
    }): AbortController {
        const controller = new AbortController();
        const projects = loadAll();
        const proj = projects.find(p => p.id === params.projectId);
        let projectSummary = proj?.summary || '';
        if (proj?.blueprint) {
            const bp = proj.blueprint;
            projectSummary = `【项目核心定位】\n${bp.positioning}\n\n【整体投标策略】\n${bp.strategy}\n\n【差异化亮点】\n${bp.highlights.map(h => `- ${h}`).join('\n')}\n\n【写作语体基调】\n${bp.writing_style}`;
        }
        const { mappingTable, bidderMappingTable, placeholderHint } = buildContentPlaceholderContext(proj);
        const imageMapHint = Object.entries(proj?.imageMap ?? {})
            .map(([k, v]) => {
                const desc = typeof v === 'string' ? '' : (v.description ?? '');
                return desc ? `${k}: ${desc}` : '';
            })
            .filter(Boolean)
            .join('\n');

        const normalizedChildren = params.blocks.map((block) => {
            let relatedIds: string[] = [];
            const diagramMeta = resolveSectionDiagramMeta(proj?.outline, block.id, {
                generationStrategy: block.generationStrategy,
                needDiagram: block.needDiagram,
                diagramBrief: block.diagramBrief,
                diagramTypeHint: block.diagramTypeHint,
                diagramPriority: block.diagramPriority,
            });
            let generationStrategy = diagramMeta.generationStrategy;
            let analysisContext = '';
            if (proj?.analysisReport?.length) {
                relatedIds = diagramMeta.matched?.relatedAnalysisIds || [];
                analysisContext = resolveAnalysisContextForContent(
                    block.title,
                    proj.analysisReport,
                    relatedIds,
                    generationStrategy,
                );
            }
            const sectionOutlineSlice = buildSectionOutlineSlice(proj?.outline, block.id);
            const scopedSectionOutlineSlice = buildOutlineNeighborhoodSlice(proj?.outline, block.id, sectionOutlineSlice);
            const coreWritingHint = extractCoreWritingIntent(block.writingHint);
            const requiresSearch = resolveRequiresSearch(
                block.requiresSearch,
                relatedIds,
                analysisContext,
                block.title,
                block.keywords || '',
                coreWritingHint,
                generationStrategy,
            );
            return {
                section_id: block.id,
                section_title: block.title,
                writing_hint: coreWritingHint,
                keywords: block.keywords || block.title,
                expected_words: block.expectedWords,
                section_outline_slice: scopedSectionOutlineSlice || sectionOutlineSlice,
                analysis_context: analysisContext,
                requires_search: requiresSearch,
                generation_strategy: generationStrategy,
                need_diagram: DIAGRAM_GENERATION_ENABLED && diagramMeta.needDiagram,
                diagram_brief: DIAGRAM_GENERATION_ENABLED ? diagramMeta.diagramBrief : '',
                diagram_type_hint: diagramMeta.diagramTypeHint,
                diagram_priority: diagramMeta.diagramPriority,
            };
        });
        const enableDiagrams = DIAGRAM_GENERATION_ENABLED;
        const maxDiagrams = DIAGRAM_MAX_PER_PROJECT;
        const requestBody = {
            project_id: params.projectId,
            group_id: params.groupId,
            group_title: params.groupTitle,
            project_summary: projectSummary,
            global_outline: buildOutlineNeighborhoodSlice(proj?.outline, params.groupId, params.globalOutline),
            placeholder_hint: placeholderHint,
            image_map_hint: imageMapHint,
            mapping_table: { ...mappingTable, ...bidderMappingTable },
            bidder_info: proj?.bidderInfo ?? {},
            requires_search: normalizedChildren.some(item => item.requires_search),
            enable_diagrams: enableDiagrams,
            max_diagrams: maxDiagrams,
            children: normalizedChildren,
        };

        (async () => {
            try {
                const workflowStatus = await fetchWorkflowStatusApi().catch(() => null);
                if (workflowStatus?.content_group_writer?.configured === false) {
                    callbacks.onError('content_group_writer 工作流未配置，请检查 DIFY_WORKFLOW_CONTENT_GROUP_WRITER');
                    return;
                }
                const { task_id } = await startContentGroupTask(requestBody);
                params.blocks.forEach((block) => {
                    localStorage.setItem(buildContentTaskStorageKey(params.projectId, block.id), task_id);
                    localStorage.removeItem(`content_task_${block.id}`);
                });
                setLocalTaskRuntime(params.projectId, {
                    state: 'running',
                    taskId: task_id,
                    taskType: 'content',
                    message: params.groupTitle ? `${params.groupTitle} 正文批量生成中` : '正文批量生成中',
                    progress: 0,
                    cancellable: true,
                });
                callbacks.onStage(`🚀 分组任务已提交（${task_id.slice(0, 8)}）`);

                let lastStage = '';
                let pollMs = 2000;
                let lastPartialEventId = 0;
                const deliveredSections = new Set<string>();
                const normalizeGroupRow = (row: any) => ({
                    sectionId: String(row.section_id || row.sectionId || ''),
                    content: applyPlaceholderReportToContent(row.content || '', row.replace_report || row.replaceReport || []),
                    wordCount: Number(row.word_count || row.wordCount || 0),
                    qualityScore: row.quality_score ?? row.qualityScore,
                    feedback: row.feedback,
                    replaceReport: row.replace_report || row.replaceReport || [],
                    placeholderWarning: normalizePlaceholderWarning(row.placeholder_warning ?? row.placeholderWarning),
                    diagramError: extractDiagramErrorMessage(row.diagram_error ?? row.diagramError)
                        || extractDiagramSkipMessage(row.diagram_skip ?? row.diagramSkip),
                    diagramRequest: row.diagram_request ?? row.diagramRequest,
                });
                const deliverPartialSection = (row: any) => {
                    const sectionId = String(row?.section_id || row?.sectionId || '');
                    if (!sectionId || !row?.content || deliveredSections.has(sectionId)) return;
                    const section = normalizeGroupRow(row);
                    if (section.diagramError) {
                        console.warn('[content group] child diagram generation failed', {
                            projectId: params.projectId,
                            sectionId,
                            diagram_error: row.diagram_error ?? row.diagramError,
                        });
                    }
                    deliveredSections.add(sectionId);
                    callbacks.onSectionDone(section);
                };
                while (!controller.signal.aborted) {
                    await new Promise(r => setTimeout(r, pollMs));
                    if (controller.signal.aborted) break;
                    try {
                        const taskStatus = await getTaskStatusApi(task_id, params.projectId, {
                            afterEventId: lastPartialEventId,
                        });
                        if (taskStatus.current_stage && taskStatus.current_stage !== lastStage) {
                            lastStage = taskStatus.current_stage;
                            callbacks.onStage(lastStage);
                        }
                        const partialEvents = Array.isArray(taskStatus.partial_events) ? taskStatus.partial_events : [];
                        if (partialEvents.length > 0) {
                            for (const event of partialEvents) {
                                const eventId = Number(event?.event_id || 0);
                                if (eventId > lastPartialEventId) {
                                    lastPartialEventId = eventId;
                                }
                                if (event?.partial && event?.phase === 'group_child_done') {
                                    deliverPartialSection(event);
                                    callbacks.onStage(`🧩 子章节完成 ${event.done_count || 0}/${event.total_count || normalizedChildren.length}`);
                                }
                            }
                        } else {
                            const pr = taskStatus.partial_result;
                            const prEventId = Number(pr?.event_id || 0);
                            if (prEventId > lastPartialEventId) {
                                lastPartialEventId = prEventId;
                            }
                            if (pr?.partial && pr.phase === 'group_child_done') {
                                deliverPartialSection(pr);
                                callbacks.onStage(`🧩 子章节完成 ${pr.done_count || 0}/${pr.total_count || normalizedChildren.length}`);
                            }
                        }
                        if (typeof taskStatus.last_partial_event_id === 'number') {
                            lastPartialEventId = Math.max(lastPartialEventId, Number(taskStatus.last_partial_event_id || 0));
                        }
                        if (taskStatus.status === 'done' && taskStatus.result) {
                            const rows = Array.isArray(taskStatus.result.sections) ? taskStatus.result.sections : [];
                            const sections = rows.map(normalizeGroupRow).filter((row: any) => row.sectionId);
                            const failedSections = Array.isArray(taskStatus.result.failed_sections)
                                ? taskStatus.result.failed_sections.map((row: any) => ({
                                    sectionId: String(row.section_id || row.sectionId || ''),
                                    error: String(row.error || '分组生成失败'),
                                })).filter((row: any) => row.sectionId)
                                : [];
                            sections.forEach((section: any) => {
                                if (deliveredSections.has(section.sectionId)) return;
                                deliveredSections.add(section.sectionId);
                                callbacks.onSectionDone(section);
                            });
                            failedSections.forEach((failed: any) => {
                                if (deliveredSections.has(failed.sectionId)) return;
                                callbacks.onSectionFailed?.(failed.sectionId, failed.error || '分组生成失败');
                            });
                            setLocalTaskRuntime(params.projectId, {
                                state: 'succeeded',
                                taskId: task_id,
                                taskType: 'content',
                                message: failedSections.length > 0 ? '分组生成已结束，部分章节失败' : '',
                                progress: 100,
                                cancellable: false,
                            });
                            params.blocks.forEach((block) => {
                                localStorage.removeItem(buildContentTaskStorageKey(params.projectId, block.id));
                                localStorage.removeItem(`content_task_${block.id}`);
                            });
                            callbacks.onDone({ sections, failedSections });
                            break;
                        }
                        if (taskStatus.status === 'cancelled' || taskStatus.cancelled) {
                            setLocalTaskRuntime(params.projectId, {
                                state: 'cancelled',
                                taskId: task_id,
                                taskType: 'content',
                                message: '已取消',
                                cancellable: false,
                            });
                            params.blocks.forEach((block) => {
                                localStorage.removeItem(buildContentTaskStorageKey(params.projectId, block.id));
                                localStorage.removeItem(`content_task_${block.id}`);
                            });
                            callbacks.onError('__cancelled__');
                            break;
                        }
                        if (taskStatus.status === 'timeout' || taskStatus.timed_out) {
                            setLocalTaskRuntime(params.projectId, {
                                state: 'timed_out',
                                taskId: task_id,
                                taskType: 'content',
                                message: taskStatus.error || '分组生成超时',
                                cancellable: false,
                            });
                            params.blocks.forEach((block) => {
                                localStorage.removeItem(buildContentTaskStorageKey(params.projectId, block.id));
                                localStorage.removeItem(`content_task_${block.id}`);
                            });
                            callbacks.onError(taskStatus.error || '分组生成超时');
                            break;
                        }
                        if (taskStatus.status === 'error') {
                            setLocalTaskRuntime(params.projectId, {
                                state: 'failed',
                                taskId: task_id,
                                taskType: 'content',
                                message: taskStatus.error || '分组生成失败',
                                cancellable: false,
                            });
                            params.blocks.forEach((block) => {
                                localStorage.removeItem(buildContentTaskStorageKey(params.projectId, block.id));
                                localStorage.removeItem(`content_task_${block.id}`);
                            });
                            callbacks.onError(taskStatus.error || '分组生成失败');
                            break;
                        }
                        pollMs = Math.min(5000, pollMs + 500);
                    } catch (error) {
                        if ((error as any)?.status === 404) {
                            setLocalTaskRuntime(params.projectId, {
                                state: 'timed_out',
                                taskId: task_id,
                                taskType: 'content',
                                message: '分组任务不存在或已过期',
                                cancellable: false,
                            });
                            params.blocks.forEach((block) => {
                                localStorage.removeItem(buildContentTaskStorageKey(params.projectId, block.id));
                                localStorage.removeItem(`content_task_${block.id}`);
                            });
                            callbacks.onError('分组任务不存在或已过期');
                            break;
                        }
                    }
                }
            } catch (e: any) {
                if (e.name !== 'AbortError') callbacks.onError(e.message || '分组生成失败');
            }
        })();

        return controller;
    },

    generateGroupReviewStream(params: {
        projectId: string;
        groupId: string;
        groupTitle: string;
    }, callbacks: {
        onStage: (stage: string) => void;
        onDone: (result: { feedback: string; qualityScore?: number }) => void;
        onError: (err: string) => void;
    }): AbortController {
        const controller = new AbortController();
        const proj = loadAll().find(p => p.id === params.projectId);
        const outline = proj?.outline || [];
        const sections = outline
            .flatMap((sec) => sec.id === params.groupId ? (sec.children || []) : [])
            .map((child) => ({
                section_id: child.id,
                section_title: child.title,
                writing_hint: extractCoreWritingIntent(child.writingHint || ''),
                content: proj?.generatedContent?.[child.id]?.content || '',
            }))
            .filter((item) => item.content.trim());
        const projectSummary = proj?.blueprint
            ? `【项目核心定位】\n${proj.blueprint.positioning}\n\n【整体投标策略】\n${proj.blueprint.strategy}\n\n【差异化亮点】\n${proj.blueprint.highlights.map(h => `- ${h}`).join('\n')}\n\n【写作语体基调】\n${proj.blueprint.writing_style}`
            : (proj?.summary || '');
        const groupAnalysisContext = (() => {
            if (!proj?.analysisReport?.length) return '';
            const ids = sections.map(item => item.section_id);
            return ids
                .map((id) => {
                    const hit = outline.flatMap(sec => sec.children || []).find(child => child.id === id);
                    return hit?.relatedAnalysisIds || [];
                })
                .flat()
                .filter(Boolean)
                .filter((value, index, arr) => arr.indexOf(value) === index)
                .map((id) => matchAnalysisNodesByIds([id], proj.analysisReport || []))
                .filter(Boolean)
                .join('\n\n---\n\n');
        })();

        (async () => {
            try {
                const { task_id } = await startGroupReviewTask({
                    project_id: params.projectId,
                    group_id: params.groupId,
                    group_title: params.groupTitle,
                    project_summary: projectSummary,
                    group_outline: buildOutlineNeighborhoodSlice(outline, params.groupId, ''),
                    group_analysis_context: groupAnalysisContext,
                    sections,
                });
                callbacks.onStage(`🚀 评估任务已提交（${task_id.slice(0, 8)}）`);
                let lastStage = '';
                while (!controller.signal.aborted) {
                    await new Promise(r => setTimeout(r, 2000));
                    if (controller.signal.aborted) break;
                    try {
                        const taskStatus = await getTaskStatusApi(task_id, params.projectId);
                        if (taskStatus.current_stage && taskStatus.current_stage !== lastStage) {
                            lastStage = taskStatus.current_stage;
                            callbacks.onStage(lastStage);
                        }
                        if (taskStatus.status === 'done' && taskStatus.result) {
                            const result = taskStatus.result as any;
                            callbacks.onDone({
                                feedback: String(result.group_feedback || ''),
                                qualityScore: result.quality_score,
                            });
                            break;
                        }
                        if (taskStatus.status === 'cancelled' || taskStatus.cancelled) {
                            callbacks.onError('__cancelled__');
                            break;
                        }
                        if (taskStatus.status === 'timeout' || taskStatus.timed_out) {
                            callbacks.onError(taskStatus.error || '评估超时');
                            break;
                        }
                        if (taskStatus.status === 'error') {
                            callbacks.onError(taskStatus.error || '评估失败');
                            break;
                        }
                    } catch (error) {
                        if ((error as any)?.status === 404) {
                            callbacks.onError('评估任务不存在或已过期');
                            break;
                        }
                    }
                }
            } catch (e: any) {
                if (e.name !== 'AbortError') callbacks.onError(e.message || '评估失败');
            }
        })();
        return controller;
    },

    /**
     * 对刷新后仍在运行的 content 任务恢复轮询（复用 generateContentStream 的回调接口）。
     * 不重新发起 Dify 调用，只轮询已有的 task_id。
     */
    resumeContentTask(taskId: string, projectId: string, sectionId: string, callbacks: {
        onStage: (stage: string) => void;
        onDone: (result: {
            content: string;
            wordCount: number;
            qualityScore?: number;
            feedback?: string;
            replaceReport?: { placeholder: string; original: string }[];
            placeholderWarning?: PlaceholderWarning;
            diagramError?: string;
        }) => void;
        onError: (err: string) => void;
        /** 任务过期（后端重启）时触发，建议将状态重置为 idle，不向用户展示错误 */
        onExpired?: () => void;
    }): AbortController {
        const controller = new AbortController();
        const taskStorageKey = buildContentTaskStorageKey(projectId, sectionId);

        (async () => {
            let lastStage = '';
            // 先快速检查一次，避免任务刚完成就等 30s
            let firstCheck = true;
            while (!controller.signal.aborted) {
                if (!firstCheck) await new Promise(r => setTimeout(r, 10000)); // 10s 轮询（比首次发起时更短，更快感知恢复）
                firstCheck = false;
                if (controller.signal.aborted) break;
                try {
                    const taskStatus = await getTaskStatusApi(taskId, projectId);
                    if (taskStatus.current_stage && taskStatus.current_stage !== lastStage) {
                        lastStage = taskStatus.current_stage;
                        callbacks.onStage(lastStage);
                    }
                    if (taskStatus.status === 'done' && taskStatus.result) {
                        const r = taskStatus.result as any;
                        const diagramError = extractDiagramErrorMessage(r.diagram_error)
                            || extractDiagramSkipMessage(r.diagram_skip);
                        if (diagramError) {
                            console.warn('[content resume] recovered text-only result after diagram failure', {
                                projectId,
                                sectionId,
                                taskId,
                                diagram_error: r.diagram_error,
                            });
                            callbacks.onStage('⚠️ 图表生成失败，已保留正文');
                        }
                        callbacks.onDone({
                            content: r.content || '',
                            wordCount: r.word_count || 0,
                            qualityScore: r.quality_score,
                            feedback: r.feedback,
                            replaceReport: r.replace_report || [],
                            placeholderWarning: normalizePlaceholderWarning(r.placeholder_warning),
                            diagramError,
                        });
                        localStorage.removeItem(taskStorageKey);
                        localStorage.removeItem(`content_task_${sectionId}`);
                        break;
                    }
                    if (taskStatus.status === 'cancelled' || taskStatus.cancelled) {
                        // 用户主动取消：静默处理，重置为 idle
                        localStorage.removeItem(taskStorageKey);
                        localStorage.removeItem(`content_task_${sectionId}`);
                        callbacks.onExpired?.();
                        break;
                    }
                    if (taskStatus.status === 'timeout' || taskStatus.timed_out) {
                        localStorage.removeItem(taskStorageKey);
                        localStorage.removeItem(`content_task_${sectionId}`);
                        callbacks.onError(taskStatus.error || '生成超时，已自动解除任务锁');
                        break;
                    }
                    if (taskStatus.status === 'error') {
                        callbacks.onError(taskStatus.error || '生成失败');
                        localStorage.removeItem(taskStorageKey);
                        localStorage.removeItem(`content_task_${sectionId}`);
                        break;
                    }
                } catch (error) {
                    if ((error as any)?.status === 404) {
                        // 后端重启或任务过期时静默清理，用户可凭“重新生成”恢复。
                        localStorage.removeItem(taskStorageKey);
                        localStorage.removeItem(`content_task_${sectionId}`);
                        console.warn(`[content resume] 任务 ${taskId} 已过期，已清除缓存`);
                        callbacks.onExpired?.();
                        break;
                    }
                }
            }
        })();

        return controller;
    },


    /**
     * 收集已生成的章节内容 + 评分表 + 附件，调用 gateway-forge 生成最终 .docx
     * mappingTable / bidderInfo / scoringRows 全部从 localStorage 读取，不经过网络上传
     */
    async forgeDocument(
        projectId: string,
        sections: Array<{
            id: string;
            title: string;
            content: string;
            heading_level?: number;
            heading_number?: string;
            heading_text?: string;
            toc_level?: number;
            bookmark_id?: string;
            title_only?: boolean;
            inject_title?: boolean;
            source_type?: 'markdown' | 'docx_slice';
            attachment_name?: string;
            start_block_id?: string;
            end_block_id?: string;
            start_locator?: string;
            end_locator?: string;
        }>,
    ): Promise<void> {
        const proj = loadAll().find(p => p.id === projectId);
        if (!proj) throw new Error('项目不存在');

        // 保持 legacy workbench 的 section 组装方式，只把实际接口收敛到统一 service layer。
        saveBlobToDisk(await forgeDocumentApi(toBidProjectRecord({
            ...proj,
            scoringRows: proj.scoringRows ?? [],
            imageMap: Object.fromEntries(
                Object.entries(proj.imageMap ?? {}).map(([k, v]) => [
                    k,
                    typeof v === 'string' ? v : v.abs_path,
                ]),
            ),
            bidderInfo: proj.bidderInfo,
        }), sections as Array<Record<string, unknown>>));
    },
    /** 一键全部生成：串联调用所有章节（SSE 流式，逐 chunk 推送） */
    async generateAll(
        projectId: string,
        blocks: BatchGenerationBlock[],
        globalOutline: string,
        onProgress: (
            blockId: string,
            status: 'generating' | 'chunk' | 'stage' | 'done' | 'error',
            result?: ContentGenerationResult & { stage?: string },
            error?: string,
        ) => void,
        /** 外部取消信号：abort 后中断后续 block 的生成 */
        signal?: AbortSignal,
    ): Promise<void> {
        const maxConcurrency = 1;
        let cursor = 0;
        const activeCtrls = new Map<string, AbortController>();
        const units = buildContentGenerationUnits(blocks);
        const diagramRequests: DiagramRequest[] = [];
        const diagramRequestSectionIds = new Set<string>();
        const enqueueDiagramRequest = (sectionId: string, request?: DiagramRequest, content?: string) => {
            if (!request || diagramRequestSectionIds.has(sectionId)) return;
            diagramRequestSectionIds.add(sectionId);
            diagramRequests.push({
                ...request,
                project_id: projectId,
                section_id: sectionId,
                base_content: content || request.base_content || '',
            });
        };

        const runUnit = async (unit: BatchGenerationUnit) => {
            if (signal?.aborted) return;
            unit.blocks.forEach(block => onProgress(block.id, 'generating'));
            try {
                await new Promise<void>((resolve) => {
                    let settled = false;
                    const finish = () => { if (!settled) { settled = true; resolve(); } };
                    let ctrl: AbortController;
                    try {
                        if (unit.kind === 'group') {
                            const deliveredInUnit = new Set<string>();
                            ctrl = this.generateContentGroupStream(
                                {
                                    projectId,
                                    groupId: unit.groupId,
                                    groupTitle: unit.groupTitle,
                                    blocks: unit.blocks,
                                    globalOutline,
                                },
                                {
                                    onStage: (stage) => {
                                        unit.blocks.forEach(block => {
                                            onProgress(block.id, 'stage', { content: '', wordCount: 0, stage });
                                        });
                                    },
                                    onSectionDone: (section) => {
                                        if (deliveredInUnit.has(section.sectionId) && !section.diagramUpdate) return;
                                        deliveredInUnit.add(section.sectionId);
                                        enqueueDiagramRequest(section.sectionId, section.diagramRequest, section.content);
                                        onProgress(section.sectionId, 'done', {
                                            content: section.content,
                                            wordCount: section.wordCount,
                                            qualityScore: section.qualityScore,
                                            feedback: section.feedback,
                                            replaceReport: section.replaceReport,
                                            placeholderWarning: section.placeholderWarning,
                                            diagramUpdate: section.diagramUpdate,
                                            diagramRequest: section.diagramRequest,
                                        });
                                    },
                                    onSectionFailed: (sectionId, error) => {
                                        if (!sectionId || deliveredInUnit.has(sectionId)) return;
                                        deliveredInUnit.add(sectionId);
                                        onProgress(sectionId, 'error', undefined, error || '分组生成失败');
                                    },
                                    onDone: (res) => {
                                        activeCtrls.delete(unit.key);
                                        const byId = new Map(res.sections.map(section => [section.sectionId, section]));
                                        const failedById = new Map((res.failedSections || []).map(section => [section.sectionId, section.error]));
                                        unit.blocks.forEach(block => {
                                            const section = byId.get(block.id);
                                            if (section && !deliveredInUnit.has(block.id)) {
                                                deliveredInUnit.add(block.id);
                                                enqueueDiagramRequest(block.id, section.diagramRequest, section.content);
                                                onProgress(block.id, 'done', {
                                                    content: section.content,
                                                    wordCount: section.wordCount,
                                                    qualityScore: section.qualityScore,
                                                    feedback: section.feedback,
                                                    replaceReport: section.replaceReport,
                                                    placeholderWarning: section.placeholderWarning,
                                                    diagramRequest: section.diagramRequest,
                                                });
                                                return;
                                            }
                                            if (deliveredInUnit.has(block.id)) {
                                                return;
                                            }
                                            const failedReason = failedById.get(block.id);
                                            if (failedReason) {
                                                onProgress(block.id, 'error', undefined, failedReason);
                                            } else if (!section) {
                                                onProgress(block.id, 'error', undefined, '分组结果缺少该章节');
                                            }
                                        });
                                        finish();
                                    },
                                    onError: (err) => {
                                        activeCtrls.delete(unit.key);
                                        const msg = err === '__cancelled__' ? '已取消' : err;
                                        unit.blocks.forEach(block => {
                                            if (deliveredInUnit.has(block.id)) return;
                                            onProgress(block.id, 'error', undefined, msg);
                                        });
                                        finish();
                                    },
                                },
                            );
                        } else {
                            const [block] = unit.blocks;
                            let accumulated = '';
                            ctrl = this.generateContentStream(
                                {
                                    projectId,
                                    sectionId: block.id,
                                    sectionTitle: block.title,
                                    writingHint: block.writingHint,
                                    keywords: block.keywords,
                                    expectedWords: block.expectedWords,
                                    globalOutline,
                                    requiresSearch: block.requiresSearch,
                                    generationStrategy: block.generationStrategy,
                                    needDiagram: block.needDiagram,
                                    diagramBrief: block.diagramBrief,
                                    diagramTypeHint: block.diagramTypeHint,
                                    diagramPriority: block.diagramPriority,
                                },
                                {
                                    onChunk: (text) => {
                                        accumulated = text;
                                        onProgress(block.id, 'chunk', { content: accumulated, wordCount: 0 });
                                    },
                                    onStage: (stage) => {
                                        onProgress(block.id, 'stage', { content: accumulated, wordCount: 0, stage });
                                    },
                                    onDone: (res) => {
                                        activeCtrls.delete(unit.key);
                                        enqueueDiagramRequest(block.id, res.diagramRequest, res.content || accumulated);
                                        onProgress(block.id, 'done', {
                                            content: res.content || accumulated,
                                            wordCount: res.wordCount,
                                            qualityScore: res.qualityScore,
                                            feedback: res.feedback,
                                            replaceReport: res.replaceReport,
                                            placeholderWarning: res.placeholderWarning,
                                            diagramUpdate: res.diagramUpdate,
                                            diagramRequest: res.diagramRequest,
                                        });
                                        finish();
                                    },
                                    onError: (err) => {
                                        activeCtrls.delete(unit.key);
                                        const msg = err === '__cancelled__' ? '已取消' : err;
                                        onProgress(block.id, 'error', undefined, msg);
                                        finish();
                                    },
                                },
                            );
                        }
                    } catch (e: any) {
                        unit.blocks.forEach(block => onProgress(block.id, 'error', undefined, e?.message || '启动生成失败'));
                        finish();
                        return;
                    }
                    activeCtrls.set(unit.key, ctrl);
                    const onAbort = () => {
                        ctrl.abort();
                        finish();
                    };
                    signal?.addEventListener('abort', onAbort, { once: true });
                });
            } catch (e: any) {
                activeCtrls.delete(unit.key);
                unit.blocks.forEach(block => onProgress(block.id, 'error', undefined, e?.message || '生成异常中断'));
            }
        };

        const worker = async () => {
            while (!signal?.aborted) {
                const idx = cursor++;
                if (idx >= units.length) break;
                await runUnit(units[idx]);
            }
        };

        await Promise.all(
            Array.from({ length: Math.min(maxConcurrency, units.length) }, () => worker())
        );

        if (signal?.aborted) {
            for (const ctrl of activeCtrls.values()) ctrl.abort();
            return;
        }

        void runDiagramBatchQueue(
            projectId,
            diagramRequests,
            {
                onStage: (stage) => {
                    blocks.forEach(block => onProgress(block.id, 'stage', { content: '', wordCount: 0, stage }));
                },
                onSectionDone: (sectionId, result) => {
                    onProgress(sectionId, 'done', result);
                },
            },
            signal,
        );
    },

    /**
     * P7 下游联动：SSE 提取节点完成后，根据 node_id 触发对应联动处理
     * 在 RequirementsReview 的 onNodeComplete 回调中调用
     */
    processAnalysisLinkage(projectId: string, nodeId: string, content: string): void {
        switch (nodeId) {
            // 投标文件目录 → requiredAttachments → BidDocWorkbench 自动初始化
            case 'structure_attachments': {
                const matches = Array.from(content.matchAll(/<要点[^>]*>(.*?)<\/要点>/g));
                const attachments: AttachmentRequirement[] = [];
                for (const match of matches) {
                    const name = String(match[1] || '').replace(/<[^>]+>/g, '').trim();
                    if (!name) continue;
                    attachments.push({
                        id: `toc_${attachments.length + 1}`,
                        name,
                        description: '',
                        type: 'extracted',
                    });
                }
                this.update(projectId, { requiredAttachments: attachments });
                console.info(`[联动] structure_attachments → requiredAttachments: ${attachments.length} 项`);
                break;
            }

            // 评审标准 → 结构化评分数据（用于自评表和生成权重）
            case 'scoring_details': {
                try {
                    const parsed = JSON.parse(content);
                    const rows = Array.isArray(parsed?.items)
                        ? parsed.items.map((item: any, idx: number) => ({
                            index: String(idx + 1),
                            item: String(item?.name || ''),
                            criteria: String(item?.criteria || ''),
                            score: String(item?.max_score || 0),
                            scoreTag: String(item?.score_tag || 'mixed'),
                        }))
                        : [];
                    this.update(projectId, { scoringCriteria: rows } as any);
                    console.info(`[联动] scoring_details → scoringCriteria: ${rows.length} 项`);
                } catch (err) {
                    console.warn('[联动] scoring_details 解析失败:', err);
                }
                break;
            }

            // 暗标格式 → 排版规则（存储到项目字段，后续投标文件生成时消费）
            case 'form_format': {
                this.update(projectId, { formatRules: content } as any);
                console.info(`[联动] form_format → formatRules 已保存`);
                break;
            }

            default:
                break;
        }
    },

    async buildScoringTable(project: Project): Promise<ScoringRow[]> {
        const scoreReqs = (project.requirements ?? [])
            .filter(r => r.type === 'score')
            .map((r, i) => ({ id: `score_${i}`, content: r.content, points: r.points ?? 10 }));
        const res = await buildScoringTableApi({
            projectId: project.id,
            scoreRequirements: scoreReqs,
            scoringTableTemplate: project.scoringTableTemplate || [],
        });
        return (res.rows ?? []).map((row: any) => ({
            id: row.id,
            indicator: row.indicator,
            maxScore: row.max_score,
            criteria: row.criteria ?? '',
            selfResponse: '',
            selfComment: '',
            evidenceRefs: [],
        }));
    },

    async fillScoringRow(project: Project, row: ScoringRow): Promise<Partial<ScoringRow>> {
        const reqsContext = (project.requirements ?? [])
            .map(r => `[${r.type}] ${r.content}`)
            .join('\n')
            .substring(0, 800);
        const res = await fillScoringRowApi({
            rowId: row.id,
            indicator: row.indicator,
            maxScore: row.maxScore,
            criteria: row.criteria,
            projectSummary: project.summary ?? '',
            requirementsContext: reqsContext,
        });
        return {
            selfResponse: res.self_response as 'full' | 'partial',
            selfComment: res.self_comment ?? '',
            evidenceRefs: res.evidence_refs ?? [],
        };
    },

    async exportScoringTable(project: Project, rows: ScoringRow[]): Promise<void> {
        saveBlobToDisk(await exportScoringTableApi(
            project.name,
            rows.map(row => ({
                id: row.id,
                indicator: row.indicator,
                max_score: row.maxScore,
                criteria: row.criteria,
                self_response: row.selfResponse,
                self_comment: row.selfComment,
                evidence_refs: row.evidenceRefs,
            })),
        ));
    },

    async generateAttachment(input: {
        project: Project;
        attachmentType: string;
        attachmentName: string;
        attachmentDesc: string;
        recipient: string;
        bidNo: string;
        agentName: string;
        agentId: string;
    }): Promise<{ label: string; content: string }> {
        const bidder = input.project.bidderInfo;
        const res = await generateAttachmentApi({
            attachmentType: input.attachmentType,
            attachmentName: input.attachmentName,
            attachmentDesc: input.attachmentDesc,
            projectId: input.project.id,
            orgName: bidder?.orgName || '',
            legalRep: bidder?.legalRep || '',
            projectLead: bidder?.projectLead || '',
            phone: bidder?.phone || '',
            docDate: bidder?.docDate || '',
            projectName: input.project.name,
            recipient: input.recipient,
            bidNo: input.bidNo,
            agentName: input.agentName,
            agentId: input.agentId,
        });
        return { label: String(res.label || ''), content: String(res.content || '') };
    },

    async generateBlueprint(project: Project): Promise<BlueprintData> {
        const reqs = (project.requirements || [])
            .filter(requirement => requirement.type !== 'score')
            .map(requirement => ({ type: requirement.type, content: requirement.content }));
        const outline = (project.outline || []).map(section => ({ title: section.title }));
        const res = await generateBlueprintApi({
            projectId: project.id,
            bidType: project.bidType || 'tech',
            projectSummary: project.summary || '',
            requirements: reqs,
            outline,
        });
        return (res.blueprint || {
            positioning: '',
            strategy: '',
            highlights: [],
            writing_style: '',
        }) as unknown as BlueprintData;
    },

    async getKnowledgeDocuments(): Promise<KnowledgeDocumentInfo[]> {
        const res: any = await fetchKnowledgeDocumentsApi();
        return toKnowledgeDocumentInfoList(res?.documents);
    },
};


// ────────────────── 投标文件附件服务 ──────────────────────

export const bidAttachmentService = {
    /**
     * 按段落定位符提取 DOCX 附件原文，返回 HTML 字符串
     */
    extractContent: async (
        projectId: string,
        item: BidAttachmentItem,
    ): Promise<{
        html: string;
        attachmentName: string;
        paragraphCount: number;
        resolvedStartLocator: string;
        resolvedEndLocator: string;
    }> => {
        const res = await extractBidAttachmentApi({
            projectId,
            startLocator: item.start_locator,
            endLocator: item.end_locator,
            attachmentName: item.name,
        });
        return {
            html: String(res.html || ''),
            attachmentName: String(res.attachment_name || item.name),
            paragraphCount: Number(res.paragraph_count || 0),
            resolvedStartLocator: res.resolved_start_locator || item.start_locator,
            resolvedEndLocator: res.resolved_end_locator || item.end_locator,
        };
    },

    getDocBlocks: async (projectId: string): Promise<DocBlocksResponse> => {
        const res = await fetchProjectDocBlocksApi(projectId);
        return {
            blocks: Array.isArray(res?.blocks)
                ? res.blocks.map((item: any) => ({
                    block_id: String(item?.block_id || ''),
                    locator: String(item?.locator || ''),
                    body_idx: Number(item?.body_idx || 0),
                    type: (item?.type === 'table' ? 'table' : 'paragraph') as 'table' | 'paragraph',
                    text: String(item?.text || ''),
                })).filter((item: any) => Boolean(item.block_id))
                : [],
            snapshotOnly: Boolean(res?.snapshot_only),
        };
    },

    getSourceDocx: async (projectId: string): Promise<Blob> => {
        return (await fetchSourceDocxApi(projectId)).blob;
    },

    rebuildLocator: async (projectId: string, file: File): Promise<{ blocks: number; locators: number }> => {
        const res = await rebuildLocatorApi(projectId, file);
        return {
            blocks: Number(res?.blocks || 0),
            locators: Number(res?.locators || 0),
        };
    },

    extractContentByBlocks: async (
        projectId: string,
        params: { attachmentName: string; startBlockId: string; endBlockId: string },
    ): Promise<{ html: string; attachmentName: string; paragraphCount: number; startBlockId: string; endBlockId: string; snapshotOnly: boolean }> => {
        const res = await extractBidAttachmentByBlocksApi({
            projectId,
            attachmentName: params.attachmentName,
            startBlockId: params.startBlockId,
            endBlockId: params.endBlockId,
        });
        return {
            html: String(res.html || ''),
            attachmentName: String(res.attachment_name || params.attachmentName),
            paragraphCount: Number(res.paragraph_count || 0),
            startBlockId: String(res.start_block_id || params.startBlockId),
            endBlockId: String(res.end_block_id || params.endBlockId),
            snapshotOnly: Boolean(res.snapshot_only),
        };
    },

    extractDocxByBlocks: async (
        projectId: string,
        params: { attachmentName: string; startBlockId: string; endBlockId: string },
    ): Promise<Blob> => {
        const download = await extractBidAttachmentDocxByBlocksApi({
            projectId,
            attachmentName: params.attachmentName,
            startBlockId: params.startBlockId,
            endBlockId: params.endBlockId,
        });
        return download.blob;
    },

    /**
     * 开发调试用：查看项目定位符映射前 20 条
     */
    testLocators: async (projectId: string): Promise<{
        total_locators: number;
        preview: { locator: string; body_idx: number; snippet: string }[];
    }> => {
        const res = await testBidAttachmentLocatorsApi(projectId);
        return {
            total_locators: Number(res.total_locators || 0),
            preview: Array.isArray(res.preview)
                ? res.preview.map((item: any) => ({
                    locator: String(item?.locator || ''),
                    body_idx: Number(item?.body_idx || 0),
                    snippet: String(item?.snippet || ''),
                }))
                : [],
        };
    },
};
