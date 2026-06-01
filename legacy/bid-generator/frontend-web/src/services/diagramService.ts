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

function escapeSvgText(text: string): string {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function mermaidToPreviewSvg(source: string, title = '数据流图'): string {
    const lines = String(source || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .filter(line => !/^(flowchart|graph)\s+/i.test(line))
        .slice(0, 18);
    const rows = lines.length ? lines : ['Mermaid 图表源码已生成'];
    const width = 1120;
    const rowHeight = 30;
    const height = Math.max(180, 92 + rows.length * rowHeight);
    const body = rows.map((line, index) => {
        const y = 88 + index * rowHeight;
        return `<text x="40" y="${y}" font-size="16" fill="#334155" font-family="monospace">${escapeSvgText(line.slice(0, 118))}</text>`;
    }).join('');
    return [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
        '<rect width="100%" height="100%" rx="16" fill="#f8fafc"/>',
        '<rect x="24" y="22" width="1072" height="44" rx="10" fill="#e0f2fe" stroke="#bae6fd"/>',
        `<text x="40" y="50" font-size="20" font-weight="700" fill="#0369a1" font-family="Arial, sans-serif">${escapeSvgText(title)}</text>`,
        body,
        `<text x="40" y="${height - 28}" font-size="13" fill="#64748b" font-family="Arial, sans-serif">Mermaid 源码预览；导出 DOCX 时会渲染为正式图片。</text>`,
        '</svg>',
    ].join('');
}

function isMermaidFallbackSvg(svg: string): boolean {
    return /Mermaid\s*源码预览/i.test(String(svg || ''));
}

let mermaidInitialized = false;
let mermaidRenderSeq = 0;

async function renderMermaidToSvg(source: string): Promise<string> {
    const text = String(source || '').trim();
    if (!text) return '';
    const { default: mermaid } = await import('mermaid');
    if (!mermaidInitialized) {
        mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            theme: 'default',
        });
        mermaidInitialized = true;
    }
    const renderId = `proengine-mermaid-${Date.now()}-${mermaidRenderSeq++}`;
    const result = await mermaid.render(renderId, text);
    return result.svg || '';
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
            if (resp.ok) {
                const svg = await resp.text();
                if (!isMermaidFallbackSvg(svg)) return svg;
                const mmdResp = await bidGeneratorFetch(`/diagram-artifacts/${encodeURIComponent(id)}.mmd${query}`);
                if (!mmdResp.ok) return svg;
                const source = await mmdResp.text();
                return await renderMermaidToSvg(source).catch(() => svg);
            }
            const mmdResp = await bidGeneratorFetch(`/diagram-artifacts/${encodeURIComponent(id)}.mmd${query}`);
            if (!mmdResp.ok) return '';
            const mermaid = await mmdResp.text();
            return await renderMermaidToSvg(mermaid).catch(() => mermaidToPreviewSvg(mermaid));
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
