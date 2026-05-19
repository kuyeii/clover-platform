import { useState, useEffect, useRef } from 'react';
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
  Sparkles, Loader2, FileText,
  AlertCircle, XCircle, RefreshCw, Plus, X, Settings2,
  ChevronDown, GripVertical, Trash2, Check, BarChart3,
} from 'lucide-react';
import type { Project, OutlineSection, OutlineSubSection, TechProposalConfig } from '../../services/projectService';
import {
  projectService,
  buildInitialOutlineFromTechnicalHeadings,
} from '../../services/projectService';
import {
  extractCoreWritingIntent,
} from '../../services/writingHintService';
import { TechProposalGate } from '../TechProposalGate';
import { TaskLoadingState } from '../TaskLoadingState';
import clsx from 'clsx';

/** 大纲插图说明超过该长度时，优先展示较短字段或截断，避免右栏过长 */
const DIAGRAM_BRIEF_LONG = 200;

const DIAGRAM_TYPE_LABELS: Record<string, string> = {
  architecture: '架构图',
  flowchart: '流程图',
  'org-chart': '组织架构图',
  'data-flow': '数据流图',
  logic: '逻辑关系图',
};

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

/** 将工作流返回的英文类型键转为界面中文；无法识别时返回 null（不展示英文键） */
function diagramTypeLabel(hint?: string): string | null {
  if (!hint?.trim()) return null;
  const raw = hint.trim();
  const k = raw.toLowerCase();
  if (DIAGRAM_TYPE_LABELS[k]) return DIAGRAM_TYPE_LABELS[k];
  if (/[\u4e00-\u9fff]/.test(raw)) return raw;
  return null;
}

/** 右栏展示的插图说明：长 diagramBrief 时优先用更短的 plan.brief，否则截断 */
function pickDiagramBriefText(section: {
  diagramBrief?: string;
  diagramPlan?: { brief?: string };
}): { text: string; note?: string } {
  const db = (section.diagramBrief || '').trim();
  const pb = (section.diagramPlan?.brief || '').trim();
  if (!db && !pb) return { text: '' };
  if (db.length > DIAGRAM_BRIEF_LONG) {
    if (pb && pb.length < db.length) {
      const t = pb.length > DIAGRAM_BRIEF_LONG ? `${pb.slice(0, 160)}…` : pb;
      return { text: t, note: '已优先展示规划中的较短说明' };
    }
    return { text: `${db.slice(0, 160)}…`, note: '说明较长，已截断展示' };
  }
  const primary = db || pb;
  if (primary.length > DIAGRAM_BRIEF_LONG) {
    return { text: `${primary.slice(0, 160)}…`, note: '说明较长，已截断展示' };
  }
  return { text: primary };
}

function remapWritingHintIds(hint?: string): string {
  if (!hint) return '';
  return hint
    .replace(/\[id:([a-z_]+)\]/gi, (_, id) => `「${ANALYSIS_ID_LABEL_MAP[id] || id}」`)
    .replace(/【id:([a-z_]+)】/gi, (_, id) => `「${ANALYSIS_ID_LABEL_MAP[id] || id}」`)
    .trim();
}

/** 组件层只存核心写作意图，系统默认规则由后端按当前参数重建 */
function normalizeWritingIntent(hint?: string): string {
  return extractCoreWritingIntent(remapWritingHintIds(hint));
}

function sanitizeOutlineSections(sections: OutlineSection[]): OutlineSection[] {
  return (sections || []).map((section) => ({
    ...section,
    writingHint: normalizeWritingIntent(section.writingHint),
    children: (section.children || []).map((child) => ({
      ...child,
      writingHint: normalizeWritingIntent(child.writingHint),
    })),
  }));
}

/** 二级节预算字数：含三级时按三级汇总，与后端归一化及树展示一致 */
function subSectionBudgetWords(sub: OutlineSubSection): number {
  if (sub.children?.length) {
    return sub.children.reduce((s, t) => s + (t.wordCount ?? 0), 0);
  }
  return sub.wordCount;
}

function sectionBudgetTotal(sec: OutlineSection): number {
  // 一级章节预算始终以自身 wordCount 为准（可独立配置，不强制取子章节汇总）
  return sec.wordCount;
}

function analyzeOutlineFallback(secs: OutlineSection[]): {
  totalChildren: number;
  fallbackChildren: number;
  fallbackRatio: number;
  degraded: boolean;
  criticalFailures: string[];
} {
  let totalChildren = 0;
  let fallbackChildren = 0;
  const criticalFailures = new Set<string>();
  for (const sec of secs || []) {
    const sectionTitle = String(sec.title || '').trim();
    const isCritical = ['售后服务方案', '响应情况', '项目实施目标'].includes(sectionTitle);
    const selfGenerating = Boolean((sec as any).generatesFromSelf || (sec as any).generationStrategy === 'response_special');
    for (const child of sec.children || []) {
      totalChildren += 1;
      const title = String(child.title || '').trim();
      const hint = String(child.writingHint || '').trim();
      const kwCount = Array.isArray(child.keywords) ? child.keywords.length : 0;
      const fallbackLike = (
        /(重点响应|补充说明|待补充|默认小节)$/u.test(title)
        && (hint.length === 0 || kwCount <= 1)
      );
      if (fallbackLike) {
        fallbackChildren += 1;
        if (isCritical) criticalFailures.add(sectionTitle);
      }
    }
    if (isCritical && (!sec.children || sec.children.length === 0) && !selfGenerating) criticalFailures.add(sectionTitle);
    if (selfGenerating) {
      const hint = String(sec.writingHint || '').trim();
      const kwCount = Array.isArray(sec.keywords) ? sec.keywords.length : 0;
      if (!hint || kwCount <= 1) criticalFailures.add(sectionTitle);
    }
  }
  const fallbackRatio = fallbackChildren / Math.max(totalChildren, 1);
  const degraded = criticalFailures.size > 0 || (totalChildren >= 6 && fallbackRatio >= 0.5);
  return { totalChildren, fallbackChildren, fallbackRatio, degraded, criticalFailures: Array.from(criticalFailures) };
}

function sectionIndexLabel(sectionIndex: number): string {
  return `${sectionIndex + 1}`;
}

function subSectionIndexLabel(sectionIndex: number, childIndex: number): string {
  return `${sectionIndex + 1}.${childIndex + 1}`;
}

function resolveInitialOutlineSections(project: Project): OutlineSection[] {
  const fresh = projectService.getById(project.id);
  const latestOutline = fresh?.outline || project.outline || [];
  if (latestOutline.length > 0) return sanitizeOutlineSections(latestOutline);
  return sanitizeOutlineSections(buildInitialOutlineFromTechnicalHeadings(fresh?.analysisV2 || project.analysisV2));
}

/** 将解析报告内容中的 XML 自定义标签转换为可读文本（关联报告恢复时启用） */
// const formatAnalysisContent = (raw: string): string => {
//   return raw
//     .replace(/<(要点|摘要|总结|说明|标准|条件|范围|方案|指标)[^>]*>/gi, '【$1】')
//     .replace(/<\/(要点|摘要|总结|说明|标准|条件|范围|方案|指标)>/gi, '')
//     .replace(/<[^>]+>/g, '')
//     .replace(/\n{3,}/g, '\n\n')
//     .trim();
// };

/* ─── 类型 ─── */
interface OutlineGeneratorProps {
  project: Project;
  onConfirm: (project: Project) => void;
  /** 通知父组件当前是否正在生成大纲 */
  onBusyChange?: (busy: boolean) => void;
  isLocked?: boolean;
}

type OutlineBatchItem = {
  index: number;
  status: 'pending' | 'running' | 'done';
  startedAtMs?: number;
  finishedAtMs?: number;
  elapsedSec?: number;
};

type RetryState = {
  active: boolean;
  batchIndex: number;
  totalBatches: number;
  issues: string[];
  elapsedSec: number;
};

/* ─── 可拖拽行组件 ─── */
function SortableRow({ id, children, className, isLocked }: { id: string; children: React.ReactNode; className?: string; isLocked?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 50 : undefined, opacity: isDragging ? 0.5 : 1 };
  return (
    <div ref={setNodeRef} style={style} className={className}>
      {!isLocked && (
        <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-1 rounded hover:bg-gray-100 shrink-0">
          <GripVertical className="w-3 h-3 text-gray-300" />
        </div>
      )}
      {children}
    </div>
  );
}

/* ─── 主组件 ─── */
export function OutlineGenerator({ project, onConfirm, onBusyChange, isLocked }: OutlineGeneratorProps) {
  const initialSectionsRef = useRef<OutlineSection[] | null>(null);
  if (initialSectionsRef.current === null) {
    initialSectionsRef.current = resolveInitialOutlineSections(project);
  }
  const initialSections = initialSectionsRef.current || [];
  const [stages, setStages] = useState<string[]>([]);
  const [, setCurrentStage] = useState('');
  const [stagePercent, setStagePercent] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);
  const [, setBatchProgress] = useState<Record<number, OutlineBatchItem>>({});
  const [h3WindowProgress, setH3WindowProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [metaWindowProgress, setMetaWindowProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [retryState, setRetryState] = useState<RetryState>({
    active: false,
    batchIndex: 0,
    totalBatches: 0,
    issues: [],
    elapsedSec: 0,
  });
  const [executionTrace, setExecutionTrace] = useState<any[]>([]);
  const [isDone, setIsDone] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [sections, setSections] = useState<OutlineSection[]>(initialSections);
  const [error, setError] = useState<string | null>(null);
  const [isCancelled, setIsCancelled] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(initialSections[0]?.id || null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set(initialSections.map((section) => section.id)));

  // 编辑状态
  const [editingField, setEditingField] = useState<{ id: string; field: 'title' | 'wordCount' | 'writingHint' } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editingKeywordsFor, setEditingKeywordsFor] = useState<string | null>(null);
  const [newKeywordInput, setNewKeywordInput] = useState('');
  const [showRegenWarn, setShowRegenWarn] = useState(false);
  // 关联解析报告暂隐藏，state 保留备用
  // const [expandedAnalysisIds, setExpandedAnalysisIds] = useState<Set<string>>(new Set());
  // const [editingAnalysisFor, setEditingAnalysisFor] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const connectedTaskRef = useRef<string>('');
  const seenStageRef = useRef<Set<string>>(new Set());
  const seenEventIdRef = useRef<Set<string>>(new Set());
  const lastStageIndexRef = useRef(-1);
  // 前端只保留本地任务键，项目级运行态以后端 taskRuntime 为准
  const taskKey = `outline_task_${project.id}`;
  const MILESTONE_STAGES = ['📤 模型连接中', '🧠 模型预热中', '✍️ 生成大纲', '🧾 大纲归一化中', '✅ 大纲结构已就绪'] as const;
  const normalizeMilestoneStage = (raw: string): string | null => {
    const s = (raw || '').trim();
    if (!s) return null;
    if (s.includes('模型连接中')) return '📤 模型连接中';
    if (s.includes('模型预热中')) return '🧠 模型预热中';
    if (
      s.includes('生成大纲')
      || s.includes('大纲润色')
      || s.includes('H2 骨架')
      || s.includes('H3 分段')
      || s.includes('元数据并行')
      || s.includes('输出清洗')
    ) return '✍️ 生成大纲';
    if (s.includes('归一化') || s.includes('解析中') || s.includes('数据校验')) return '🧾 大纲归一化中';
    if (s.includes('结构已就绪') || s.includes('解析完成')) return '✅ 大纲结构已就绪';
    return null;
  };
  const resetProgressTracks = () => {
    setTotalBatches(0);
    setBatchProgress({});
    setH3WindowProgress({ current: 0, total: 0 });
    setMetaWindowProgress({ current: 0, total: 0 });
    setRetryState({
      active: false,
      batchIndex: 0,
      totalBatches: 0,
      issues: [],
      elapsedSec: 0,
    });
    setExecutionTrace([]);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    const fresh = projectService.getById(project.id);
    const pendingTaskId = localStorage.getItem(taskKey);
    const runtimeTaskId = fresh?.taskRuntime?.taskType === 'outline'
      ? (fresh.taskRuntime.taskId || '')
      : '';
    const runtimeBusy = fresh?.taskRuntime?.taskType === 'outline'
      && (fresh.taskRuntime.state === 'running' || fresh.taskRuntime.state === 'cancelling' || fresh.taskRuntime.state === 'queued');
    const latestOutline = fresh?.outline || project.outline || [];
    const seedOutline = latestOutline.length > 0
      ? latestOutline
      : buildInitialOutlineFromTechnicalHeadings(fresh?.analysisV2 || project.analysisV2);

    if (seedOutline.length > 0) {
      setSections(seedOutline);
      setExpandedIds(new Set(seedOutline.map(s => s.id)));
      if (!selectedSectionId) setSelectedSectionId(seedOutline[0].id);
    }

    const effectiveTaskId = pendingTaskId || runtimeTaskId;
    if (effectiveTaskId && runtimeBusy) {
      setIsDone(false);
      setError(null);
      if (connectedTaskRef.current !== effectiveTaskId) {
        connectProgress(effectiveTaskId);
      }
      return;
    }

    if (latestOutline && latestOutline.length > 0) {
      const shouldKeepGenerating = Boolean(
        (fresh?.status ?? project.status) === 'generating_outline'
        || pendingTaskId
        || runtimeBusy,
      );
      setIsDone(!shouldKeepGenerating);
      if (!shouldKeepGenerating && (fresh?.status ?? project.status) === 'generating_outline') {
        const updated = projectService.update(project.id, { status: 'outline_ready' });
        if (updated) onConfirm(updated);
      }
    } else {
      // 仅有骨架或空数据时，维持“未完成”态，展示等待样式
      setIsDone(false);
    }
    return;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, project.status, project.taskRuntime?.taskId, project.taskRuntime?.state, project.outline?.length, project.analysisV2?.schema_version]);

  // 仅在组件卸载或切换项目时断开 SSE，避免依赖变更触发的误中断
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      connectedTaskRef.current = '';
    };
  }, [project.id]);

  // 持久化 helper
  const persist = (updated: OutlineSection[]) => {
    const sanitized = sanitizeOutlineSections(updated);
    setSections(sanitized);
    projectService.update(project.id, { outline: sanitized });
  };

  const persistTerminalRuntime = (
    runtimeState: 'succeeded' | 'cancelled' | 'failed' | 'timed_out',
    options?: {
      outline?: OutlineSection[];
      status?: Project['status'];
      message?: string;
      progress?: number;
    },
  ) => {
    const fresh = projectService.getById(project.id);
    const currentRuntime = fresh?.taskRuntime;
    const taskId = currentRuntime?.taskType === 'outline'
      ? (currentRuntime.taskId || '')
      : (localStorage.getItem(taskKey) || connectedTaskRef.current || '');
    const updated = projectService.update(project.id, {
      ...(options?.outline ? { outline: sanitizeOutlineSections(options.outline) } : {}),
      ...(options?.status ? { status: options.status } : {}),
      taskRuntime: {
        ...(currentRuntime || {}),
        state: runtimeState,
        taskId,
        taskType: 'outline',
        message: options?.message ?? '',
        progress: options?.progress ?? (runtimeState === 'succeeded' ? 100 : 0),
        cancellable: false,
        updatedAt: new Date().toISOString(),
      },
    });
    if (updated) onConfirm(updated);
  };

  /* ─── 检测下游是否已有技术方案正文 ─── */
  const getExistingContentCount = (): number => {
    const fresh = projectService.getById(project.id);
    const gc = fresh?.generatedContent;
    if (!gc) return 0;
    return Object.values(gc).filter(v => v.status === 'done' && v.content).length;
  };

  // 用户主动触发重新生成（带下游覆盖警告）
  const handleRegenerate = () => {
    const count = getExistingContentCount();
    if (count > 0) {
      setShowRegenWarn(true);
    } else {
      generate();
    }
  };

  /* ─── 连接 SSE 进度流（支持重连） ─── */
  const connectProgress = (taskId: string) => {
    abortRef.current?.abort();
    if (connectedTaskRef.current !== taskId) {
      seenStageRef.current.clear();
      seenEventIdRef.current.clear();
      lastStageIndexRef.current = -1;
      resetProgressTracks();
    }
    connectedTaskRef.current = taskId;
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const normalizeSections = (rawSecs: OutlineSection[]): OutlineSection[] => {
      const usedIds = new Set<string>();
      const ensureUniqueId = (id: string): string => {
        let uid = id; let n = 1;
        while (usedIds.has(uid)) { uid = `${id}_dup${n++}`; }
        usedIds.add(uid); return uid;
      };
      const toDiagramPlan = (obj: any) => {
        const plan = obj?.diagramPlan || obj?.diagram_plan;
        if (!plan) return undefined;
        return {
          enabled: Boolean(plan.enabled),
          brief: String(plan.brief || ''),
          typeHint: plan.typeHint || plan.type_hint,
          priority: typeof plan.priority === 'number' ? plan.priority : undefined,
        };
      };
      const normalizeDiagramMeta = (obj: any, parentStrategy?: string, parentSelfGenerating?: boolean) => {
        const generationStrategy = String(obj?.generationStrategy ?? obj?.generation_strategy ?? parentStrategy ?? 'general');
        const generatesFromSelf = Boolean(obj?.generatesFromSelf ?? obj?.generates_from_self ?? parentSelfGenerating ?? false);
        const plan = toDiagramPlan(obj);
        const rawBrief = String(obj?.diagramBrief ?? obj?.diagram_brief ?? plan?.brief ?? '').trim();
        const rawNeedDiagram = Boolean(obj?.needDiagram ?? obj?.need_diagram ?? plan?.enabled ?? false);
        const hasChildren = Array.isArray(obj?.children) && obj.children.length > 0;
        const isSelfGenerating = generationStrategy === 'response_special' || generatesFromSelf;
        const disabled = hasChildren || isSelfGenerating || !rawNeedDiagram || !rawBrief;
        return {
          needDiagram: !disabled,
          diagramBrief: disabled ? '' : rawBrief,
          diagramPlan: plan
            ? {
                ...plan,
                enabled: !disabled && Boolean(plan.enabled),
                brief: disabled ? '' : String(plan.brief || '').trim(),
                priority: !disabled ? plan.priority : 0,
              }
            : (disabled ? undefined : plan),
          generationStrategy,
          generatesFromSelf,
        };
      };
      return (rawSecs || []).map((s: any) => ({
        ...s, id: ensureUniqueId(s.id),
        writingHint: normalizeWritingIntent(s.writingHint),
        ...normalizeDiagramMeta(s),
        children: (s.children || []).map((c: any) => ({
          ...c,
          id: ensureUniqueId(c.id),
          writingHint: normalizeWritingIntent(c.writingHint),
          ...normalizeDiagramMeta(
            c,
            s?.generationStrategy ?? s?.generation_strategy ?? 'general',
            Boolean(s?.generatesFromSelf ?? s?.generates_from_self ?? ((s?.generationStrategy ?? s?.generation_strategy) === 'response_special')),
          ),
        })),
      }));
    };

    const pushStage = (label: string) => {
      const text = normalizeMilestoneStage(label);
      if (!text) return;
      const stageIndex = MILESTONE_STAGES.indexOf(text as typeof MILESTONE_STAGES[number]);
      if (stageIndex === -1) return;
      if (stageIndex <= lastStageIndexRef.current) return;
      lastStageIndexRef.current = stageIndex;
      if (seenStageRef.current.has(text)) return;
      seenStageRef.current.add(text);
      setStages(MILESTONE_STAGES.slice(0, stageIndex + 1) as string[]);
    };

    (async () => {
      try {
        const resp = await projectService.openTaskProgressStream(taskId, project.id, ctrl.signal);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const reader = resp.body!.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split('\n\n');
          buf = parts.pop() ?? '';
          for (const part of parts) {
            let eventType = 'message';
            let eventData = '';
            for (const line of part.split('\n')) {
              if (line.startsWith('event: ')) eventType = line.slice(7).trim();
              if (line.startsWith('data: ')) eventData = line.slice(6);
            }
            if (!eventData) continue;
            try {
              const data = JSON.parse(eventData);
              const eventId = data?.event_id != null ? String(data.event_id) : '';
              if (eventId) {
                if (seenEventIdRef.current.has(eventId)) continue;
                seenEventIdRef.current.add(eventId);
              }
              if (data.error) {
                setError(data.error);
                setRetryState((prev) => ({ ...prev, active: false }));
                setIsDone(true);
                setIsCancelling(false);
                setIsStarting(false);
                persistTerminalRuntime('failed', {
                  status: sections.length > 0 ? 'outline_ready' : 'report_done',
                  message: String(data.error || ''),
                  progress: 0,
                });
                _clearTaskId();
                continue;
              }
              if (data.cancelled || eventType === 'cancelled') {
                setIsCancelled(true);
                setRetryState((prev) => ({ ...prev, active: false }));
                setIsDone(true);
                setCurrentStage('');
                setIsCancelling(false);
                setIsStarting(false);
                persistTerminalRuntime('cancelled', {
                  status: sections.length > 0 ? 'outline_ready' : 'report_done',
                  message: '',
                  progress: 0,
                });
                _clearTaskId();
                continue;
              }
              if (eventType === 'control' && data.response_branch) {
                // 控制类事件只用于分支判断，不展示为里程碑节点，避免噪音
                continue;
              }
              if (eventType === 'execution_trace') {
                setExecutionTrace((prev) => {
                  const next = [...prev, data];
                  return next.slice(-120);
                });
                continue;
              }
              if (eventType === 'outline_retry') {
                setRetryState({
                  active: true,
                  batchIndex: Number(data.batch_index || 0),
                  totalBatches: Number(data.total_batches || totalBatches || 0),
                  issues: Array.isArray(data.issues) ? data.issues.map((x: any) => String(x || '').trim()).filter(Boolean) : [],
                  elapsedSec: Number(data.elapsed_sec || elapsedSec || 0),
                });
                setCurrentStage(String(data.label || '⚠️ 结构校验失败'));
                continue;
              }
              if (eventType === 'outline_batch' && data.total_batches) {
                const tb = Number(data.total_batches || 0);
                if (tb > 0) setTotalBatches(tb);
                const started = String(data.status || '') === 'started';
                const finished = String(data.status || '') === 'finished';
                const bi = Number(data.finished_batch_index || data.batch_index || 0);
                if (bi > 0) {
                  setBatchProgress((prev) => {
                    const old = prev[bi] || { index: bi, status: 'pending' as const };
                    const next: OutlineBatchItem = {
                      ...old,
                      index: bi,
                      status: finished ? 'done' : (started ? 'running' : old.status),
                      startedAtMs: started ? Date.now() : old.startedAtMs,
                      finishedAtMs: finished ? Date.now() : old.finishedAtMs,
                      elapsedSec: Number(data.batch_elapsed_sec || old.elapsedSec || 0),
                    };
                    return { ...prev, [bi]: next };
                  });
                }
                if (finished) {
                  setCurrentStage(`已完成 ${Number(data.completed_batches || 0)}/${tb} 批大纲`);
                } else {
                  setCurrentStage(`正在启动第 ${bi}/${tb} 批大纲...`);
                }
                continue;
              }
              if (eventType === 'stage' && data.label) {
                const stage = normalizeMilestoneStage(String(data.label));
                if (stage) setCurrentStage(stage);
                else if (String(data.label || '').includes('第') && String(data.label || '').includes('批')) setCurrentStage(String(data.label));
                else if (String(data.label || '').includes('重试')) setCurrentStage(String(data.label));
                if (typeof data.percent === 'number') {
                  setStagePercent((prev) => Math.max(prev, Math.max(0, Math.min(100, data.percent))));
                }
                if (typeof data.elapsed_sec === 'number') setElapsedSec(Math.max(0, data.elapsed_sec));
                if (!data.heartbeat) pushStage(data.label);
                continue;
              }
              if (eventType === 'h3_batch') {
                const cur = Number(data.window_index || 0);
                const total = Number(data.total_windows || 0);
                setH3WindowProgress({ current: cur, total });
                continue;
              }
              if (eventType === 'meta_batch') {
                const cur = Number(data.window_index || 0);
                const total = Number(data.total_windows || 0);
                setMetaWindowProgress({ current: cur, total });
                continue;
              }
              if (eventType === 'h2_seed' || eventType === 'h3_batch' || eventType === 'meta_batch' || eventType === 'partial_outline') {
                const secs = normalizeSections(data.sections || []);
                if (secs.length) {
                  persist(secs);
                  setExpandedIds(new Set(secs.map(s => s.id)));
                  if (!selectedSectionId) setSelectedSectionId(secs[0].id);
                  const qa = analyzeOutlineFallback(secs);
                  if (qa.degraded) setCurrentStage('⚠️ 结构质量校验中');
                }
                continue;
              }
              if (data.stage) {
                const stage = normalizeMilestoneStage(String(data.stage));
                if (stage) setCurrentStage(stage);
                else if (String(data.stage || '').includes('第') && String(data.stage || '').includes('批')) setCurrentStage(String(data.stage));
                else if (String(data.stage || '').includes('重试')) setCurrentStage(String(data.stage));
                if (typeof data.percent === 'number') {
                  setStagePercent((prev) => Math.max(prev, Math.max(0, Math.min(100, data.percent))));
                }
                if (typeof data.elapsed_sec === 'number') setElapsedSec(Math.max(0, data.elapsed_sec));
                if (eventType !== 'stage' && !data.heartbeat) pushStage(data.stage);
                continue;
              }
              if (data.done) {
                if (Array.isArray(data.execution_trace)) setExecutionTrace(data.execution_trace.slice(-120));
                if (typeof data.total_batches === 'number') setTotalBatches(Math.max(0, data.total_batches));
                const secs = normalizeSections(data.sections ?? []);
                if (secs.length > 0) {
                  const qa = analyzeOutlineFallback(secs);
                  if (qa.degraded) setCurrentStage('⚠️ 结构质量校验中');
                  persist(secs);
                  setExpandedIds(new Set(secs.map(s => s.id)));
                  setSelectedSectionId(secs[0].id);
                  persistTerminalRuntime('succeeded', {
                    outline: secs,
                    status: 'outline_ready',
                    message: '',
                    progress: 100,
                  });
                } else { setError('未收到大纲数据'); }
                setIsDone(true); setCurrentStage(''); setIsCancelling(false); setIsStarting(false);
                setRetryState((prev) => ({ ...prev, active: false }));
                _clearTaskId();
                connectedTaskRef.current = '';
              }
            } catch { /* ignore */ }
          }
        }
        // 连接自然结束（可能发生在最后一帧未被前端消费时），主动查询一次任务终态进行收敛。
        try {
          const st = await projectService.getTaskStatus(taskId, project.id);
          if ((st?.state === 'succeeded' || st?.status === 'done') && st.result?.sections?.length) {
            const secs = normalizeSections(st.result.sections);
            if (Array.isArray(st?.result?.execution_trace)) setExecutionTrace(st.result.execution_trace.slice(-120));
            if (typeof st?.result?.total_batches === 'number') setTotalBatches(Math.max(0, st.result.total_batches));
            persist(secs);
            setExpandedIds(new Set(secs.map(s => s.id)));
            if (!selectedSectionId && secs[0]?.id) setSelectedSectionId(secs[0].id);
            persistTerminalRuntime('succeeded', {
              outline: secs,
              status: 'outline_ready',
              message: '',
              progress: 100,
            });
            setIsDone(true);
            setError(null);
            setRetryState((prev) => ({ ...prev, active: false }));
            setIsCancelling(false);
            setIsStarting(false);
            _clearTaskId();
            connectedTaskRef.current = '';
            return;
          }
          if (st?.state === 'cancelled' || st?.status === 'cancelled' || st?.cancelled) {
            setIsCancelled(true);
            setIsDone(true);
            setRetryState((prev) => ({ ...prev, active: false }));
            setIsCancelling(false);
            setIsStarting(false);
            persistTerminalRuntime('cancelled', {
              status: sections.length > 0 ? 'outline_ready' : 'report_done',
              message: '',
              progress: 0,
            });
            _clearTaskId();
            connectedTaskRef.current = '';
            return;
          }
          if (st?.state === 'failed' || st?.state === 'timed_out' || st?.error || st?.timed_out) {
            setError(st?.error || '大纲生成失败');
            setIsDone(true);
            setRetryState((prev) => ({ ...prev, active: false }));
            setIsCancelling(false);
            setIsStarting(false);
            persistTerminalRuntime(st?.state === 'timed_out' ? 'timed_out' : 'failed', {
              status: sections.length > 0 ? 'outline_ready' : 'report_done',
              message: st?.error || '',
              progress: 0,
            });
            _clearTaskId();
            connectedTaskRef.current = '';
            return;
          }
        } catch {
          // ignore: 保持现有 UI 状态
        }
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
        console.warn('[outline progress] 连接中断:', e?.message || e);
        try {
          const st = await projectService.getTaskStatus(taskId, project.id);
          if (st?.state === 'running' || st?.status === 'running') {
            setTimeout(() => connectProgress(taskId), 1200);
            return;
          }
          if ((st?.state === 'succeeded' || st?.status === 'done') && st.result?.sections?.length) {
            const secs = normalizeSections(st.result.sections);
            if (Array.isArray(st?.result?.execution_trace)) setExecutionTrace(st.result.execution_trace.slice(-120));
            if (typeof st?.result?.total_batches === 'number') setTotalBatches(Math.max(0, st.result.total_batches));
            const qa = analyzeOutlineFallback(secs);
            if (qa.degraded) setCurrentStage('⚠️ 结构质量校验中');
            persist(secs);
            setIsDone(true);
            setError(null);
            setRetryState((prev) => ({ ...prev, active: false }));
            setIsCancelling(false);
            setIsStarting(false);
            persistTerminalRuntime('succeeded', {
              outline: secs,
              status: 'outline_ready',
              message: '',
              progress: 100,
            });
            _clearTaskId();
            connectedTaskRef.current = '';
            return;
          }
          if (st?.state === 'cancelled' || st?.status === 'cancelled' || st?.cancelled) {
            setIsCancelled(true);
            setIsDone(true);
            setRetryState((prev) => ({ ...prev, active: false }));
            setIsCancelling(false);
            setIsStarting(false);
            persistTerminalRuntime('cancelled', {
              status: sections.length > 0 ? 'outline_ready' : 'report_done',
              message: '',
              progress: 0,
            });
            _clearTaskId();
            connectedTaskRef.current = '';
            return;
          }
        } catch {
          // ignore
        }
        setIsCancelling(false);
        setIsStarting(false);
        _clearTaskId();
        connectedTaskRef.current = '';
        setIsDone(true);
        persistTerminalRuntime('failed', {
          status: sections.length > 0 ? 'outline_ready' : 'report_done',
          message: e?.message || '',
          progress: 0,
        });
      }
    })();
  };

  const _saveTaskId = (tid: string) => {
    localStorage.setItem(taskKey, tid);
  };
  const _clearTaskId = () => {
    localStorage.removeItem(taskKey);
    connectedTaskRef.current = '';
  };

  /* ─── 后台任务模式：start + progress（防刷新中断） ─── */
  const generate = () => {
    if (isLocked) return;
    abortRef.current?.abort();
    setIsStarting(true);
    seenStageRef.current.clear();
    lastStageIndexRef.current = -1;
    resetProgressTracks();
    setStages([]); setCurrentStage(''); setIsDone(false); setError(null);
    setStagePercent(0); setElapsedSec(0);
    const seed = buildInitialOutlineFromTechnicalHeadings(projectService.getById(project.id)?.analysisV2 || project.analysisV2);
    if (seed.length) {
      setSections(seed);
      setExpandedIds(new Set(seed.map((s) => s.id)));
      setSelectedSectionId(seed[0].id);
      projectService.update(project.id, { outline: seed, status: 'generating_outline' });
    } else {
      setSections([]);
      setSelectedSectionId(null);
      projectService.update(project.id, { status: 'generating_outline' });
    }

    (async () => {
      try {
        const { taskId } = await projectService.startOutlineTask(project.id);
        _saveTaskId(taskId);
        setIsStarting(false);
        connectProgress(taskId);
      } catch (e: any) {
        setIsStarting(false);
        setError(e?.message || '大纲生成失败');
        setIsDone(true);
        persistTerminalRuntime('failed', {
          status: sections.length > 0 ? 'outline_ready' : 'report_done',
          message: e?.message || '大纲生成失败',
          progress: 0,
        });
      }
    })();
  };

  /* ─── 编辑操作 ─── */
  const startEdit = (id: string, field: 'title' | 'wordCount' | 'writingHint') => {
    const sec = findAny(id);
    if (!sec) return;
    setEditingField({ id, field });
    const currentValue = field === 'wordCount'
      ? String(sec.wordCount)
      : (field === 'writingHint'
        ? normalizeWritingIntent((sec as any)[field] || '')
        : (sec as any)[field] || '');
    setEditValue(currentValue);
  };

  const cancelEdit = () => {
    setEditingField(null);
    setEditValue('');
  };

  const commitEdit = () => {
    if (!editingField) return;
    const { id, field } = editingField;
    const nextValue = field === 'wordCount'
      ? parseInt(editValue) || 0
      : (field === 'writingHint' ? normalizeWritingIntent(editValue) : editValue);
    const updated = sections.map(s => {
      if (s.id === id) {
        return { ...s, [field]: nextValue };
      }
      return { ...s, children: s.children.map(c => c.id === id ? { ...c, [field]: nextValue } : c) };
    });
    persist(updated);
    cancelEdit();
  };

  const deleteSection = (id: string) => {
    const updated = sections.filter(s => s.id !== id).map(s => ({
      ...s, children: s.children.filter(c => c.id !== id),
    }));
    persist(updated);
    if (selectedSectionId === id) setSelectedSectionId(null);
  };

  /* ─── 拖拽排序 ─── */
  const handleDragEnd = (event: DragEndEvent) => {
    if (isLocked) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    // 一级章节排序
    const aIdx = sections.findIndex(s => s.id === activeId);
    const oIdx = sections.findIndex(s => s.id === overId);
    if (aIdx !== -1 && oIdx !== -1) {
      persist(arrayMove(sections, aIdx, oIdx));
      return;
    }

    // 二级子章节排序（同一父级内）
    for (const sec of sections) {
      const ca = sec.children.findIndex(c => c.id === activeId);
      const co = sec.children.findIndex(c => c.id === overId);
      if (ca !== -1 && co !== -1) {
        const updated = sections.map(s =>
          s.id === sec.id ? { ...s, children: arrayMove(s.children, ca, co) } : s
        );
        persist(updated);
        return;
      }
    }
  };

  /* ─── 关键词 ─── */
  const handleAddKeyword = (sectionId: string) => {
    if (!newKeywordInput.trim()) return;
    const updated = sections.map(s => {
      if (s.id === sectionId) return { ...s, keywords: [...(s.keywords || []), newKeywordInput.trim()] };
      return { ...s, children: s.children.map(c => c.id === sectionId ? { ...c, keywords: [...(c.keywords || []), newKeywordInput.trim()] } : c) };
    });
    persist(updated);
    setNewKeywordInput('');
  };

  const handleRemoveKeyword = (sectionId: string, kw: string) => {
    const updated = sections.map(s => {
      if (s.id === sectionId) return { ...s, keywords: (s.keywords || []).filter(k => k !== kw) };
      return { ...s, children: s.children.map(c => c.id === sectionId ? { ...c, keywords: (c.keywords || []).filter(k => k !== kw) } : c) };
    });
    persist(updated);
  };

  const handleConfigConfirm = (config: TechProposalConfig) => {
    projectService.update(project.id, {
      targetConfig: config,
      status: 'generating_outline',
    });
    setShowConfig(false);
    generate();
  };

  /* ─── 工具函数 ─── */
  const toggleExpand = (id: string) => setExpandedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  type SelectedItem = (OutlineSection | OutlineSubSection) & { _parent?: OutlineSection; _isSubSection?: boolean };
  const findAny = (id: string | null): SelectedItem | null => {
    if (!id) return null;
    for (const s of sections) {
      if (s.id === id) return s;
      for (const c of s.children) if (c.id === id) return { ...c, _parent: s, _isSubSection: true };
    }
    return null;
  };

  const selectedSection = findAny(selectedSectionId);
  const totalWordCount = sections.reduce((s, sec) => s + sectionBudgetTotal(sec), 0);
  const hasWordBudget = sections.some((sec) =>
    sectionBudgetTotal(sec) > 0 || sec.children.some((c) => subSectionBudgetWords(c) > 0),
  );
  const currentConfig = projectService.getById(project.id)?.targetConfig ?? project.targetConfig;
  const runtimeOutlineBusy = (project.taskRuntime?.taskType === 'outline')
    && (project.taskRuntime?.state === 'running' || project.taskRuntime?.state === 'cancelling' || project.taskRuntime?.state === 'queued');
  const hasPendingTask = !!localStorage.getItem(taskKey);
  // 真实生成态：覆盖“任务已发出但尚未收到首条 SSE”的窗口
  const isActuallyGenerating = !isDone && (
    isStarting
    || hasPendingTask
    || runtimeOutlineBusy
    || stages.length > 0
    || project.status === 'generating_outline'
  );
  const isGenerating = isActuallyGenerating;
  const isSectionPending = (section: OutlineSection): boolean => {
    if (!isActuallyGenerating) return false;
    if (section.children.length === 0) return true;
    if (section.wordCount <= 0 || !String(section.writingHint || '').trim()) return true;
    return section.children.some((child) => child.wordCount <= 0 || !String(child.writingHint || '').trim());
  };
  const isSubSectionPending = (child: OutlineSubSection): boolean => (
    isActuallyGenerating && (child.wordCount <= 0 || !String(child.writingHint || '').trim())
  );
  const selectedSectionPending = selectedSection
    ? (selectedSection._isSubSection
      ? isSubSectionPending(selectedSection as OutlineSubSection)
      : isSectionPending(selectedSection as OutlineSection))
    : false;
  useEffect(() => {
    onBusyChange?.(isActuallyGenerating);
    return () => { onBusyChange?.(false); };
  }, [isActuallyGenerating, onBusyChange]);

  /* ─── 内联编辑 input ─── */
  const InlineEdit = ({ field }: { field: 'title' | 'wordCount' }) => {
    if (editingField?.id !== selectedSectionId || editingField?.field !== field) return null;
    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(); }
      if (e.key === 'Escape') cancelEdit();
    };
    return (
      <div className="flex gap-2 items-center mt-1">
        <input type={field === 'wordCount' ? 'number' : 'text'} value={editValue} onChange={e => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown} autoFocus
          className={clsx('text-sm border border-sky-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-sky-400',
            field === 'wordCount' ? 'w-28 font-mono' : 'flex-1')} />
        <button onClick={commitEdit} className="p-1.5 bg-sky-100 text-sky-600 rounded-lg hover:bg-sky-200 shrink-0">
          <Check className="w-4 h-4" />
        </button>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-xl overflow-hidden border border-gray-200 shadow-sm">
      {/* ── 顶栏 ── */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 bg-sky-50 rounded-lg">
            <Sparkles className="w-4 h-4 text-sky-600" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
              技术方案大纲生成
              {isLocked && <span className="bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded text-[10px] font-normal border border-gray-200">只读</span>}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {isGenerating ? '生成中'
                : isDone && sections.length > 0
                  ? `已生成 ${sections.length} 个二级标题 / ${sections.reduce((s, sec) => s + sec.children.length, 0)} 个三级标题${
                      hasWordBudget ? ` · 预算合计 ${totalWordCount.toLocaleString()} 字` : ''
                    }${
                      hasWordBudget && currentConfig?.totalWords != null && currentConfig.totalWords > 0
                        ? `（配置目标 ${currentConfig.totalWords.toLocaleString()} 字）`
                        : ''
                    }`
                  : '基于解析报告中的技术结构 heading，生成其下三级标题与写作引导提示词'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowConfig(true)}
            disabled={isActuallyGenerating}
            className={clsx(
              'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border rounded-lg transition-colors',
              isActuallyGenerating
                ? 'text-gray-300 border-gray-100 bg-gray-50 cursor-not-allowed'
                : 'text-gray-600 border-gray-200 hover:bg-gray-50'
            )}
          >
            <Settings2 className="w-3 h-3" />配置
          </button>
          {isGenerating && (
            <button onClick={async () => {
              const runtimeTaskId = project.taskRuntime?.taskType === 'outline' ? project.taskRuntime?.taskId : '';
              const taskId = localStorage.getItem(taskKey) || runtimeTaskId || '';
              if (!taskId) return;
              setIsCancelling(true);
              setCurrentStage('正在取消任务...');
              setError(null);
              try {
                await projectService.cancelTask(taskId, project.id);
              } catch {
                setError('取消请求失败，请重试');
              }
            }}
              disabled={isCancelling}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-500 bg-gray-100 border border-gray-200 rounded-lg hover:bg-gray-200 transition-colors">
              <XCircle className="w-3 h-3" />{isCancelling ? '取消中...' : '取消'}
            </button>
          )}
          {isDone && !isLocked && (() => {
            const downstreamCount = getExistingContentCount();
            const isDisabled = downstreamCount > 0;
            return (
              <button
                onClick={isDisabled ? undefined : handleRegenerate}
                disabled={isDisabled}
                title={isDisabled ? `下游已生成 ${downstreamCount} 章正文，重新生成大纲会导致内容冲突` : undefined}
                className={clsx(
                  'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border rounded-lg transition-colors',
                  isDisabled
                    ? 'text-gray-300 border-gray-100 cursor-not-allowed bg-gray-50'
                    : 'text-gray-600 border-gray-200 hover:bg-gray-50'
                )}>
                <RefreshCw className="w-3 h-3" />重新生成
              </button>
            );
          })()}
        </div>
      </div>

      {isCancelled && (
        <div className="mx-6 mt-3 flex items-center gap-2 text-sm text-gray-500 bg-gray-50 border border-gray-200 px-4 py-2.5 rounded-lg">
          <XCircle className="w-4 h-4 shrink-0" /><span>【已取消】大纲生成已中断</span>
          {!isLocked && <button onClick={() => { setIsCancelled(false); generate(); }} className="ml-auto underline text-xs font-medium hover:text-gray-700">重新生成</button>}
        </div>
      )}
      {error && !isCancelled && (
        <div className="mx-6 mt-3 flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 px-4 py-2.5 rounded-lg">
          <AlertCircle className="w-4 h-4 shrink-0" /><span>运行异常，请稍后重试</span>
          {!isLocked && <button onClick={() => { setError(null); generate(); }} className="ml-auto underline text-xs font-medium hover:text-amber-800">重试</button>}
          <button
            onClick={() => {
              const payload = {
                error,
                retryState,
                stagePercent,
                elapsedSec,
                totalBatches,
                h3WindowProgress,
                metaWindowProgress,
                executionTrace: executionTrace.slice(-40),
              };
              navigator.clipboard?.writeText(`[Outline Error] ${new Date().toISOString()}\n${JSON.stringify(payload, null, 2)}`).catch(() => {});
            }}
            className="underline text-xs font-medium hover:text-amber-800">复制错误信息</button>
          <button className="underline text-xs font-medium text-gray-400 cursor-default">报告问题</button>
        </div>
      )}
      <TechProposalGate
        visible={showConfig}
        onCancel={() => setShowConfig(false)}
        onConfirm={handleConfigConfirm}
        initialConfig={currentConfig}
        disabled={isActuallyGenerating}
      />

      {/* ── 重新生成警告弹窗 ── */}
      {showRegenWarn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
            <div className="px-6 pt-6 pb-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                  <AlertCircle className="w-5 h-5 text-amber-600" />
                </div>
                <h3 className="text-base font-bold text-gray-900">下游内容将失效</h3>
              </div>
              <p className="text-sm text-gray-600 leading-relaxed">
                当前项目已生成 <span className="font-semibold text-amber-700">{getExistingContentCount()}</span> 章技术方案正文。重新生成大纲后，已有的正文内容将与新大纲不匹配，需要重新生成。
              </p>
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button onClick={() => setShowRegenWarn(false)}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors">取消</button>
              <button onClick={() => { setShowRegenWarn(false); generate(); }}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 transition-all shadow-sm">确认重新生成</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 两栏主体 ── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* 左栏：可拖拽章节树 */}
        <div className="w-[28rem] bg-white border-r border-gray-200 flex flex-col shrink-0">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-600">技术方案大纲结构</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {/* {isActuallyGenerating && sections.length > 0 && pendingSectionCount > 0 && (
              <div className="px-3 pt-3">
                <div className="flex items-center gap-2 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-600">
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  <span>{pendingSectionCount} 个章节生成中</span>
                </div>
              </div>
            )} */}
            {/* 空状态 */}
            {sections.length === 0 && isDone && (
              <div className="py-16 flex flex-col items-center text-gray-400 gap-2">
                <AlertCircle className="w-7 h-7 text-amber-400" />
                <p className="text-xs font-medium text-gray-500">未收到数据</p>
              </div>
            )}

            {/* 一级章节拖拽 */}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={sections.map(s => s.id)} strategy={verticalListSortingStrategy}>
                {sections.map((section, si) => {
                  const isExpanded = expandedIds.has(section.id);
                  const isSelected = selectedSectionId === section.id;
                  const sectionPending = isSectionPending(section);
                  return (
                    <div key={section.id}>
                      <SortableRow id={section.id} isLocked={isLocked}
                        className={clsx(
                          'flex items-center gap-1.5 px-2 py-2.5 border-l-3 transition-all hover:bg-gray-50',
                          isSelected ? 'border-l-sky-500 bg-sky-50' : 'border-l-transparent'
                        )}>
                        <button onClick={() => toggleExpand(section.id)} className="p-0.5 rounded hover:bg-gray-100 shrink-0">
                          <ChevronDown className={clsx('w-4 h-4 text-gray-400 transition-transform', !isExpanded && '-rotate-90')} />
                        </button>
                        <span className="text-xs text-gray-400 font-mono shrink-0 w-6">{sectionIndexLabel(si)}</span>
                        <p onClick={() => setSelectedSectionId(section.id)}
                          className="flex-1 text-base font-semibold text-gray-800 truncate cursor-pointer">{section.title}</p>
                        {sectionPending && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-sky-50 px-1.5 py-0.5 text-[11px] font-medium text-sky-500 shrink-0">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            生成中
                          </span>
                        )}
                        {section.needDiagram && (
                          <span title="本章节规划了配图" className="shrink-0 text-sky-500"><BarChart3 className="w-3.5 h-3.5" /></span>
                        )}
                        <span className="text-xs text-gray-400 font-mono shrink-0">
                          {hasWordBudget ? sectionBudgetTotal(section).toLocaleString() : '--'}
                        </span>
                      </SortableRow>

                      {/* 二级子章节拖拽 */}
                      {isExpanded && (
                        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                          <SortableContext items={section.children.map(c => c.id)} strategy={verticalListSortingStrategy}>
                            {section.children.map((child, ci) => {
                              const isChildSelected = selectedSectionId === child.id;
                              const childPending = isSubSectionPending(child);
                              return (
                                <SortableRow key={child.id} id={child.id} isLocked={isLocked}
                                  className={clsx(
                                    'flex items-center gap-1.5 pl-10 pr-2 py-2 border-l-3 transition-colors hover:bg-gray-50',
                                    isChildSelected ? 'border-l-sky-400 bg-sky-50/70' : 'border-l-transparent'
                                  )}>
                                  <span className="text-xs text-gray-400 font-mono shrink-0 w-10">{subSectionIndexLabel(si, ci)}</span>
                                  <p onClick={() => setSelectedSectionId(child.id)}
                                    className="flex-1 text-sm text-gray-700 truncate cursor-pointer">{child.title}</p>
                                  {childPending && (
                                    <Loader2 className="w-3 h-3 shrink-0 text-sky-500 animate-spin" />
                                  )}
                                  {child.needDiagram && (
                                    <span title="本子节规划了配图" className="shrink-0 text-sky-500"><BarChart3 className="w-3 h-3" /></span>
                                  )}
                                  <span className="text-xs text-gray-400 font-mono shrink-0">
                                    {hasWordBudget ? subSectionBudgetWords(child).toLocaleString() : '--'}
                                  </span>
                                </SortableRow>
                              );
                            })}
                          </SortableContext>
                        </DndContext>
                      )}
                    </div>
                  );
                })}
              </SortableContext>
            </DndContext>
          </div>
        </div>

        {/* 右栏：详情编辑面板 */}
        <div className="flex-1 overflow-y-auto bg-gray-50">
          {selectedSection ? (
            selectedSectionPending ? (
              <div className="h-full min-h-[28rem] flex items-center justify-center px-8 py-6">
                <TaskLoadingState title="正在生成当前章节内容" />
              </div>
            ) : (
            <div className="max-w-2xl mx-auto px-8 py-6 space-y-6">
              {/* 标题 + 字数 */}
              <div className="flex-1">
                {editingField?.id === selectedSectionId && editingField.field === 'title' ? (
                  <InlineEdit field="title" />
                ) : (
                  <div className="flex items-center gap-3">
                    <h3 className="text-xl font-bold text-gray-900 flex-1">{selectedSection.title}</h3>
                    {!isLocked && (
                      <button onClick={() => startEdit(selectedSectionId!, 'title')}
                        disabled={isActuallyGenerating}
                        className={clsx(
                          'px-2.5 py-1 rounded-lg text-xs font-medium transition-colors',
                          isActuallyGenerating
                            ? 'text-gray-300 bg-gray-100 cursor-not-allowed'
                            : 'text-sky-600 bg-sky-50 hover:bg-sky-100',
                        )}>
                        编辑标题
                      </button>
                    )}
                  </div>
                )}
                {/* 字数 */}
                {editingField?.id === selectedSectionId && editingField.field === 'wordCount' ? (
                  <InlineEdit field="wordCount" />
                ) : (
                  <div className="flex items-center gap-2 mt-2">
                    <p className="text-sm text-gray-500">
                      预计字数：
                      <span className="font-mono text-sky-600 font-semibold">
                        {hasWordBudget ? selectedSection.wordCount.toLocaleString() : '等待回传'}
                      </span>
                      {hasWordBudget ? ' 字' : ''}
                    </p>
                    {!isLocked && (
                      <button onClick={() => startEdit(selectedSectionId!, 'wordCount')}
                        disabled={isActuallyGenerating}
                        className={clsx(
                          'px-2 py-0.5 rounded text-xs transition-colors',
                          isActuallyGenerating
                            ? 'text-gray-300 cursor-not-allowed'
                            : 'text-gray-400 hover:text-sky-600 hover:bg-sky-50',
                        )}>
                        修改
                      </button>
                    )}
                  </div>
                )}
                {(selectedSection as any)._parent && (
                  <p className="text-sm text-gray-400 mt-1">所属：{(selectedSection as any)._parent.title}</p>
                )}
              </div>

              {/* 写作意图 */}
              <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-6">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-lg font-semibold text-amber-800">✍ 文本提示词 - 用于引导生成技术方案正文</span>
                  {(editingField?.id !== selectedSectionId || editingField?.field !== 'writingHint') && !isLocked ? (
                    <button onClick={() => startEdit(selectedSectionId!, 'writingHint')}
                      disabled={isActuallyGenerating}
                      className={clsx(
                        'px-2.5 py-1 rounded-lg text-xs font-medium transition-colors',
                        isActuallyGenerating
                          ? 'text-gray-300 bg-gray-100 cursor-not-allowed'
                          : 'text-amber-600 bg-amber-100 hover:bg-amber-200',
                      )}>编辑</button>
                  ) : null}
                </div>
                {editingField?.id === selectedSectionId && editingField.field === 'writingHint' ? (
                  <div className="space-y-4">
                    <div className="rounded-xl  p-4">
                      {/* <div className="mb-2 flex items-center justify-between gap-3">
                        <span className="text-sm font-semibold text-amber-900">写作意图</span>
                        <span className="text-xs text-amber-700/80">仅编辑业务意图</span>
                      </div> */}
                      {/* <p className="mb-3 text-xs leading-relaxed text-amber-700/80">
                        {WRITING_INTENT_AUTO_RULE_NOTE}
                      </p> */}
                      <textarea
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                            e.preventDefault();
                            commitEdit();
                          }
                          if (e.key === 'Escape') cancelEdit();
                        }}
                        autoFocus
                        rows={8}
                        className="min-h-[220px] w-full resize-y rounded-xl border border-amber-200 bg-white px-4 py-3 text-base leading-relaxed text-amber-950 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-200"
                        placeholder="填写本节需要重点回应的问题、技术方案重点、边界和禁止事项。"
                      />
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        onClick={commitEdit}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-600"
                      >
                        <Check className="h-4 w-4" />
                        保存写作意图
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-base text-amber-900 leading-relaxed whitespace-pre-line">
                      {selectedSection.writingHint || '暂无写作意图，点击右上方「编辑」添加'}
                    </p>
                    {/* <p className="text-xs leading-relaxed text-amber-700/80">
                      {WRITING_INTENT_AUTO_RULE_NOTE}
                    </p> */}
                  </div>
                )}
              </div>

              {/* 关键词 */}
              <div className="hidden bg-white border border-gray-200 rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-base font-semibold text-gray-700">🔑 检索关键词</span>
                  {!isLocked && (
                    editingKeywordsFor !== selectedSectionId ? (
                      <button onClick={() => setEditingKeywordsFor(selectedSectionId)}
                        className="px-2.5 py-1 rounded-lg text-xs font-medium text-sky-600 bg-sky-50 hover:bg-sky-100 transition-colors">编辑</button>
                    ) : (
                      <button onClick={() => { setEditingKeywordsFor(null); setNewKeywordInput(''); }}
                        className="px-2.5 py-1 rounded-lg text-xs font-medium text-gray-500 bg-gray-100 hover:bg-gray-200 transition-colors">完成</button>
                    )
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(selectedSection.keywords || []).length === 0 && editingKeywordsFor !== selectedSectionId && (
                    <span className="text-xs text-gray-400">暂无关键词</span>
                  )}
                  {(selectedSection.keywords || []).map((kw, ki) => (
                    <span key={ki} className="inline-flex items-center gap-1 rounded-lg bg-sky-50 px-2.5 py-1 text-xs text-sky-700 border border-sky-100">
                      {kw}
                      {editingKeywordsFor === selectedSectionId && (
                        <button onClick={() => handleRemoveKeyword(selectedSectionId!, kw)} className="hover:text-red-500"><X className="w-3 h-3" /></button>
                      )}
                    </span>
                  ))}
                  {editingKeywordsFor === selectedSectionId && (
                    <div className="flex items-center gap-1.5">
                      <input type="text" value={newKeywordInput} onChange={e => setNewKeywordInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddKeyword(selectedSectionId!))}
                        placeholder="输入后回车" autoFocus
                        className="text-xs border border-sky-200 rounded-lg px-2.5 py-1 w-32 focus:outline-none focus:ring-1 focus:ring-sky-400" />
                      <button onClick={() => handleAddKeyword(selectedSectionId!)}
                        className="p-1 rounded-lg bg-sky-100 text-sky-600 hover:bg-sky-200">
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* 插图规划：样式与「检索关键词」一致；长说明只展示是否配图 + 较短/截断说明 */}
              {(selectedSection.needDiagram ||
                (selectedSection.diagramBrief && selectedSection.diagramBrief.trim()) ||
                selectedSection.diagramPlan) && (() => {
                const { text: briefDisplay, note: briefNote } = pickDiagramBriefText(selectedSection);
                const typeZh = diagramTypeLabel(selectedSection.diagramPlan?.typeHint);
                const pri = selectedSection.diagramPlan?.priority;
                return (
                  <div className="hidden bg-white border border-gray-200 rounded-xl p-5">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-base font-semibold text-gray-700">插图规划</span>
                      <span className={clsx(
                        'text-xs font-medium px-2.5 py-1 rounded-lg border',
                        selectedSection.needDiagram
                          ? 'text-sky-700 bg-sky-50 border-sky-100'
                          : 'text-gray-500 bg-gray-50 border-gray-100',
                      )}>
                        {selectedSection.needDiagram ? '需要配图' : '不需要配图'}
                      </span>
                    </div>
                    {briefDisplay ? (
                      <>
                        <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{briefDisplay}</p>
                        {briefNote && (
                          <p className="text-xs text-gray-400 mt-2">{briefNote}</p>
                        )}
                      </>
                    ) : (
                      <p className="text-sm text-gray-500">
                        {selectedSection.needDiagram ? '已标记配图，暂无文字说明。' : '未填写插图说明。'}
                      </p>
                    )}
                    {(typeZh || pri != null) && (
                      <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-500 space-y-1">
                        {typeZh ? <p>图表类型：{typeZh}</p> : null}
                        {/* {pri != null ? <p>排序优先级：{pri}</p> : null} */}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* 关联解析报告（暂隐藏：当前仅展示参考，未注入内容生成流程，待后续集成后开启） */}
              {/* {project.analysisReport && project.analysisReport.length > 0 && (() => {
                ...
              })()} */}

              {/* 子章节列表（仅一级标题时） */}
              {'children' in selectedSection && (selectedSection as OutlineSection).children.length > 0 && (
                <div className="hidden bg-white border border-gray-200 rounded-xl p-5">
                  <p className="text-base font-semibold text-gray-700 mb-3">📑 子章节 ({(selectedSection as OutlineSection).children.length})</p>
                  <div className="space-y-1">
                    {(selectedSection as OutlineSection).children.map((child: OutlineSubSection, ci: number) => (
                      <div key={child.id} onClick={() => setSelectedSectionId(child.id)}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
                        <span className="text-sm text-gray-400 font-mono w-8">{ci + 1}.</span>
                        <p className="flex-1 text-sm font-medium text-gray-700">{child.title}</p>
                        <span className="text-xs text-gray-400 font-mono">{hasWordBudget ? subSectionBudgetWords(child).toLocaleString() : '--'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 操作按钮 */}
              {!isLocked && (
                <div className="flex items-center justify-center gap-4 pt-4 border-t border-gray-100">
                  <button onClick={() => deleteSection(selectedSectionId!)}
                    disabled={isActuallyGenerating}
                    className={clsx(
                      'inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors',
                      isActuallyGenerating
                        ? 'text-gray-300 bg-gray-100 cursor-not-allowed'
                        : 'text-red-500 bg-red-50 hover:bg-red-100',
                    )}>
                    <Trash2 className="w-4 h-4" />删除此章节
                  </button>
                </div>
              )}
            </div>
            )
          ) : (
            isActuallyGenerating ? (
              <TaskLoadingState title="正在生成大纲结构" className="py-20" />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-3 py-20">
                <FileText className="w-10 h-10 text-gray-200" />
                <p className="text-sm">{sections.length > 0 ? '点击左侧章节查看详情' : '等待大纲结构回传...'}</p>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
