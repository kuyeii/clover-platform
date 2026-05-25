/**
 * writingHint 纯文本辅助：
 * - 提取用户可见/可编辑的核心写作意图
 * - 兼容旧数据中已经混入的系统默认规则与目录定位块
 */

const ANALYSIS_ID_LABEL_MAP: Record<string, string> = {
    proj_overview: '项目解读',
    proj_basic: '项目基础信息',
    structure_attachments: '附件结构',
    form_format: '暗标格式',
    form_other: '其他要求',
    qual_cert: '资质要求',
    qual_perf: '业绩要求',
    qual_fin: '财务要求',
    resp_tech: '技术要求',
    resp_param: '参数要求',
    resp_substance: '实质性条款',
    eval_method: '评审方式',
    scoring_details: '评分细则',
    invalid_items: '废标项',
};

const SYSTEM_BLOCK_TITLES = [
    '【本节目录层级定位（勿用 # 标题重复以下编号）】',
    '【招标文件解析参考（优先级最高，严格对应本章节要求）】',
    '【正文扩写与技术深度约束（必须遵守）】',
] as const;

const IMPLICIT_TAIL_ANCHORS = [
    '正文应按“需求理解、方案机制、落地措施、验证与风险控制”展开',
    '不要重复目录编号',
    '不得编造缺乏依据',
] as const;

type TextRange = {
    start: number;
    end: number;
};

export const WRITING_INTENT_AUTO_RULE_NOTE = '系统会根据当前标题、预计字数和关键词自动补齐默认规则，无需手动修改。';

function remapAnalysisIds(text: string): string {
    return text
        .replace(/\[id:([a-z_]+)\]/gi, (_, id: string) => `「${ANALYSIS_ID_LABEL_MAP[id] || id}」`)
        .replace(/【id:([a-z_]+)】/gi, (_, id: string) => `「${ANALYSIS_ID_LABEL_MAP[id] || id}」`);
}

function findSystemBlockRanges(text: string): TextRange[] {
    const matches = SYSTEM_BLOCK_TITLES
        .map((title) => ({ title, start: text.indexOf(title) }))
        .filter((item) => item.start >= 0)
        .sort((a, b) => a.start - b.start);
    return matches.map((item, idx) => ({
        start: item.start,
        end: matches[idx + 1]?.start ?? text.length,
    }));
}

function joinNonEmptySegments(segments: string[]): string {
    return segments.map((segment) => segment.trim()).filter(Boolean).join('\n\n').trim();
}

/**
 * 提取用户真正应看到/编辑的核心写作意图。
 * 兼容两类旧数据：
 * 1. 运行时已经拼入目录定位/解析参考/扩写约束块；
 * 2. AI 大纲增强阶段自动追加的通用尾句。
 */
export function extractCoreWritingIntent(raw?: string): string {
    const normalized = remapAnalysisIds(String(raw || '').replace(/\r\n/g, '\n')).trim();
    if (!normalized) return '';

    const systemRanges = findSystemBlockRanges(normalized);
    let core = normalized;

    if (systemRanges.length > 0) {
        const segments: string[] = [];
        let cursor = 0;
        for (const range of systemRanges) {
            const between = normalized.slice(cursor, range.start).trim();
            if (between) segments.push(between);
            cursor = range.end;
        }
        const tail = normalized.slice(cursor).trim();
        if (tail) segments.push(tail);
        core = joinNonEmptySegments(segments);
    }

    const anchorIndexes = IMPLICIT_TAIL_ANCHORS
        .map((anchor) => core.indexOf(anchor))
        .filter((index) => index >= 0);
    if (anchorIndexes.length > 0) {
        core = core.slice(0, Math.min(...anchorIndexes)).trim();
    }

    return core.trim();
}
