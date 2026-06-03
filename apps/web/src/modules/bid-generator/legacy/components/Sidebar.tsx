import { useState } from 'react';
import {
    Plus, FileText, ChevronLeft, ChevronRight, Trash2, RefreshCw
} from 'lucide-react';
import clsx from 'clsx';
import type { Project } from '../services/projectService';
import { projectService } from '../services/projectService';

// ─────────── 项目状态 ───────────
const STATUS_CONFIG: Record<Project['status'], { label: string; color: string }> = {
    uploading: { label: '解析报告环节', color: 'text-gray-400' },
    parsing: { label: '解析报告环节', color: 'text-warning' },
    parsing_report: { label: '解析报告环节', color: 'text-warning' },
    report_done: { label: '解析报告环节', color: 'text-brand-600' },
    reviewing: { label: '解析报告环节', color: 'text-warning' },
    generating_outline: { label: '技术大纲生成环节', color: 'text-brand-500' },
    outline_ready: { label: '技术大纲生成环节', color: 'text-success' },
    tech_proposal: { label: '技术方案环节', color: 'text-brand-600' },
    editing: { label: '技术方案环节', color: 'text-brand-600' },
    generating_content: { label: '技术方案环节', color: 'text-brand-500' },
    tech_done: { label: '技术方案环节', color: 'text-teal-600' },
    bid_assembling: { label: '投标文件环节', color: 'text-brand-600' },
    bid_done: { label: '投标文件环节', color: 'text-teal-600' },
    exporting: { label: '投标文件环节', color: 'text-gray-500' },
    done: { label: '已完成', color: 'text-success' },
};
const DOT_COLOR: Record<Project['status'], string> = {
    uploading: 'bg-gray-300',
    parsing: 'bg-[var(--color-warning-text)] animate-pulse',
    parsing_report: 'bg-[var(--color-warning-text)] animate-pulse',
    report_done: 'bg-brand-500',
    reviewing: 'bg-[var(--color-warning-text)]',
    generating_outline: 'bg-brand-500 animate-pulse',
    outline_ready: 'bg-[var(--color-success-bg)]0',
    tech_proposal: 'bg-brand-500 animate-pulse',
    editing: 'bg-brand-500',
    generating_content: 'bg-brand-500 animate-pulse',
    tech_done: 'bg-teal-400',
    bid_assembling: 'bg-brand-500 animate-pulse',
    bid_done: 'bg-teal-400',
    exporting: 'bg-gray-400 animate-pulse',
    done: 'bg-[var(--color-success-icon)]',
};

const FALLBACK_STATUS = { label: '处理中', color: 'text-gray-500' };
const FALLBACK_DOT = 'bg-gray-300';

function resolveBusyProjectVisual(project: Project): { label: string; color: string; dotClass: string } {
    const meta = projectService.getProjectBusyMeta(project);
    const baseCfg = STATUS_CONFIG[project.status as keyof typeof STATUS_CONFIG] ?? FALLBACK_STATUS;
    const baseDot = DOT_COLOR[project.status as keyof typeof DOT_COLOR] ?? FALLBACK_DOT;
    if (!meta.busy) {
        return { label: baseCfg.label, color: baseCfg.color, dotClass: baseDot };
    }
    if (meta.activeTaskType === 'outline') {
        return { label: '技术大纲生成环节', color: 'text-brand-500', dotClass: 'bg-brand-500 animate-pulse' };
    }
    if (meta.activeTaskType === 'content' || meta.activeTaskType === 'diagram') {
        return { label: '技术方案环节', color: 'text-brand-500', dotClass: 'bg-brand-500 animate-pulse' };
    }
    if (meta.activeTaskType === 'analyze' || meta.activeTaskType === 'extract') {
        return { label: '解析报告环节', color: 'text-warning', dotClass: 'bg-[var(--color-warning-text)] animate-pulse' };
    }
    return { label: baseCfg.label, color: baseCfg.color, dotClass: baseDot };
}

interface SidebarProps {
    projects: Project[];
    activeProjectId: string | null;
    globalTab: 'project';
    onSelectProject: (id: string) => void;
    onNewProject: () => void;
    onDeleteProject: (id: string) => void;
    onRepairLocks: () => void;
    repairingLocks?: boolean;
    projectsLoading?: boolean;
    lockedProjectId?: string | null;
    disableNewProject?: boolean;
}

export function Sidebar({
    projects, activeProjectId, globalTab,
    onSelectProject, onNewProject, onDeleteProject,
    onRepairLocks, repairingLocks = false,
    projectsLoading = false,
    lockedProjectId, disableNewProject
}: SidebarProps) {
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

    return (
        <div className={clsx(
            'relative bg-white border-r border-gray-100 h-full flex flex-col select-none transition-all duration-200',
            sidebarCollapsed ? 'w-16' : 'w-72',
        )}>
            <button
                type="button"
                onClick={() => setSidebarCollapsed(v => !v)}
                className="absolute -right-3 top-1/2 z-20 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 shadow-none hover:text-gray-700"
                title={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
                aria-label={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
            >
                {sidebarCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
            </button>

            {!sidebarCollapsed ? (
                <>

            {/* ── 新建项目 ── */}
            <div className="px-4 pt-4 pb-3 shrink-0">
                <button
                    onClick={onNewProject}
                    disabled={disableNewProject}
                    className={clsx(
                        'w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-lg transition-colors shadow-none',
                        disableNewProject
                            ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                            : 'bg-brand-500 hover:bg-brand-600 text-white'
                    )}
                >
                    <Plus className="w-4 h-4" />新建项目
                </button>
            </div>

            {/* ── 项目列表 ── */}
            <div className="flex-1 overflow-y-auto px-3 pb-3">
                <div className="space-y-1">
                    <div className="px-2 py-2 flex items-center justify-between">
                        <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">我的项目</p>
                        {projectsLoading ? null : (
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onRepairLocks();
                                }}
                                disabled={repairingLocks}
                                title="状态刷新"
                                aria-label="状态刷新"
                                className={clsx(
                                    'p-1 rounded-md transition-colors',
                                    repairingLocks
                                        ? 'text-gray-300 cursor-not-allowed'
                                        : 'text-gray-300 hover:text-brand-600 hover:bg-brand-50',
                                )}
                            >
                                <RefreshCw className={clsx('w-3.5 h-3.5', repairingLocks && 'animate-spin')} />
                            </button>
                        )}
                    </div>

                    {projectsLoading ? (
                        <div className="py-10 text-center">
                            <RefreshCw className="w-8 h-8 text-brand-500 animate-spin mx-auto mb-2" />
                            <p className="text-sm text-gray-400">加载中</p>
                        </div>
                    ) : projects.length === 0 ? (
                        <div className="py-10 text-center">
                            <FileText className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                            <p className="text-sm text-gray-400">暂无项目</p>
                            <p className="text-xs text-gray-300 mt-1">点击"新建项目"开始</p>
                        </div>
                    ) : (
                        <>
                        {projects.map(proj => {
                            const isActive = activeProjectId === proj.id && globalTab === 'project';
                            const isLockedOut = !!lockedProjectId && proj.id !== lockedProjectId;
                            const visual = resolveBusyProjectVisual(proj);
                            return (
                                <div key={proj.id}
                                    onMouseEnter={() => setHoveredId(proj.id)}
                                    onMouseLeave={() => setHoveredId(null)}
                                    onClick={() => onSelectProject(proj.id)}
                                    className={clsx('group relative flex items-center px-3 py-3 rounded-lg transition-colors',
                                        isLockedOut ? 'opacity-50 cursor-pointer' : 'cursor-pointer',
                                        isActive ? 'bg-brand-50 text-brand-900' : 'text-gray-700 hover:bg-gray-50')}>
                                    <div className={clsx('w-2 h-2 rounded-full shrink-0 mr-3', visual.dotClass)} />
                                    <div className="flex-1 min-w-0">
                                        <p className={clsx('text-sm font-medium truncate leading-tight', isActive ? 'text-brand-900' : 'text-gray-800')}>{proj.name}</p>
                                        <p className={clsx('text-xs mt-0.5', visual.color)}>{visual.label}</p>
                                    </div>
                                    {hoveredId === proj.id && !isLockedOut ? (
                                        <button onClick={e => { e.stopPropagation(); onDeleteProject(proj.id); }} className="p-1 text-gray-400 hover:text-danger rounded transition-colors shrink-0">
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    ) : isActive && <ChevronRight className="w-4 h-4 text-brand-500 shrink-0" />}
                                </div>
                            );
                        })}
                        </>
                    )}
                </div>
            </div>


                </>
            ) : (
                <>
                    <div className="px-2 pt-4 pb-3 shrink-0">
                        <button
                            onClick={onNewProject}
                            disabled={disableNewProject}
                            className={clsx(
                                'mx-auto w-8 h-8 flex items-center justify-center rounded-lg transition-colors shadow-none',
                                disableNewProject
                                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                    : 'bg-brand-500 hover:bg-brand-600 text-white',
                            )}
                            title="新建项目"
                            aria-label="新建项目"
                        >
                            <Plus className="w-4 h-4" />
                        </button>
                    </div>
                    <div className="flex-1" />
                </>
            )}
        </div>
    );
}
