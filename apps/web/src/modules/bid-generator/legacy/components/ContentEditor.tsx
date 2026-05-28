/**
 * ContentEditor — 基于 Tiptap 的富文本编辑器
 * - 支持标准富文本格式（标题/加粗/列表/表格/图片）
 * - 支持 <diagram type="..."> XML 标签，自动渲染 SVG 架构图
 * - 占位符替换已移至后端（Dify 传入前映射）
 */

import { useEditor, EditorContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Node as TiptapNode } from '@tiptap/core';
import Placeholder from '@tiptap/extension-placeholder';
import Highlight from '@tiptap/extension-highlight';
import Underline from '@tiptap/extension-underline';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Image from '@tiptap/extension-image';
import { useEffect, useState, useRef, useLayoutEffect } from 'react';
import {
    Bold, Italic, Underline as UnderlineIcon, Strikethrough,
    List,
    Undo2, Redo2, Highlighter, Minus, ImageIcon,
    MoreHorizontal, LayoutDashboard, Maximize2, Copy, Check,
} from 'lucide-react';
import clsx from 'clsx';
import { marked } from 'marked';
import turndownService from '../utils/turndown';
import { diagramService } from '../services/diagramService';

export const CONTENT_PREVIEW_PROSE_CLASS =
    'content-editor-prose prose prose-sm prose-sky max-w-none text-gray-700 ' +
    'prose-headings:font-bold prose-p:leading-relaxed prose-a:text-brand-600 ' +
    'prose-table:border-collapse prose-td:border prose-td:border-gray-200 prose-td:p-2 ' +
    'prose-th:border prose-th:border-gray-300 prose-th:bg-gray-50 prose-th:p-2 prose-img:max-w-full';

const CONTENT_EDITOR_PROSE_CLASS =
    `${CONTENT_PREVIEW_PROSE_CLASS} focus:outline-none min-h-[200px] px-5 py-4`;


// ── SVG 响应式处理 ──────────────────────────────────────────────────────────

/** 将 LLM 输出的固定宽高 SVG 修正为响应式 */
function makeResponsiveSvg(svg: string): string {
    // 保留 viewBox（若不存在则从 width/height 生成），强制 100% 宽度
    let processed = svg;
    const wMatch = svg.match(/\bwidth="(\d+)"/);
    const hMatch = svg.match(/\bheight="(\d+)"/);
    // 若无 viewBox，从 width/height 补充
    if (!svg.includes('viewBox') && wMatch && hMatch) {
        processed = processed.replace('<svg', `<svg viewBox="0 0 ${wMatch[1]} ${hMatch[1]}"`);
    }
    // 强制宽度 100%，高度 auto
    processed = processed.replace(/\s+width="[^"]*"/, ' width="100%"');
    processed = processed.replace(/\s+height="[^"]*"/, ' height="auto"');
    return processed;
}

/** 基础 SVG 清洗：移除 script/foreignObject 与内联事件，降低注入风险 */
function sanitizeSvg(svg: string): string {
    if (!svg) return '';
    let safe = svg;
    safe = safe.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
    safe = safe.replace(/<foreignObject[\s\S]*?>[\s\S]*?<\/foreignObject>/gi, '');
    safe = safe.replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '');
    safe = safe.replace(/\s(?:href|xlink:href)\s*=\s*(['"])javascript:[\s\S]*?\1/gi, '');
    return safe;
}

// ── Base64 编解码（UTF-8 安全）──────────────────────────────────────────────

function b64Encode(str: string): string {
    try { return btoa(unescape(encodeURIComponent(str))); } catch { return ''; }
}
function b64Decode(b64: string): string {
    try { return decodeURIComponent(escape(atob(b64))); } catch { return ''; }
}

function escapeHtmlText(text: string): string {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ── <diagram> 预处理：在 Tiptap 解析 HTML 前提取 SVG ─────────────────────
/**
 * 把 <diagram type="..." title="..."><svg>...</svg></diagram>
 * 转为 Tiptap 能识别的 <div data-diagram-*="..."> 属性节点
 * （SVG 内容 Base64 编码存入属性，防止被 HTML 解析器破坏）
 */
function preprocessDiagramTags(html: string): string {
    return html.replace(
        /<diagram\s+([^>]*)>([\s\S]*?)<\/diagram>/gi,
        (_, attrsStr: string, inner: string) => {
            const typeM = attrsStr.match(/type="([^"]*)"/);
            const titleM = attrsStr.match(/title="([^"]*)"/);
            const idM = attrsStr.match(/data-diagram-id="([^"]*)"/);
            const type = typeM?.[1] || 'architecture';
            const title = titleM?.[1] || '架构图';
            const diagramId = idM?.[1] || '';
            const svgM = inner.match(/<svg[\s\S]*?<\/svg>/i);
            const svgRaw = svgM ? svgM[0] : inner.trim();
            return `<div data-diagram-type="${type}" data-diagram-title="${encodeURIComponent(title)}" data-diagram-id="${diagramId}" data-diagram-svg="${b64Encode(svgRaw)}"></div>`;
        }
    );
}

/** 输出时将 Tiptap 存储的属性节点还原为 <diagram> 标签（存储用） */
function postprocessDiagramNodes(html: string): string {
    return html.replace(
        /<div([^>]*data-diagram-type="[^"]*"[^>]*)><\/div>/g,
        (_, attrs: string) => {
            const typeM = attrs.match(/data-diagram-type="([^"]*)"/);
            const titleM = attrs.match(/data-diagram-title="([^"]*)"/);
            const svgM = attrs.match(/data-diagram-svg="([^"]*)"/);
            const idM = attrs.match(/data-diagram-id="([^"]*)"/);
            const type = typeM?.[1] || 'architecture';
            const title = decodeURIComponent(titleM?.[1] || '');
            const diagramId = idM?.[1] || '';
            const svg = b64Decode(svgM?.[1] || '');
            if (diagramId && !svg) {
                return `<diagram data-diagram-id="${diagramId}" type="${type}" title="${title}"></diagram>`;
            }
            return `<diagram type="${type}" title="${title}">${svg}</diagram>`;
        }
    );
}

// ── DiagramRenderer：SVG 图表渲染 React 组件 ─────────────────────────────

const TYPE_LABELS: Record<string, string> = {
    architecture: '架构图', flowchart: '流程图', 'org-chart': '组织架构图',
    process: '流程图', logic: '逻辑关系图', 'data-flow': '数据流图',
};

function DiagramRenderer({ node }: NodeViewProps) {
    const attrs = node.attrs as { type: string; title: string; svgContent: string; diagramId: string };
    const { type, title, svgContent, diagramId } = attrs;
    const [fullscreen, setFullscreen] = useState(false);
    const [copied, setCopied] = useState(false);
    const [remoteSvg, setRemoteSvg] = useState('');

    useEffect(() => {
        if (!diagramId || svgContent) return;
        let cancelled = false;
        diagramService.getDiagramSvg(diagramId)
            .then(svg => { if (!cancelled) setRemoteSvg(svg); })
            .catch(() => { if (!cancelled) setRemoteSvg(''); });
        return () => { cancelled = true; };
    }, [diagramId, svgContent]);

    const effectiveSvg = svgContent || remoteSvg;
    const responsiveSvg = effectiveSvg ? makeResponsiveSvg(sanitizeSvg(effectiveSvg)) : '';
    const typeLabel = TYPE_LABELS[type] || '图表';

    const handleCopy = () => {
        navigator.clipboard.writeText(effectiveSvg).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    return (
        <NodeViewWrapper>
            <div className="my-4 rounded-xl border border-brand-200 overflow-hidden shadow-none bg-white">
                {/* 标题栏 */}
                <div className="flex items-center justify-between px-4 py-2 bg-brand-50 border-b border-brand-200">
                    <div className="flex items-center gap-2">
                        <LayoutDashboard className="w-3.5 h-3.5 text-brand-500 shrink-0" />
                        <span className="text-xs font-semibold text-brand-600">{title || typeLabel}</span>
                        <span className="text-xs text-brand-500 bg-brand-50 px-1.5 py-0.5 rounded">{typeLabel}</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <button onClick={handleCopy} title="复制 SVG 代码"
                            className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
                            {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                        <button onClick={() => setFullscreen(true)} title="全屏查看"
                            className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
                            <Maximize2 className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>
                {/* SVG 渲染区 */}
                <div className="p-4 bg-white overflow-x-auto">
                    {responsiveSvg
                        ? <div dangerouslySetInnerHTML={{ __html: responsiveSvg }} className="w-full" />
                        : <div className="text-center text-gray-400 text-sm py-8">图表内容加载中…</div>
                    }
                </div>
            </div>
            {/* 全屏 Modal */}
            {fullscreen && (
                <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6"
                    onClick={() => setFullscreen(false)}>
                    <div className="bg-white rounded-2xl shadow-panel w-full max-w-6xl max-h-[90vh] overflow-auto p-6"
                        onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-base font-bold text-gray-900">{title}</h3>
                            <button onClick={() => setFullscreen(false)}
                                className="px-3 py-1.5 rounded-lg text-sm text-gray-500 hover:bg-gray-100 transition-colors">关闭</button>
                        </div>
                        <div dangerouslySetInnerHTML={{ __html: responsiveSvg }} className="w-full" />
                    </div>
                </div>
            )}
        </NodeViewWrapper>
    );
}

function renderDiagramPreviewCards(html: string): string {
    return html.replace(/<div([^>]*data-diagram-type="[^"]*"[^>]*)><\/div>/g, (_, attrs: string) => {
        const typeM = attrs.match(/data-diagram-type="([^"]*)"/);
        const titleM = attrs.match(/data-diagram-title="([^"]*)"/);
        const svgM = attrs.match(/data-diagram-svg="([^"]*)"/);
        const type = typeM?.[1] || 'architecture';
        const title = decodeURIComponent(titleM?.[1] || '') || TYPE_LABELS[type] || '图表';
        const titleText = escapeHtmlText(title);
        const typeText = escapeHtmlText(TYPE_LABELS[type] || '图表');
        const svg = b64Decode(svgM?.[1] || '');
        const responsiveSvg = svg ? makeResponsiveSvg(sanitizeSvg(svg)) : '';
        return [
            '<div class="my-4 rounded-xl border border-blue-100 overflow-hidden shadow-sm bg-white">',
            '<div class="flex items-center gap-2 px-4 py-2 bg-blue-50 border-b border-blue-100">',
            `<span class="text-xs font-semibold text-blue-700">${titleText}</span>`,
            `<span class="text-xs text-blue-400 bg-white px-1.5 py-0.5 rounded">${typeText}</span>`,
            '</div>',
            '<div class="p-4 bg-white overflow-x-auto">',
            responsiveSvg || '<div class="text-center text-gray-400 text-sm py-8">图表内容加载中…</div>',
            '</div>',
            '</div>',
        ].join('');
    });
}

export function ContentPreview({ content, className }: { content: string; className?: string }) {
    const [html, setHtml] = useState(() => renderDiagramPreviewCards(renderContentToHtml(content)));

    useEffect(() => {
        let cancelled = false;
        const hydrate = async () => {
            let next = renderContentToHtml(content);
            const matches = Array.from(next.matchAll(/<div([^>]*data-diagram-id="([^"]+)"[^>]*)><\/div>/g));
            for (const match of matches) {
                const attrs = match[1] || '';
                const diagramId = match[2] || '';
                const svgM = attrs.match(/data-diagram-svg="([^"]*)"/);
                if (!diagramId || svgM?.[1]) continue;
                const svg = await diagramService.getDiagramSvg(diagramId);
                if (!svg) continue;
                const hydrated = match[0].replace(
                    'data-diagram-svg=""',
                    `data-diagram-svg="${b64Encode(svg)}"`,
                );
                next = next.replace(match[0], hydrated);
            }
            if (!cancelled) setHtml(renderDiagramPreviewCards(next));
        };
        void hydrate();
        return () => { cancelled = true; };
    }, [content]);

    return (
        <div
            className={className}
            dangerouslySetInnerHTML={{ __html: html }}
        />
    );
}

// ── DiagramNode：Tiptap block atom Node ─────────────────────────────────

const DiagramNode = TiptapNode.create({
    name: 'diagramNode',
    group: 'block',
    atom: true,

    addAttributes() {
        return {
            type: { default: 'architecture' },
            title: { default: '' },
            svgContent: { default: '' },
            diagramId: { default: '' },
        };
    },

    parseHTML() {
        return [{
            tag: 'div[data-diagram-type]',
            getAttrs: (dom) => {
                const el = dom as HTMLElement;
                return {
                    type: el.getAttribute('data-diagram-type') || 'architecture',
                    title: decodeURIComponent(el.getAttribute('data-diagram-title') || ''),
                    svgContent: b64Decode(el.getAttribute('data-diagram-svg') || ''),
                    diagramId: el.getAttribute('data-diagram-id') || '',
                };
            },
        }];
    },

    renderHTML({ node }) {
        return ['div', {
            'data-diagram-type': node.attrs.type,
            'data-diagram-title': encodeURIComponent(node.attrs.title),
            'data-diagram-svg': b64Encode(node.attrs.svgContent),
            'data-diagram-id': node.attrs.diagramId,
        }];
    },

    addNodeView() {
        return ReactNodeViewRenderer(DiagramRenderer);
    },
});

// ── HTML 检测与 Markdown 转换 ──────────────────────────────────────────────

function looksLikeMarkdown(str: string): boolean {
    if (!str) return false;
    if (/^\s*<[a-z]/.test(str)) return false;
    return /^#{1,6}\s|^\*\*|^[-*]\s|^\d+\.\s|^>\s|```/m.test(str);
}

function normalizeListSyntax(raw: string): string {
    if (!raw) return '';
    return raw
        // 常见 unicode bullet 转标准 markdown 列表
        .replace(/^([ \t]*)[•·●○▪◦]\s+/gm, '$1- ')
        // 中文编号样式转有序列表，便于 marked/tiptap 正确识别
        .replace(/^([ \t]*)(\d+)[、.)）]\s+/gm, '$1$2. ');
}

function renderContentSegmentToHtml(segment: string): string {
    if (!segment) return '';
    const trimmed = segment.trim();
    if (!trimmed) return segment;

    // 已含 HTML 标签
    if (/^\s*<[a-zA-Z]/.test(segment) || /<\/?(p|br|div|ul|ol|li|h[1-6]|strong|em|blockquote)\b/i.test(segment)) {
        return segment;
    }
    const normalized = normalizeListSyntax(segment);
    if (!looksLikeMarkdown(normalized)) {
        const escaped = segment.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return escaped.split(/\n\n+/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
    }
    return marked.parse(normalized, { async: false }) as string;
}

/** 将原始内容统一转为 HTML 供编辑器和只读预览复用，<diagram> 标签优先处理 */
export function renderContentToHtml(raw: string): string {
    if (!raw) return '';
    // 预处理图片占位符，替换为真实网络URL以供 Tiptap/marked 渲染
    const processRaw = raw.replace(/__PRO_IMG_([a-fA-F0-9]+)__/g, '/api/extracted-images/by-hash/$1');

    if (!/<diagram\s/i.test(processRaw)) {
        return renderContentSegmentToHtml(processRaw);
    }

    const diagramRe = /<diagram\s+[^>]*>[\s\S]*?<\/diagram>/gi;
    const parts: string[] = [];
    let cursor = 0;
    for (const match of processRaw.matchAll(diagramRe)) {
        const start = match.index ?? 0;
        parts.push(renderContentSegmentToHtml(processRaw.slice(cursor, start)));
        parts.push(preprocessDiagramTags(match[0]));
        cursor = start + match[0].length;
    }
    parts.push(renderContentSegmentToHtml(processRaw.slice(cursor)));
    return parts.join('');
}

/** 将 HTML 还原为干净标准的 Markdown，供组件向外输出和源码模式展示 */
function toMarkdown(html: string): string {
    if (!html) return '';
    const recoveredHtml = postprocessDiagramNodes(html);
    const md = turndownService.turndown(recoveredHtml);
    // 恢复图片占位符，保持后端锚点的纯洁性
    return md.replace(/\/api\/extracted-images\/by-hash\/([a-fA-F0-9]+)/g, '__PRO_IMG_$1__');
}

// ── 组件接口 ─────────────────────────────────────────────────────────────

export interface ContentEditorProps {
    content: string;
    onChange?: (html: string) => void;
    readOnly?: boolean;
    className?: string;
    saveStatus?: React.ReactNode;
}

// ── ToolbarButton（带延迟 tooltip）──────────────────────────────────────

function ToolbarButton({ onClick, active, disabled, title, children }: {
    onClick: () => void; active?: boolean; disabled?: boolean; title: string; children: React.ReactNode;
}) {
    const [showTip, setShowTip] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    return (
        <div className="relative">
            <button type="button" onClick={onClick} disabled={disabled}
                onMouseEnter={() => { timerRef.current = setTimeout(() => setShowTip(true), 400); }}
                onMouseLeave={() => { if (timerRef.current) clearTimeout(timerRef.current); setShowTip(false); }}
                className={clsx('p-1.5 rounded-md transition-colors',
                    active ? 'bg-brand-50 text-brand-600' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700',
                    disabled && 'opacity-30 cursor-not-allowed')}>
                {children}
            </button>
            {showTip && (
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-0.5 bg-gray-800 text-white text-xs rounded whitespace-nowrap pointer-events-none z-50 shadow-none">
                    {title}
                    <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-b-4 border-l-transparent border-r-transparent border-b-gray-800" />
                </div>
            )}
        </div>
    );
}

function Divider() { return <div className="w-px h-5 bg-gray-200 mx-0.5 shrink-0" />; }

// ── 图片插入弹窗 ──────────────────────────────────────────────────────────

function ImageDialog({ onConfirm, onClose }: { onConfirm: (url: string, alt: string) => void; onClose: () => void; }) {
    const [url, setUrl] = useState('');
    const [alt, setAlt] = useState('');
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-panel w-full max-w-sm mx-4 overflow-hidden">
                <div className="px-5 pt-5 pb-4 border-b border-gray-100">
                    <h3 className="text-base font-bold text-gray-900">插入图片</h3>
                </div>
                <div className="px-5 py-4 space-y-3">
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">图片链接（URL）</label>
                        <input autoFocus type="text" value={url} onChange={e => setUrl(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && url.trim()) { onConfirm(url.trim(), alt.trim()); onClose(); } }}
                            placeholder="https://example.com/image.png"
                            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:border-brand-500 focus:ring-1 focus:ring-brand-200 outline-none" />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">描述文字（可选）</label>
                        <input type="text" value={alt} onChange={e => setAlt(e.target.value)}
                            placeholder="图片说明"
                            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:border-brand-500 focus:ring-1 focus:ring-brand-200 outline-none" />
                    </div>
                </div>
                <div className="px-5 pb-5 flex gap-3">
                    <button onClick={onClose} className="flex-1 px-4 py-2 rounded-xl text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors">取消</button>
                    <button onClick={() => { if (url.trim()) { onConfirm(url.trim(), alt.trim()); onClose(); } }}
                        disabled={!url.trim()}
                        className="flex-1 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-brand-500 hover:bg-brand-600 transition-colors disabled:opacity-40">插入</button>
                </div>
            </div>
        </div>
    );
}

// ── 主编辑器组件 ──────────────────────────────────────────────────────────

export function ContentEditor({ content, onChange, readOnly = false, className, saveStatus }: ContentEditorProps) {
    const [showImageDialog, setShowImageDialog] = useState(false);
    const isProgrammaticRef = useRef(false);
    const lastEmittedMdRef = useRef<string>('');

    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                heading: { levels: [1, 2, 3, 4] },
                codeBlock: { HTMLAttributes: { class: 'bg-gray-50 border border-gray-200 rounded-lg p-4 font-mono text-sm' } },
            }),
            Placeholder.configure({ placeholder: '开始编辑内容…' }),
            Highlight.configure({ multicolor: false }),
            Underline,
            Table.configure({ resizable: true }),
            TableRow, TableCell, TableHeader,
            Image.configure({ allowBase64: true, HTMLAttributes: { class: 'max-w-full rounded-lg my-2' } }),
            DiagramNode,
        ],
        content: renderContentToHtml(content) || '',
        editable: !readOnly,
        onUpdate: ({ editor: e }) => {
            if (isProgrammaticRef.current) return;
            const md = toMarkdown(e.getHTML());
            lastEmittedMdRef.current = md;
            onChange?.(md);
        },
        editorProps: {
            attributes: {
                class: CONTENT_EDITOR_PROSE_CLASS,
            },
        },
    });

    // 同步外部 content（SSE 流式写入）
    useEffect(() => {
        if (!editor) return;
        if (content === lastEmittedMdRef.current) return;
        const htmlContent = renderContentToHtml(content);
        if (htmlContent !== editor.getHTML() && content !== undefined) {
            isProgrammaticRef.current = true;
            editor.commands.setContent(htmlContent, { emitUpdate: false });
            setTimeout(() => { isProgrammaticRef.current = false; }, 0);
        }
    }, [content, editor]);

    useEffect(() => { editor?.setEditable(!readOnly); }, [editor, readOnly]);

    // 监听来自「附件图片」画廊的插入事件（TemplateEditor dispatch）
    // blockId 用于标识目标 block，ContentEditor 无法自知自己的 blockId，所以不做 blockId 过滤
    // 每页只有一个 ContentEditor 处于激活状态，多实例场景下依赖 editor.isFocused 过滤
    useEffect(() => {
        if (!editor) return;
        const handler = (e: Event) => {
            const { src, alt } = (e as CustomEvent).detail ?? {};
            if (!src) return;
            // 只有当前编辑器处于焦点时才响应，防止多 ContentEditor 同时插入
            if (!editor.isFocused) {
                // 若无焦点则强制 focus 后再插入（画廊点击导致焦点丢失）
                editor.commands.focus();
            }
            editor.chain().focus().setImage({ src, alt: alt ?? '' }).run();
        };
        document.addEventListener('proengine:insert-image', handler);
        return () => document.removeEventListener('proengine:insert-image', handler);
    }, [editor]);


    // ── 工具栏溢出检测 ──────────────────────────────────────────────────────
    const toolbarRef = useRef<HTMLDivElement>(null);
    const [visibleCount, setVisibleCount] = useState(999);
    const [showMoreMenu, setShowMoreMenu] = useState(false);
    const moreMenuRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const el = toolbarRef.current;
        if (!el) return;
        const GROUP_WIDTHS = [68, 106, 148, 126, 76, 32];
        const RIGHT_RESERVED = 100;
        const obs = new ResizeObserver(([entry]) => {
            const available = entry.contentRect.width - RIGHT_RESERVED;
            let used = 0; let count = 0;
            for (const w of GROUP_WIDTHS) { if (used + w > available) break; used += w; count++; }
            setVisibleCount(Math.max(1, count));
        });
        obs.observe(el);
        return () => obs.disconnect();
    }, []);

    useEffect(() => {
        if (!showMoreMenu) return;
        const handler = (e: MouseEvent) => {
            if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node))
                setShowMoreMenu(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showMoreMenu]);

    if (!editor) return null;

    // ── 静态按钮组定义 ────────────────────────────────────────────────────
    type BtnDef = { icon: React.ReactNode; title: string; onClick: () => void; active?: boolean; disabled?: boolean; };
    const buttonGroups: BtnDef[][] = [
        [
            { icon: <Undo2 className="w-4 h-4" />, title: '撤销', onClick: () => editor.chain().focus().undo().run(), disabled: !editor.can().undo() },
            { icon: <Redo2 className="w-4 h-4" />, title: '重做', onClick: () => editor.chain().focus().redo().run(), disabled: !editor.can().redo() },
        ],
        [
            { icon: <Bold className="w-4 h-4" />, title: '加粗', onClick: () => editor.chain().focus().toggleBold().run(), active: editor.isActive('bold') },
            { icon: <Italic className="w-4 h-4" />, title: '斜体', onClick: () => editor.chain().focus().toggleItalic().run(), active: editor.isActive('italic') },
            { icon: <UnderlineIcon className="w-4 h-4" />, title: '下划线', onClick: () => editor.chain().focus().toggleUnderline().run(), active: editor.isActive('underline') },
            { icon: <Strikethrough className="w-4 h-4" />, title: '删除线', onClick: () => editor.chain().focus().toggleStrike().run(), active: editor.isActive('strike') },
            { icon: <Highlighter className="w-4 h-4" />, title: '高亮', onClick: () => editor.chain().focus().toggleHighlight().run(), active: editor.isActive('highlight') },
        ],
        [
            { icon: <List className="w-4 h-4" />, title: '无序列表', onClick: () => editor.chain().focus().toggleBulletList().run(), active: editor.isActive('bulletList') },
            { icon: <Minus className="w-4 h-4" />, title: '分割线', onClick: () => editor.chain().focus().setHorizontalRule().run() },
        ],
        [
            { icon: <ImageIcon className="w-4 h-4" />, title: '插入图片', onClick: () => setShowImageDialog(true) },
        ],
    ];

    const renderBtn = (btn: BtnDef, key: string | number, inMenu = false) =>
        inMenu ? (
            <button key={key} type="button" onClick={() => { btn.onClick(); setShowMoreMenu(false); }}
                className={clsx('flex items-center gap-2.5 w-full px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors text-left',
                    btn.active && 'bg-brand-50 text-brand-600')}>
                {btn.icon}<span>{btn.title}</span>
            </button>
        ) : (
            <ToolbarButton key={key} onClick={btn.onClick} active={btn.active} disabled={btn.disabled} title={btn.title}>
                {btn.icon}
            </ToolbarButton>
        );

    const renderMainArea = () => {
        const nodes: React.ReactNode[] = [];
        for (let gi = 0; gi < Math.min(visibleCount, buttonGroups.length); gi++) {
            if (gi > 0) nodes.push(<Divider key={`d${gi}`} />);
            buttonGroups[gi].forEach((btn, bi) => nodes.push(renderBtn(btn, `g${gi}b${bi}`)));
        }
        return nodes;
    };

    const overflowBtns = buttonGroups.slice(visibleCount).flat();
    const hasOverflow = visibleCount < buttonGroups.length;

    return (
        <div className={clsx('flex flex-col border border-gray-200 rounded-xl overflow-hidden bg-white', className)}>
            {/* 工具栏 */}
            {!readOnly && (
                <div ref={toolbarRef} className="flex items-center px-2 py-1 bg-gray-50 border-b border-gray-200 shrink-0 min-w-0">
                    <div className="flex items-center flex-1 min-w-0">{renderMainArea()}</div>
                    {hasOverflow && (
                        <div ref={moreMenuRef} className="relative shrink-0 ml-0.5">
                            <button type="button" onClick={() => setShowMoreMenu(v => !v)}
                                className={clsx('p-1.5 rounded-md transition-colors text-gray-500 hover:bg-gray-100 hover:text-gray-700',
                                    showMoreMenu && 'bg-gray-100 text-gray-700')}>
                                <MoreHorizontal className="w-4 h-4" />
                            </button>
                            {showMoreMenu && (
                                <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-none p-1.5 z-50 min-w-[140px]">
                                    {overflowBtns.map((btn, i) => renderBtn(btn, `ov${i}`, true))}
                                </div>
                            )}
                        </div>
                    )}
                    {saveStatus && (
                        <span className="ml-2 text-xs text-gray-300 select-none whitespace-nowrap shrink-0">{saveStatus}</span>
                    )}
                </div>
            )}

            {showImageDialog && (
                <ImageDialog
                    onConfirm={(url, alt) => { editor.chain().focus().setImage({ src: url, alt }).run(); }}
                    onClose={() => setShowImageDialog(false)} />
            )}

            {/* 编辑区 */}
            <div className="flex-1 overflow-y-auto">
                <EditorContent editor={editor} />
            </div>
        </div>
    );
}
