import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    FileText, ChevronDown, ChevronRight,
    AlertTriangle, Loader2, Download, RefreshCw, CheckCircle2, RotateCcw
} from 'lucide-react';
import clsx from 'clsx';
import remarkGfm from 'remark-gfm';
import type { Project, AnalysisNode } from '../../services/projectService';
import { projectService } from '../../services/projectService';
import { ProtectedMarkdown } from '../ProtectedMarkdown';
import { ResizablePdfPreviewPane } from '../ResizablePdfPreviewPane';

function TreeNode({ node, depth, activeId, onAnchorClick, extractingIds, selectedIds, onToggleSelect, virtualFilledIds, isLocked: isLockedByParent = false }: {
    node: AnalysisNode;
    depth: number;
    activeId: string | null;
    onAnchorClick: (id: string) => void;
    extractingIds: Set<string>;
    selectedIds?: Set<string>;
    onToggleSelect?: (id: string) => void;
    virtualFilledIds?: Set<string>;
    isLocked?: boolean;
}) {
    const [expanded, setExpanded] = useState(true);
    const hasChildren = (node.children?.length ?? 0) > 0;
    const isDerivedStructureLeaf = !hasChildren && (node.id === 'structure_business' || node.id === 'structure_technical');
    const hasContent = !!node.content?.trim() || !!virtualFilledIds?.has(node.id);
    const isActive = activeId === node.id;
    const isExtracting = extractingIds.has(node.id);
    const showLeafCheckbox = !hasChildren && (!!node.extractionPrompt || isDerivedStructureLeaf);
    const isSelectableLeaf = !hasChildren && !!node.extractionPrompt;
    const isSelected = selectedIds?.has(node.id) ?? false;
    // isLockedByParent: 由父级传入的整体只读状态（用于单向流程锁定）
    // isExtracting: 当前节点正在提取（本地禁用 checkbox）

    return (
        <div>
            <button
                onClick={() => {
                    // 行点击：主要行为是跳转到对应内容节点
                    onAnchorClick(node.id);
                    // 父节点额外折叠/展开
                    if (hasChildren) setExpanded(prev => !prev);
                }}
                className={clsx(
                    'w-full flex items-center gap-1.5 py-1.5 pr-2 text-left transition-all rounded-md',
                    isActive
                        ? 'bg-brand-50 text-brand-600'
                        : 'hover:bg-gray-50 text-gray-700',
                    isExtracting && 'opacity-70',
                )}
                style={{ paddingLeft: `${depth * 16 + 8}px` }}
            >
                {hasChildren ? (
                    expanded
                        ? <ChevronDown className="w-3 h-3 text-gray-400 shrink-0" />
                        : <ChevronRight className="w-3 h-3 text-gray-400 shrink-0" />
                ) : (
                    <div className="w-3 h-3 shrink-0" />
                )}
                {/* checkbox — 只对叶子节点显示，精确点击才触发选中；整体锁定时隐藏 */}
                {showLeafCheckbox && !isLockedByParent && (
                    <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={isExtracting || !isSelectableLeaf}
                        onChange={() => { }}
                        onClick={e => {
                            e.stopPropagation();
                            if (!isExtracting && isSelectableLeaf) onToggleSelect?.(node.id);
                        }}
                        className={clsx('w-3 h-3 shrink-0 rounded border-gray-300 accent-sky-500 focus:ring-0 cursor-pointer',
                            (isExtracting || !isSelectableLeaf) && 'opacity-40 cursor-not-allowed')}
                        title={isSelectableLeaf ? '勾选后可加入重提取' : '该节点为后端派生结果，无需手动重提取'}
                    />
                )}
                {!showLeafCheckbox && !isLockedByParent && <div className="w-3 h-3 shrink-0" />}
                {/* 状态图标（独立于 checkbox 右侧） */}
                {isExtracting ? (
                    <Loader2 className="w-3 h-3 shrink-0 text-brand-500 animate-spin" />
                ) : hasContent ? (
                    <CheckCircle2 className="w-2.5 h-2.5 shrink-0 text-success" />
                ) : (
                    <div className="w-2 h-2 shrink-0 rounded-full bg-gray-200" />
                )}
                <span className={clsx(
                    'text-xs truncate',
                    isActive ? 'font-semibold' : hasChildren ? 'font-medium' : 'font-normal',
                )}>
                    {node.label}
                </span>
            </button>
            {expanded && hasChildren && (
                <div>
                    {node.children!.map(child => (
                        <TreeNode key={child.id} node={child} depth={depth + 1}
                            activeId={activeId} onAnchorClick={onAnchorClick} extractingIds={extractingIds}
                            selectedIds={selectedIds} onToggleSelect={onToggleSelect}
                            virtualFilledIds={virtualFilledIds}
                            isLocked={isLockedByParent} />
                    ))}
                </div>
            )}
        </div>
    );
}


// ── 主组件 ───────────────────────────────────────────────
interface RequirementsReviewProps {
    project: Project;
    onConfirm?: (project: Project) => void;
    isLocked?: boolean;
    onBusyChange?: (busy: boolean) => void;
}

export default function RequirementsReview({ project, isLocked, onBusyChange }: RequirementsReviewProps) {
    const cancelSuppressKey = `proengine_analyze_cancelled_${project.id}`;
    const DERIVED_ATTACHMENT_NODE_ID = 'structure_attachments';
    const DERIVED_BUSINESS_NODE_ID = 'structure_business';
    const DERIVED_TECHNICAL_NODE_ID = 'structure_technical';
    const [analysisNodes, setAnalysisNodes] = useState<AnalysisNode[]>(project.analysisReport ?? []);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isCancelling, setIsCancelling] = useState(false);
    const [analyzeProgress, setAnalyzeProgress] = useState('');
    const [extractingIds, setExtractingIds] = useState<Set<string>>(new Set());
    // 重新生成缓存机制
    const draftBackupRef = useRef<Map<string, string>>(new Map()); // nodeId -> 旧内容
    const [pendingDraftIds, setPendingDraftIds] = useState<Set<string>>(new Set());
    // 重新提取确认弹窗
    const [regenConfirmNode, setRegenConfirmNode] = useState<AnalysisNode | null>(null);
    const [showPdf, setShowPdf] = useState(!!project.pdfUrl);
    const [frameworkLoading, setFrameworkLoading] = useState(true);
    const [activeNavId, setActiveNavId] = useState<string | null>(null);
    // 批量重提取多选（常态可见）
    const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
    const [showReExtractConfirm, setShowReExtractConfirm] = useState(false);
    const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const docScrollRef = useRef<HTMLDivElement>(null);
    const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // 用于中断正在进行的解析 SSE 请求
    const analyzeAbortRef = useRef<AbortController | null>(null);

    const setDerivedGenerating = useCallback((phase: 'attachments' | 'business' | 'technical') => {
        const map = {
            attachments: DERIVED_ATTACHMENT_NODE_ID,
            business: DERIVED_BUSINESS_NODE_ID,
            technical: DERIVED_TECHNICAL_NODE_ID,
        };
        const nodeId = map[phase];
        setExtractingIds(prev => {
            const next = new Set(prev);
            next.add(nodeId);
            return next;
        });
    }, []);

    const setDerivedDone = useCallback((phase: 'attachments' | 'business' | 'technical') => {
        const map = {
            attachments: DERIVED_ATTACHMENT_NODE_ID,
            business: DERIVED_BUSINESS_NODE_ID,
            technical: DERIVED_TECHNICAL_NODE_ID,
        };
        const nodeId = map[phase];
        setExtractingIds(prev => {
            const next = new Set(prev);
            next.delete(nodeId);
            return next;
        });
    }, []);

    // 将解析忙态上抛给页面级顶部栏，用于禁用“下一步”按钮。
    useEffect(() => {
        onBusyChange?.(isAnalyzing);
    }, [isAnalyzing, onBusyChange]);

    useEffect(() => {
        return () => {
            onBusyChange?.(false);
        };
    }, [onBusyChange]);

    useEffect(() => {
        if (!project.analysisV2?.schema_version) return;
        setDerivedDone('attachments');
        setDerivedDone('business');
        setDerivedDone('technical');
    }, [project.analysisV2?.schema_version, setDerivedDone]);

    // ── 从 framework JSON 加载骨架，合并已有内容 ──────────
    useEffect(() => {
        setFrameworkLoading(true);
        projectService.getAnalysisFramework().then(async ({ framework }) => {
            if (!framework.length) { setFrameworkLoading(false); return; }

            // 优先级：localStorage 中的 analysisReport > 后端持久化 > 空
            const existingMap = new Map<string, string>();
            const collectContent = (nodes: AnalysisNode[]) => {
                for (const n of nodes) {
                    if (n.content) existingMap.set(n.id, n.content);
                    if (n.children) collectContent(n.children);
                }
            };

            if (project.analysisReport?.length) {
                collectContent(project.analysisReport);
            }

            // 如果 localStorage 里也没有内容，尝试从后端恢复
            if (existingMap.size === 0) {
                const serverReport = await projectService.loadAnalysisReport(project.id);
                if (serverReport.length) collectContent(serverReport);
            }

            const mergeContent = (nodes: AnalysisNode[]): AnalysisNode[] =>
                nodes.map(n => ({
                    ...n,
                    content: existingMap.get(n.id) || n.content || '',
                    children: n.children ? mergeContent(n.children) : undefined,
                }));

            setAnalysisNodes(mergeContent(framework));
            setFrameworkLoading(false);
        }).catch(() => setFrameworkLoading(false));
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── 统计 ──────────────────────────────────────────────
    const filledCount = (() => {
        let total = 0, filled = 0;
        const count = (nodes: AnalysisNode[]) => {
            for (const n of nodes) {
                if (!n.children?.length) { total++; if (n.content?.trim()) filled++; }
                if (n.children) count(n.children);
            }
        };
        count(analysisNodes);
        return { total, filled };
    })();
    const derivedFilledIds = new Set<string>();
    if ((project.analysisV2?.bid_structure?.business_sections || []).some(item => !item.deleted)) {
        derivedFilledIds.add(DERIVED_BUSINESS_NODE_ID);
    }
    if ((project.analysisV2?.bid_structure?.technical_sections || []).some(item => !item.deleted)) {
        derivedFilledIds.add(DERIVED_TECHNICAL_NODE_ID);
    }

    // ── 递归更新节点内容 + 持久化 ─────────────────────────
    const updateNodeContent = useCallback((nodeId: string, content: string) => {
        setAnalysisNodes(prev => {
            const updateTree = (nodes: AnalysisNode[]): AnalysisNode[] =>
                nodes.map(n => ({
                    ...n,
                    content: n.id === nodeId ? content : n.content,
                    children: n.children ? updateTree(n.children) : undefined,
                }));
            const updated = updateTree(prev);
            // localStorage 即时存
            projectService.update(project.id, { analysisReport: updated });
            // 后端 debounce 保存（500ms 防抖）
            if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
            saveDebounceRef.current = setTimeout(() => {
                projectService.saveAnalysisReport(project.id, updated);
            }, 500);
            return updated;
        });
    }, [project.id]);

    // ── addExtracting / removeExtracting ──────────────────
    const addExtracting = (id: string) => setExtractingIds(prev => new Set([...prev, id]));
    const removeExtracting = (id: string) => setExtractingIds(prev => { const s = new Set(prev); s.delete(id); return s; });

    // ── mount 重连：检测 localStorage 中是否有进行中的 analyze 任务 ──
    // 必须放在 updateNodeContent/removeExtracting 定义之后，避免 TDZ 报错
    useEffect(() => {
        if (frameworkLoading || isLocked) return; // 等 framework 加载完成再检测
        const taskKey = `proengine_analyze_task_${project.id}`;
        const pendingTaskId = localStorage.getItem(taskKey);
        if (!pendingTaskId) return;

        // ⚠️ 阻断竞态：有进行中任务时，禁止「无内容自动触发」useEffect 再发起新任务
        autoTriggered.current = true;

        // 收集所有尚无内容的叶子节点，设为 extractingIds，让用户看到 loading 动画
        const pendingLeafIds = new Set<string>();
        const collectPending = (nodes: AnalysisNode[]) => {
            for (const n of nodes) {
                if (n.children?.length) {
                    collectPending(n.children);
                } else if (n.extractionPrompt && !n.content?.trim()) {
                    pendingLeafIds.add(n.id);
                }
            }
        };
        collectPending(analysisNodes);
        if (!project.analysisV2?.schema_version) {
            pendingLeafIds.add(DERIVED_ATTACHMENT_NODE_ID);
            pendingLeafIds.add(DERIVED_BUSINESS_NODE_ID);
            pendingLeafIds.add(DERIVED_TECHNICAL_NODE_ID);
        }
        setExtractingIds(pendingLeafIds);

        setIsAnalyzing(true);
        setAnalyzeProgress('正在恢复解析进度...');
        const ctrl = new AbortController();
        analyzeAbortRef.current = ctrl;

        projectService.reconnectAnalyzeTask(pendingTaskId, project.id, {
            onProgress: (d) => setAnalyzeProgress(d.message),
            onNodeComplete: (d) => {
                updateNodeContent(d.node_id, d.content);
                removeExtracting(d.node_id);
                setActiveNavId(d.node_id);
                projectService.processAnalysisLinkage(project.id, d.node_id, d.content);
            },
            onBidAttachments: (data) => {
                if (Array.isArray(data)) {
                    projectService.update(project.id, { bidAttachmentList: data });
                    setDerivedDone('attachments');
                }
            },
            onAnalysisV2: (data) => {
                projectService.update(project.id, { analysisV2: data });
                setDerivedDone('business');
                setDerivedDone('technical');
                setDerivedDone('attachments');
            },
            onStructureStage: (data) => {
                if (data?.phase === 'attachments_generating') setDerivedGenerating('attachments');
                if (data?.phase === 'business_generating') setDerivedGenerating('business');
                if (data?.phase === 'technical_generating') setDerivedGenerating('technical');
            },
            onError: (d) => { console.warn('[analyze reconnect] 任务报错:', d.error); },
            onComplete: (d) => {
                setAnalyzeProgress(`✅ 恢复完成 ${d.success_count}/${d.total_nodes} 节点`);
                progressTimerRef.current = setTimeout(() => setAnalyzeProgress(''), 3000);
            },
        }, ctrl.signal).catch(e => {
            if (!(e instanceof DOMException && e.name === 'AbortError')) {
                console.warn('[analyze reconnect] 重连失败:', e);
            }
        }).finally(() => {
            setIsAnalyzing(false);
            setExtractingIds(new Set());
            analyzeAbortRef.current = null;
        });

        return () => { ctrl.abort(); }; // 组件卸载时取消重连
    }, [frameworkLoading]); // eslint-disable-line react-hooks/exhaustive-deps



    // 多选切换
    const toggleNodeSelect = (id: string) => {
        setSelectedNodeIds(prev => {
            const s = new Set(prev);
            if (s.has(id)) s.delete(id); else s.add(id);
            return s;
        });
    };

    // 批量重提取：选中的节点打包为一组调用 analyze 接口
    const handleBatchReAnalyze = async () => {
        if (selectedNodeIds.size === 0) return;
        localStorage.removeItem(cancelSuppressKey);

        // 缓存旧内容
        const collectNode = (nodes: AnalysisNode[]): void => {
            for (const n of nodes) {
                if (selectedNodeIds.has(n.id)) draftBackupRef.current.set(n.id, n.content || '');
                if (n.children) collectNode(n.children);
            }
        };
        collectNode(analysisNodes);

        setIsAnalyzing(true);
        const extracting = new Set(selectedNodeIds);
        extracting.add(DERIVED_ATTACHMENT_NODE_ID);
        extracting.add(DERIVED_BUSINESS_NODE_ID);
        extracting.add(DERIVED_TECHNICAL_NODE_ID);
        setExtractingIds(extracting);
        setAnalyzeProgress(`批量提取 ${selectedNodeIds.size} 个节点...`);

        try {
            await projectService.analyzeDocument(project.id, {
                onProgress: (data) => setAnalyzeProgress(data.message),
                onNodeComplete: (data) => {
                    updateNodeContent(data.node_id, data.content);
                    removeExtracting(data.node_id);
                    setPendingDraftIds(prev => new Set([...prev, data.node_id]));
                    projectService.processAnalysisLinkage(project.id, data.node_id, data.content);
                },
                onBidAttachments: (data) => {
                    if (Array.isArray(data)) {
                        projectService.update(project.id, { bidAttachmentList: data });
                        setDerivedDone('attachments');
                    }
                },
                onAnalysisV2: (data) => {
                    projectService.update(project.id, { analysisV2: data });
                    setDerivedDone('business');
                    setDerivedDone('technical');
                    setDerivedDone('attachments');
                },
                onStructureStage: (data) => {
                    if (data?.phase === 'attachments_generating') setDerivedGenerating('attachments');
                    if (data?.phase === 'business_generating') setDerivedGenerating('business');
                    if (data?.phase === 'technical_generating') setDerivedGenerating('technical');
                },
                onError: (data) => {
                    console.warn(`节点 ${data.label} 提取失败:`, data.error);
                    if (data.node_id) removeExtracting(data.node_id);
                },
                onComplete: (data) => {
                    setAnalyzeProgress(`✅ 批量完成 ${data.success_count}/${data.total_nodes} 节点`);
                    progressTimerRef.current = setTimeout(() => setAnalyzeProgress(''), 3000);
                },
            }, [...selectedNodeIds]);
        } catch (e) {
            alert(e instanceof Error ? e.message : '批量提取失败');
        } finally {
            setIsAnalyzing(false);
            setExtractingIds(new Set());
            setSelectedNodeIds(new Set());
        }
    };

    // ── 全量 SSE 解析 ─────────────────────────────────────
    const handleAnalyze = async () => {
        localStorage.removeItem(cancelSuppressKey);
        // 中止之前残留的请求
        analyzeAbortRef.current?.abort();
        const ctrl = new AbortController();
        analyzeAbortRef.current = ctrl;

        setIsAnalyzing(true);
        setAnalyzeProgress('准备解析...');

        // 收集所有叶子节点 ID，标记为 extracting（pending loading 效果）
        const leafIds = new Set<string>();
        const collectLeaves = (nodes: AnalysisNode[]) => {
            for (const n of nodes) {
                if (n.children?.length) collectLeaves(n.children);
                else if (n.extractionPrompt) leafIds.add(n.id);
            }
        };
        collectLeaves(analysisNodes);
        leafIds.add(DERIVED_ATTACHMENT_NODE_ID);
        leafIds.add(DERIVED_BUSINESS_NODE_ID);
        leafIds.add(DERIVED_TECHNICAL_NODE_ID);
        setExtractingIds(leafIds);

        try {
            await projectService.analyzeDocument(project.id, {
                onProgress: (data) => {
                    setAnalyzeProgress(data.message);
                },
                onNodeComplete: (data) => {
                    updateNodeContent(data.node_id, data.content);
                    removeExtracting(data.node_id);
                    setActiveNavId(data.node_id);
                    projectService.processAnalysisLinkage(project.id, data.node_id, data.content);
                },
                onBidAttachments: (data) => {
                    if (Array.isArray(data)) {
                        projectService.update(project.id, { bidAttachmentList: data });
                        setDerivedDone('attachments');
                    }
                },
                onAnalysisV2: (data) => {
                    projectService.update(project.id, { analysisV2: data });
                    setDerivedDone('business');
                    setDerivedDone('technical');
                    setDerivedDone('attachments');
                },
                onStructureStage: (data) => {
                    if (data?.phase === 'attachments_generating') setDerivedGenerating('attachments');
                    if (data?.phase === 'business_generating') setDerivedGenerating('business');
                    if (data?.phase === 'technical_generating') setDerivedGenerating('technical');
                },
                onError: (data) => {
                    console.warn(`节点 ${data.label} 提取失败:`, data.error);
                    if (data.node_id) removeExtracting(data.node_id);
                },
                onComplete: (data) => {
                    setAnalyzeProgress(`✅ 完成 ${data.success_count}/${data.total_nodes} 节点`);
                    progressTimerRef.current = setTimeout(() => setAnalyzeProgress(''), 3000);
                },
            }, undefined, ctrl.signal);
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                // 用户手动取消，不弹错误
                return;
            }
            alert(error instanceof Error ? error.message : '解析失败');
        } finally {
            setIsAnalyzing(false);
            setExtractingIds(new Set());
            analyzeAbortRef.current = null;
        }
    };

    const handleCancelAnalyze = async () => {
        if (isCancelling) return;
        setIsCancelling(true);
        try {
            const taskId = localStorage.getItem(`proengine_analyze_task_${project.id}`)
                || project.taskRuntime?.taskId
                || '';
            localStorage.setItem(cancelSuppressKey, '1');
            if (taskId) {
                projectService.update(project.id, {
                    taskRuntime: {
                        state: 'cancelling',
                        taskId,
                        taskType: 'analyze',
                        message: '任务取消中',
                        progress: 0,
                        startedAt: project.taskRuntime?.startedAt || new Date().toISOString(),
                        cancellable: false,
                        updatedAt: new Date().toISOString(),
                    },
                });
            }
            if (taskId) {
                await projectService.cancelTask(taskId, project.id);
            }
            analyzeAbortRef.current?.abort();
            localStorage.removeItem(`proengine_analyze_task_${project.id}`);
            localStorage.removeItem(`extract_task_${project.id}`);
            projectService.update(project.id, {
                taskRuntime: {
                    state: 'cancelled',
                    taskId,
                    taskType: 'analyze',
                    message: '',
                    progress: 0,
                    startedAt: project.taskRuntime?.startedAt || new Date().toISOString(),
                    cancellable: false,
                    updatedAt: new Date().toISOString(),
                },
            });
            setIsAnalyzing(false);
            setExtractingIds(new Set());
            setAnalyzeProgress('');
            await projectService.syncFromServer();
        } catch (e) {
            console.warn('[cancel analyze] 取消失败:', e);
        } finally {
            setIsCancelling(false);
        }
    };

    // ── 单节点重新提取（缓存模式 + SSE 流式）──────────────────────────
    const doReAnalyzeNode = async (node: AnalysisNode) => {
        if (!node.extractionPrompt) return;
        // 缓存旧内容
        draftBackupRef.current.set(node.id, node.content || '');
        addExtracting(node.id);

        // 实时更新节点内容（streaming 中间态，不持久化）
        const updateNodeTemp = (text: string) => {
            setAnalysisNodes(prev => {
                const updateTree = (nodes: AnalysisNode[]): AnalysisNode[] =>
                    nodes.map(n => ({
                        ...n,
                        content: n.id === node.id ? text : n.content,
                        children: n.children ? updateTree(n.children) : undefined,
                    }));
                return updateTree(prev);
            });
        };

        try {
            const result = await projectService.analyzeNode(
                project.id, node.id, node.label, node.extractionPrompt,
                (partial) => updateNodeTemp(partial), // 逐 chunk 更新界面
                (items) => {
                    if (Array.isArray(items)) {
                        projectService.update(project.id, { bidAttachmentList: items });
                    }
                },
            );
            if (result?.content) {
                updateNodeTemp(result.content); // 最终完整内容覆盖
                setPendingDraftIds(prev => new Set([...prev, node.id]));
            }
        } catch (e) {
            console.error('单节点重提取失败:', e);
            alert(e instanceof Error ? e.message : '重新提取失败');
            // 失败时恢复旧内容
            const old = draftBackupRef.current.get(node.id) || '';
            updateNodeTemp(old);
            draftBackupRef.current.delete(node.id);
        } finally {
            removeExtracting(node.id);
        }
    };

    // 点击「重新提取」：有内容时弹确认框，无内容时直接执行
    const handleReAnalyzeNode = (node: AnalysisNode) => {
        if (!node.extractionPrompt) return;
        if (node.content?.trim()) {
            setRegenConfirmNode(node);
        } else {
            doReAnalyzeNode(node);
        }
    };

    // ── 采纳草稿（持久化到后端） ──────────────────────────
    const acceptDraft = (nodeId: string) => {
        // 找到当前界面上已显示的新内容，正式持久化
        const findContent = (nodes: AnalysisNode[]): string | null => {
            for (const n of nodes) {
                if (n.id === nodeId) return n.content || '';
                if (n.children) { const r = findContent(n.children); if (r !== null) return r; }
            }
            return null;
        };
        const content = findContent(analysisNodes);
        if (content !== null) updateNodeContent(nodeId, content);
        draftBackupRef.current.delete(nodeId);
        setPendingDraftIds(prev => { const s = new Set(prev); s.delete(nodeId); return s; });
    };

    // ── 回退草稿（恢复旧版本） ──────────────────────────
    const rejectDraft = (nodeId: string) => {
        const oldContent = draftBackupRef.current.get(nodeId) || '';
        setAnalysisNodes(prev => {
            const updateTree = (nodes: AnalysisNode[]): AnalysisNode[] =>
                nodes.map(n => ({
                    ...n,
                    content: n.id === nodeId ? oldContent : n.content,
                    children: n.children ? updateTree(n.children) : undefined,
                }));
            return updateTree(prev);
        });
        draftBackupRef.current.delete(nodeId);
        setPendingDraftIds(prev => { const s = new Set(prev); s.delete(nodeId); return s; });
    };

    // ── 导出解析报告 PDF（后端生成，带大纲书签）───────────
    const [isExporting, setIsExporting] = useState(false);
    const handleExportReport = async () => {
        if (isExporting) return;
        setIsExporting(true);
        try {
            await projectService.exportReportPdf(
                project.name || '招标文件',
                analysisNodes,
            );
        } catch (e) {
            console.error('PDF 导出失败:', e);
        } finally {
            setIsExporting(false);
        }
    };

    // ── 首次进入自动触发（有缓存文档 + 节点全空）─────────
    const autoTriggered = useRef(false);
    useEffect(() => {
        if (frameworkLoading || autoTriggered.current || isLocked) return;
        if (!project.pdfUrl) return;
        if (localStorage.getItem(cancelSuppressKey) === '1') return;
        let hasAnyContent = false;
        const check = (nodes: AnalysisNode[]) => {
            for (const n of nodes) {
                if (n.content?.trim()) { hasAnyContent = true; return; }
                if (n.children) check(n.children);
            }
        };
        check(analysisNodes);
        if (!hasAnyContent && analysisNodes.length > 0) {
            autoTriggered.current = true;
            handleAnalyze();
        }
    }, [frameworkLoading, isLocked, project.pdfUrl, analysisNodes, cancelSuppressKey]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── 锚点跳转 ─────────────────────────────────────────
    const handleAnchorClick = (nodeId: string) => {
        setActiveNavId(nodeId);
        const el = document.getElementById(`node-anchor-${nodeId}`);
        if (el && docScrollRef.current) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    };

    // ── 找某节点的 extractionPrompt（用于单节点重提取）────
    const findNode = (nodes: AnalysisNode[], id: string): AnalysisNode | null => {
        for (const n of nodes) {
            if (n.id === id) return n;
            if (n.children) { const f = findNode(n.children, id); if (f) return f; }
        }
        return null;
    };

    const hasCache = !!project.pdfUrl;

    // ── Markdown 内容预处理：把单个 \n 转成 hard line break，并无缝解析图片占位符 ──
    const normalizeMarkdown = (text: string): string => {
        // 第一层清洗：把所有的后置占位符直接替换为对服务端的安全访问路由
        const safeText = text.replace(/__PRO_IMG_([a-f0-9]+)__/ig, '/api/extracted-images/by-hash/$1');

        // 按代码块分割，代码块内不处理
        const parts = safeText.split(/(```[\s\S]*?```)/g);
        return parts.map((part, i) => {
            if (i % 2 === 1) return part; // 代码块
            // 按行处理，跳过表格行（以 | 开头或分隔行 |---|）
            const lines = part.split('\n');
            const result: string[] = [];
            for (let li = 0; li < lines.length; li++) {
                const line = lines[li];
                const isTableLine = /^\s*\|/.test(line);
                const nextIsTableLine = li + 1 < lines.length && /^\s*\|/.test(lines[li + 1]);
                // 表格行或表格行前一行：保持原样换行，不加 trailing spaces
                if (isTableLine || nextIsTableLine) {
                    result.push(line);
                } else {
                    // 非表格行：加 trailing spaces 保证软换行
                    result.push(line.replace(/([^\n])$/, '$1  '));
                }
            }
            return result.join('\n');
        }).join('');
    };

    // ── XML 内容解析工具 ───────────────────────────────────
    // 解析 <要点 [attrs]>content</要点> 格式
    const parseXmlList = (text: string): Array<{ content: string; mandatory: boolean }> => {
        const results: Array<{ content: string; mandatory: boolean }> = [];
        const re = /<要点([^>]*)>([\s\S]*?)<\/要点>/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
            results.push({
                content: m[2].trim(),
                mandatory: m[1].includes('mandatory'),
            });
        }
        // 如果没匹配到 XML 标签，回退到按 \n\n 分段
        if (!results.length) {
            return text.split(/\n\n+/).map(p => p.trim()).filter(Boolean)
                .map(p => ({ content: p, mandatory: false }));
        }
        return results;
    };

    // 解析 <字段名>值</字段名> 格式的结构化字段
    const parseXmlFields = (text: string): Array<{ label: string; value: string }> => {
        const results: Array<{ label: string; value: string }> = [];
        const re = /<([^/>\s][^>]*)>([\s\S]*?)<\/\1>/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
            // 跳过 <要点> 标签（那是列举类）
            if (m[1].startsWith('要点')) continue;
            results.push({ label: m[1], value: m[2].trim() });
        }
        return results;
    };

    // 解析旧格式 **字段名**：值（兼容历史缓存数据）
    const parseMarkdownFields = (text: string): Array<{ label: string; value: string }> => {
        const results: Array<{ label: string; value: string }> = [];
        const lines = text.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            // 匹配 **label**：value 或 **label**:value
            const m = trimmed.match(/^\*\*([^*]+)\*\*[：:]\s*(.+)$/);
            if (m) {
                results.push({ label: m[1].trim(), value: m[2].trim() });
            }
        }
        return results;
    };

    // 渲染 field-value 字段列表（XML 和 Markdown bold 格式共用同一套样式）
    const renderFieldList = (fields: Array<{ label: string; value: string }>) => (
        <div className="divide-y divide-gray-100">
            {fields.map((f, idx) => (
                <div key={idx} className="py-2 first:pt-0 last:pb-0">
                    <div className="text-[11px] text-brand-600 tracking-wide mb-0.5">{f.label}</div>
                    <div className="text-[13px] text-gray-700 leading-relaxed">{f.value}</div>
                </div>
            ))}
        </div>
    );

    // ── 节点内容渲染 ──────────────────────────────────────
    const renderNodeContent = (node: AnalysisNode) => {
        // 兼容历史项目：旧数据中 structure_business / structure_technical 可能未写回 analysisReport.content，
        // 但 analysisV2 已有派生结构，前端需要兜底展示，避免“等待解析填充”误导。
        if (!node.content && node.id === DERIVED_BUSINESS_NODE_ID) {
            const items = (project.analysisV2?.bid_structure?.business_sections || []).filter(item => !item.deleted);
            if (items.length) {
                return (
                    <div className="space-y-2.5">
                        {items.map((item, idx) => (
                            <div key={item.id || `${DERIVED_BUSINESS_NODE_ID}_${idx}`} className="flex gap-2.5 text-[13px] leading-relaxed text-gray-700">
                                <span className="shrink-0 text-gray-400 font-mono text-xs pt-0.5 min-w-[18px]">{idx + 1}.</span>
                                <span className="flex-1">{item.title || '未命名章节'}</span>
                            </div>
                        ))}
                    </div>
                );
            }
        }

        if (!node.content && node.id === DERIVED_TECHNICAL_NODE_ID) {
            const items = (project.analysisV2?.bid_structure?.technical_sections || []).filter(item => !item.deleted);
            if (items.length) {
                return (
                    <div className="space-y-2.5">
                        {items.map((item, idx) => (
                            <div key={item.id || `${DERIVED_TECHNICAL_NODE_ID}_${idx}`} className="flex gap-2.5 text-[13px] leading-relaxed text-gray-700">
                                <span className="shrink-0 text-gray-400 font-mono text-xs pt-0.5 min-w-[18px]">{idx + 1}.</span>
                                <span className="flex-1">{item.title || '未命名章节'}</span>
                            </div>
                        ))}
                    </div>
                );
            }
        }

        if (!node.content) return <p className="text-gray-300 text-xs italic">等待解析填充</p>;

        const txt = node.content;

        // 1. JSON 结构化（scoring_details 节点）— 最先检测，避免 JSON 被误判为字段
        const trimmed = txt.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
                const parsed = JSON.parse(trimmed);
                const items: { name: string; max_score: number; criteria: string; category?: string }[] = parsed.items || (Array.isArray(parsed) ? parsed : []);
                if (items.length > 0) {
                    return (
                        <div className="overflow-x-auto">
                            {parsed.note && <p className="text-xs text-gray-400 italic mb-2">{parsed.note}</p>}
                            <table className="w-full text-[12px] border-collapse">
                                <thead>
                                    <tr className="bg-gray-50 border-b border-gray-200">
                                        <th className="text-left px-3 py-2 font-semibold text-gray-600 w-28">评分项</th>
                                        <th className="text-left px-3 py-2 font-semibold text-gray-600">评分规则</th>
                                        <th className="text-right px-3 py-2 font-semibold text-gray-600 w-14 shrink-0">满分</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {items.map((item, idx) => (
                                        <tr key={idx} className="border-b border-gray-100 align-top hover:bg-gray-50 transition-colors">
                                            <td className="px-3 py-2 font-medium text-gray-800 whitespace-nowrap">{item.name}</td>
                                            <td className="px-3 py-2 text-gray-600 leading-relaxed whitespace-pre-wrap">{item.criteria}</td>
                                            <td className="px-3 py-2 text-right font-semibold text-brand-600 whitespace-nowrap">{item.max_score}分</td>
                                        </tr>
                                    ))}
                                </tbody>
                                {items.length > 0 && (
                                    <tfoot>
                                        <tr className="bg-gray-50 border-t border-gray-200">
                                            <td colSpan={2} className="px-3 py-2 font-semibold text-gray-700 text-right">合计</td>
                                            <td className="px-3 py-2 text-right font-bold text-brand-600">
                                                {items.reduce((sum: number, it: { max_score: number }) => sum + (it.max_score || 0), 0)}分
                                            </td>
                                        </tr>
                                    </tfoot>
                                )}
                            </table>
                        </div>
                    );
                }
                if (parsed.note) return <p className="text-xs text-gray-400 italic">{parsed.note}</p>;
            } catch { /* 不是合法 JSON，继续后续检测 */ }
        }

        // ── 内容自动识别：字段 vs 列表 ─────────────────────────
        // 规则：有结构化字段 且 完全没有 <要点> 列举标签 → key-value
        //       只要有 <要点> 或 numbered 标记，哪怕一条 → 带序号列表
        const hasListTags = txt.includes('<要点');

        // 2. 结构化字段（XML <字段名>值</字段名>，parseXmlFields 已内部排除 <要点>）
        const xmlFields = parseXmlFields(txt);
        if (xmlFields.length > 0 && !hasListTags) {
            return renderFieldList(xmlFields);
        }

        // 3. 旧格式 **字段名**：值（兼容历史缓存，同样要求无列举标签）
        const mdFields = parseMarkdownFields(txt);
        if (mdFields.length > 2 && !hasListTags) {
            return renderFieldList(mdFields);
        }

        // 4. 带序号列表（有 <要点> 标签 或 node.numbered 配置）
        if (hasListTags || node.numbered) {
            const items = parseXmlList(txt);
            if (!items.length) return <p className="text-gray-300 text-xs italic">等待解析填充</p>;
            return (
                <div className="space-y-2.5">
                    {items.map((item, idx) => (
                        <div key={idx} className={clsx(
                            'flex gap-2.5 text-[13px] leading-relaxed text-gray-700',
                            item.mandatory && 'pl-2 border-l-2 border-[var(--color-danger-border)]'
                        )}>
                            <span className="shrink-0 text-gray-400 font-mono text-xs pt-0.5 min-w-[18px]">
                                {idx + 1}.
                            </span>
                            <span className="flex-1">{item.content}</span>
                        </div>
                    ))}
                </div>
            );
        }

        // 5. Markdown fallback（无 XML 标签的纯文本/表格内容）
        return (
            <div className="prose prose-sm prose-gray max-w-none
                prose-headings:font-normal prose-headings:text-gray-700
                prose-strong:font-normal prose-strong:text-gray-700
                prose-table:text-xs prose-td:py-1.5 prose-td:px-2 prose-th:py-1.5 prose-th:px-2
                prose-p:my-1 prose-p:text-[13px] prose-p:text-gray-700
            ">
                <ProtectedMarkdown remarkPlugins={[remarkGfm]}>
                    {normalizeMarkdown(txt)}
                </ProtectedMarkdown>
            </div>
        );
    };
    const renderDocumentFlow = (nodes: AnalysisNode[], depth = 0): React.ReactElement[] => {
        return nodes.flatMap(node => {
            const hasChildren = (node.children?.length ?? 0) > 0;
            const isExtracting = extractingIds.has(node.id);
            const isLeaf = !hasChildren;
            const elements: React.ReactElement[] = [];

            if (depth === 0) {
                // 一级：粗标题
                elements.push(
                    <div key={`d0-${node.id}`} id={`node-anchor-${node.id}`}
                        className="pt-8 pb-2 border-b border-gray-200 mb-4 scroll-mt-4">
                        <div className="flex items-center gap-2">
                            <h2 className="text-base font-bold text-gray-900">{node.label}</h2>
                            {/* 顶层叶子节点（如项目解读/项目基础信息）的重新提取按钮 */}
                            {isLeaf && node.extractionPrompt && !isExtracting && !pendingDraftIds.has(node.id) && !isLocked && (
                                <button
                                    onClick={() => handleReAnalyzeNode(node)}
                                    title="重新提取此节点"
                                    className="ml-auto flex items-center gap-1 text-xs text-gray-400 hover:text-brand-600 px-1.5 py-0.5 rounded hover:bg-brand-50 transition-colors"
                                >
                                    <RotateCcw className="w-3 h-3" />
                                    重新提取
                                </button>
                            )}
                        </div>
                    </div>
                );

                // 顶层叶子节点：同样渲染内容框
                if (isLeaf) {
                    const isPending = pendingDraftIds.has(node.id);
                    elements.push(
                        <div key={`d0-content-${node.id}`} className="mb-6 group">
                            <div className={clsx(
                                'rounded-lg border p-4 min-h-[60px] transition-all',
                                isExtracting ? 'border-[var(--color-warning-border)] bg-[var(--color-warning-bg)]'
                                    : isPending ? 'border-[var(--color-success-border)] border-dashed bg-[var(--color-success-bg)]'
                                        : 'border-gray-100 bg-white'
                            )}>
                                {isExtracting ? (
                                    <div className="flex items-center gap-2 text-warning text-sm">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        <span>正在从招标文件中提取...</span>
                                    </div>
                                ) : (
                                    renderNodeContent(node)
                                )}
                            </div>
                            {isPending && (
                                <div className="flex items-center gap-3 mt-2 px-1">
                                    <span className="text-xs text-success font-medium">✨ 新版本已生成</span>
                                    <div className="flex-1" />
                                    <button onClick={() => acceptDraft(node.id)}
                                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-brand-500 rounded-lg hover:bg-brand-500 transition-colors">
                                        <CheckCircle2 className="w-3.5 h-3.5" />采纳此版本
                                    </button>
                                    <button onClick={() => rejectDraft(node.id)}
                                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">
                                        <RotateCcw className="w-3.5 h-3.5" />回退旧版本
                                    </button>
                                </div>
                            )}
                        </div>
                    );
                }
            } else {
                // 二级或叶子
                elements.push(
                    <div key={`d1-${node.id}`} id={`node-anchor-${node.id}`}
                        className="group relative mb-6 scroll-mt-4">
                        <div className="flex items-center gap-2 mb-2">
                            <h3 className={clsx(
                                'text-sm font-semibold',
                                isLeaf ? 'text-brand-600' : 'text-gray-700'
                            )}>
                                {node.label}
                            </h3>
                            {/* 单节点重新提取按钮（仅叶子节点有 extractionPrompt） */}
                            {isLeaf && node.extractionPrompt && !isExtracting && !pendingDraftIds.has(node.id) && !isLocked && (
                                <button
                                    onClick={() => handleReAnalyzeNode(node)}
                                    title="重新提取此节点"
                                    className="opacity-0 group-hover:opacity-100 transition-opacity ml-auto flex items-center gap-1 text-xs text-gray-400 hover:text-brand-600 px-1.5 py-0.5 rounded hover:bg-brand-50"
                                >
                                    <RotateCcw className="w-3 h-3" />
                                    重新提取
                                </button>
                            )}
                        </div>

                        {isLeaf && (() => {
                            const isPending = pendingDraftIds.has(node.id);
                            return (
                                <>
                                    <div className={clsx(
                                        'rounded-lg border p-4 min-h-[60px] transition-all',
                                        isExtracting ? 'border-[var(--color-warning-border)] bg-[var(--color-warning-bg)]'
                                            : isPending ? 'border-[var(--color-success-border)] border-dashed bg-[var(--color-success-bg)]'
                                                : 'border-gray-100 bg-white'
                                    )}>
                                        {isExtracting ? (
                                            <div className="flex items-center gap-2 text-warning text-sm">
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                <span>正在从招标文件中提取...</span>
                                            </div>
                                        ) : (
                                            renderNodeContent(node)
                                        )}
                                    </div>
                                    {isPending && (
                                        <div className="flex items-center gap-3 mt-2 px-1">
                                            <span className="text-xs text-success font-medium">✨ 新版本已生成</span>
                                            <div className="flex-1" />
                                            <button onClick={() => acceptDraft(node.id)}
                                                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-brand-500 rounded-lg hover:bg-brand-500 transition-colors">
                                                <CheckCircle2 className="w-3.5 h-3.5" />采纳此版本
                                            </button>
                                            <button onClick={() => rejectDraft(node.id)}
                                                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">
                                                <RotateCcw className="w-3.5 h-3.5" />回退旧版本
                                            </button>
                                        </div>
                                    )}
                                </>
                            );
                        })()}
                    </div>
                );
            }

            if (hasChildren) {
                elements.push(...renderDocumentFlow(node.children!, depth + 1));
            }

            return elements;
        });
    };

    return (
        <div className="flex flex-col h-full bg-white rounded-xl overflow-hidden border border-gray-200 shadow-none">
            {/* ── 重新提取确认弹窗 ── */}
            {regenConfirmNode && (
                <div className="fixed inset-0 z-50 flex items-center justify-center">
                    {/* 半透明遮罩 */}
                    <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]"
                        onClick={() => setRegenConfirmNode(null)} />
                    {/* 弹窗卡片 */}
                    <div className="relative bg-white rounded-xl shadow-none border border-gray-200 w-[360px] mx-4 overflow-hidden">
                        {/* 顶部边条 */}
                        <div className="h-1 bg-brand-500 w-full" />
                        <div className="px-5 py-5">
                            <p className="text-base font-semibold text-gray-800 mb-1.5">
                                重新提取「{regenConfirmNode.label}」
                            </p>
                            <p className="text-sm text-gray-500">
                                已有结果将暂存，生成后可选择采纳或回退。
                            </p>
                        </div>
                        <div className="flex items-center justify-end gap-2 px-5 pb-5">
                            <button
                                onClick={() => setRegenConfirmNode(null)}
                                className="px-4 py-1.5 text-sm text-gray-500 rounded-lg hover:bg-gray-100 transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={() => {
                                    const node = regenConfirmNode;
                                    setRegenConfirmNode(null);
                                    doReAnalyzeNode(node);
                                }}
                                className="px-4 py-1.5 text-sm font-medium text-white bg-brand-500 rounded-lg hover:bg-brand-600 transition-colors"
                            >
                                重新生成
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* ── 顶栏 ── */}
            <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2.5">
                    <div className="p-1.5 bg-brand-50 rounded-lg">
                        <FileText className="w-4 h-4 text-brand-600" />
                    </div>
                    <div>
                        <h2 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
                            招标文件解析报告
                            {isLocked && <span className="bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded text-[10px] font-normal border border-gray-200">只读</span>}
                        </h2>
                        <p className="text-xs text-gray-400 mt-0.5">
                            {frameworkLoading ? '加载框架...' :
                                analyzeProgress ? analyzeProgress :
                                    `${filledCount.filled}/${filledCount.total} 节点已提取`
                            }
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                    {/* 解析中状态指示 */}
                    {isAnalyzing && (
                        <>
                            <span className="px-2.5 py-1.5 text-xs font-medium bg-brand-50 text-brand-500 rounded-lg flex items-center gap-1.5 whitespace-nowrap">
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />解析中...
                            </span>
                            <button
                                onClick={handleCancelAnalyze}
                                disabled={isCancelling}
                                className="px-2.5 py-1.5 text-xs font-medium text-gray-500 bg-gray-100 border border-gray-200 rounded-lg hover:bg-gray-200 transition-colors whitespace-nowrap"
                            >{isCancelling ? '取消中...' : '取消解析'}</button>
                            <span className="w-px h-4 bg-gray-200 shrink-0" />
                        </>
                    )}
                    {/* 导出解析报告（左） */}
                    <button
                        onClick={handleExportReport}
                        disabled={filledCount.filled === 0 || isExporting}
                        className="px-2.5 py-1.5 text-xs font-medium text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 whitespace-nowrap"
                    >
                        {isExporting
                            ? <><Loader2 className="w-3 h-3 animate-spin" />导出中...</>
                            : <><Download className="w-3 h-3" />导出解析报告</>
                        }
                    </button>
                    {/* 重新提取（右）：合并全量 + 选中两种逻辑，点击先弹确认 */}
                    {!isLocked && (
                        <button
                            onClick={() => setShowReExtractConfirm(true)}
                            disabled={(!hasCache || isAnalyzing) && selectedNodeIds.size === 0 || isAnalyzing}
                            className={clsx(
                                'px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed',
                                selectedNodeIds.size > 0
                                    ? 'bg-brand-500 text-white hover:bg-brand-500'
                                    : 'text-gray-600 bg-gray-100 border border-gray-200 hover:bg-gray-200'
                            )}
                        >
                            <RefreshCw className="w-3 h-3" />
                            {selectedNodeIds.size > 0 ? `重新提取 (${selectedNodeIds.size})` : '重新提取'}
                        </button>
                    )}
                </div>
            </div>




            {/* ── 三区主体 ── */}
            <div className="flex-1 flex min-h-0 overflow-hidden">
                {/* ── 左：导航树 ── */}
                <div className="w-56 bg-white border-r border-gray-200 flex flex-col shrink-0">
                    <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
                        <p className="text-sm font-semibold text-gray-500 uppercase tracking-wider">解析框架</p>
                        <div className="flex items-center gap-0.5">
                            <button
                                onClick={() => {
                                    const leafIds = new Set<string>();
                                    const collect = (nodes: typeof analysisNodes) => {
                                        nodes.forEach(n => {
                                            if (!n.children || n.children.length === 0) {
                                                if (n.extractionPrompt) leafIds.add(n.id);
                                            }
                                            else collect(n.children);
                                        });
                                    };
                                    collect(analysisNodes);
                                    setSelectedNodeIds(leafIds);
                                }}
                                className="px-1.5 py-0.5 text-[11px] text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded transition-colors"
                            >全选</button>
                            <button
                                onClick={() => setSelectedNodeIds(new Set())}
                                className="px-1.5 py-0.5 text-[11px] text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                            >清空</button>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto py-1">
                        {frameworkLoading ? (
                            <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
                                <Loader2 className="w-5 h-5 animate-spin" />
                                <p className="text-xs">加载框架配置...</p>
                            </div>
                        ) : analysisNodes.length > 0 ? (
                            analysisNodes.map(node => (
                                <TreeNode key={node.id} node={node} depth={0}
                                    activeId={activeNavId}
                                    onAnchorClick={handleAnchorClick}
                                    extractingIds={extractingIds}
                                    selectedIds={selectedNodeIds}
                                    onToggleSelect={toggleNodeSelect}
                                    virtualFilledIds={derivedFilledIds}
                                    isLocked={isLocked} />
                            ))
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full text-gray-300 gap-2 px-4">
                                <AlertTriangle className="w-8 h-8" />
                                <p className="text-xs text-center text-gray-400">框架配置未加载</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* ── 中：文档流滚动视图 ── */}
                <div ref={docScrollRef} className="flex-1 overflow-y-auto bg-white">
                    <div className="px-6 pb-16">
                        {frameworkLoading ? (
                            <div className="flex flex-col items-center justify-center h-64 text-gray-400 gap-3">
                                <Loader2 className="w-8 h-8 animate-spin" />
                                <p className="text-sm">加载解析框架...</p>
                            </div>
                        ) : analysisNodes.length > 0 ? (
                            renderDocumentFlow(analysisNodes)
                        ) : (
                            <div className="flex flex-col items-center justify-center h-64 text-gray-300 gap-3">
                                <FileText className="w-12 h-12 text-gray-200" />
                                <p className="text-sm text-gray-400">暂无解析内容</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* ── 右：PDF 常驻侧边栏 ── */}
                {project.pdfUrl && (
                    <ResizablePdfPreviewPane
                        pdfUrl={project.pdfUrl}
                        open={showPdf}
                        onOpenChange={setShowPdf}
                    />
                )}
            </div>

            {/* ── 重新提取确认弹窗 ── */}
            {showReExtractConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-panel w-full max-w-sm mx-4 overflow-hidden">
                        <div className="px-6 pt-6 pb-4">
                            <div className="flex items-center gap-3 mb-3">
                                <div className="w-10 h-10 rounded-xl bg-[var(--color-warning-bg)] flex items-center justify-center shrink-0">
                                    <RefreshCw className="w-5 h-5 text-warning" />
                                </div>
                                <h3 className="text-base font-bold text-gray-900">
                                    {selectedNodeIds.size > 0
                                        ? `重新提取选中的 ${selectedNodeIds.size} 个节点`
                                        : '重新提取全部节点'
                                    }
                                </h3>
                            </div>
                            <p className="text-sm text-gray-600 leading-relaxed">
                                {selectedNodeIds.size > 0
                                    ? '将重新调用 AI 提取选中节点，原有内容会被覆盖，此操作不可撤销。'
                                    : '将重新调用 AI 提取所有节点，当前已提取的全部内容会被覆盖，此操作不可撤销。'
                                }
                            </p>
                        </div>
                        <div className="px-6 pb-6 flex gap-3">
                            <button
                                onClick={() => setShowReExtractConfirm(false)}
                                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
                            >取消</button>
                            <button
                                onClick={() => {
                                    setShowReExtractConfirm(false);
                                    if (selectedNodeIds.size > 0) {
                                        handleBatchReAnalyze();
                                    } else {
                                        handleAnalyze();
                                    }
                                }}
                                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-brand-500 hover:bg-brand-500 transition-all shadow-none"
                            >确认提取</button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}
