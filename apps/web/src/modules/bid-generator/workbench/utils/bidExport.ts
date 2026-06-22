import type { BidModule, OutlineSection, Project } from '../services/projectService';
import { syncBidModulesForProject } from '../services/projectService';
import turndownService from './turndown';

export type BidExportSection = {
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
};

export function resolveVersionContent(state: any): string {
    if (!state) return '';
    return state.content || '';
}

function stripHeadingNumberingText(text: string): string {
    return String(text || '')
        .trim()
        .replace(
            /^(?:[一二三四五六七八九十百千万]+、|（[一二三四五六七八九十百千万]+）|\([一二三四五六七八九十百千万]+\)|\d+(?:\.\d+){1,3}|\d+\.)\s*/,
            '',
        )
        .trim();
}

function normalizeHeadingCompareText(text: string): string {
    return stripHeadingNumberingText(
        String(text || '')
            .trim()
            .replace(/^\*\*(.*?)\*\*$/, '$1')
            .replace(/^#+\s*/, '')
            .replace(/[：:]\s*$/, ''),
    )
        .replace(/\s+/g, '')
        .trim()
        .toLowerCase();
}

function removeLeadingDuplicateHeading(content: string, title: string): string {
    const raw = String(content || '').trim();
    if (!raw) return '';

    const lines = raw.split(/\r?\n/);
    const titleNorm = normalizeHeadingCompareText(title);
    let firstContentIndex = -1;
    for (let i = 0; i < lines.length; i += 1) {
        if (lines[i].trim()) {
            firstContentIndex = i;
            break;
        }
    }
    if (firstContentIndex < 0) return raw;

    const firstLine = lines[firstContentIndex].trim();
    if (normalizeHeadingCompareText(firstLine) !== titleNorm) return raw;

    lines.splice(firstContentIndex, 1);
    while (lines.length > 0 && !lines[0].trim()) lines.shift();
    return lines.join('\n').trim();
}

type OutlineExportNode = {
    id: string;
    title: string;
    headingLevel?: number;
    children?: OutlineExportNode[];
};

function flattenOutlineById(outline: OutlineSection[] | undefined): Map<string, { id: string; title: string; headingLevel: number }> {
    const map = new Map<string, { id: string; title: string; headingLevel: number }>();
    for (const sec of outline || []) {
        map.set(sec.id, { id: sec.id, title: sec.title, headingLevel: sec.headingLevel || 2 });
        for (const child of sec.children || []) {
            map.set(child.id, { id: child.id, title: child.title, headingLevel: child.headingLevel || 3 });
            for (const third of child.children || []) {
                map.set(third.id, { id: third.id, title: third.title, headingLevel: third.headingLevel || 3 });
            }
        }
    }
    return map;
}

function flattenOutlineNodes(outline: OutlineSection[] | undefined): Map<string, OutlineExportNode> {
    const map = new Map<string, OutlineExportNode>();

    const visit = (node: OutlineExportNode) => {
        map.set(node.id, node);
        for (const child of node.children || []) visit(child);
    };

    for (const sec of outline || []) {
        visit(sec as OutlineExportNode);
    }
    return map;
}

function collectOutlineIdsInOrder(node: OutlineExportNode | undefined): string[] {
    if (!node) return [];
    const ids = [node.id];
    for (const child of node.children || []) {
        ids.push(...collectOutlineIdsInOrder(child));
    }
    return ids;
}

export function collectGeneratedSections(
    project: Project,
    linkedSectionIds: string[],
): Array<{ id: string; title: string; content: string; headingLevel: number }> {
    const outlineMap = flattenOutlineById(project.outline);
    const outlineNodes = flattenOutlineNodes(project.outline);
    const sections: Array<{ id: string; title: string; content: string; headingLevel: number }> = [];
    const seen = new Set<string>();

    for (const sectionId of linkedSectionIds) {
        const orderedIds = collectOutlineIdsInOrder(outlineNodes.get(sectionId));
        const candidateIds = orderedIds.length > 0 ? orderedIds : [sectionId];
        for (const candidateId of candidateIds) {
            if (seen.has(candidateId)) continue;
            seen.add(candidateId);
            const state = project.generatedContent?.[candidateId];
            if (!state || state.status !== 'done') continue;
            const content = resolveVersionContent(state).trim();
            if (!content) continue;
            const meta = outlineMap.get(candidateId);
            sections.push({
                id: candidateId,
                title: stripHeadingNumberingText(meta?.title || candidateId),
                content,
                headingLevel: meta?.headingLevel || 3,
            });
        }
    }
    return sections;
}

function pushMarkdownSection(
    target: BidExportSection[],
    section: {
        id: string;
        title: string;
        content?: string;
        headingLevel?: number;
        headingNumber?: string;
        headingText?: string;
        tocLevel?: number;
        bookmarkId?: string;
        titleOnly?: boolean;
    },
) {
    target.push({
        id: section.id,
        title: section.title,
        content: section.content || '',
        heading_level: section.headingLevel || 1,
        // 导出时以 Word 自动多级编号为唯一来源，避免静态编号与自动编号叠加。
        heading_number: '',
        heading_text: section.headingText || section.title,
        toc_level: section.tocLevel || section.headingLevel || 1,
        bookmark_id: section.bookmarkId || '',
        title_only: section.titleOnly ?? false,
        source_type: 'markdown',
    });
}

type HeadingNumberingState = {
    h1: number;
    h2: number;
    h3: number;
};

function toChineseNumber(value: number): string {
    const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    if (value <= 0) return '零';
    if (value < 10) return digits[value];
    if (value < 20) return `十${value % 10 === 0 ? '' : digits[value % 10]}`;
    if (value < 100) {
        const tens = Math.floor(value / 10);
        const units = value % 10;
        return `${digits[tens]}十${units === 0 ? '' : digits[units]}`;
    }
    return String(value);
}

function buildHeadingMeta(
    state: HeadingNumberingState,
    headingLevel: number,
    id: string,
    title: string,
): { headingNumber: string; headingText: string; tocLevel: number; bookmarkId: string } {
    const level = Math.max(1, Math.min(3, headingLevel || 1));
    if (level === 1) {
        state.h1 += 1;
        state.h2 = 0;
        state.h3 = 0;
        const number = `${toChineseNumber(state.h1)}、`;
        return {
            headingNumber: number,
            headingText: stripHeadingNumberingText(title),
            tocLevel: 1,
            bookmarkId: `BM_${String(id || '').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 35)}`,
        };
    }
    if (level === 2) {
        if (state.h1 <= 0) state.h1 = 1;
        state.h2 += 1;
        state.h3 = 0;
        const number = `${state.h1}.${state.h2}`;
        return {
            headingNumber: number,
            headingText: stripHeadingNumberingText(title),
            tocLevel: 2,
            bookmarkId: `BM_${String(id || '').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 35)}`,
        };
    }
    if (state.h1 <= 0) state.h1 = 1;
    if (state.h2 <= 0) state.h2 = 1;
    state.h3 += 1;
    const number = `${state.h1}.${state.h2}.${state.h3}`;
    return {
        headingNumber: number,
        headingText: stripHeadingNumberingText(title),
        tocLevel: 3,
        bookmarkId: `BM_${String(id || '').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 35)}`,
    };
}

/**
 * 构建投标文件导出章节：
 * - 以 analysis_v2.bid_structure 生成的编排模块为唯一顺序来源；
 * - 附件、技术部分、商务部分均作为主标题，可按块锚点保格式切片；
 * - 技术模块下展开已完成的正文小节，商务模块默认只保留占位标题；
 * - 没有正文但仍需保留结构时，允许仅导出标题节点。
 */
export function buildBidExportSections(
    project: Project,
    modules: BidModule[],
): BidExportSection[] {
    const exportSections: BidExportSection[] = [];
    const numberingState: HeadingNumberingState = { h1: 0, h2: 0, h3: 0 };
    const effectiveModules = syncBidModulesForProject(project, modules)
        .filter(item => item.enabled)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const attachmentModules = effectiveModules.filter((item) => item.moduleKind === 'attachment');
    const technicalModules = effectiveModules.filter((item) => item.moduleKind === 'technical');
    const businessModules = effectiveModules.filter((item) => item.moduleKind === 'business');
    const attachmentAnchorByStructureId = new Map<string, {
        startBlockId: string;
        endBlockId: string;
        startLocator: string;
        endLocator: string;
    }>();
    for (const item of project.analysisV2?.bid_structure?.attachments || []) {
        const id = String(item?.id || '').trim();
        if (!id) continue;
        attachmentAnchorByStructureId.set(id, {
            startBlockId: String(item?.start_block_id || '').trim(),
            endBlockId: String(item?.end_block_id || '').trim(),
            startLocator: String(item?.start_locator || '').trim(),
            endLocator: String(item?.end_locator || '').trim(),
        });
    }

    for (const module of attachmentModules) {
        const htmlContent = module.filledContent || module.templateContent || '';
        const markdownContent = htmlContent.trim() ? turndownService.turndown(htmlContent) : '';
        const fallbackAnchor = module.structureHeadingId
            ? attachmentAnchorByStructureId.get(module.structureHeadingId)
            : undefined;

        const start = (module.startBlockId || fallbackAnchor?.startBlockId || '').trim();
        const end = (module.endBlockId || fallbackAnchor?.endBlockId || '').trim();
        const startLocator = (module.locatorStart || fallbackAnchor?.startLocator || '').trim();
        const endLocator = (module.locatorEnd || fallbackAnchor?.endLocator || '').trim();
        const headingLevel = module.headingLevel || 1;
        const headingMeta = buildHeadingMeta(numberingState, headingLevel, module.id, module.name);
        if ((start && end) || (startLocator && endLocator)) {
            exportSections.push({
                id: module.id,
                title: module.name,
                content: '',
                heading_level: headingLevel,
                heading_number: '',
                heading_text: headingMeta.headingText,
                toc_level: headingMeta.tocLevel,
                bookmark_id: headingMeta.bookmarkId,
                // 附件正文保留招标原文排版；节点标题仍作为真实 Heading 注入，保证目录结构不丢失。
                inject_title: true,
                source_type: 'docx_slice',
                attachment_name: module.sourceAttachmentName || module.name,
                start_block_id: start,
                end_block_id: end,
                start_locator: startLocator,
                end_locator: endLocator,
            });
            continue;
        }

        pushMarkdownSection(exportSections, {
            id: module.id,
            title: module.name,
            content: markdownContent,
            headingLevel,
            headingNumber: headingMeta.headingNumber,
            headingText: headingMeta.headingText,
            tocLevel: headingMeta.tocLevel,
            bookmarkId: headingMeta.bookmarkId,
            titleOnly: !markdownContent,
        });
    }

    if (technicalModules.length > 0) {
        const rootMeta = buildHeadingMeta(numberingState, 1, 'root_technical', '技术部分');
        pushMarkdownSection(exportSections, {
            id: 'root_technical',
            title: '技术部分',
            content: '',
            headingLevel: 1,
            headingNumber: rootMeta.headingNumber,
            headingText: rootMeta.headingText,
            tocLevel: rootMeta.tocLevel,
            bookmarkId: rootMeta.bookmarkId,
            titleOnly: true,
        });

        for (const module of technicalModules) {
            const htmlContent = module.filledContent || module.templateContent || '';
            const markdownContent = htmlContent.trim() ? turndownService.turndown(htmlContent) : '';
            const linkedSections = collectGeneratedSections(project, module.linkedSections || []);
            const hasOwnContent = markdownContent.trim().length > 0;
            const cleanModuleTitle = stripHeadingNumberingText(module.name);
            const headingMeta = buildHeadingMeta(numberingState, 2, module.id, cleanModuleTitle);
            pushMarkdownSection(exportSections, {
                id: module.id,
                title: cleanModuleTitle,
                content: hasOwnContent ? markdownContent : '',
                headingLevel: 2,
                headingNumber: headingMeta.headingNumber,
                headingText: headingMeta.headingText,
                tocLevel: headingMeta.tocLevel,
                bookmarkId: headingMeta.bookmarkId,
                titleOnly: !hasOwnContent,
            });

            linkedSections.forEach((section) => {
                const childId = `${module.id}__${section.id}`;
                const cleanSectionTitle = stripHeadingNumberingText(section.title);
                const childHeadingMeta = buildHeadingMeta(numberingState, 3, childId, cleanSectionTitle);
                pushMarkdownSection(exportSections, {
                    id: childId,
                    title: cleanSectionTitle,
                    content: removeLeadingDuplicateHeading(section.content, cleanSectionTitle),
                    headingLevel: 3,
                    headingNumber: childHeadingMeta.headingNumber,
                    headingText: childHeadingMeta.headingText,
                    tocLevel: childHeadingMeta.tocLevel,
                    bookmarkId: childHeadingMeta.bookmarkId,
                    titleOnly: false,
                });
            });
        }
    }

    if (businessModules.length > 0) {
        const rootMeta = buildHeadingMeta(numberingState, 1, 'root_business', '商务部分');
        pushMarkdownSection(exportSections, {
            id: 'root_business',
            title: '商务部分',
            content: '',
            headingLevel: 1,
            headingNumber: rootMeta.headingNumber,
            headingText: rootMeta.headingText,
            tocLevel: rootMeta.tocLevel,
            bookmarkId: rootMeta.bookmarkId,
            titleOnly: true,
        });

        for (const module of businessModules) {
            const htmlContent = module.filledContent || module.templateContent || '';
            const markdownContent = htmlContent.trim() ? turndownService.turndown(htmlContent) : '';
            const headingMeta = buildHeadingMeta(numberingState, 2, module.id, module.name);
            pushMarkdownSection(exportSections, {
                id: module.id,
                title: module.name,
                content: markdownContent,
                headingLevel: 2,
                headingNumber: headingMeta.headingNumber,
                headingText: headingMeta.headingText,
                tocLevel: headingMeta.tocLevel,
                bookmarkId: headingMeta.bookmarkId,
                titleOnly: !markdownContent,
            });
        }
    }

    return exportSections;
}
