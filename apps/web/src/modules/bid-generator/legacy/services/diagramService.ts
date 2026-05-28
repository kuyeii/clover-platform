import { bidGeneratorFetch } from './apiBase';

export interface PlaceholderReplaceRow {
    placeholder: string;
    original: string;
}

export interface DiagramRequest {
    project_id: string;
    section_id: string;
    section_title?: string;
    base_content: string;
    writing_hint?: string;
    keywords?: string;
    global_outline?: string;
    section_outline_slice?: string;
    expected_words?: number;
    analysis_context?: string;
    mapping_table?: Record<string, string>;
    enable_diagrams: boolean;
    max_diagrams: number;
    need_diagram: boolean;
    diagram_brief: string;
    diagram_type_hint?: string;
    diagram_specs?: unknown;
    quality_score?: number;
    feedback?: string;
    replace_report?: PlaceholderReplaceRow[];
}

export interface DiagramSectionResult {
    section_id: string;
    content: string;
    word_count: number;
    quality_score?: number;
    feedback?: string;
    replace_report?: PlaceholderReplaceRow[];
    diagrams_count?: number;
    diagram_error?: unknown;
}

export interface DiagramBatchResult {
    sections: DiagramSectionResult[];
    failed_sections?: Array<{ section_id: string; error: unknown }>;
    diagrams_count?: number;
    diagram_error?: unknown;
}

export interface DiagramTaskStatus {
    task_id: string;
    status: string;
    current_stage?: string;
    result?: DiagramBatchResult | DiagramSectionResult | null;
    partial_events?: Array<DiagramSectionResult & {
        partial?: boolean;
        phase?: string;
        event_id?: number;
        done_count?: number;
        total_count?: number;
    }>;
    last_partial_event_id?: number;
    error?: string;
    cancelled?: boolean;
    timed_out?: boolean;
}

export class DiagramServiceError extends Error {
    status: number;
    detail: unknown;
    code?: string;

    constructor(status: number, detail: unknown) {
        const message = typeof detail === 'object' && detail && 'message' in detail
            ? String((detail as { message?: unknown }).message || `HTTP ${status}`)
            : `HTTP ${status}`;
        super(message);
        this.name = 'DiagramServiceError';
        this.status = status;
        this.detail = detail;
        this.code = typeof detail === 'object' && detail && 'code' in detail
            ? String((detail as { code?: unknown }).code || '')
            : undefined;
    }
}

/** 图表 API Service：封装 artifact 拉取、批量启动和轮询，避免组件直接访问后端。 */
export const diagramService = {
    /** 获取后端落盘的 SVG artifact，失败时返回空字符串，由 UI 静默降级。 */
    async getDiagramSvg(diagramId: string, projectId?: string): Promise<string> {
        const id = String(diagramId || '').trim();
        if (!id) return '';
        const query = projectId ? `?project_id=${encodeURIComponent(projectId)}` : '';
        try {
            const resp = await bidGeneratorFetch(`/diagram-artifacts/${encodeURIComponent(id)}.svg${query}`);
            return resp.ok ? await resp.text() : '';
        } catch {
            return '';
        }
    },

    /** 启动后端批量图表任务。正文已交付，图表只作为增强内容回填。 */
    async startDiagramBatch(projectId: string, requests: DiagramRequest[], signal?: AbortSignal): Promise<string> {
        const resp = await bidGeneratorFetch(`/tasks/start-diagram-batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                project_id: projectId,
                diagram_requests: requests,
                enable_diagrams: true,
            }),
            signal,
        });
        if (!resp.ok) {
            const body = await resp.json().catch(() => ({}));
            throw new DiagramServiceError(resp.status, body?.detail || body);
        }
        const body = await resp.json();
        return String(body.task_id || '');
    },

    /** 查询图表任务状态，支持 afterEventId 增量拉取 partial_events。 */
    async getDiagramTaskStatus(taskId: string, projectId: string, afterEventId = 0): Promise<DiagramTaskStatus> {
        const query = `?project_id=${encodeURIComponent(projectId)}&after_event_id=${encodeURIComponent(String(afterEventId))}`;
        const resp = await bidGeneratorFetch(`/tasks/${encodeURIComponent(taskId)}/status${query}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return await resp.json();
    },

    /** 取消图表任务。取消失败通常代表任务已经结束，调用方不需要弹窗。 */
    async cancelDiagramTask(taskId: string, projectId: string): Promise<void> {
        const query = `?project_id=${encodeURIComponent(projectId)}`;
        try {
            await bidGeneratorFetch(`/tasks/${encodeURIComponent(taskId)}/cancel${query}`, { method: 'POST' });
        } catch {
            // 图表是增强任务，取消失败静默处理。
        }
    },
};
