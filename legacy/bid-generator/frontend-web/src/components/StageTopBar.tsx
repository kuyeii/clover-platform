/**
 * StageTopBar — 四步骤式顶部导航
 * 解析报告 → 大纲生成 → 技术方案 → 投标文件
 *
 * 布局：
 *  行一：项目名（仅文字，无按钮）
 *  行二：步骤 tabs（左） + 竖向分隔线 + 下一步按钮（右）融为一体
 *
 * 屏幕自适应：tabs 区域 overflow-x-auto，下一步 shrink-0 whitespace-nowrap
 * 裁切修复：步骤行 py-1 + overflow-visible（不上滚动条），用 gap 撑空间
 */

import { CheckCircle2, FileSearch, PenTool, FileStack, AlignLeft, Loader2, Lock } from 'lucide-react';
import clsx from 'clsx';
import type { ProjectStatus } from '../services/projectService';

export type StageId = 'analysis' | 'outline' | 'tech' | 'bid';

export interface StageDefinition {
    id: StageId;
    label: string;
    icon: React.ElementType;
    statuses: ProjectStatus[];
}

export const STAGES: StageDefinition[] = [
    { id: 'analysis', label: '解析报告', icon: FileSearch, statuses: ['uploading', 'parsing', 'parsing_report', 'report_done', 'reviewing'] },
    { id: 'outline', label: '技术大纲', icon: AlignLeft, statuses: ['generating_outline', 'outline_ready'] },
    { id: 'tech', label: '技术方案', icon: PenTool, statuses: ['tech_proposal', 'editing', 'generating_content', 'tech_done'] },
    { id: 'bid', label: '投标文件', icon: FileStack, statuses: ['bid_assembling', 'bid_done', 'exporting', 'done'] },
];

export function getCurrentStageIndex(status: ProjectStatus): number {
    for (let i = STAGES.length - 1; i >= 0; i--) {
        if (STAGES[i].statuses.includes(status)) return i;
    }
    return 0;
}

export function isStageDone(stageIdx: number, currentIdx: number): boolean {
    return stageIdx < currentIdx;
}

function isStageUnlocked(stageIdx: number, currentIdx: number): boolean {
    return stageIdx <= currentIdx;
}

function isGeneratingStatus(status: ProjectStatus): boolean {
    return ['parsing', 'parsing_report', 'generating_outline', 'generating_content', 'exporting'].includes(status);
}

function getNextStepInfo(activeTab: StageId): {
    label: string;
    action: 'go_outline' | 'go_tech' | 'go_bid' | null;
} {
    switch (activeTab) {
        case 'analysis': return { label: '下一步', action: 'go_outline' };
        case 'outline': return { label: '下一步', action: 'go_tech' };
        case 'tech': return { label: '下一步', action: 'go_bid' };
        default: return { label: '', action: null };
    }
}

interface StageTopBarProps {
    projectName: string;
    projectStatus: ProjectStatus;
    activeTab: StageId;
    onTabChange: (tab: StageId) => void;
    onNextStep?: (action: 'go_outline' | 'go_tech' | 'go_bid') => void;
    rightAction?: React.ReactNode;
    /** 组件内部生成状态（如 TemplateEditor 批量生成中），合并到禁用判断 */
    isExternallyBusy?: boolean;
}

export function StageTopBar({
    projectName,
    projectStatus,
    activeTab,
    onTabChange,
    onNextStep,
    rightAction,
    isExternallyBusy,
}: StageTopBarProps) {
    const currentIdx = getCurrentStageIndex(projectStatus);
    const generating = isGeneratingStatus(projectStatus) || !!isExternallyBusy;
    const { label: nextLabel, action: nextAction } = getNextStepInfo(activeTab);

    return (
        <div className="bg-white border-b border-gray-200 shrink-0">
            {/* ── 行一：项目名 ── */}
            <div className="px-6 pt-3 pb-1.5">
                <h2 className="text-sm font-semibold text-gray-700 truncate">{projectName}</h2>
            </div>

            {/* ── 行二：步骤 Tabs ＋ 下一步按钮（同行融合） ── */}
            <div className="px-4 pb-2 flex items-center min-w-0">
                {/* 步骤 tabs 区域：overflow-x-auto 但用 py-1 留出 ring 的显示空间 */}
                <div className="flex items-center gap-0 overflow-x-auto py-1 flex-1 min-w-0">
                    {STAGES.map((stage, idx) => {
                        const done = isStageDone(idx, currentIdx);
                        const current = idx === currentIdx;
                        const isActive = activeTab === stage.id;
                        const unlocked = isStageUnlocked(idx, currentIdx);
                        // 技术方案阶段不显示只读锁
                        const isStagePast = done && isActive && stage.id !== 'tech';

                        return (
                            <div key={stage.id} className="flex items-center shrink-0">
                                <button
                                    onClick={() => unlocked && onTabChange(stage.id)}
                                    disabled={!unlocked}
                                    title={!unlocked ? `请先完成「${STAGES[idx - 1]?.label}」后解锁` : undefined}
                                    className={clsx(
                                        'relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap',
                                        !unlocked
                                            ? 'text-gray-300 cursor-not-allowed'
                                            : isActive
                                                ? 'bg-sky-50 text-sky-600 shadow-sm ring-1 ring-inset ring-sky-200'
                                                : done
                                                    ? 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                                                    : current
                                                        ? 'text-sky-500 hover:bg-sky-50'
                                                        : 'text-gray-300 cursor-not-allowed'
                                    )}
                                >
                                    {done ? (
                                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                    ) : (
                                        <span className={clsx(
                                            'w-4 h-4 rounded-full text-[10px] flex items-center justify-center font-bold shrink-0',
                                            isActive ? 'bg-sky-500 text-white' :
                                                current && !isActive ? 'bg-sky-100 text-sky-500 animate-pulse' :
                                                    unlocked ? 'bg-gray-100 text-gray-400' :
                                                        'bg-gray-50 text-gray-300'
                                        )}>
                                            {idx + 1}
                                        </span>
                                    )}
                                    <span>{stage.label}</span>
                                    {isStagePast && (
                                        <span title="该阶段已完成不可修改" className="shrink-0">
                                            <Lock className="w-3 h-3 text-sky-400/70 ml-0.5" />
                                        </span>
                                    )}
                                    {current && generating && (
                                        <span className="w-1 h-1 bg-sky-400 rounded-full animate-pulse shrink-0" />
                                    )}
                                </button>

                                {/* 步骤连接线 */}
                                {idx < STAGES.length - 1 && (
                                    <div className={clsx(
                                        'w-5 h-px mx-0.5 shrink-0 transition-colors',
                                        done ? 'bg-emerald-200' : 'bg-gray-150'
                                    )} style={!done ? { backgroundColor: '#e8eaed' } : {}} />
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* 右侧操作区：下一步按钮 / 自定义按钮 */}
                {(onNextStep && nextAction) || rightAction ? (
                    <>
                        <div className="w-px h-5 bg-gray-200 mx-3 shrink-0" />
                        {onNextStep && nextAction ? (
                            <button
                                onClick={() => !generating && onNextStep(nextAction)}
                                disabled={generating}
                                className={clsx(
                                    'shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-all whitespace-nowrap',
                                    generating
                                        ? 'text-gray-400 bg-gray-100 cursor-not-allowed'
                                        // 活跃 tabs 用 sky-50+ring，下一步用实心 sky-500 区分
                                        : 'bg-sky-600 hover:bg-sky-700 text-white shadow-sm'
                                )}
                            >
                                {generating ? (
                                    <><Loader2 className="w-3.5 h-3.5 animate-spin" />生成中...</>
                                ) : (
                                    <>
                                        {nextLabel}
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                                        </svg>
                                    </>
                                )}
                            </button>
                        ) : null}
                        {rightAction ? <div className="shrink-0">{rightAction}</div> : null}
                    </>
                ) : null}
            </div>
        </div>
    );
}
