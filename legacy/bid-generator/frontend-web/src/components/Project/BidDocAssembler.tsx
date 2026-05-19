import { useState, useEffect } from 'react';
import {
    DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
    arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
    Layout, ChevronDown, ChevronUp, FileText,
    Paperclip, ArrowRight,
    GripVertical, Eye, EyeOff
} from 'lucide-react';
import clsx from 'clsx';
import type { Project } from '../../services/projectService';
import { projectService } from '../../services/projectService';
import turndownService from '../../utils/turndown';

function resolveVersionContent(state: any): string {
    if (!state) return '';
    return state.content || '';
}

// ── 章节可见性配置（用于决定哪些模块纳入最终文件）──────────────────
interface AssemblySection {
    id: string;
    title: string;
    type: 'cover' | 'toc' | 'tech' | 'attachment' | 'custom';
    enabled: boolean;
    sourceDesc: string;
}

interface OrderedTechSection {
    id: string;
    title: string;
}

function collectOrderedTechSectionMeta(project: Project): OrderedTechSection[] {
    const ordered: OrderedTechSection[] = [];
    const seen = new Set<string>();

    const pushNode = (id?: string, title?: string) => {
        const safeId = String(id || '').trim();
        const safeTitle = String(title || '').trim();
        if (!safeId || !safeTitle || seen.has(safeId)) return;
        ordered.push({ id: safeId, title: safeTitle });
        seen.add(safeId);
    };

    for (const sec of project.outline || []) {
        pushNode(sec.id, sec.title);
        for (const sub of sec.children || []) {
            pushNode(sub.id, sub.title);
            for (const third of sub.children || []) {
                pushNode(third.id, third.title);
            }
        }
    }

    // 兜底：补充不在 outline 树中的已生成章节（避免用户自定义章节丢失）
    Object.entries(project.generatedContent || {}).forEach(([id]) => {
        if (seen.has(id)) return;
        ordered.push({ id, title: id });
    });

    return ordered;
}

function collectDoneTechSections(project: Project): Array<{ id: string; title: string; content: string }> {
    const orderedMeta = collectOrderedTechSectionMeta(project);
    const sections: Array<{ id: string; title: string; content: string }> = [];
    for (const item of orderedMeta) {
        const state = project.generatedContent?.[item.id];
        if (!state || state.status !== 'done') continue;
        const text = resolveVersionContent(state).trim();
        if (!text) continue;
        sections.push({ id: item.id, title: item.title, content: text });
    }
    return sections;
}

function buildDefaultSections(project: Project): AssemblySection[] {
    const sections: AssemblySection[] = [];

    sections.push({
        id: 'cover',
        title: '封面页',
        type: 'cover',
        enabled: true,
        sourceDesc: '自动从投标人信息生成',
    });

    sections.push({
        id: 'toc',
        title: '目录',
        type: 'toc',
        enabled: true,
        sourceDesc: '根据各章节自动生成目录',
    });

    // 依照前端已经编排好的项目模块生成
    const modules = project.bidModules ?? [];
    
    const doneTechSections = collectDoneTechSections(project);
    modules.forEach(mod => {
        if (!mod.enabled) return;
        
        if (mod.isTechProposalLink) {
            // 如果此模块被指定为技术方案挂载点，我们给它一个标记类型，后面会展平
            sections.push({
                id: `tech_link_${mod.id}`,
                title: mod.name,
                type: 'tech',
                enabled: true,
                sourceDesc: `技术方案挂载点 · 当前可导出 ${doneTechSections.length} 章`,
            });
        } else {
            // 常规 HTML 附件，后续将用 Turndown 转换为 Markdown
            sections.push({
                id: `att_${mod.id}`,
                title: mod.name,
                type: 'attachment',
                enabled: true,
                sourceDesc: mod.source === 'extracted' ? '招标文件提取附件' : '手动填写附件',
            });
        }
    });

    return sections;
}

// ── 类型图标/颜色配置 ──────────────────
const TYPE_META: Record<AssemblySection['type'], { color: string; icon: React.ReactNode }> = {
    cover:      { color: 'bg-indigo-50 text-indigo-600 border-indigo-100', icon: <FileText className="w-4 h-4" /> },
    toc:        { color: 'bg-gray-50 text-gray-500 border-gray-100', icon: <Layout className="w-4 h-4" /> },
    tech:       { color: 'bg-sky-50 text-sky-600 border-sky-100', icon: <FileText className="w-4 h-4" /> },
    attachment: { color: 'bg-teal-50 text-teal-600 border-teal-100', icon: <Paperclip className="w-4 h-4" /> },
    custom:     { color: 'bg-purple-50 text-purple-600 border-purple-100', icon: <FileText className="w-4 h-4" /> },
};

// ── 可拖拽的行组件 ──────────────────
interface SortableRowProps {
    sec: AssemblySection;
    idx: number;
    project: Project;
    expandedId: string | null;
    onToggleExpand: (id: string) => void;
    onToggleEnabled: (id: string) => void;
}

function SortableRow({ sec, idx, project, expandedId, onToggleExpand, onToggleEnabled }: SortableRowProps) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: sec.id });
    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 50 : undefined,
        opacity: isDragging ? 0.85 : undefined,
    };

    const meta = TYPE_META[sec.type];
    const isExpanded = expandedId === sec.id;

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={clsx(
                'bg-white rounded-xl border transition-all shadow-sm',
                sec.enabled ? 'border-gray-200' : 'border-gray-100 opacity-50',
                isDragging && 'shadow-xl ring-2 ring-indigo-200'
            )}
        >
            <div className="flex items-center px-4 py-3 gap-3">
                {/* 拖拽把手 */}
                <div {...attributes} {...listeners} className="touch-none cursor-grab active:cursor-grabbing">
                    <GripVertical className="w-4 h-4 text-gray-300 hover:text-gray-500 transition-colors" />
                </div>

                {/* 序号 */}
                <span className="text-xs text-gray-400 font-mono w-5 shrink-0 text-center">
                    {String(idx + 1).padStart(2, '0')}
                </span>

                {/* 类型角标 */}
                <div className={clsx('flex items-center justify-center w-7 h-7 rounded-lg border shrink-0', meta.color)}>
                    {meta.icon}
                </div>

                {/* 标题 + 来源描述 */}
                <div className="flex-1 min-w-0">
                    <p className={clsx('text-sm font-semibold leading-tight truncate', sec.enabled ? 'text-gray-800' : 'text-gray-400')}>
                        {sec.title}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5 truncate">{sec.sourceDesc}</p>
                </div>

                {/* 操作按钮 */}
                <div className="flex items-center gap-1 shrink-0">
                    <button
                        onClick={() => onToggleExpand(sec.id)}
                        className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                        title={isExpanded ? '收起' : '展开预览'}
                    >
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                    <button
                        onClick={() => onToggleEnabled(sec.id)}
                        className={clsx(
                            'p-1.5 rounded-lg transition-colors',
                            sec.enabled
                                ? 'text-gray-500 hover:text-orange-500 hover:bg-orange-50'
                                : 'text-gray-300 hover:text-green-500 hover:bg-green-50'
                        )}
                        title={sec.enabled ? '点击隐藏此模块' : '点击启用此模块'}
                    >
                        {sec.enabled ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    </button>
                </div>
            </div>

            {/* 展开区域 */}
            {isExpanded && (
                <div className="px-4 pb-3 pt-0 border-t border-gray-50 mt-0">
                    <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-500 leading-relaxed">
                        {sec.type === 'tech' && (() => {
                            if (sec.id.startsWith('tech_link_')) {
                                const total = collectDoneTechSections(project).length;
                                return <p className="text-gray-500 italic font-medium">✨ 此处将在导出时自动展开拼装 {total} 个已完成技术方案章节。</p>;
                            }
                            const secId = sec.id.replace('tech_', '');
                            const content = project.generatedContent?.[secId];
                            const text = resolveVersionContent(content);
                            return text
                                ? <p className="line-clamp-4">{text.slice(0, 300)}...</p>
                                : <p className="text-gray-400 italic">该章节内容尚未生成</p>;
                        })()}
                        {(sec.type === 'cover' || sec.type === 'toc' || sec.type === 'attachment' || sec.type === 'custom') && (
                            <p className="text-gray-400 italic">{sec.sourceDesc}</p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

// ── 主组件 ──────────────────
interface BidDocAssemblerProps {
    project: Project;
    onAssembled?: () => void;
}

/**
 * 投标文件编排组件
 * 可视化列出所有待合并的文档模块，用户可开关、拖拽排序，
 * 最终点击"生成投标文件"触发 gateway-out 的 Docx 合并接口。
 */
export function BidDocAssembler({ project, onAssembled }: BidDocAssemblerProps) {
    const [sections, setSections] = useState<AssemblySection[]>([]);
    const [forging, setForging] = useState(false);
    const [expandedId, setExpandedId] = useState<string | null>(null);

    // 拖拽传感器
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    useEffect(() => {
        setSections(buildDefaultSections(project));
    }, [project.id, project.bidModules, project.outline]);

    const toggleEnabled = (id: string) => {
        setSections(prev => prev.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s));
    };

    const handleToggleExpand = (id: string) => {
        setExpandedId(prev => prev === id ? null : id);
    };

    // 拖拽排序结束
    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            setSections(prev => {
                const oldIndex = prev.findIndex(s => s.id === active.id);
                const newIndex = prev.findIndex(s => s.id === over.id);
                return arrayMove(prev, oldIndex, newIndex);
            });
        }
    };

    const handleForge = async () => {
        setForging(true);
        try {
            // 组装最终平铺的 Markdown 章节序列
            const unifiedSections: { id: string; title: string; content: string }[] = [];
            const doneTechSections = collectDoneTechSections(project);

            // 严格按照用户调整的顺序解析
            const enabledSections = sections.filter(s => s.enabled);
            for (const s of enabledSections) {
                if (s.type === 'tech') {
                    const modId = s.id.replace('tech_link_', '');
                    const linkedModule = project.bidModules?.find(m => m.id === modId);
                    const linkedModuleContent = linkedModule?.filledContent || linkedModule?.templateContent || '';
                    const linkedModuleMarkdown = linkedModuleContent.trim()
                        ? turndownService.turndown(linkedModuleContent)
                        : '';

                    // 技术方案挂载：先写挂载模块标题（及其正文），再按技术方案导出顺序展开已完成章节。
                    if (linkedModuleMarkdown || doneTechSections.length > 0) {
                        unifiedSections.push({
                            id: s.id,
                            title: s.title,
                            content: linkedModuleMarkdown,
                        });
                    }
                    for (const techSection of doneTechSections) {
                        unifiedSections.push({
                            id: `tech_${techSection.id}`,
                            title: techSection.title,
                            content: techSection.content,
                        });
                    }
                } else if (s.type === 'attachment' || s.type === 'custom') {
                    // 对于原始 HTML 附件，通过 turndown 转为 Markdown，让后端统一解析！
                    const modId = s.id.replace('att_', '').replace('custom_', '');
                    const mod = project.bidModules?.find(m => m.id === modId || `att_${m.id}` === s.id || `custom_${m.id}` === s.id);
                    if (mod) {
                        const htmlContent = mod.filledContent || mod.templateContent || "";
                        if (htmlContent.trim()) {
                            // 使用我们在 Frontend 配置好的 GFM Markdown 生成器降维处理 HTML 表格和格式
                            const mdContent = turndownService.turndown(htmlContent);
                            unifiedSections.push({
                                id: s.id,
                                title: s.title,
                                content: mdContent
                            });
                        }
                    }
                }
            }

            await projectService.forgeDocument(project.id, unifiedSections);
            projectService.update(project.id, { status: 'bid_done' });
            onAssembled?.();
        } catch (e) {
            console.error('生成投标文件失败', e);
        } finally {
            setForging(false);
        }
    };

    const enabledCount = sections.filter(s => s.enabled).length;

    return (
        <div className="flex flex-col h-full bg-gray-50">

            {/* 顶栏 */}
            <div className="bg-white border-b border-gray-200 px-6 py-4 shrink-0">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-indigo-50 rounded-xl flex items-center justify-center border border-indigo-100">
                            <Layout className="w-5 h-5 text-indigo-500" />
                        </div>
                        <div>
                            <h2 className="font-bold text-gray-900 text-base">投标文件编排</h2>
                            <p className="text-xs text-gray-500 mt-0.5">
                                已选 {enabledCount} / {sections.length} 个模块 · 拖拽把手调整顺序 · 点击眼睛图标可隐藏
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={handleForge}
                        disabled={forging || enabledCount === 0}
                        className={clsx(
                            'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all',
                            forging || enabledCount === 0
                                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm hover:shadow-md'
                        )}
                    >
                        {forging ? (
                            <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                        ) : (
                            <ArrowRight className="w-4 h-4" />
                        )}
                        {forging ? '生成中...' : '生成投标文件 (.docx)'}
                    </button>
                </div>
            </div>

            {/* 可拖拽模块列表 */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={sections.map(s => s.id)} strategy={verticalListSortingStrategy}>
                        {sections.map((sec, idx) => (
                            <SortableRow
                                key={sec.id}
                                sec={sec}
                                idx={idx}
                                project={project}
                                expandedId={expandedId}
                                onToggleExpand={handleToggleExpand}
                                onToggleEnabled={toggleEnabled}
                            />
                        ))}
                    </SortableContext>
                </DndContext>
            </div>

            {/* 底部提示 */}
            <div className="bg-white border-t border-gray-100 px-6 py-3 shrink-0">
                <p className="text-xs text-gray-400">
                    拖动 ≡ 把手调整模块顺序 · 点击「生成投标文件」将所有已启用模块合并为 Word 文档(.docx)并自动下载。
                </p>
            </div>
        </div>
    );
}
