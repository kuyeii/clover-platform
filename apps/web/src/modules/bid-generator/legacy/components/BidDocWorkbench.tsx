import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
    SortableContext,
    arrayMove,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
    Eye,
    EyeOff,
    FileStack,
    FolderTree,
    GripVertical,
    Loader2,
} from 'lucide-react';
import clsx from 'clsx';
import { renderAsync } from 'docx-preview';
import type { BidAttachmentItem, BidModule, DocBlockItem, Project } from '../services/projectService';
import {
    bidAttachmentService,
    projectService,
    syncBidModulesForProject,
} from '../services/projectService';
import { resolveVersionContent } from '../utils/bidExport';
import { AttachmentAnchorCanvas, type AttachmentMaskRange } from './AttachmentAnchorCanvas';
import { CONTENT_PREVIEW_PROSE_CLASS, renderContentToHtml } from './ContentEditor';

interface Props {
    project: Project;
    onRefresh: () => void;
    onNextStep?: () => void;
    isLocked?: boolean;
}

type ModuleGroupKey = 'attachments' | 'technical' | 'business';

type PreviewCacheEntry = {
    html: string;
    startBlockId: string;
    endBlockId: string;
    snapshotOnly: boolean;
    docxBlob: Blob | null;
};

type SelectedAttachmentRange = {
    moduleId: string;
    startBlockId: string;
    endBlockId: string;
};

interface SortableModuleRowProps {
    module: BidModule;
    active: boolean;
    extracting: boolean;
    locked: boolean;
    onToggleVisible: (id: string) => void;
    onSelect: (id: string) => void;
}

function isAttachmentModule(module: BidModule | null | undefined): boolean {
    return (module?.moduleKind || '') === 'attachment';
}

function isTechnicalModule(module: BidModule | null | undefined): boolean {
    return (module?.moduleKind || '') === 'technical';
}

function isBusinessModule(module: BidModule | null | undefined): boolean {
    return (module?.moduleKind || '') === 'business';
}

function toAttachment(module: BidModule): BidAttachmentItem | null {
    if (!module.locatorStart || !module.locatorEnd) return null;
    return {
        name: module.sourceAttachmentName || module.name,
        start_locator: module.locatorStart,
        end_locator: module.locatorEnd,
    };
}

function moduleKindLabel(module: BidModule): string {
    if (isAttachmentModule(module)) return '附件';
    if (isTechnicalModule(module)) return '技术部分';
    if (isBusinessModule(module)) return '商务部分';
    return '结构节点';
}

function buildPreviewKey(moduleId: string, startBlockId: string, endBlockId: string): string {
    return `${moduleId}:${startBlockId}:${endBlockId}`;
}

function formatFallbackSectionTitle(value: string): string {
    const match = /^sec_(\d+)_(\d+)$/i.exec(String(value || '').trim());
    if (!match) return value;
    return `章节 ${match[1]}.${match[2]}`;
}

function stripDisplayNumbering(value: string): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return raw.replace(
        /^(?:[一二三四五六七八九十百千万]+、|\d+(?:\.\d+){0,3}\s+|\d+(?:\.\d+){0,3}|（[一二三四五六七八九十百千万]+）|\([一二三四五六七八九十百千万]+\))\s*/,
        '',
    ).trim();
}

function SortableModuleRow({
    module,
    active,
    extracting,
    locked,
    onToggleVisible,
    onSelect,
}: SortableModuleRowProps) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: module.id,
        disabled: locked,
    });

    return (
        <div
            ref={setNodeRef}
            style={{
                transform: CSS.Transform.toString(transform),
                transition,
                zIndex: isDragging ? 20 : undefined,
            }}
            className={clsx(
                'px-3 py-2 transition',
                active ? 'bg-sky-50' : 'bg-white',
                !module.enabled && 'opacity-60',
                isDragging && 'shadow-sm ring-1 ring-sky-200',
            )}
        >
            <div className="flex items-start gap-2">
                <button
                    type="button"
                    {...attributes}
                    {...listeners}
                    disabled={locked}
                    className={clsx(
                        'mt-0.5 p-0.5 rounded touch-none',
                        locked ? 'cursor-not-allowed text-gray-200' : 'cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500',
                    )}
                    title={locked ? '当前已锁定，无法调整顺序' : '拖拽调整顺序'}
                >
                    <GripVertical className="w-4 h-4" />
                </button>
                <button
                    type="button"
                    disabled={locked}
                    onClick={() => onToggleVisible(module.id)}
                    className={clsx(
                        'mt-0.5 p-0.5 rounded transition-colors',
                        module.enabled
                            ? 'text-gray-500 hover:text-orange-500 hover:bg-orange-50'
                            : 'text-gray-300 hover:text-emerald-500 hover:bg-emerald-50',
                        locked && 'opacity-50 cursor-not-allowed',
                    )}
                    title={module.enabled ? '点击隐藏（导出时不包含）' : '点击显示（导出时包含）'}
                >
                    {module.enabled ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
                <button
                    type="button"
                    onClick={() => onSelect(module.id)}
                    className="flex-1 min-w-0 text-left"
                >
                    <p className={clsx('truncate text-sm font-medium', module.enabled ? 'text-gray-800' : 'text-gray-500')}>
                        {module.name}
                    </p>
                    {extracting ? (
                        <p className="mt-1 inline-flex items-center gap-1 text-xs text-sky-600">
                            <Loader2 className="h-3 w-3 animate-spin" /> 正在拉取原文切片
                        </p>
                    ) : null}
                </button>
            </div>
        </div>
    );
}

export function BidDocWorkbench({ project, onRefresh, onNextStep, isLocked = false }: Props) {
    const [modules, setModules] = useState<BidModule[]>([]);
    const [activeModuleId, setActiveModuleId] = useState<string | null>(null);
    const [extractingId, setExtractingId] = useState<string | null>(null);
    const [previewing, setPreviewing] = useState(false);
    const [docBlocks, setDocBlocks] = useState<DocBlockItem[]>([]);
    const [blocksLoading, setBlocksLoading] = useState(false);
    const [selectedAttachmentRange, setSelectedAttachmentRange] = useState<SelectedAttachmentRange | null>(null);
    const [previewHtml, setPreviewHtml] = useState('');
    const [previewSnapshotOnly, setPreviewSnapshotOnly] = useState(false);
    const [previewDocxBlob, setPreviewDocxBlob] = useState<Blob | null>(null);
    const [previewKey, setPreviewKey] = useState('');
    const [persistingLocator, setPersistingLocator] = useState(false);
    const [snapshotOnly, setSnapshotOnly] = useState(false);
    const [focusRequestSeq, setFocusRequestSeq] = useState(0);

    const autoExtractingRef = useRef(false);
    const modulesRef = useRef<BidModule[]>([]);
    const styledPreviewDocxRef = useRef<HTMLDivElement | null>(null);
    const previewCacheRef = useRef(new Map<string, PreviewCacheEntry>());
    const previewRequestIdRef = useRef(0);

    useEffect(() => {
        previewCacheRef.current.clear();
    }, [project.id]);

    const persistModules = useCallback((updated: BidModule[], extraPatch?: Partial<Project>) => {
        setModules(updated);
        modulesRef.current = updated;
        projectService.update(project.id, { bidModules: updated, ...extraPatch });
    }, [project.id]);

    const refreshDocBlocks = useCallback(async (applyState = true) => {
        const { blocks, snapshotOnly: isSnapshotOnly } = await bidAttachmentService.getDocBlocks(project.id);
        if (applyState) {
            setDocBlocks(blocks);
            setSnapshotOnly(isSnapshotOnly);
        }
        return { blocks, snapshotOnly: isSnapshotOnly };
    }, [project.id]);

    useEffect(() => {
        const nextModules = syncBidModulesForProject(project, project.bidModules);
        const localById = new Map((modulesRef.current || []).map((module) => [module.id, module]));
        const mergedModules = nextModules.map((incoming) => {
            const local = localById.get(incoming.id);
            if (!local) return incoming;
            return {
                ...incoming,
                startBlockId: local.startBlockId || incoming.startBlockId,
                endBlockId: local.endBlockId || incoming.endBlockId,
                locatorStart: local.locatorStart || incoming.locatorStart,
                locatorEnd: local.locatorEnd || incoming.locatorEnd,
                templateContent: local.templateContent || incoming.templateContent,
                filledContent: local.filledContent ?? incoming.filledContent,
                fillStatus: local.fillStatus || incoming.fillStatus,
            };
        });
        setModules(mergedModules);
        modulesRef.current = mergedModules;
        if (!activeModuleId || !mergedModules.some((item) => item.id === activeModuleId)) {
            setActiveModuleId(mergedModules[0]?.id || null);
        }
    }, [project, activeModuleId]);

    useEffect(() => {
        let cancelled = false;
        setBlocksLoading(true);
        refreshDocBlocks(false)
            .then(({ blocks, snapshotOnly: isSnapshotOnly }) => {
                if (cancelled) return;
                setDocBlocks(blocks);
                setSnapshotOnly(isSnapshotOnly);
            })
            .catch(() => {
                if (!cancelled) {
                    setDocBlocks([]);
                    setSnapshotOnly(false);
                }
            })
            .finally(() => {
                if (!cancelled) setBlocksLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [project.id, project.analysisV2?.schema_version, refreshDocBlocks]);

    useEffect(() => {
        setExtractingId(null);
        autoExtractingRef.current = false;
    }, [project.id]);

    useEffect(() => {
        if (blocksLoading || docBlocks.length === 0 || autoExtractingRef.current) return;
        const currentModules = modulesRef.current;
        const emptyExtracted = currentModules.filter((item) => {
            if (!isAttachmentModule(item)) return false;
            if (item.templateContent || item.filledContent) return false;
            return Boolean((item.startBlockId && item.endBlockId) || (item.locatorStart && item.locatorEnd));
        });
        if (!emptyExtracted.length) return;

        autoExtractingRef.current = true;
        let cancelled = false;

        (async () => {
            let working = currentModules;
            let changed = false;
            for (const module of emptyExtracted) {
                if (cancelled) return;
                setExtractingId(module.id);
                try {
                    let html = '';
                    let resolvedStartLocator = module.locatorStart || '';
                    let resolvedEndLocator = module.locatorEnd || '';
                    if (module.startBlockId && module.endBlockId) {
                        const byBlock = await bidAttachmentService.extractContentByBlocks(project.id, {
                            attachmentName: module.sourceAttachmentName || module.name,
                            startBlockId: module.startBlockId,
                            endBlockId: module.endBlockId,
                        });
                        html = byBlock.html;
                    } else {
                        const item = toAttachment(module);
                        if (!item) continue;
                        const byLocator = await bidAttachmentService.extractContent(project.id, item);
                        html = byLocator.html;
                        resolvedStartLocator = byLocator.resolvedStartLocator;
                        resolvedEndLocator = byLocator.resolvedEndLocator;
                    }
                    if (cancelled) return;
                    working = working.map((row) => row.id === module.id ? {
                        ...row,
                        templateContent: html,
                        fillStatus: 'partial' as const,
                        locatorStart: resolvedStartLocator,
                        locatorEnd: resolvedEndLocator,
                    } : row);
                    changed = true;
                } catch (error) {
                    console.warn('[BidDocWorkbench] 自动提取失败:', module.name, error);
                } finally {
                    setExtractingId(null);
                }
            }
            if (cancelled) return;
            if (changed) {
                persistModules(working);
                onRefresh();
            }
            autoExtractingRef.current = false;
        })();

        return () => {
            cancelled = true;
        };
    }, [blocksLoading, docBlocks.length, onRefresh, persistModules, project.id]);

    const activeModule = useMemo(
        () => modules.find((module) => module.id === activeModuleId) || null,
        [modules, activeModuleId],
    );
    const moduleById = useMemo(
        () => new Map(modules.map((module) => [module.id, module])),
        [modules],
    );
    const selectedStartBlockId = selectedAttachmentRange?.startBlockId || null;
    const selectedEndBlockId = selectedAttachmentRange?.endBlockId || null;

    const isAttachmentActive = Boolean(activeModule && isAttachmentModule(activeModule));
    const isTechnicalActive = Boolean(activeModule && isTechnicalModule(activeModule));

    const moduleTree = useMemo(() => ({
        attachments: modules.filter((module) => isAttachmentModule(module)),
        technical: modules.filter((module) => isTechnicalModule(module)),
        business: modules.filter((module) => isBusinessModule(module)),
    }), [modules]);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    const linkedOutlineSections = useMemo(() => {
        if (!activeModule?.linkedSections?.length) return [];
        const outlineMap = new Map<string, { id: string; title: string }>();
        for (const sec of project.outline || []) {
            outlineMap.set(sec.id, { id: sec.id, title: sec.title });
            for (const child of sec.children || []) {
                outlineMap.set(child.id, { id: child.id, title: child.title });
                for (const third of child.children || []) {
                    outlineMap.set(third.id, { id: third.id, title: third.title });
                }
            }
        }
        return activeModule.linkedSections.map((id) => {
            const state = project.generatedContent?.[id];
            const content = resolveVersionContent(state).trim();
            return {
                id,
                title: outlineMap.get(id)?.title || formatFallbackSectionTitle(id),
                content,
                done: state?.status === 'done' && Boolean(content),
            };
        });
    }, [activeModule, project.generatedContent, project.outline]);

    const technicalPreviewIntroHtml = useMemo(() => {
        if (!activeModule || !isTechnicalModule(activeModule)) return '';
        return renderContentToHtml((activeModule.filledContent || activeModule.templateContent || '').trim());
    }, [activeModule]);

    const locatorToBlockId = useMemo(() => {
        const map = new Map<string, string>();
        for (const block of docBlocks) {
            map.set((block.locator || '').toUpperCase(), block.block_id);
        }
        return map;
    }, [docBlocks]);

    const blockById = useMemo(() => {
        const map = new Map<string, DocBlockItem>();
        for (const block of docBlocks) {
            map.set(block.block_id, block);
        }
        return map;
    }, [docBlocks]);

    const blockIndexMap = useMemo(() => {
        const map = new Map<string, number>();
        docBlocks.forEach((block, idx) => map.set(block.block_id, idx));
        return map;
    }, [docBlocks]);

    const resolveModuleBlockRange = useCallback((module: BidModule | null): { startBlockId: string; endBlockId: string } | null => {
        if (!module || !isAttachmentModule(module)) return null;
        const startBlockId = module.startBlockId || locatorToBlockId.get((module.locatorStart || '').toUpperCase()) || '';
        const endBlockId = module.endBlockId || locatorToBlockId.get((module.locatorEnd || '').toUpperCase()) || '';
        if (!startBlockId || !endBlockId) return null;
        const startIndex = blockIndexMap.get(startBlockId);
        const endIndex = blockIndexMap.get(endBlockId);
        if (startIndex === undefined || endIndex === undefined) return null;
        return startIndex <= endIndex
            ? { startBlockId, endBlockId }
            : { startBlockId: endBlockId, endBlockId: startBlockId };
    }, [blockIndexMap, locatorToBlockId]);

    const clearPreview = useCallback(() => {
        previewRequestIdRef.current += 1;
        setPreviewKey('');
        setPreviewHtml('');
        setPreviewSnapshotOnly(false);
        setPreviewDocxBlob(null);
        setPreviewing(false);
    }, []);

    const refreshAttachmentPreview = useCallback(async (
        module: BidModule,
        startBlockId: string,
        endBlockId: string,
    ) => {
        const key = buildPreviewKey(module.id, startBlockId, endBlockId);
        const cached = previewCacheRef.current.get(key);

        setPreviewKey(key);
        if (cached) {
            setPreviewHtml(cached.html);
            setPreviewSnapshotOnly(Boolean(cached.snapshotOnly));
            setPreviewDocxBlob(cached.docxBlob || null);
            if (cached.html && cached.docxBlob) {
                setPreviewing(false);
                return;
            }
        } else {
            setPreviewHtml('');
            setPreviewSnapshotOnly(false);
            setPreviewDocxBlob(null);
        }

        const requestId = previewRequestIdRef.current + 1;
        previewRequestIdRef.current = requestId;
        setPreviewing(true);

        const htmlPromise = cached?.html
            ? Promise.resolve({
                html: cached.html,
                startBlockId: cached.startBlockId,
                endBlockId: cached.endBlockId,
                snapshotOnly: Boolean(cached.snapshotOnly),
            })
            : bidAttachmentService.extractContentByBlocks(project.id, {
                attachmentName: module.sourceAttachmentName || module.name,
                startBlockId,
                endBlockId,
            });

        const docxPromise = cached?.docxBlob
            ? Promise.resolve(cached.docxBlob)
            : bidAttachmentService.extractDocxByBlocks(project.id, {
                attachmentName: module.sourceAttachmentName || module.name,
                startBlockId,
                endBlockId,
            });

        const [htmlResult, docxResult] = await Promise.allSettled([htmlPromise, docxPromise]);
        if (previewRequestIdRef.current !== requestId) return;

        const nextEntry: PreviewCacheEntry = {
            html: cached?.html || '',
            startBlockId,
            endBlockId,
            snapshotOnly: Boolean(cached?.snapshotOnly),
            docxBlob: cached?.docxBlob || null,
        };

        if (htmlResult.status === 'fulfilled') {
            nextEntry.html = htmlResult.value.html;
            nextEntry.startBlockId = htmlResult.value.startBlockId;
            nextEntry.endBlockId = htmlResult.value.endBlockId;
            nextEntry.snapshotOnly = Boolean(htmlResult.value.snapshotOnly);
            setPreviewHtml(htmlResult.value.html);
            setPreviewSnapshotOnly(Boolean(htmlResult.value.snapshotOnly));
        } else {
            console.error('[BidDocWorkbench] 附件 HTML 预览失败:', htmlResult.reason);
        }

        if (docxResult.status === 'fulfilled') {
            nextEntry.docxBlob = docxResult.value;
            setPreviewDocxBlob(docxResult.value);
        } else {
            console.warn('[BidDocWorkbench] 附件 DOCX 样式预览降级为 HTML:', docxResult.reason);
            setPreviewDocxBlob(null);
        }

        previewCacheRef.current.set(key, nextEntry);
        setPreviewing(false);
    }, [project.id]);

    useEffect(() => {
        if (!activeModule || !isAttachmentModule(activeModule)) {
            setSelectedAttachmentRange(null);
            clearPreview();
            return;
        }
        const range = resolveModuleBlockRange(activeModule);
        setSelectedAttachmentRange(range ? {
            moduleId: activeModule.id,
            startBlockId: range.startBlockId,
            endBlockId: range.endBlockId,
        } : null);
        if (!range) {
            clearPreview();
            return;
        }
        void refreshAttachmentPreview(activeModule, range.startBlockId, range.endBlockId);
    }, [
        activeModule?.id,
        activeModule?.startBlockId,
        activeModule?.endBlockId,
        activeModule?.locatorStart,
        activeModule?.locatorEnd,
        clearPreview,
        refreshAttachmentPreview,
        resolveModuleBlockRange,
    ]);

    useEffect(() => {
        if (!styledPreviewDocxRef.current) return;
        if (!previewDocxBlob) {
            styledPreviewDocxRef.current.innerHTML = '';
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const buffer = await previewDocxBlob.arrayBuffer();
                if (cancelled || !styledPreviewDocxRef.current) return;
                styledPreviewDocxRef.current.innerHTML = '';
                await renderAsync(buffer, styledPreviewDocxRef.current, undefined, {
                    className: 'docx',
                    inWrapper: true,
                    ignoreWidth: false,
                    ignoreHeight: false,
                    ignoreLastRenderedPageBreak: false,
                });
            } catch (error) {
                if (!cancelled) {
                    console.error('[BidDocWorkbench] DOCX 切片渲染失败:', error);
                    if (styledPreviewDocxRef.current) styledPreviewDocxRef.current.innerHTML = '';
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [previewDocxBlob, previewKey]);

    const handleToggleEnabled = useCallback((moduleId: string) => {
        if (isLocked) return;
        const updated = modules.map((item) => item.id === moduleId ? { ...item, enabled: !item.enabled } : item);
        persistModules(updated);
        onRefresh();
    }, [isLocked, modules, onRefresh, persistModules]);

    const handleSelectModule = useCallback((moduleId: string) => {
        const nextModule = moduleById.get(moduleId) || null;
        const nextRange = resolveModuleBlockRange(nextModule);
        setSelectedAttachmentRange(nextRange ? {
            moduleId,
            startBlockId: nextRange.startBlockId,
            endBlockId: nextRange.endBlockId,
        } : null);
        setActiveModuleId(moduleId);
        setFocusRequestSeq((value) => value + 1);
    }, [moduleById, resolveModuleBlockRange]);

    const handleGroupDragEnd = useCallback((group: ModuleGroupKey, event: DragEndEvent) => {
        if (isLocked) return;
        const { active, over } = event;
        if (!over || active.id === over.id) return;

        const currentGroupItems = group === 'attachments'
            ? moduleTree.attachments
            : group === 'technical'
                ? moduleTree.technical
                : moduleTree.business;
        const oldIndex = currentGroupItems.findIndex((item) => item.id === String(active.id));
        const newIndex = currentGroupItems.findIndex((item) => item.id === String(over.id));
        if (oldIndex < 0 || newIndex < 0) return;

        const moved = arrayMove(currentGroupItems, oldIndex, newIndex);
        const nextAttachments = group === 'attachments' ? moved : moduleTree.attachments;
        const nextTechnical = group === 'technical' ? moved : moduleTree.technical;
        const nextBusiness = group === 'business' ? moved : moduleTree.business;
        const reordered = [...nextAttachments, ...nextTechnical, ...nextBusiness].map((item, idx) => ({
            ...item,
            order: idx,
        }));
        persistModules(reordered);
        onRefresh();
    }, [isLocked, moduleTree.attachments, moduleTree.business, moduleTree.technical, onRefresh, persistModules]);

    const handleAttachmentRangeChange = useCallback((range: { startBlockId: string; endBlockId: string }) => {
        if (!activeModule || !isAttachmentModule(activeModule)) return;
        setSelectedAttachmentRange({
            moduleId: activeModule.id,
            startBlockId: range.startBlockId,
            endBlockId: range.endBlockId,
        });
    }, [activeModule]);

    const persistAttachmentLocatorRange = useCallback(async (
        module: BidModule,
        startBlockId: string,
        endBlockId: string,
        nextPreviewHtml?: string,
    ) => {
        const startBlock = blockById.get(startBlockId);
        const endBlock = blockById.get(endBlockId);
        const latest = projectService.getById(project.id) || project;

        const updatedModules = modules.map((item) => item.id === module.id ? {
            ...item,
            startBlockId,
            endBlockId,
            locatorStart: startBlock?.locator || item.locatorStart,
            locatorEnd: endBlock?.locator || item.locatorEnd,
            templateContent: nextPreviewHtml || item.templateContent,
            fillStatus: (nextPreviewHtml || item.templateContent) ? 'partial' as const : 'unfilled' as const,
        } : item);

        const updatedAnalysisV2 = latest.analysisV2?.schema_version ? {
            ...latest.analysisV2,
            bid_structure: {
                ...latest.analysisV2.bid_structure,
                attachments: latest.analysisV2.bid_structure.attachments.map((item) => {
                    if (item.id !== module.structureHeadingId) return item;
                    return {
                        ...item,
                        start_block_id: startBlockId,
                        end_block_id: endBlockId,
                        start_locator: startBlock?.locator || item.start_locator,
                        end_locator: endBlock?.locator || item.end_locator,
                    };
                }),
            },
        } : latest.analysisV2;

        const updatedAttachmentList = (latest.bidAttachmentList || []).map((item) => {
            const sameAttachment = (item.name || '').trim() === (module.sourceAttachmentName || module.name).trim();
            if (!sameAttachment) return item;
            return {
                ...item,
                start_locator: startBlock?.locator || item.start_locator,
                end_locator: endBlock?.locator || item.end_locator,
                start_block_id: startBlockId,
                end_block_id: endBlockId,
            };
        });

        setPersistingLocator(true);
        try {
            await projectService.updateAndPersist(project.id, {
                bidModules: updatedModules,
                analysisV2: updatedAnalysisV2,
                bidAttachmentList: updatedAttachmentList,
            });
            setModules(updatedModules);
            modulesRef.current = updatedModules;
        } catch (error) {
            console.error('[BidDocWorkbench] 锚点持久化失败:', error);
        } finally {
            setPersistingLocator(false);
        }

        onRefresh();
    }, [blockById, modules, onRefresh, project]);

    const handleAttachmentRangeCommit = useCallback(async (range: { startBlockId: string; endBlockId: string }) => {
        if (isLocked || !activeModule || !isAttachmentModule(activeModule)) return;
        setSelectedAttachmentRange({
            moduleId: activeModule.id,
            startBlockId: range.startBlockId,
            endBlockId: range.endBlockId,
        });
        await refreshAttachmentPreview(activeModule, range.startBlockId, range.endBlockId);
        const previewKey = buildPreviewKey(activeModule.id, range.startBlockId, range.endBlockId);
        const cached = previewCacheRef.current.get(previewKey);
        await persistAttachmentLocatorRange(
            activeModule,
            range.startBlockId,
            range.endBlockId,
            cached?.html || '',
        );
    }, [activeModule, isLocked, persistAttachmentLocatorRange, refreshAttachmentPreview]);

    const attachmentMaskRanges = useMemo(() => {
        if (!docBlocks.length) return [];
        const ranges: AttachmentMaskRange[] = [];
        for (const module of moduleTree.attachments) {
            const active = module.id === activeModuleId;
            const range = selectedAttachmentRange?.moduleId === module.id
                ? {
                    startBlockId: selectedAttachmentRange.startBlockId,
                    endBlockId: selectedAttachmentRange.endBlockId,
                }
                : resolveModuleBlockRange(module);
            if (!range) continue;
            const startIndex = blockIndexMap.get(range.startBlockId);
            const endIndex = blockIndexMap.get(range.endBlockId);
            if (startIndex === undefined || endIndex === undefined) continue;
            ranges.push({
                moduleId: module.id,
                label: module.name,
                startBlockId: range.startBlockId,
                endBlockId: range.endBlockId,
                startIndex: Math.min(startIndex, endIndex),
                endIndex: Math.max(startIndex, endIndex),
                active,
            });
        }
        return ranges;
    }, [
        activeModuleId,
        blockIndexMap,
        docBlocks.length,
        moduleTree.attachments,
        resolveModuleBlockRange,
        selectedAttachmentRange,
    ]);

    const enabledCount = modules.filter((module) => module.enabled).length;

    return (
        <div className="flex h-full bg-gray-50">
            <div className="flex w-[22rem] flex-col border-r border-gray-200 bg-white">
                <div className="space-y-3 border-b border-gray-100 px-4 py-4">
                    <div className="flex min-w-0 items-center gap-2.5">
                        <div className="rounded-lg bg-indigo-50 p-1.5">
                            <FileStack className="h-4 w-4 text-indigo-600" />
                        </div>
                        <div className="min-w-0">
                            <h2 className="text-base font-bold text-gray-900">投标文件编排</h2>
                            <p className="mt-0.5 text-sm text-gray-500">
                                {enabledCount} 个启用节点
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex-1 space-y-2 overflow-y-auto p-3">
                    {modules.length === 0 ? (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-700">
                            当前项目还没有生成可编排的招标书结构。请先完成解析报告中的“招标书结构”解析。
                        </div>
                    ) : null}
                    {[
                        { key: 'attachments', label: '附件部分', items: moduleTree.attachments },
                        { key: 'technical', label: '技术部分', items: moduleTree.technical },
                        { key: 'business', label: '商务部分', items: moduleTree.business },
                    ].map((group) => (
                        <div key={group.key} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                            <div className="border-b border-gray-100 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-600">
                                {group.label}
                            </div>
                            <div className="divide-y divide-gray-100">
                                {group.items.length === 0 ? (
                                    <div className="px-3 py-2 text-xs text-gray-400">暂无节点</div>
                                ) : (
                                    <DndContext
                                        sensors={sensors}
                                        collisionDetection={closestCenter}
                                        onDragEnd={(event) => handleGroupDragEnd(group.key as ModuleGroupKey, event)}
                                    >
                                        <SortableContext
                                            items={group.items.map((item) => item.id)}
                                            strategy={verticalListSortingStrategy}
                                        >
                                            {group.items.map((module) => (
                                                <SortableModuleRow
                                                    key={module.id}
                                                    module={module}
                                                    active={activeModuleId === module.id}
                                                    extracting={extractingId === module.id}
                                                    locked={isLocked}
                                                    onToggleVisible={handleToggleEnabled}
                                                    onSelect={handleSelectModule}
                                                />
                                            ))}
                                        </SortableContext>
                                    </DndContext>
                                )}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="border-t border-gray-100 px-3 py-3">
                    {onNextStep ? (
                        <button
                            onClick={onNextStep}
                            className="w-full rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-700"
                        >
                            下一步：导出
                        </button>
                    ) : null}
                </div>
            </div>

            <div className="flex min-w-0 flex-1 flex-col">
                {!activeModule ? (
                    <div className="flex flex-1 items-center justify-center text-gray-400">请选择左侧结构节点</div>
                ) : (
                    <>
                        <div className="border-b border-gray-200 bg-white px-5 py-3">
                            <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <h3 className="truncate text-base font-bold text-gray-900">{activeModule.name}</h3>
                                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">
                                            {moduleKindLabel(activeModule)}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className={clsx('flex-1 min-h-0 bg-gray-50/60 p-4', !isAttachmentActive && 'hidden')}>
                            <div className="flex h-full flex-col gap-3">
                                {snapshotOnly && docBlocks.length > 0 ? (
                                    <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
                                        当前为块索引快照降级模式，可继续调整锚点，但表格、图片和部分样式可能不完整。
                                    </div>
                                ) : null}

                                <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(220px,3fr)_minmax(0,7fr)]">
                                    <div className="flex min-h-0 flex-col rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
                                        <div className="mb-3 flex items-center justify-between px-1">
                                            <div>
                                                <p className="text-base font-bold text-gray-900">附件内容编辑</p>
                                            </div>
                                            {persistingLocator ? (
                                                <div className="inline-flex items-center gap-1.5 text-xs text-sky-600">
                                                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> 自动保存中
                                                </div>
                                            ) : previewing ? (
                                                <div className="inline-flex items-center gap-1.5 text-xs text-sky-600">
                                                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> 预览待刷新
                                                </div>
                                            ) : null}
                                        </div>
                                        <AttachmentAnchorCanvas
                                            blocks={docBlocks}
                                            blocksLoading={blocksLoading}
                                            ranges={attachmentMaskRanges}
                                            activeRange={selectedStartBlockId && selectedEndBlockId
                                                ? { startBlockId: selectedStartBlockId, endBlockId: selectedEndBlockId }
                                                : null}
                                            focusBlockId={selectedStartBlockId}
                                            focusRequestKey={`${activeModuleId || 'none'}:${selectedStartBlockId || 'none'}:${focusRequestSeq}`}
                                            isLocked={isLocked}
                                            onSelectModule={handleSelectModule}
                                            onRangeChange={handleAttachmentRangeChange}
                                            onRangeCommit={handleAttachmentRangeCommit}
                                        />
                                    </div>

                                    <div className="flex min-h-0 flex-col rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
                                        <div className="mb-3 flex items-center justify-between px-1">
                                            <div>
                                                <p className="text-base font-bold text-gray-900">实时样式预览</p>
                                            </div>
                                            {previewSnapshotOnly ? (
                                                <span className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700">
                                                    快照降级
                                                </span>
                                            ) : null}
                                        </div>
                                        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 bg-slate-50/50">
                                            {previewing ? (
                                                <div className="flex h-full items-center justify-center text-sm text-gray-500">
                                                    <span className="inline-flex items-center gap-2">
                                                        <Loader2 className="h-4 w-4 animate-spin" /> 正在刷新样式预览
                                                    </span>
                                                </div>
                                            ) : !selectedStartBlockId || !selectedEndBlockId ? (
                                                <div className="flex h-full items-center justify-center px-6 text-center text-sm text-gray-500">
                                                    当前附件尚未绑定有效切片范围。
                                                </div>
                                            ) : (
                                                <div className="h-full overflow-y-auto px-4 py-4">
                                                    <div ref={styledPreviewDocxRef} />
                                                    {!previewDocxBlob && previewHtml ? (
                                                        <div
                                                            className="prose prose-sm max-w-none text-gray-700"
                                                            dangerouslySetInnerHTML={{ __html: previewHtml }}
                                                        />
                                                    ) : !previewDocxBlob ? (
                                                        <div className="text-sm text-gray-500">当前锚点范围暂无可预览内容。</div>
                                                    ) : null}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className={clsx('flex-1 overflow-y-auto bg-gray-50/60 p-6', !isTechnicalActive && 'hidden')}>
                            <div className="max-w-4xl space-y-4">
                                {technicalPreviewIntroHtml ? (
                                    <div className="rounded-xl border border-gray-200 bg-white">
                                        <div
                                            className={`${CONTENT_PREVIEW_PROSE_CLASS} px-5 py-4`}
                                            dangerouslySetInnerHTML={{ __html: technicalPreviewIntroHtml }}
                                        />
                                    </div>
                                ) : null}
                                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white divide-y divide-gray-100">
                                    {activeModule.linkedSections?.length ? (
                                        activeModule.linkedSections.map((sectionId) => {
                                            const item = linkedOutlineSections.find((row) => row.id === sectionId);
                                            return (
                                                <div key={sectionId} className="px-5 py-4">
                                                    <div className="flex items-center justify-between gap-3">
                                                        <h4 className="text-sm font-semibold text-gray-900">
                                                            {stripDisplayNumbering(item?.title || sectionId)}
                                                        </h4>
                                                        <span className={clsx(
                                                            'shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold',
                                                            item?.done ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500',
                                                        )}>
                                                            {item?.done ? '已生成' : '未生成'}
                                                        </span>
                                                    </div>
                                                    {item?.content ? (
                                                        <div
                                                            className={`${CONTENT_PREVIEW_PROSE_CLASS} mt-3`}
                                                            dangerouslySetInnerHTML={{ __html: renderContentToHtml(item.content) }}
                                                        />
                                                    ) : (
                                                        <p className="mt-3 text-sm text-gray-400">当前章节尚未生成内容</p>
                                                    )}
                                                </div>
                                            );
                                        })
                                    ) : (
                                        <div className="px-5 py-5 text-sm text-gray-500">当前技术部分下暂无可展示章节</div>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className={clsx('flex-1 overflow-y-auto bg-gray-50/60 p-6', (isAttachmentActive || isTechnicalActive) && 'hidden')}>
                            <div className="max-w-4xl space-y-4">
                                <div className="rounded-xl border border-gray-200 bg-white p-4">
                                    <div className="flex items-center gap-2">
                                        <FolderTree className="h-4 w-4 text-gray-400" />
                                        <p className="text-sm font-semibold text-gray-800">商务结构节点</p>
                                    </div>
                                    <p className="mt-3 text-sm text-gray-500">
                                        当前仅按解析报告中的商务结构导出，不提供正文编辑。
                                    </p>
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
