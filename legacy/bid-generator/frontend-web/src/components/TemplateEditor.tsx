import { useState, useEffect, useRef, useCallback } from 'react';
import {
    DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
    arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { SortableBlock } from './SortableBlock';
import {
    AlertCircle, CheckCircle2, Download,
    FileDown, FileText, FolderTree, Loader2, PanelRightClose, PanelRightOpen,
    Plus, RefreshCw, RotateCcw, Sparkles, Trash2, UploadIcon, XCircle,
} from 'lucide-react';
import type { StandardYaml, TemplateBlock } from '../services/configService';
import { configService } from '../services/configService';
import {
    projectService,
    buildTreeGlobalOutline,
    applyPlaceholderReportToContent,
    buildContentTaskStorageKey,
    getContentTaskStorageCandidates,
} from '../services/projectService';
import { bidGeneratorFetch } from '../services/apiBase';
import clsx from 'clsx';
import { ContentEditor } from './ContentEditor';
import { TaskLoadingState } from './TaskLoadingState';
import { ProtectedIframe } from './ProtectedIframe';

interface Props {
    projectId?: string;  // 当前项目 ID
    pdfUrl?: string;     // PDF 预览 URL
    /** 通知父组件当前是否有批量生成任务在运行 */
    onBusyChange?: (busy: boolean) => void;
    /** 前置阶段只读：禁止改写 */
    isLocked?: boolean;
}

// 每个 block 的内容生成状态
interface BlockContentState {
    status: 'idle' | 'queued' | 'generating' | 'done' | 'error' | 'cancelled';
    content: string;
    wordCount: number;
    error?: string;
    qualityScore?: number;
    feedback?: string;
    diagramError?: string;
    stage?: string;
    previousContent?: string;
    previousWordCount?: number;
    /** 占位符替换报告：模型输出后还原的实体列表 */
    replaceReport?: { placeholder: string; original: string }[];
}

function isGroupBlock(block?: TemplateBlock | null): boolean {
    return block?.block_kind === 'group';
}

function isContentBlock(block?: TemplateBlock | null): boolean {
    return !!block && block.block_kind !== 'group';
}

function getGroupChildren(blocks: TemplateBlock[], groupId: string): TemplateBlock[] {
    return blocks.filter((block) => isContentBlock(block) && block.parent_heading_id === groupId);
}

function isSelfGeneratingParentBlock(block?: TemplateBlock | null): boolean {
    if (!block || !isContentBlock(block) || block.parent_heading_id) return false;
    if (block.heading_level && block.heading_level !== 2) return false;
    return Boolean(block.generates_from_self || block.generation_strategy === 'response_special');
}

function reorderStructuredBlocks(blocks: TemplateBlock[], activeId: string, overId: string): TemplateBlock[] {
    const activeBlock = blocks.find((block) => block.id === activeId);
    const overBlock = blocks.find((block) => block.id === overId);
    if (!activeBlock || !overBlock || activeId === overId) return blocks;

    if (isGroupBlock(activeBlock)) {
        const movingIds = new Set([
            activeBlock.id,
            ...getGroupChildren(blocks, activeBlock.id).map((block) => block.id),
        ]);
        const movingSegment = blocks.filter((block) => movingIds.has(block.id));
        const remaining = blocks.filter((block) => !movingIds.has(block.id));
        const targetGroupId = isGroupBlock(overBlock) ? overBlock.id : overBlock.parent_heading_id;
        if (!targetGroupId || targetGroupId === activeBlock.id) return blocks;
        const insertIndex = remaining.findIndex((block) => block.id === targetGroupId);
        if (insertIndex < 0) return blocks;
        return [
            ...remaining.slice(0, insertIndex),
            ...movingSegment,
            ...remaining.slice(insertIndex),
        ];
    }

    if (!isContentBlock(activeBlock)) return blocks;

    const remaining = blocks.filter((block) => block.id !== activeBlock.id);
    let nextParentId = activeBlock.parent_heading_id;
    let nextParentTitle = activeBlock.parent_heading_title;
    let insertIndex = -1;

    if (isGroupBlock(overBlock)) {
        nextParentId = overBlock.id;
        nextParentTitle = overBlock.title;
        const groupIndex = remaining.findIndex((block) => block.id === overBlock.id);
        if (groupIndex < 0) return blocks;
        insertIndex = groupIndex + 1;
        for (let i = groupIndex + 1; i < remaining.length; i += 1) {
            if (remaining[i].parent_heading_id === overBlock.id) {
                insertIndex = i + 1;
                continue;
            }
            if (isGroupBlock(remaining[i])) break;
        }
    } else {
        nextParentId = overBlock.parent_heading_id || activeBlock.parent_heading_id;
        nextParentTitle = overBlock.parent_heading_title || activeBlock.parent_heading_title;
        insertIndex = remaining.findIndex((block) => block.id === overBlock.id);
        if (insertIndex < 0) return blocks;
    }

    const movedBlock: TemplateBlock = {
        ...activeBlock,
        parent_heading_id: nextParentId,
        parent_heading_title: nextParentTitle,
        heading_level: nextParentId ? 3 : activeBlock.heading_level,
    };

    return [
        ...remaining.slice(0, insertIndex),
        movedBlock,
        ...remaining.slice(insertIndex),
    ];
}

export function TemplateEditor({ projectId, pdfUrl, onBusyChange, isLocked = false }: Props) {
    const [template, setTemplate] = useState<StandardYaml | null>(null);
    const [availableTemplates, setAvailableTemplates] = useState<string[]>([]);
    const [currentTemplateName, setCurrentTemplateName] = useState<string>('standard.yaml');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [lastSavedAt, setLastSavedAt] = useState<string | null>(null); // HH:MM 格式
    const [forging, setForging] = useState(false); // 生成最终文档状态
    const [error, setError] = useState<string | null>(null);
    const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);

    // PDF 预览面板折叠状态（默认折叠）
    const [showPdf, setShowPdf] = useState(false);

    // 一键生成全部状态
    const [showGenerateAllConfirm, setShowGenerateAllConfirm] = useState(false);
    const [isGeneratingAll, setIsGeneratingAll] = useState(false);
    const [, setGenerateAllProgress] = useState<{ done: number; total: number } | null>(null);

    // 多选章节的 ID 集合
    const [checkedBlockIds, setCheckedBlockIds] = useState<Set<string>>(new Set());
    // 已入队但尚未开始生成的 block ID（锁定 checkbox）
    const [queuedBlockIds, setQueuedBlockIds] = useState<Set<string>>(new Set());

    // 配置面板折叠 & 更多菜单
    const [showConfigBeforeGenerate, setShowConfigBeforeGenerate] = useState(false);
    const [showMoreMenu, setShowMoreMenu] = useState(false);

    // 重新生成临时配置（不持久化到模板，存在内存）
    const [regenConfig, setRegenConfig] = useState<{
        instruction: string;
        wordCount: number;
    } | null>(null);

    // 每个 block 的生成状态 map
    const [contentStates, setContentStates] = useState<Record<string, BlockContentState>>({});
    const hasGeneratingContent = Object.values(contentStates).some((state) => state.status === 'queued' || state.status === 'generating');
    const isContentGenerationBusy = isGeneratingAll || queuedBlockIds.size > 0 || hasGeneratingContent;
    const fileInputRef = useRef<HTMLInputElement>(null);
    // 用于取消 generateAll 的完整串行循环
    const generateAllAbortRef = useRef<AbortController | null>(null);
    const getContentTaskKey = useCallback(
        (blockId: string) => (projectId ? buildContentTaskStorageKey(projectId, blockId) : `content_task_${blockId}`),
        [projectId],
    );

    // 通知父组件生成状态变化（用于禁用【下一步】按钮）
    useEffect(() => {
        onBusyChange?.(isContentGenerationBusy);
        return () => { onBusyChange?.(false); };
    }, [isContentGenerationBusy, onBusyChange]);

    const countVisibleWords = (text: string): number => {
        if (!text) return 0;
        const plain = text
            .replace(/<diagram[\s\S]*?<\/diagram>/gi, '')
            .replace(/<svg[\s\S]*?<\/svg>/gi, '')
            .replace(/<[^>]*>/g, '')
            .replace(/\s+/g, '');
        return plain.length;
    };

    const persistGeneratedResult = useCallback((blockId: string, result: {
        content: string;
        wordCount?: number;
        qualityScore?: number;
        feedback?: string;
        replaceReport?: { placeholder: string; original: string }[];
        diagramError?: string;
    }) => {
        setContentStates(prev => {
            const existing = prev[blockId] ?? { status: 'idle', content: '', wordCount: 0 };
            const finalContent = applyPlaceholderReportToContent(result.content || '', result.replaceReport);
            const finalWordCount = countVisibleWords(finalContent);
            const nextState: BlockContentState = {
                ...existing,
                status: 'done',
                content: finalContent,
                wordCount: finalWordCount,
                qualityScore: result.qualityScore,
                feedback: result.feedback,
                diagramError: result.diagramError,
                replaceReport: result.replaceReport,
                stage: undefined,
            };
            const next = { ...prev, [blockId]: nextState };
            if (projectId) projectService.update(projectId, { generatedContent: next });
            return next;
        });
    }, [projectId]);

    const resolveDraftSnapshot = useCallback((state?: BlockContentState): { content: string; wordCount: number } | null => {
        if (!state) return null;
        if (state.status === 'done' && state.content.trim()) {
            return { content: state.content, wordCount: state.wordCount };
        }
        if (state.previousContent?.trim()) {
            return {
                content: state.previousContent,
                wordCount: state.previousWordCount || countVisibleWords(state.previousContent),
            };
        }
        return null;
    }, []);

    const patchContentState = (blockId: string, patch: Partial<BlockContentState>) => {
        setContentStates(prev => {
            const existing: BlockContentState = prev[blockId] ?? { status: 'idle', content: '', wordCount: 0 };
            return { ...prev, [blockId]: { ...existing, ...patch } };
        });
    };

    const patchGeneratingStageSafely = useCallback((blockId: string, stage: string) => {
        setContentStates(prev => {
            const existing: BlockContentState = prev[blockId] ?? { status: 'idle', content: '', wordCount: 0 };
            // 分组任务会先用 partial_event 回填已完成章节，后续 stage 轮询不能把它打回 loading。
            if (existing.status === 'done' && existing.content.trim()) {
                return prev;
            }
            return {
                ...prev,
                [blockId]: {
                    ...existing,
                    status: 'generating',
                    stage,
                },
            };
        });
    }, []);

    const isBatchSelectableBlock = useCallback((block?: TemplateBlock | null) => {
        if (!block || !isContentBlock(block)) return false;
        const status = contentStates[block.id]?.status;
        if (status === 'done' || status === 'queued' || status === 'generating') return false;
        if (queuedBlockIds.has(block.id)) return false;
        return true;
    }, [contentStates, queuedBlockIds]);

    // 立即持久化：将指定的 block patch 与当前 contentStates 合并后同步到 localStorage + 后端
    const immediatelyPersist = useCallback((patches: Record<string, Partial<BlockContentState>>) => {
        if (!projectId) return;
        setContentStates(prev => {
            const next = { ...prev };
            for (const [blockId, patch] of Object.entries(patches)) {
                const existing = next[blockId] ?? { status: 'idle', content: '', wordCount: 0 };
                next[blockId] = { ...existing, ...patch };
            }
            // 直接写入 localStorage + 后端（不等 60s 自动保存）
            projectService.update(projectId, { generatedContent: next });
            return next;
        });
    }, [projectId]);

    // ─── 组装全局大纲 ───
    const getGlobalOutlineString = useCallback(() => {
        if (!template) return '';
        const proj = projectId ? projectService.getById(projectId) : undefined;
        return buildTreeGlobalOutline(proj?.outline, template.blocks);
    }, [projectId, template]);

    // ─── 章节内容生成（SSE 流式） ───
    // 存储各章节的 AbortController，用于取消生成
    const streamControllersRef = useRef<Record<string, AbortController>>({});

    const handleGenerateContent = useCallback((block: TemplateBlock, override?: {
        instruction?: string;
        expectedWords?: number;
    }) => {
        if (isLocked || isContentGenerationBusy) return;
        if (!projectId) return;
        if (!isContentBlock(block)) return;
        const current = contentStates[block.id];
        if (current?.status === 'queued' || current?.status === 'generating') return;
        // 如果有正在进行的流，先取消
        streamControllersRef.current[block.id]?.abort();

        // 备份已有内容：单节点重生成失败/取消时要自动回退，不能让用户丢稿。
        const existing = contentStates[block.id];
        const baseDraft = resolveDraftSnapshot(existing);
        const isRewrite = Boolean(baseDraft?.content.trim());
        const backup = baseDraft
            ? { previousContent: baseDraft.content, previousWordCount: baseDraft.wordCount }
            : {};

        // 首次生成允许清空占位区；重生成则保留旧稿可见，只锁编辑和按钮。
        immediatelyPersist({
            [block.id]: {
                ...existing,
                status: 'queued',
                content: isRewrite ? (baseDraft?.content || '') : '',
                wordCount: isRewrite ? (baseDraft?.wordCount || 0) : 0,
                error: undefined,
                stage: isRewrite ? '⏳ 重生成任务排队中' : '⏳ 生成任务排队中',
                ...backup,
            },
        });
        const globalOutline = getGlobalOutlineString();

        // 累积内容引用（闭包内维护，避免 stale state）
        let accumulated = '';
        const restoreSnapshot = () => {
            if (backup.previousContent?.trim()) {
                immediatelyPersist({
                    [block.id]: {
                        ...existing,
                        status: 'done',
                        content: backup.previousContent,
                        wordCount: backup.previousWordCount || countVisibleWords(backup.previousContent),
                        error: undefined,
                        stage: undefined,
                    },
                });
                return;
            }
            immediatelyPersist({
                [block.id]: {
                    ...existing,
                    status: 'idle',
                    content: '',
                    wordCount: 0,
                    error: undefined,
                    stage: undefined,
                },
            });
        };
        const resetToIdle = () => {
            immediatelyPersist({
                [block.id]: {
                    ...existing,
                    status: 'idle',
                    content: '',
                    wordCount: 0,
                    error: undefined,
                    stage: undefined,
                },
            });
        };

        const controller = isRewrite
            ? projectService.generateContentRewriteStream({
                projectId,
                sectionId: block.id,
                sectionTitle: block.title,
                currentContent: baseDraft?.content || '',
                rewriteInstruction: override?.instruction ?? block.instruction ?? '',
                expectedWords: override?.expectedWords ?? block.expected_word_count ?? 1500,
                globalOutline,
            }, {
                onStage: (stage) => {
                    patchContentState(block.id, { status: 'generating', stage });
                },
                onDone: (result) => {
                    delete streamControllersRef.current[block.id];
                    persistGeneratedResult(block.id, {
                        content: result.content,
                        qualityScore: result.qualityScore,
                        feedback: result.feedback,
                        diagramError: result.diagramError,
                        replaceReport: result.replaceReport,
                    });
                },
                onError: (err) => {
                    delete streamControllersRef.current[block.id];
                    delete streamControllersRef.current[`${block.id}_retry`];
                    if (err && err !== '__cancelled__') {
                        console.warn(`[content rewrite] ${block.title} 失败:`, err);
                    }
                    restoreSnapshot();
                },
            })
            : projectService.generateContentStream({
                projectId,
                sectionId: block.id,
                sectionTitle: block.title,
                writingHint: override?.instruction ?? block.instruction ?? '',
                keywords: (block.keywords ?? []).join(', '),
                expectedWords: override?.expectedWords ?? block.expected_word_count ?? 1500,
                globalOutline,
                requiresSearch: block.generation_strategy === 'response_special' ? false : (block.requires_search || false),
                generationStrategy: block.generation_strategy || 'general',
                needDiagram: block.generation_strategy === 'response_special' ? false : Boolean(block.need_diagram ?? block.diagram_plan?.enabled),
                diagramBrief: block.diagram_brief || block.diagram_plan?.brief || '',
                diagramTypeHint: block.diagram_plan?.typeHint || 'architecture',
                diagramPriority: Number(block.diagram_plan?.priority || 0),
            }, {
                onChunk: (text) => {
                    accumulated = text;
                    const wc = countVisibleWords(accumulated);
                    patchContentState(block.id, { status: 'generating', content: accumulated, wordCount: wc });
                },
                onStage: (stage) => {
                    patchContentState(block.id, { status: 'generating', stage });
                },
                onDone: (result) => {
                    delete streamControllersRef.current[block.id];
                    persistGeneratedResult(block.id, {
                        content: accumulated,
                        qualityScore: result.qualityScore,
                        feedback: result.feedback,
                        diagramError: result.diagramError,
                        replaceReport: result.replaceReport,
                    });
                },
                onError: (err) => {
                    if (err === '__cancelled__' || err?.includes?.('用户手动取消') || err?.includes?.('取消')) {
                        delete streamControllersRef.current[`${block.id}_retry`];
                        delete streamControllersRef.current[block.id];
                        immediatelyPersist({ [block.id]: { status: 'cancelled', error: undefined, stage: undefined } });
                        return;
                    }
                    const retryCount = (streamControllersRef.current[`${block.id}_retry`] as any) || 0;
                    if (retryCount < 1) {
                        (streamControllersRef.current[`${block.id}_retry`] as any) = retryCount + 1;
                        patchContentState(block.id, { stage: '⏳ 自动重试中...' });
                        setTimeout(() => handleGenerateContent(block, override), 2000);
                        return;
                    }
                    delete streamControllersRef.current[`${block.id}_retry`];
                    delete streamControllersRef.current[block.id];
                    console.warn(`[content generate] ${block.title} 失败:`, err);
                    resetToIdle();
                },
            });

        streamControllersRef.current[block.id] = controller;
    }, [isLocked, isContentGenerationBusy, projectId, getGlobalOutlineString, contentStates, immediatelyPersist, persistGeneratedResult, resolveDraftSnapshot]);

    // ─── 生成最终 Docx ───
    const handleForgeDocument = useCallback(async () => {
        if (!projectId || !template) return;
        // 收集所有已完成章节
        const doneSections = template.blocks
            .filter(b => isContentBlock(b) && contentStates[b.id]?.status === 'done')
            .map(b => ({
                id: b.id,
                title: b.title,
                content: contentStates[b.id]?.content || '',
            }));
        if (doneSections.length === 0) return;
        setForging(true);
        try {
            await projectService.forgeDocument(projectId, doneSections);
        } catch (e: any) {
            console.error('生成最终文档失败:', e?.response?.data?.detail || e.message || e);
        } finally {
            setForging(false);
        }
    }, [projectId, template, contentStates]);

    const activeBlock = template?.blocks.find(b => b.id === selectedBlockId) || null;
    const activeContent = activeBlock && isContentBlock(activeBlock) ? contentStates[activeBlock.id] : null;
    const groupChildrenMap = new Map<string, TemplateBlock[]>();
    template?.blocks.forEach((block) => {
        if (!isContentBlock(block) || !block.parent_heading_id) return;
        const siblings = groupChildrenMap.get(block.parent_heading_id) || [];
        siblings.push(block);
        groupChildrenMap.set(block.parent_heading_id, siblings);
    });
    const structuredRows = (template?.blocks || []).reduce<Array<
        | { type: 'group'; block: TemplateBlock; children: TemplateBlock[] }
        | { type: 'content'; block: TemplateBlock }
    >>((rows, block) => {
        if (isGroupBlock(block)) {
            rows.push({
                type: 'group',
                block,
                children: groupChildrenMap.get(block.id) || [],
            });
            return rows;
        }
        if (!block.parent_heading_id) {
            rows.push({ type: 'content', block });
        }
        return rows;
    }, []);
    const activeGroupChildren = activeBlock && isGroupBlock(activeBlock)
        ? (groupChildrenMap.get(activeBlock.id) || [])
        : [];
    const activeGroupDoneCount = activeGroupChildren.filter((block) => contentStates[block.id]?.status === 'done').length;
    const activeGroupActualWords = activeGroupChildren.reduce((sum, block) => sum + (contentStates[block.id]?.wordCount || 0), 0);
    const activeGroupTargetWords = activeGroupChildren.reduce((sum, block) => sum + (block.expected_word_count || 0), 0);
    const activeContentGeneratingLabel = activeContent?.previousContent?.trim() ? '重生成中' : '生成中';
    const displayNumberById = structuredRows.reduce<Record<string, string>>((acc, row, rowIndex) => {
        const groupNumber = `${rowIndex + 1}`;
        if (row.type === 'group') {
            acc[row.block.id] = groupNumber;
            row.children.forEach((child, childIndex) => {
                acc[child.id] = `${groupNumber}.${childIndex + 1}`;
            });
            return acc;
        }
        acc[row.block.id] = groupNumber;
        return acc;
    }, {});

    // ─── 强制取消/重置卡住的生成状态 ───
    const handleCancelGenerateAll = useCallback(async () => {
        if (isLocked) return;
        // 中断 generateAll 串行循环（防止后续 block 继续提交）
        generateAllAbortRef.current?.abort();
        generateAllAbortRef.current = null;
        const pendingTaskIds = Object.keys(contentStates)
            .map((blockId) => {
                if (contentStates[blockId]?.status !== 'queued' && contentStates[blockId]?.status !== 'generating') return '';
                const taskStorageKey = getContentTaskKey(blockId);
                const legacyTaskKey = `content_task_${blockId}`;
                return localStorage.getItem(taskStorageKey) || localStorage.getItem(legacyTaskKey) || '';
            })
            .filter(Boolean);
        if (pendingTaskIds.length > 0) {
            await Promise.allSettled(
                pendingTaskIds.map((taskId) => projectService.cancelTask(taskId, projectId || undefined)),
            );
        }
        // 将所有仍处于 queued/generating 的 block 强制取消
        setContentStates(prev => {
            const next = { ...prev };
            Object.keys(next).forEach(blockId => {
                if (next[blockId].status === 'queued' || next[blockId].status === 'generating') {
                    // abort 前端 controller
                    streamControllersRef.current[blockId]?.abort();
                    // cancel 后端任务
                    const taskStorageKey = getContentTaskKey(blockId);
                    const legacyTaskKey = `content_task_${blockId}`;
                    const taskId = localStorage.getItem(taskStorageKey) || localStorage.getItem(legacyTaskKey);
                    if (taskId) {
                        localStorage.removeItem(taskStorageKey);
                        localStorage.removeItem(legacyTaskKey);
                    }
                    if (next[blockId].previousContent?.trim()) {
                        next[blockId] = {
                            ...next[blockId],
                            status: 'done',
                            content: next[blockId].previousContent || '',
                            wordCount: next[blockId].previousWordCount || countVisibleWords(next[blockId].previousContent || ''),
                            error: undefined,
                            stage: undefined,
                        };
                    } else {
                        next[blockId] = { ...next[blockId], status: 'cancelled', error: undefined, stage: undefined };
                    }
                }
            });
            // 取消操作后立即持久化，避免刷新丢失已完成章节
            if (projectId) projectService.update(projectId, { generatedContent: next });
            return next;
        });
        setIsGeneratingAll(false);
        setGenerateAllProgress(null);
        setQueuedBlockIds(new Set());
    }, [contentStates, isLocked, getContentTaskKey, projectId]);

    useEffect(() => {
        if (!template) return;
        const selectableIds = new Set(
            template.blocks
                .filter((block) => isBatchSelectableBlock(block))
                .map((block) => block.id),
        );
        setCheckedBlockIds(prev => {
            let changed = false;
            const next = new Set<string>();
            prev.forEach((id) => {
                if (selectableIds.has(id)) next.add(id);
                else changed = true;
            });
            return changed ? next : prev;
        });
    }, [template, isBatchSelectableBlock]);

    // ─── 多选控制：单个 toggle ───
    const toggleCheck = useCallback((blockId: string) => {
        const block = template?.blocks.find((item) => item.id === blockId);
        if (!isBatchSelectableBlock(block)) return;
        setCheckedBlockIds(prev => {
            const next = new Set(prev);
            if (next.has(blockId)) next.delete(blockId);
            else next.add(blockId);
            return next;
        });
    }, [template, isBatchSelectableBlock]);

    const toggleGroupCheck = useCallback((groupId: string) => {
        if (!template) return;
        const childIds = template.blocks
            .filter((block) => isContentBlock(block) && block.parent_heading_id === groupId)
            .filter((block) => isBatchSelectableBlock(block))
            .map((block) => block.id);
        if (!childIds.length) return;
        setCheckedBlockIds(prev => {
            const next = new Set(prev);
            const allChecked = childIds.every(id => next.has(id));
            childIds.forEach(id => {
                if (allChecked) next.delete(id);
                else next.add(id);
            });
            return next;
        });
    }, [template, isBatchSelectableBlock]);

    // ─── 多选控制：全选 / 取消全选 ───
    const handleCheckAll = useCallback(() => {
        if (!template) return;
        const allIds = template.blocks
            .filter((block) => isBatchSelectableBlock(block))
            .map((block) => block.id);
        setCheckedBlockIds(prev => {
            const allChecked = allIds.length > 0 && allIds.every((id) => prev.has(id));
            return allChecked ? new Set() : new Set(allIds);
        });
    }, [template, isBatchSelectableBlock]);

    // ─── 生成选中的章节（多选批量生成） ───
    const handleGenerateSelected = useCallback(async () => {
        if (isLocked) return;
        if (!projectId || !template || checkedBlockIds.size === 0) return;
        setShowGenerateAllConfirm(false);
        setIsGeneratingAll(true);

        const globalOutline = getGlobalOutlineString();
        // 批量入口只处理未完成节点，避免将已生成内容误送入重写链路。
        const blocks = template.blocks
            .filter((block) => isBatchSelectableBlock(block) && checkedBlockIds.has(block.id))
            .map(b => ({
                id: b.id,
                title: b.title,
                writingHint: b.instruction || '',
                keywords: b.keywords?.join(', ') || '',
                expectedWords: b.expected_word_count || 1500,
                requiresSearch: b.generation_strategy === 'response_special' ? false : (b.requires_search ?? true),
                generationStrategy: b.generation_strategy || 'general',
                parentHeadingId: b.parent_heading_id,
                parentHeadingTitle: b.parent_heading_title,
                needDiagram: b.generation_strategy === 'response_special' ? false : Boolean(b.need_diagram ?? b.diagram_plan?.enabled),
                diagramBrief: b.diagram_brief || b.diagram_plan?.brief || '',
                diagramTypeHint: b.diagram_plan?.typeHint || 'architecture',
                diagramPriority: Number(b.diagram_plan?.priority || 0),
            }));
        if (blocks.length === 0) { setIsGeneratingAll(false); return; }

        // 将待生成的全部 block 加入队列（锁定 checkbox）
        setQueuedBlockIds(new Set(blocks.map(b => b.id)));
        immediatelyPersist(Object.fromEntries(blocks.map((block) => {
            const existing = contentStates[block.id];
            const backup = existing?.status === 'done' && existing.content
                ? { previousContent: existing.content, previousWordCount: existing.wordCount }
                : {};
            return [block.id, {
                ...existing,
                status: 'queued' as const,
                error: undefined,
                stage: '⏳ 任务排队中',
                ...backup,
            }];
        })));
        setGenerateAllProgress({ done: 0, total: blocks.length });

        try {
            const abortCtrl = new AbortController();
            generateAllAbortRef.current = abortCtrl;
            await projectService.generateAll(projectId, blocks, globalOutline, (blockId, status, result) => {
                if (status === 'generating') {
                    // 开始生成：从队列移除 + 清空旧内容（备份到 previousContent 供采纳/回退）
                    setQueuedBlockIds(prev => { const s = new Set(prev); s.delete(blockId); return s; });
                    const existing = contentStates[blockId];
                    const backup = existing?.status === 'done' && existing.content
                        ? { previousContent: existing.content, previousWordCount: existing.wordCount }
                        : {};
                    immediatelyPersist({
                        [blockId]: {
                            ...existing,
                            status: 'generating',
                            content: '',
                            wordCount: 0,
                            error: undefined,
                            stage: '🚀 启动工作流',
                            ...backup,
                        },
                    });
                } else if (status === 'chunk' && result) {
                    patchContentState(blockId, {
                        status: 'generating',
                        content: result.content || '',
                        wordCount: countVisibleWords(result.content || ''),
                    });
                } else if (status === 'stage' && result?.stage) {
                    patchGeneratingStageSafely(blockId, result.stage);
                } else if (status === 'done' && result) {
                    persistGeneratedResult(blockId, result);
                    setGenerateAllProgress(prev => prev ? { ...prev, done: prev.done + 1 } : null);
                } else if (status === 'error') {
                    setQueuedBlockIds(prev => { const s = new Set(prev); s.delete(blockId); return s; });
                    const previous = contentStates[blockId];
                    if (previous?.previousContent?.trim()) {
                        immediatelyPersist({
                            [blockId]: {
                                ...previous,
                                status: 'done',
                                content: previous.previousContent,
                                wordCount: previous.previousWordCount || countVisibleWords(previous.previousContent),
                                error: undefined,
                                stage: undefined,
                            },
                        });
                    } else {
                        immediatelyPersist({ [blockId]: { ...previous, status: 'idle', error: undefined, stage: undefined } });
                    }
                    setGenerateAllProgress(prev => prev ? { ...prev, done: prev.done + 1 } : null);
                }
            }, abortCtrl.signal);
        } finally {
            generateAllAbortRef.current = null;
            setIsGeneratingAll(false);
            setGenerateAllProgress(null);
            setQueuedBlockIds(new Set()); // 全部完成，清除队列
        }
    }, [isLocked, projectId, template, checkedBlockIds, getGlobalOutlineString, contentStates, persistGeneratedResult, immediatelyPersist, isBatchSelectableBlock, patchGeneratingStageSafely]);

    // ─── 一键生成全部 ───
    const handleGenerateAll = useCallback(async () => {
        if (isLocked) return;
        if (!projectId || !template) return;
        setShowGenerateAllConfirm(false);
        setIsGeneratingAll(true);

        // 启动前先将所有残留的 generating 状态重置为 idle，防止 localStorage 残留导致按钮无法点击
        setContentStates(prev => {
            const next = { ...prev };
            Object.keys(next).forEach(blockId => {
                if (next[blockId].status === 'queued' || next[blockId].status === 'generating') {
                    next[blockId] = { ...next[blockId], status: 'idle', error: undefined };
                }
            });
            return next;
        });

        const globalOutline = getGlobalOutlineString();
        const blocks = template.blocks.filter((block) => {
            if (!isContentBlock(block)) return false;
            if (queuedBlockIds.has(block.id)) return false;
            return contentStates[block.id]?.status !== 'done';
        }).map(b => ({
            id: b.id,
            title: b.title,
            writingHint: b.instruction || '',
            keywords: b.keywords?.join(', ') || '',
                expectedWords: b.expected_word_count || 1500,
                requiresSearch: b.generation_strategy === 'response_special' ? false : (b.requires_search ?? true),
                generationStrategy: b.generation_strategy || 'general',
                parentHeadingId: b.parent_heading_id,
                parentHeadingTitle: b.parent_heading_title,
                needDiagram: b.generation_strategy === 'response_special' ? false : Boolean(b.need_diagram ?? b.diagram_plan?.enabled),
                diagramBrief: b.diagram_brief || b.diagram_plan?.brief || '',
            diagramTypeHint: b.diagram_plan?.typeHint || 'architecture',
                diagramPriority: Number(b.diagram_plan?.priority || 0),
        }));
        if (blocks.length === 0) {
            setIsGeneratingAll(false);
            return;
        }

        setQueuedBlockIds(new Set(blocks.map(b => b.id)));
        immediatelyPersist(Object.fromEntries(blocks.map((block) => {
            const existing = contentStates[block.id];
            const backup = existing?.status === 'done' && existing.content
                ? { previousContent: existing.content, previousWordCount: existing.wordCount }
                : {};
            return [block.id, {
                ...existing,
                status: 'queued' as const,
                error: undefined,
                stage: '⏳ 任务排队中',
                ...backup,
            }];
        })));
        setGenerateAllProgress({ done: 0, total: blocks.length });

        try {
            const abortCtrl = new AbortController();
            generateAllAbortRef.current = abortCtrl;
            await projectService.generateAll(projectId, blocks, globalOutline, (blockId, status, result) => {
                if (status === 'generating') {
                    // 清空旧内容 + 备份（与 handleGenerateSelected 保持一致）
                    const existing = contentStates[blockId];
                    const backup = existing?.status === 'done' && existing.content
                        ? { previousContent: existing.content, previousWordCount: existing.wordCount }
                        : {};
                    immediatelyPersist({
                        [blockId]: {
                            ...existing,
                            status: 'generating',
                            content: '',
                            wordCount: 0,
                            error: undefined,
                            stage: '🚀 启动工作流',
                            ...backup,
                        },
                    });
                } else if (status === 'chunk' && result) {
                    patchContentState(blockId, {
                        status: 'generating',
                        content: result.content || '',
                        wordCount: countVisibleWords(result.content || ''),
                    });
                } else if (status === 'stage' && result?.stage) {
                    patchGeneratingStageSafely(blockId, result.stage);
                } else if (status === 'done' && result) {
                    persistGeneratedResult(blockId, result);
                    setGenerateAllProgress(prev => prev ? { ...prev, done: prev.done + 1 } : null);
                } else if (status === 'error') {
                    const previous = contentStates[blockId];
                    if (previous?.previousContent?.trim()) {
                        immediatelyPersist({
                            [blockId]: {
                                ...previous,
                                status: 'done',
                                content: previous.previousContent,
                                wordCount: previous.previousWordCount || countVisibleWords(previous.previousContent),
                                error: undefined,
                                stage: undefined,
                            },
                        });
                    } else {
                        immediatelyPersist({ [blockId]: { ...previous, status: 'idle', error: undefined, stage: undefined } });
                    }
                    setGenerateAllProgress(prev => prev ? { ...prev, done: prev.done + 1 } : null);
                }
            }, abortCtrl.signal);
        } finally {
            generateAllAbortRef.current = null;
            setIsGeneratingAll(false);
            setGenerateAllProgress(null);
            setQueuedBlockIds(new Set());
        }
    }, [isLocked, projectId, template, getGlobalOutlineString, persistGeneratedResult, contentStates, immediatelyPersist, queuedBlockIds, patchGeneratingStageSafely]);

    // ─── 新增章节 ───
    const handleAddBlock = useCallback(() => {
        if (isLocked) return;
        if (!template) return;
        if (template.blocks.some((block) => block.block_kind === 'group')) return;
        const newId = `block_${Date.now()}`;
        const newBlock: TemplateBlock = { id: newId, title: '新章节', instruction: '', requires_search: true };
        setTemplate({ ...template, blocks: [...template.blocks, newBlock] });
        setSelectedBlockId(newId);
    }, [isLocked, template]);

    // ─── 删除章节 ───
    const handleDeleteBlock = useCallback((blockId: string) => {
        if (isLocked) return;
        if (!template) return;
        if (template.blocks.some((block) => block.block_kind === 'group')) return;
        const remaining = template.blocks.filter(b => b.id !== blockId);
        setTemplate({ ...template, blocks: remaining });
        if (selectedBlockId === blockId) setSelectedBlockId(remaining.length > 0 ? remaining[0].id : null);
    }, [isLocked, template, selectedBlockId]);

    // ─── 导出 ───
    const handleExport = useCallback(() => {
        if (!template) return;
        const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url;
        a.download = `${currentTemplateName.replace(/\.ya?ml$/, '')}_export.json`;
        a.click(); URL.revokeObjectURL(url);
    }, [template, currentTemplateName]);

    // ─── 导入 ───
    const handleImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const parsed = JSON.parse(ev.target?.result as string) as StandardYaml;
                if (parsed && Array.isArray(parsed.blocks)) {
                    setTemplate(parsed);
                    if (parsed.blocks.length > 0) {
                        const firstContent = parsed.blocks.find((block) => block.block_kind !== 'group');
                        setSelectedBlockId(firstContent?.id || parsed.blocks[0].id);
                    }
                } else alert('导入的文件格式不合法，需包含 blocks 数组。');
            } catch { alert('文件解析失败，请确认为合法 JSON 格式。'); }
        };
        reader.readAsText(file);
        e.target.value = '';
    }, []);

    const fetchData = async (templateName?: string) => {
        try {
            setLoading(true); setError(null);

            // 尝试读取当前项目的专属大纲和缓存的正文
            let customOutline = null;
            if (projectId) {
                const proj = projectService.getById(projectId);
                if (proj && proj.outline && proj.outline.length > 0) {
                    customOutline = proj.outline;
                }
                // 恢复缓存的生成内容
                if (proj && proj.generatedContent) {
                    const recovered: typeof proj.generatedContent = {};
                    const resumeTargets: { blockId: string; taskId: string }[] = [];

                    for (const [blockId, cs] of Object.entries(proj.generatedContent)) {
                        const savedTaskId = getContentTaskStorageCandidates(projectId, blockId)
                            .map((key) => localStorage.getItem(key))
                            .find(Boolean);
                        if (savedTaskId) {
                            // 只要有 task_id，就尝试恢复轮询（不依赖 cs.status，避免状态丢失导致无法恢复）
                            recovered[blockId] = { ...cs, status: 'generating' as const, stage: '🔄 正在恢复...' };
                            resumeTargets.push({ blockId, taskId: savedTaskId });
                        } else if (cs.status === 'queued' || cs.status === 'generating') {
                            // 无 task_id（刷新前任务 ID 丢失/已被清理）→ 静默重置为 idle，不报错
                            recovered[blockId] = { ...cs, status: 'idle' as const, error: undefined };
                        } else if (cs.status === 'error') {
                            recovered[blockId] = { ...cs, status: 'idle' as const, error: undefined, stage: undefined };
                        } else {
                            recovered[blockId] = cs;
                        }
                    }
                    setContentStates(recovered);

                    // 对每个需要恢复的章节启动轮询（在 fetchData 返回后异步进行）
                    if (resumeTargets.length > 0) {
                        setTimeout(() => {
                            resumeTargets.forEach(({ blockId, taskId }) => {
                                // 竞态约束：先快速查一次后端状态，若已 done 则直接应用，不等 resumeContentTask 轮询
                                // 场景：刷新前任务刚完成但结果还没写入 localStorage，后端已有数据
                                bidGeneratorFetch(`/tasks/${taskId}/status?project_id=${encodeURIComponent(projectId)}`)
                                    .then(r => r.ok ? r.json() : null)
                                    .then(taskStatus => {
                                        if (taskStatus?.status === 'done' && taskStatus.result) {
                                            // 后端已完成 → 直接应用，无须继续轮询（优先于 localStorage 的 generating 状态）
                                            const r = taskStatus.result;
                                            const restored = applyPlaceholderReportToContent(
                                                r.content || '',
                                                r.replace_report,
                                            );
                                            immediatelyPersist({ [blockId]: {
                                                status: 'done' as const,
                                                content: restored,
                                                wordCount: countVisibleWords(restored),
                                                qualityScore: r.quality_score,
                                                feedback: r.feedback,
                                                diagramError: typeof r.diagram_error === 'object' ? String(r.diagram_error?.message || '') : (r.diagram_error || undefined),
                                                replaceReport: r.replace_report,
                                                stage: undefined,
                                            }});
                                            localStorage.removeItem(buildContentTaskStorageKey(projectId, blockId));
                                            localStorage.removeItem(`content_task_${blockId}`);
                                            return;
                                        }
                                        if (taskStatus?.status === 'error') {
                                            // 后端已报错 → 静默重置 idle（后端错误非用户可控）
                                            immediatelyPersist({ [blockId]: { status: 'idle' as const, error: undefined, stage: undefined }});
                                            localStorage.removeItem(buildContentTaskStorageKey(projectId, blockId));
                                            localStorage.removeItem(`content_task_${blockId}`);
                                            return;
                                        }
                                        // 后端仍在运行（running）或 404（onExpired）→ 继续标准轮询
                                        projectService.resumeContentTask(taskId, projectId, blockId, {
                                            onStage: (stage) => patchContentState(blockId, { stage }),
                                            onDone: (result) => {
                                                const restored = applyPlaceholderReportToContent(
                                                    result.content,
                                                    result.replaceReport,
                                                );
                                                immediatelyPersist({ [blockId]: {
                                                    status: 'done' as const,
                                                    content: restored,
                                                    wordCount: countVisibleWords(restored),
                                                    qualityScore: result.qualityScore,
                                                    feedback: result.feedback,
                                                    diagramError: result.diagramError,
                                                    replaceReport: result.replaceReport,
                                                    stage: undefined,
                                                }});
                                            },
                                            onError: () => {
                                                // 恢复轮询中的错误属于用户不可控（后端或 Dify 问题），静默重置 idle
                                                immediatelyPersist({ [blockId]: { status: 'idle' as const, error: undefined, stage: undefined }});
                                            },
                                            onExpired: () => {
                                                immediatelyPersist({ [blockId]: { status: 'idle' as const, error: undefined, stage: undefined }});
                                            },
                                        });
                                    })
                                    .catch(() => {
                                        // 网络异常时仍走标准轮询
                                        projectService.resumeContentTask(taskId, projectId, blockId, {
                                            onStage: (stage) => patchContentState(blockId, { stage }),
                                            onDone: (result) => {
                                                const restored = applyPlaceholderReportToContent(
                                                    result.content,
                                                    result.replaceReport,
                                                );
                                                immediatelyPersist({ [blockId]: {
                                                    status: 'done' as const,
                                                    content: restored,
                                                    wordCount: countVisibleWords(restored),
                                                    qualityScore: result.qualityScore,
                                                    feedback: result.feedback,
                                                    diagramError: result.diagramError,
                                                    replaceReport: result.replaceReport,
                                                    stage: undefined,
                                                }});
                                            },
                                            onError: () => {
                                                immediatelyPersist({ [blockId]: { status: 'idle' as const, error: undefined, stage: undefined }});
                                            },
                                            onExpired: () => {
                                                immediatelyPersist({ [blockId]: { status: 'idle' as const, error: undefined, stage: undefined }});
                                            },
                                        });
                                    });
                            });
                        }, 500);
                    }
                }

            }

            // 并行或者继续获取远端的模版配置集合（为了保留 availableTemplates 下拉选项）
            const res = await configService.getTemplateAndConfig(templateName);
            let effectiveBlocks = res.template_dict?.blocks || [];

            if (customOutline) {
                // 如果有专属大纲，将其转换为“结构容器 + 正文单元”的模板块。
                // 有 children 的章节作为 group；无 children 的章节自身可直接生成正文。
                const blocks: import('../services/configService').TemplateBlock[] = [];
                customOutline.forEach((sec: any) => {
                    const children = Array.isArray(sec.children) ? sec.children : [];
                    const secGeneratesFromSelf = (() => {
                        if (sec.generatesFromSelf !== undefined) return Boolean(sec.generatesFromSelf);
                        if (sec.generates_from_self !== undefined) return Boolean(sec.generates_from_self);
                        if ((sec.generationStrategy || sec.generation_strategy) === 'response_special') return true;
                        return children.length === 0;
                    })();
                    if (children.length > 0 && !secGeneratesFromSelf) {
                        blocks.push({
                            id: sec.id,
                            title: sec.title,
                            instruction: sec.writingHint || '',
                            keywords: sec.keywords || [],
                            requires_search: false,
                            block_kind: 'group',
                            heading_level: sec.headingLevel || 2,
                            generation_strategy: sec.generationStrategy || sec.generation_strategy || 'general',
                            generates_from_self: false,
                        });
                        children.forEach((child: any) => {
                            blocks.push({
                                id: child.id,
                                title: child.title,
                                instruction: child.writingHint || '',
                                keywords: child.keywords || [],
                                need_diagram: child.needDiagram ?? false,
                                diagram_brief: child.diagramBrief || '',
                                diagram_plan: child.diagramPlan || undefined,
                                expected_word_count: child.wordCount,
                                requires_search: (child.generationStrategy || child.generation_strategy) === 'response_special' ? false : true,
                                block_kind: 'content',
                                heading_level: child.headingLevel || 3,
                                parent_heading_id: sec.id,
                                parent_heading_title: sec.title,
                                generation_strategy: child.generationStrategy || child.generation_strategy || 'general',
                                generates_from_self: Boolean(child.generatesFromSelf ?? child.generates_from_self),
                            });
                        });
                        return;
                    }
                    blocks.push({
                        id: sec.id,
                        title: sec.title,
                        instruction: sec.writingHint || '',
                        keywords: sec.keywords || [],
                        need_diagram: false,
                        diagram_brief: '',
                        diagram_plan: undefined,
                        expected_word_count: sec.wordCount,
                        requires_search: (sec.generationStrategy || sec.generation_strategy) === 'response_special' ? false : true,
                        block_kind: 'content',
                        heading_level: sec.headingLevel || 2,
                        generation_strategy: sec.generationStrategy || sec.generation_strategy || 'general',
                        generates_from_self: true,
                    });
                });

                setTemplate({
                    ...res.template_dict,
                    name: "AI 专属大纲",
                    blocks: blocks
                });
                effectiveBlocks = blocks;
                setCurrentTemplateName("AI 专属大纲");
            } else {
                setTemplate(res.template_dict);
                setCurrentTemplateName(res.current_template);
            }

            setAvailableTemplates(res.available_templates);

            if (customOutline && customOutline.length > 0 && !selectedBlockId) {
                const firstContent = effectiveBlocks.find((block) => block.block_kind !== 'group');
                setSelectedBlockId(firstContent?.id || effectiveBlocks[0]?.id || null);
            } else if (effectiveBlocks.length > 0 && !selectedBlockId) {
                setSelectedBlockId(effectiveBlocks[0].id);
            }
        } catch (err: any) {
            setError(err.message || '获取配置失败');
        } finally { setLoading(false); }
    };

    useEffect(() => { fetchData(); }, [projectId]);

    // 标记内容是否有未保存修改（用 ref 追踪初始化状态，避免初始化时误触发）
    const [isDirty, setIsDirty] = useState(false);
    const isInitializedRef = useRef(false);

    // 数据加载完成后标记已初始化
    useEffect(() => {
        if (!loading && template) {
            const timer = setTimeout(() => { isInitializedRef.current = true; }, 500);
            return () => clearTimeout(timer);
        }
    }, [loading, template]);

    // onChange 自动保存（debounce 1.5s，有修改即触发）
    const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const triggerAutoSave = useCallback(async () => {
        if (!isInitializedRef.current || !template) return;
        setIsDirty(true);
        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = setTimeout(async () => {
            try {
                setSaving(true);
                await configService.updateTemplate(currentTemplateName, template);
                if (projectId && Object.keys(contentStates).length > 0) {
                    projectService.update(projectId, { generatedContent: contentStates });
                }
                setIsDirty(false);
                const now = new Date();
                setLastSavedAt(`${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`);
            } catch (err) {
                console.warn('[auto-save] 自动保存失败:', err);
            } finally { setSaving(false); }
        }, 1500);
    }, [template, currentTemplateName, projectId, contentStates]);


    // markDirty 同时触发自动保存
    const markDirty = useCallback(() => {
        if (isInitializedRef.current) triggerAutoSave();
    }, [triggerAutoSave]);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const handleDragEnd = (event: DragEndEvent) => {
        if (isLocked) return;
        const { active, over } = event;
        if (over && active.id !== over.id && template) {
            setTemplate(prev => {
                if (!prev) return prev;
                if (prev.blocks.some((block) => block.block_kind === 'group')) {
                    return {
                        ...prev,
                        blocks: reorderStructuredBlocks(prev.blocks, String(active.id), String(over.id)),
                    };
                }
                const oldIndex = prev.blocks.findIndex(item => item.id === active.id);
                const newIndex = prev.blocks.findIndex(item => item.id === over.id);
                return { ...prev, blocks: arrayMove(prev.blocks, oldIndex, newIndex) };
            });
            markDirty();
        }
    };


    // ── 占位符映射 Toggle：从后端 API 获取映射表，切换显示原文/占位符 ──
    const showOriginal = false;
    const mappingsCache = useRef<Record<string, string> | null>(null);

    // 模糊匹配替换函数
    const applyMappings = useCallback((html: string): string => {
        const mapping = mappingsCache.current;
        if (!mapping) return html;
        const normalizeKey = (k: string) => k.replace(/\{\{/g, '').replace(/\}\}/g, '').replace(/^_+|_+$/g, '').toLowerCase();
        const extractType = (norm: string) => norm.replace(/_\d+$/, '');
        const entries = Object.entries(mapping).map(([k, v]) => {
            const norm = normalizeKey(k);
            return { key: k, value: v, norm, entityType: extractType(norm) };
        });
        const findMatch = (ph: string): string | null => {
            const norm = normalizeKey(ph);
            const exact = entries.find(e => e.norm === norm);
            if (exact) return exact.value;
            const fuzzy = entries.find(e => norm.includes(e.norm) || e.norm.includes(norm));
            if (fuzzy) return fuzzy.value;
            const phType = extractType(norm);
            const typeMatch = entries.find(e => e.entityType === phType);
            return typeMatch?.value ?? null;
        };
        // 将占位符替换为原文，但保留高亮 span 样式
        const wrapOriginal = (placeholder: string, originalText: string) =>
            `<span data-placeholder data-original="${placeholder}" class="pipt-placeholder" contenteditable="false">${originalText}</span>`;

        // 处理被 <strong> 拆散的
        let result = html.replace(/\{\{<strong>(.*?)<\/strong>\}\}/g, (_m, inner) => {
            const ph = `{{__${inner}__}}`;
            const match = findMatch(ph);
            return match ? wrapOriginal(ph, match) : _m;
        });
        // 处理 <span data-placeholder> 包裹的
        result = result.replace(/<span[^>]*data-placeholder[^>]*>(\{\{[^}]+\}\})<\/span>/g, (_m, ph) => {
            const match = findMatch(ph);
            return match ? wrapOriginal(ph, match) : _m;
        });
        // 处理纯文本占位符
        result = result.replace(/\{\{[^}]+\}\}/g, (ph) => {
            const match = findMatch(ph);
            return match ? wrapOriginal(ph, match) : ph;
        });
        return result;
    }, []);

    // 计算当前选中 block 的显示内容（toggle 切换显示原文/占位符）
    const displayContent = activeContent?.content
        ? (showOriginal ? applyMappings(activeContent.content) : activeContent.content)
        : '';

    // 用户手动编辑内容回调
    const handleContentEdit = useCallback((html: string) => {
        if (isLocked) return;
        if (!activeBlock) return;
        const wc = countVisibleWords(html);
        setContentStates(prev => {
            const existing: BlockContentState = prev[activeBlock.id] ?? { status: 'idle', content: '', wordCount: 0 };
            const nextState: BlockContentState = {
                ...existing,
                content: html,
                wordCount: wc,
                status: 'done',
            };
            return { ...prev, [activeBlock.id]: nextState };
        });
        markDirty();
    }, [isLocked, activeBlock, markDirty]);

    if (loading) return (
        <div className="flex justify-center flex-col items-center h-[600px] text-gray-400">
            <RefreshCw className="w-8 h-8 animate-spin mb-4 text-sky-500" />
            <p>正在加载架构大纲...</p>
        </div>
    );
    if (error || !template) return (
        <div className="bg-red-50 text-red-600 p-6 rounded-lg flex items-start m-8">
            <AlertCircle className="w-6 h-6 mr-3 shrink-0 mt-0.5" />
            <div><h3 className="font-semibold text-lg">架构读取失败</h3><p className="mt-2">{error}</p></div>
        </div>
    );

    const contentBlocks = template.blocks.filter((block) => isContentBlock(block));
    const hasStructuredOutline = template.blocks.some((block) => block.block_kind === 'group');
    const selectableContentBlocks = contentBlocks.filter((block) => isBatchSelectableBlock(block));
    const selectableContentBlockIds = selectableContentBlocks.map((block) => block.id);
    const checkedSelectableCount = selectableContentBlockIds.filter((id) => checkedBlockIds.has(id)).length;
    const hasSelectableBlocks = selectableContentBlockIds.length > 0;

    // 总进度统计
    const totalBlocks = contentBlocks.length;
    const doneBlocks = contentBlocks.filter(b => contentStates[b.id]?.status === 'done').length;
    const totalExpectedWords = contentBlocks.reduce((s, b) => s + (b.expected_word_count || 0), 0);
    const totalActualWords = contentBlocks.reduce((s, b) => s + (contentStates[b.id]?.wordCount || 0), 0);

    return (
        <div className="bg-gray-50/30 flex flex-col h-full border border-gray-200 rounded-xl overflow-hidden shadow-sm">

            {/* ── Top Toolbar (紧凑版) ── */}
            <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2.5">
                    <div className="p-1.5 bg-sky-50 text-sky-600 rounded-lg"><FolderTree className="w-4 h-4" /></div>
                    <div>
                        <h2 className="text-sm font-bold text-gray-900 leading-tight">技术方案</h2>
                        <div className="text-sm text-gray-400 flex items-center gap-1">
                            <select value={currentTemplateName} onChange={e => fetchData(e.target.value)}
                                className="bg-transparent border-none text-gray-500 py-0 px-0 text-sm focus:ring-0 cursor-pointer">
                                {currentTemplateName === "AI 专属大纲" && (<option value="AI 专属大纲">AI 大纲</option>)}
                                {availableTemplates.map(name => <option key={name} value={name}>{name}</option>)}
                            </select>
                            <span className="text-gray-300">·</span>
                            <span className="font-medium text-sky-600">{doneBlocks}/{totalBlocks}</span>
                            {hasStructuredOutline && (
                                <>
                                    <span className="text-gray-300">·</span>
                                    <span className="text-xs text-gray-500">按大纲结构生成</span>
                                </>
                            )}
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2">

                    {/* 导出技术方案 */}
                    {projectId && (
                        <button onClick={handleForgeDocument}
                            disabled={forging || !contentBlocks.some(b => contentStates[b.id]?.status === 'done')}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                            {forging
                                ? <><Loader2 className="w-3 h-3 animate-spin" />导出中</>
                                : <><FileDown className="w-3 h-3" />导出技术方案</>
                            }
                        </button>
                    )}

                    {/* 一键生成：生成中显示进度，无选中→全量弹窗，有选中→直接生成 */}
                    {!isLocked && isGeneratingAll ? (
                        <button onClick={handleCancelGenerateAll}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors">
                            取消批量生成
                        </button>
                    ) : !isLocked ? (
                        <button
                            onClick={checkedSelectableCount > 0 ? handleGenerateSelected : () => setShowGenerateAllConfirm(true)}
                            disabled={isContentGenerationBusy || contentBlocks.length === 0 || (!hasSelectableBlocks && checkedSelectableCount === 0)}
                            className={clsx(
                                'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                                contentBlocks.length > 0 && (hasSelectableBlocks || checkedSelectableCount > 0)
                                    ? 'bg-sky-500 text-white hover:bg-sky-600'
                                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            )}>
                            <Sparkles className="w-3 h-3" />
                            {checkedSelectableCount > 0 ? `一键生成 (${checkedSelectableCount})` : '一键生成'}
                        </button>
                    ) : null}

                    {/* 更多菜单：仅保留大纲导入/导出 */}
                    <div className="relative">
                        <button onClick={() => setShowMoreMenu(v => !v)} className="p-1.5 hover:bg-gray-100 text-gray-400 rounded-lg transition-colors">
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>
                        </button>
                        {showMoreMenu && (
                            <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1 w-40" onClick={() => setShowMoreMenu(false)}>
                                <button onClick={handleExport} className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                                    <Download className="w-3 h-3" />导出大纲配置
                                </button>
                                <button onClick={() => fileInputRef.current?.click()} className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                                    <UploadIcon className="w-3 h-3" />导入大纲配置
                                    <input type="file" ref={fileInputRef} className="hidden" accept=".json,.yaml,.yml" onChange={handleImport} />
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* ── 3-Pane Layout ── */}
            <div className="flex-1 flex overflow-hidden">

                {/* 1. 左侧：目录树（带字数进度） */}
                <div className="w-80 bg-white border-r border-gray-200 flex flex-col shrink-0">
                    <div className="px-3 py-2 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                        <h3 className="font-semibold text-gray-600 text-sm flex items-center"><FolderTree className="w-3.5 h-3.5 mr-1.5 text-gray-400" />章节目录</h3>
                        <div className="flex items-center gap-1">
                            {contentBlocks.length > 0 && (
                                <button
                                    onClick={handleCheckAll}
                                    disabled={isLocked || isContentGenerationBusy || !hasSelectableBlocks}
                                    className="text-sm px-1 py-0.5 rounded text-gray-400 hover:bg-gray-200 hover:text-gray-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    {hasSelectableBlocks && checkedSelectableCount === selectableContentBlockIds.length ? '取消' : '全选'}
                                </button>
                            )}
                            {!hasStructuredOutline && (
                                <button onClick={handleAddBlock} className="p-0.5 hover:bg-white text-gray-400 hover:text-sky-600 rounded transition-colors" title="新增"><Plus className="w-3.5 h-3.5" /></button>
                            )}
                        </div>
                    </div>
                    <div className="px-2 py-1.5 flex-1 overflow-y-auto">
                        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                            <SortableContext items={template.blocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
                                <div className="space-y-1.5">
                                    {structuredRows.map((row) => {
                                        if (row.type === 'group') {
                                            const group = row.block;
                                            const children = row.children;
                                            const selectableChildren = children.filter((block) => isBatchSelectableBlock(block));
                                            const isActiveGroup = selectedBlockId === group.id;
                                            const doneCount = children.filter((block) => contentStates[block.id]?.status === 'done').length;
                                            const checkedCount = selectableChildren.filter((block) => checkedBlockIds.has(block.id)).length;
                                            const isGroupChecked = selectableChildren.length > 0 && checkedCount === selectableChildren.length;
                                            const isGroupIndeterminate = checkedCount > 0 && checkedCount < selectableChildren.length;
                                            const groupLocked = isLocked || isContentGenerationBusy || selectableChildren.length === 0;
                                            return (
                                                <div key={group.id}>
                                                    <SortableBlock
                                                        id={group.id}
                                                        containerClassName={clsx(
                                                            '!mb-0 border-gray-200 bg-gray-50 shadow-none',
                                                            isActiveGroup && 'border-sky-300 bg-sky-50 shadow-sm',
                                                        )}
                                                        handleClassName="border-gray-200 bg-gray-100 hover:bg-gray-200"
                                                    >
                                                        <div
                                                            onClick={() => {
                                                                setSelectedBlockId(group.id);
                                                                setShowConfigBeforeGenerate(false);
                                                                setRegenConfig(null);
                                                            }}
                                                            className="cursor-pointer"
                                                        >
                                                            <div className="flex items-center gap-2">
                                                                <input
                                                                    type="checkbox"
                                                                    ref={(node) => { if (node) node.indeterminate = isGroupIndeterminate; }}
                                                                    checked={isGroupChecked}
                                                                    disabled={groupLocked}
                                                                    onChange={() => {}}
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        if (!groupLocked) toggleGroupCheck(group.id);
                                                                    }}
                                                                    className={clsx(
                                                                        'w-3.5 h-3.5 rounded border-gray-300 text-sky-500 focus:ring-0 shrink-0 cursor-pointer accent-sky-500',
                                                                        groupLocked && 'opacity-40 cursor-not-allowed',
                                                                    )}
                                                                />
                                                                <FolderTree className={clsx('w-4 h-4 shrink-0', isActiveGroup ? 'text-sky-600' : 'text-gray-400')} />
                                                                <span className={clsx('flex-1 truncate text-sm font-semibold', isActiveGroup ? 'text-sky-800' : 'text-gray-800')}>
                                                                    {group.title}
                                                                </span>
                                                            </div>
                                                            <div className="mt-1 text-xs text-gray-500">
                                                                已完成 {doneCount}/{children.length}
                                                            </div>
                                                        </div>
                                                    </SortableBlock>

                                                            {children.length > 0 ? (
                                                        <div className="ml-7 mt-1 border-l border-gray-200 pl-2 space-y-1">
                                                            {children.map((block) => {
                                                                const cs = contentStates[block.id];
                                                                const isBatchSelectable = isBatchSelectableBlock(block);
                                                                const isChecked = isBatchSelectable && checkedBlockIds.has(block.id);
                                                                const isQueued = queuedBlockIds.has(block.id);
                                                                const rowLocked = isLocked || !isBatchSelectable;
                                                                const isActive = selectedBlockId === block.id;
                                                                const isRewriteGenerating = (cs?.status === 'queued' || cs?.status === 'generating') && Boolean(cs?.previousContent?.trim());
                                                                const displayNumber = displayNumberById[block.id];
                                                                const target = block.expected_word_count || 0;
                                                                const actual = cs?.wordCount || 0;
                                                                const pct = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0;
                                                                return (
                                                                    <SortableBlock
                                                                        key={block.id}
                                                                        id={block.id}
                                                                        containerClassName={clsx(
                                                                            '!mb-0 shadow-none',
                                                                            isActive ? 'border-sky-200 bg-sky-50' : 'border-gray-100 bg-white',
                                                                        )}
                                                                        contentClassName="py-1.5"
                                                                    >
                                                                        <div
                                                                            onClick={() => {
                                                                                setSelectedBlockId(block.id);
                                                                                setShowConfigBeforeGenerate(false);
                                                                                setRegenConfig(null);
                                                                            }}
                                                                            className="cursor-pointer"
                                                                        >
                                                                            <div className="flex items-center gap-1.5">
                                                                                <input
                                                                                    type="checkbox"
                                                                                    checked={isChecked}
                                                                                    disabled={rowLocked}
                                                                                    onChange={() => {}}
                                                                                    onClick={(e) => {
                                                                                        e.stopPropagation();
                                                                                        if (!rowLocked) toggleCheck(block.id);
                                                                                    }}
                                                                                    className={clsx(
                                                                                        'w-3 h-3 rounded border-gray-300 text-sky-500 focus:ring-0 shrink-0 cursor-pointer accent-sky-500',
                                                                                        rowLocked && 'opacity-40 cursor-not-allowed',
                                                                                    )}
                                                                                />
                                                                                {cs?.status === 'done' ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-green-500" />
                                                                                    : cs?.status === 'cancelled' ? <XCircle className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                                                                                            : <FileText className={clsx('w-3.5 h-3.5 shrink-0', isActive ? 'text-sky-500' : 'text-gray-400')} />}
                                                                                <span className={clsx('flex-1 truncate text-sm', isActive ? 'text-sky-800 font-medium' : 'text-gray-700', block.is_chapter_intro && 'font-semibold')}>
                                                                                    {isRewriteGenerating && displayNumber ? `【${displayNumber}】重生成中` : block.title}
                                                                                </span>
                                                                                {(cs?.status === 'queued' || cs?.status === 'generating' || isQueued) && (
                                                                                    <Loader2 className={clsx('w-3.5 h-3.5 shrink-0 animate-spin', cs?.status === 'generating' ? 'text-sky-400' : 'text-gray-300')} />
                                                                                )}
                                                                                {/* 目录树中隐藏单节点评分标记（按需可恢复）
                                                                                {cs?.qualityScore !== undefined && cs.status === 'done' && (
                                                                                    <div className={clsx(
                                                                                        'w-5 h-4 flex items-center justify-center rounded text-xs font-bold',
                                                                                        cs.qualityScore >= 8 ? 'bg-green-100 text-green-700' : cs.qualityScore >= 6 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700',
                                                                                    )}>
                                                                                        {cs.qualityScore}
                                                                                    </div>
                                                                                )}
                                                                                */}
                                                                            </div>
                                                                            <div className="mt-1 pl-[22px]">
                                                                                {cs?.status === 'done' ? (
                                                                                    <div className="flex items-center gap-1.5">
                                                                                        <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
                                                                                            <div
                                                                                                className={clsx('h-full rounded-full transition-all', pct >= 80 ? 'bg-green-400' : pct >= 50 ? 'bg-amber-400' : 'bg-red-300')}
                                                                                                style={{ width: `${pct}%` }}
                                                                                            />
                                                                                        </div>
                                                                                        <span className="text-xs text-gray-500 font-mono whitespace-nowrap">{actual.toLocaleString()}/{target.toLocaleString()}</span>
                                                                                    </div>
                                                                                ) : cs?.status === 'cancelled' ? (
                                                                                    <span className="text-xs text-gray-400">【已取消】</span>
                                                                                ) : cs?.status === 'queued' ? (
                                                                                    <span className="text-xs text-sky-500">任务排队中</span>
                                                                                ) : target > 0 ? (
                                                                                    <span className="text-xs text-gray-300 font-mono">— / {target.toLocaleString()}字</span>
                                                                                ) : null}
                                                                            </div>
                                                                        </div>
                                                                    </SortableBlock>
                                                                );
                                                            })}
                                                        </div>
                                                    ) : (
                                                        <div className="ml-7 mt-1 rounded-lg border border-dashed border-gray-200 bg-white/80 px-3 py-2 text-xs text-gray-400">
                                                            当前章节下暂无内容
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        }

                                        const block = row.block;
                                        const cs = contentStates[block.id];
                                        const isBatchSelectable = isBatchSelectableBlock(block);
                                        const isChecked = isBatchSelectable && checkedBlockIds.has(block.id);
                                        const isQueued = queuedBlockIds.has(block.id);
                                        const rowLocked = isLocked || !isBatchSelectable;
                                        const isActive = selectedBlockId === block.id;
                                        const isParentLike = isSelfGeneratingParentBlock(block);
                                        const isRewriteGenerating = (cs?.status === 'queued' || cs?.status === 'generating') && Boolean(cs?.previousContent?.trim());
                                        const displayNumber = displayNumberById[block.id];
                                        const target = block.expected_word_count || 0;
                                        const actual = cs?.wordCount || 0;
                                        const pct = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0;
                                        return (
                                            <SortableBlock
                                                key={block.id}
                                                id={block.id}
                                                containerClassName={isParentLike ? clsx(
                                                    '!mb-0 border-gray-200 bg-gray-50 shadow-none',
                                                    isActive && 'border-sky-300 bg-sky-50 shadow-sm',
                                                ) : undefined}
                                                handleClassName={isParentLike ? 'border-gray-200 bg-gray-100 hover:bg-gray-200' : undefined}
                                            >
                                                <div
                                                    onClick={() => {
                                                        setSelectedBlockId(block.id);
                                                        setShowConfigBeforeGenerate(false);
                                                        setRegenConfig(null);
                                                    }}
                                                    className={clsx(
                                                        'group text-sm cursor-pointer',
                                                        isParentLike
                                                            ? undefined
                                                            : clsx(
                                                                'px-2 py-1.5 rounded-lg transition-all border',
                                                                isActive ? 'bg-sky-50 border-sky-200 shadow-sm' : 'bg-white border-transparent hover:bg-gray-50',
                                                            ),
                                                    )}
                                                >
                                                    <div className={clsx('flex items-center', isParentLike ? 'gap-2' : 'gap-1.5')}>
                                                        <input
                                                            type="checkbox"
                                                            checked={isChecked}
                                                            disabled={rowLocked}
                                                            onChange={() => {}}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                if (!rowLocked) toggleCheck(block.id);
                                                            }}
                                                            className={clsx(
                                                                isParentLike ? 'w-3.5 h-3.5' : 'w-3 h-3',
                                                                'rounded border-gray-300 text-sky-500 focus:ring-0 shrink-0 cursor-pointer accent-sky-500',
                                                                rowLocked && 'opacity-40 cursor-not-allowed')}
                                                        />
                                                        {cs?.status === 'done' ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-green-500" />
                                                            : cs?.status === 'cancelled' ? <XCircle className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                                                                    : isParentLike
                                                                        ? <FolderTree className={clsx('w-4 h-4 shrink-0', isActive ? 'text-sky-600' : 'text-gray-400')} />
                                                                        : <FileText className={clsx('w-3.5 h-3.5 shrink-0', isActive ? 'text-sky-500' : 'text-gray-400')} />}
                                                        <span className={clsx(
                                                            'flex-1 truncate',
                                                            isParentLike
                                                                ? (isActive ? 'text-sky-800 text-sm font-semibold' : 'text-gray-800 text-sm font-semibold')
                                                                : (isActive ? 'text-sky-800 font-medium' : 'text-gray-700'),
                                                            block.is_chapter_intro && 'font-semibold',
                                                        )}>
                                                            {isRewriteGenerating && displayNumber ? `【${displayNumber}】重生成中` : block.title}
                                                        </span>
                                                        {(cs?.status === 'queued' || cs?.status === 'generating' || isQueued) && (
                                                            <Loader2 className={clsx('w-3.5 h-3.5 shrink-0 animate-spin', cs?.status === 'generating' ? 'text-sky-400' : 'text-gray-300')} />
                                                        )}
                                                        {!hasStructuredOutline && (
                                                            <button onClick={e => { e.stopPropagation(); handleDeleteBlock(block.id); }}
                                                                className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-300 hover:text-red-500 rounded transition-all shrink-0"><Trash2 className="w-3 h-3" /></button>
                                                        )}
                                                    </div>
                                                    <div className={clsx('text-xs text-gray-500', isParentLike ? 'mt-1' : 'mt-0.5 pl-[22px]')}>
                                                        {cs?.status === 'done' ? (
                                                            <div className="flex items-center gap-1.5">
                                                                <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
                                                                    <div className={clsx('h-full rounded-full transition-all', pct >= 80 ? 'bg-green-400' : pct >= 50 ? 'bg-amber-400' : 'bg-red-300')}
                                                                        style={{ width: `${pct}%` }} />
                                                                </div>
                                                                <span className="text-xs text-gray-500 font-mono whitespace-nowrap">{actual.toLocaleString()}/{target.toLocaleString()}</span>
                                                            </div>
                                                        ) : cs?.status === 'cancelled' ? (
                                                            <span className="text-xs text-gray-400">【已取消】</span>
                                                        ) : target > 0 ? (
                                                            <span className="text-xs text-gray-300 font-mono">— / {target.toLocaleString()}字</span>
                                                        ) : null}
                                                    </div>
                                                </div>
                                            </SortableBlock>
                                        );
                                    })}
                                </div>
                            </SortableContext>
                        </DndContext>
                    </div>
                    <div className="px-3 py-2 border-t border-gray-100 bg-gray-50/50">
                        <div className="flex justify-between text-sm text-gray-500">
                            <span>已生成 {totalActualWords.toLocaleString()} 字</span>
                            <span>目标 {totalExpectedWords.toLocaleString()} 字</span>
                        </div>
                        <div className="mt-1 h-1 bg-gray-200 rounded-full overflow-hidden">
                            <div className="h-full bg-sky-500 rounded-full transition-all"
                                style={{ width: `${totalExpectedWords > 0 ? Math.min(100, Math.round(totalActualWords / totalExpectedWords * 100)) : 0}%` }} />
                        </div>
                    </div>
                </div>

                {/* 2. 中间主区：配置（折叠）+ 内容预览 */}
                <div className="flex-1 bg-gray-50 flex flex-col min-w-0 overflow-hidden">
                    {activeBlock ? (
                        <div className="h-full flex flex-col">
                            <div className="bg-white border-b border-gray-200 shrink-0">
                                <div className="px-5 py-2.5 flex items-center justify-between">
                                    <div className="flex items-center gap-2.5 flex-1 min-w-0">
                                        <h3 className="text-base font-bold text-gray-900 truncate">{activeBlock.title}</h3>
                                        {activeContent?.status === 'done' && (
                                            <span className="text-sm text-green-600 bg-green-50 px-2 py-0.5 rounded-full font-medium shrink-0">{activeContent.wordCount.toLocaleString()} 字</span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        {projectId && isContentBlock(activeBlock) && (
                                            (activeContent?.status === 'queued' || activeContent?.status === 'generating') ? (
                                                <div className="flex items-center gap-1.5">
                                                    <button onClick={async () => {
                                                        if (activeBlock) streamControllersRef.current[activeBlock.id]?.abort();
                                                        const taskStorageKey = activeBlock ? getContentTaskKey(activeBlock.id) : '';
                                                        const legacyTaskKey = activeBlock ? `content_task_${activeBlock.id}` : '';
                                                        const taskId = (taskStorageKey && localStorage.getItem(taskStorageKey))
                                                            || (legacyTaskKey && localStorage.getItem(legacyTaskKey));
                                                        if (taskId) {
                                                            await projectService.cancelTask(taskId, projectId || undefined).catch(() => {});
                                                            if (taskStorageKey) localStorage.removeItem(taskStorageKey);
                                                            if (legacyTaskKey) localStorage.removeItem(legacyTaskKey);
                                                        }
                                                        if (activeBlock) {
                                                            const currentState = contentStates[activeBlock.id];
                                                            if (currentState?.previousContent?.trim()) {
                                                                immediatelyPersist({
                                                                    [activeBlock.id]: {
                                                                        ...currentState,
                                                                        status: 'done',
                                                                        content: currentState.previousContent,
                                                                        wordCount: currentState.previousWordCount || countVisibleWords(currentState.previousContent),
                                                                        error: undefined,
                                                                        stage: undefined,
                                                                    },
                                                                });
                                                            } else {
                                                                patchContentState(activeBlock.id, { status: 'cancelled', error: undefined, stage: undefined });
                                                            }
                                                        }
                                                    }}
                                                        className="px-2.5 py-1.5 rounded-lg text-sm font-medium text-gray-500 bg-gray-100 border border-gray-200 hover:bg-gray-200 transition-colors"
                                                    >取消生成</button>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-1.5">
                                                    <button
                                                        onClick={() => {
                                                            if (isLocked || isContentGenerationBusy) return;
                                                            const hasDraft = Boolean(activeContent?.content?.trim());
                                                            if (hasDraft) {
                                                                if (!showConfigBeforeGenerate && activeBlock) {
                                                                    setRegenConfig({
                                                                        instruction: activeBlock.instruction || '',
                                                                        wordCount: activeBlock.expected_word_count || 1500,
                                                                    });
                                                                }
                                                                setShowConfigBeforeGenerate(v => !v);
                                                            } else {
                                                                if (activeBlock) handleGenerateContent(activeBlock);
                                                            }
                                                        }}
                                                        className={clsx('flex items-center gap-1 transition-colors',
                                                            activeContent?.content?.trim()
                                                                ? showConfigBeforeGenerate
                                                                    ? 'text-xs text-sky-600 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded-lg'
                                                                    : 'text-xs text-gray-400 hover:text-sky-600 px-1.5 py-0.5 rounded hover:bg-sky-50'
                                                                : activeContent?.status === 'error'
                                                                    ? 'px-3 py-1.5 rounded-lg text-sm font-medium bg-white border border-amber-200 text-amber-600 hover:bg-amber-50'
                                                                : 'px-3 py-1.5 rounded-lg text-sm font-medium bg-white border border-sky-200 text-sky-700 hover:bg-sky-50')}
                                                        disabled={isLocked || isContentGenerationBusy}
                                                    >
                                                        {activeContent?.content?.trim() ? <><RotateCcw className="w-3 h-3" />{showConfigBeforeGenerate ? '收起配置' : '重新生成'}</>
                                                            : activeContent?.status === 'error' ? <><RefreshCw className="w-3.5 h-3.5" />重试</>
                                                                : <><Sparkles className="w-3.5 h-3.5" />AI 生成</>}
                                                    </button>
                                                </div>
                                            )
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* ── 重新生成配置面板（折叠展开）── */}
                            {showConfigBeforeGenerate && regenConfig && activeBlock && isContentBlock(activeBlock) && (
                                <div className="bg-gradient-to-b from-sky-50 to-white border-b border-sky-100 px-5 py-4 shrink-0 space-y-3">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-xs font-semibold text-sky-700 flex items-center gap-1.5">
                                            <Sparkles className="w-3.5 h-3.5" />本次重生成提示词配置
                                        </span>
                                        <span className="text-xs text-gray-400">仅对本次重新生成有效</span>
                                    </div>

                                    {/* 写作提示词 */}
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 mb-1">补充提示词</label>
                                        <textarea
                                            value={regenConfig.instruction}
                                            onChange={e => setRegenConfig(prev => prev ? { ...prev, instruction: e.target.value } : prev)}
                                            rows={3}
                                            placeholder="描述这次希望调整的方向，例如强化技术细节、压缩空话、突出某项优势..."
                                            className="w-full text-sm text-gray-800 bg-white border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-sky-300 transition-shadow placeholder-gray-300"
                                        />
                                    </div>

                                    {/* 字数 + 按钮行 */}
                                    <div className="flex items-center gap-3">
                                        <div className="flex items-center gap-2">
                                            <label className="text-xs font-medium text-gray-500 whitespace-nowrap">目标字数</label>
                                            <input
                                                type="number"
                                                min={200}
                                                max={10000}
                                                step={100}
                                                value={regenConfig.wordCount}
                                                onChange={e => setRegenConfig(prev => prev ? { ...prev, wordCount: Number(e.target.value) } : prev)}
                                                className="w-24 text-sm text-gray-800 bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-center focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-sky-300 transition-shadow"
                                            />
                                            <span className="text-xs text-gray-400">字</span>
                                        </div>
                                        <div className="flex-1" />
                                        <button
                                            onClick={() => {
                                                setShowConfigBeforeGenerate(false);
                                                setRegenConfig(null);
                                            }}
                                            className="px-3 py-1.5 text-sm text-gray-500 border border-gray-200 bg-white rounded-lg hover:bg-gray-50 transition-colors"
                                        >取消</button>
                                        <button
                                            onClick={() => {
                                                setShowConfigBeforeGenerate(false);
                                                if (activeBlock && regenConfig) {
                                                    handleGenerateContent(activeBlock, {
                                                        instruction: regenConfig.instruction,
                                                        expectedWords: regenConfig.wordCount,
                                                    });
                                                }
                                                setRegenConfig(null);
                                            }}
                                            className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold bg-sky-600 hover:bg-sky-700 text-white rounded-lg shadow-sm transition-colors"
                                            disabled={isLocked || isContentGenerationBusy}
                                        >
                                            <Sparkles className="w-3.5 h-3.5" />确认重新生成
                                        </button>
                                    </div>
                                </div>
                            )}

                            {isGroupBlock(activeBlock) && (
                                <div className="flex-1 overflow-y-auto p-5">
                                    <div className="max-w-4xl mx-auto space-y-4">
                                        <div className="rounded-xl border border-gray-200 bg-white px-5 py-4">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <FolderTree className="w-4 h-4 text-gray-500 shrink-0" />
                                                <h4 className="text-base font-semibold text-gray-900 truncate flex-1">{activeBlock.title}</h4>
                                            </div>
                                            <p className="mt-2 text-xs text-gray-500">
                                                已完成 {activeGroupDoneCount}/{activeGroupChildren.length}，字数 {activeGroupActualWords.toLocaleString()}/{activeGroupTargetWords.toLocaleString()}
                                            </p>
                                        </div>

                                        {activeGroupChildren.length > 0 ? (
                                            <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
                                                <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/70 flex items-center justify-between">
                                                    <h5 className="text-sm font-semibold text-gray-700">本章内容</h5>
                                                    <span className="text-xs text-gray-400">点击任一小节进入正文编辑与生成</span>
                                                </div>
                                                <div className="divide-y divide-gray-100">
                                                    {activeGroupChildren.map((block, index) => {
                                                        const state = contentStates[block.id];
                                                        const statusLabel = state?.status === 'done'
                                                            ? '已完成'
                                                            : state?.status === 'queued'
                                                                ? '排队中'
                                                            : state?.status === 'generating'
                                                                ? '生成中'
                                                                : state?.status === 'cancelled'
                                                                        ? '已取消'
                                                                        : '待生成';
                                                        const statusClass = state?.status === 'done'
                                                            ? 'bg-emerald-50 text-emerald-600'
                                                            : state?.status === 'queued'
                                                                ? 'bg-gray-100 text-gray-500'
                                                            : state?.status === 'generating'
                                                                ? 'bg-sky-50 text-sky-600'
                                                                : state?.status === 'cancelled'
                                                                        ? 'bg-gray-100 text-gray-500'
                                                                        : 'bg-gray-100 text-gray-500';
                                                        return (
                                                            <button
                                                                key={block.id}
                                                                onClick={() => setSelectedBlockId(block.id)}
                                                                className="w-full px-5 py-4 text-left hover:bg-sky-50/60 transition-colors"
                                                            >
                                                                <div className="flex items-center gap-3">
                                                                    <div className="w-7 h-7 rounded-lg bg-gray-100 text-gray-500 flex items-center justify-center text-xs font-semibold shrink-0">
                                                                        {index + 1}
                                                                    </div>
                                                                    <div className="min-w-0 flex-1">
                                                                        <div className="flex items-center gap-2">
                                                                            <p className="truncate text-sm font-medium text-gray-800">{block.title}</p>
                                                                        </div>
                                                                        <div className="mt-1 flex items-center gap-3 text-xs text-gray-400">
                                                                            <span>目标 {Number(block.expected_word_count || 0).toLocaleString()} 字</span>
                                                                            <span>已写 {Number(state?.wordCount || 0).toLocaleString()} 字</span>
                                                                        </div>
                                                                    </div>
                                                                    <span className={clsx('px-2 py-1 rounded-full text-xs font-medium shrink-0', statusClass)}>
                                                                        {statusLabel}
                                                                    </span>
                                                                </div>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-6 py-10 text-center">
                                                <p className="text-sm font-medium text-gray-600">当前章节下暂无内容</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {isContentBlock(activeBlock) && activeContent?.status === 'cancelled' && (
                                <div className="mx-5 mt-3 text-sm text-gray-500 bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg flex items-center gap-2 shrink-0">
                                    <XCircle className="w-3.5 h-3.5 shrink-0" />【已取消】生成已中断
                                    {!isLocked && activeBlock && (
                                        <button
                                            onClick={() => handleGenerateContent(activeBlock)}
                                            disabled={isContentGenerationBusy}
                                            className={clsx(
                                                'ml-auto underline text-xs transition-colors',
                                                isContentGenerationBusy ? 'cursor-not-allowed text-gray-300 no-underline' : 'hover:text-gray-700',
                                            )}
                                        >
                                            重新生成
                                        </button>
                                    )}
                                </div>
                            )}

                            {isContentBlock(activeBlock) && activeContent?.status === 'done' && activeContent.content ? (
                                <div className="flex-1 flex flex-col overflow-hidden">
                                    <div className="flex-1 overflow-hidden">
                                        <ContentEditor
                                            key={`${selectedBlockId}-${showOriginal}`}
                                            content={displayContent}
                                            onChange={handleContentEdit}
                                            readOnly={
                                                isLocked ||
                                                showOriginal ||
                                                isContentGenerationBusy
                                            }
                                            className="h-full"
                                            saveStatus={
                                                saving ? '正在保存...' :
                                                isDirty ? '编辑中...' :
                                                lastSavedAt ? `已保存 ${lastSavedAt}` : undefined
                                            }
                                        />
                                    </div>
                                </div>
                            ) : isContentBlock(activeBlock) && (activeContent?.status === 'queued' || activeContent?.status === 'generating') ? (
                                <div className="flex-1 flex flex-col overflow-hidden">
                                    <TaskLoadingState title={activeContent?.status === 'queued' ? '任务排队中' : activeContentGeneratingLabel} />
                                </div>
                            ) : isContentBlock(activeBlock) ? (
                                <div className="flex-1 flex flex-col items-center justify-center text-gray-300 gap-4 p-8">
                                    <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
                                        <Sparkles className="w-8 h-8 text-gray-300" />
                                    </div>
                                    <p className="text-sm font-medium text-gray-500 mb-1">点击 "AI 生成" 开始撰写</p>
                                </div>
                            ) : null}
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
                            <FolderTree className="w-10 h-10 mb-3 text-gray-300" />
                            <p className="text-sm">在左侧选择一个章节开始编辑</p>
                        </div>
                    )}
                </div>

                {/* 3. 右侧：PDF 侧边栏（仿解析报告） */}
                {pdfUrl && (
                    <div className={`flex shrink-0 border-l border-gray-200 transition-all duration-200 ${showPdf ? 'w-[46%] min-w-[360px] max-w-[620px]' : 'w-8'}`}>
                        <button
                            onClick={() => setShowPdf(!showPdf)}
                            className="w-8 shrink-0 bg-gray-50 hover:bg-sky-50 border-r border-gray-200 flex flex-col items-center justify-center gap-2 transition-colors group"
                            title={showPdf ? '收起原文' : '展开查看原始招标文件'}
                        >
                            {showPdf
                                ? <PanelRightClose className="w-3.5 h-3.5 text-gray-400 group-hover:text-sky-600" />
                                : <PanelRightOpen className="w-3.5 h-3.5 text-gray-400 group-hover:text-sky-600" />
                            }
                            <span
                                className="text-xs text-gray-400 group-hover:text-sky-600"
                                style={{ writingMode: 'vertical-rl', letterSpacing: '0.05em' }}
                            >
                                招标文件原文
                            </span>
                        </button>
                        {showPdf && (
                            <div className="flex-1 bg-gray-100 flex flex-col min-w-0">
                                <div className="px-3 py-2 bg-white border-b border-gray-200 shrink-0">
                                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">原始招标文件</p>
                                </div>
                                <ProtectedIframe
                                    src={`${pdfUrl}#pagemode=none`}
                                    className="flex-1 w-full border-0"
                                    title="招标文件预览"
                                />
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* ── 一键生成全部：确认弹窗 ── */}
            {showGenerateAllConfirm && template && (() => {
                const proj = projectId ? projectService.getById(projectId) : null;
                const bidderOk = !!(proj?.bidderInfo?.orgName);
                return (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
                            <div className="px-6 pt-6 pb-4 border-b border-gray-100">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-sky-600 flex items-center justify-center shrink-0">
                                        <Sparkles className="w-5 h-5 text-white" />
                                    </div>
                                    <div>
                                        <h3 className="text-base font-bold text-gray-900">一键生成全部章节</h3>
                                        <p className="text-sm text-gray-500 mt-0.5">系统会按目录顺序生成，并逐节点回填正文</p>
                                    </div>
                                </div>
                            </div>
                            <div className="px-6 py-4 space-y-3">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-gray-600">待生成章节</span>
                                    <span className="font-semibold text-gray-900">{contentBlocks.length} 个章节</span>
                                </div>
                                <div className={clsx('flex items-center gap-2 px-3 py-2 rounded-lg text-sm',
                                    bidderOk ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700')}>
                                    {bidderOk
                                        ? <><CheckCircle2 className="w-3.5 h-3.5 shrink-0" />投标人信息已配置</>
                                        : <><AlertCircle className="w-3.5 h-3.5 shrink-0" />投标人信息未配置</>}
                                </div>
                                <p className="text-sm text-gray-400">单章节失败将自动跳过，不影响其余章节。</p>
                            </div>
                            <div className="px-6 pb-6 flex gap-3">
                                <button onClick={() => setShowGenerateAllConfirm(false)}
                                    className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors">取消</button>
                                <button onClick={handleGenerateAll}
                                    className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 transition-all shadow-sm hover:shadow-md">开始生成</button>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}
