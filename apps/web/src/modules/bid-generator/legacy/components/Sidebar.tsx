import { useState, useEffect } from 'react';
import {
    Plus, Database, FileText, ChevronLeft, ChevronRight, Trash2,
    ShieldCheck, ChevronDown, ChevronUp, CheckCircle2, Building2, Save, Image, RefreshCw
} from 'lucide-react';
import clsx from 'clsx';
import type { Project, BidderInfo } from '../services/projectService';
import { projectService } from '../services/projectService';

// ─────────── 隐私保护设置 ───────────
const DESEN_KEY = 'proengine_desen_settings';
interface DesenSettings { enabled: boolean; profile: 'tender' | 'default'; }
function loadDesen(): DesenSettings {
    try { return { enabled: true, profile: 'tender', ...JSON.parse(localStorage.getItem(DESEN_KEY) || '{}') }; }
    catch { return { enabled: true, profile: 'tender' }; }
}
function saveDesen(s: DesenSettings) { localStorage.setItem(DESEN_KEY, JSON.stringify(s)); }

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
    activeProject: Project | null;
    globalTab: 'project' | 'knowledge';
    onSelectProject: (id: string) => void;
    onNewProject: () => void;
    onDeleteProject: (id: string) => void;
    onOpenKnowledge: () => void;
    onBidderInfoUpdated: () => void;
    onRepairLocks: () => void;
    repairingLocks?: boolean;
    lockedProjectId?: string | null;
    disableNewProject?: boolean;
}

// 投标人信息字段定义
const BIDDER_FIELDS: { key: keyof BidderInfo; label: string; placeholder: string; type?: string }[] = [
    { key: 'orgName', label: '投标单位全称', placeholder: 'XX科技有限公司' },
    { key: 'legalRep', label: '法定代表人', placeholder: '张三' },
    { key: 'projectLead', label: '项目负责人', placeholder: '李四' },
    { key: 'phone', label: '联系电话', placeholder: '138-0000-0000' },
    { key: 'docDate', label: '文件编制日期', placeholder: '2025-03-01', type: 'date' },
];

const EMPTY_BIDDER: BidderInfo = { orgName: '', legalRep: '', projectLead: '', phone: '', docDate: '' };

export function Sidebar({
    projects, activeProjectId, activeProject, globalTab,
    onSelectProject, onNewProject, onDeleteProject, onOpenKnowledge, onBidderInfoUpdated,
    onRepairLocks, repairingLocks = false,
    lockedProjectId, disableNewProject
}: SidebarProps) {
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

    // — 脱敏设置 —
    const [desen, setDesen] = useState<DesenSettings>(loadDesen);
    const [desenExpanded, setDesenExpanded] = useState(false);
    const updateDesen = (patch: Partial<DesenSettings>) => {
        const next = { ...desen, ...patch };
        setDesen(next);
        saveDesen(next);
    };

    // — 视觉增强设置 —
    const [useVision, setUseVision] = useState(() => localStorage.getItem('proengine_use_vision_parsing') === 'true');
    const updateVision = (val: boolean) => {
        setUseVision(val);
        localStorage.setItem('proengine_use_vision_parsing', String(val));
    };

    // — 投标人信息（跟随当前项目）—
    const [bidderExpanded, setBidderExpanded] = useState(false);
    const [bidderDraft, setBidderDraft] = useState<BidderInfo>(EMPTY_BIDDER);
    const [bidderSaved, setBidderSaved] = useState(false);

    // 切换项目时重新加载 draft
    useEffect(() => {
        setBidderDraft(activeProject?.bidderInfo ?? EMPTY_BIDDER);
        setBidderSaved(false);
    }, [activeProject?.id]);

    const handleBidderSave = () => {
        if (!activeProjectId) return;
        projectService.updateBidderInfo(activeProjectId, bidderDraft);
        setBidderSaved(true);
        onBidderInfoUpdated();
        setTimeout(() => setBidderSaved(false), 2000);
    };

    const bidderConfigured = !!(activeProject?.bidderInfo?.orgName || activeProject?.bidderInfo?.legalRep);

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
                {projects.length === 0 ? (
                    <div className="py-10 text-center">
                        <FileText className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                        <p className="text-sm text-gray-400">暂无项目</p>
                        <p className="text-xs text-gray-300 mt-1">点击"新建项目"开始</p>
                    </div>
                ) : (
                    <div className="space-y-1">
                        <div className="px-2 py-2 flex items-center justify-between">
                            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">我的项目</p>
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
                        </div>
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
                    </div>
                )}
            </div>


            {/* ── 投标人信息（跟随当前项目）── */}
            <div className="border-t border-gray-100 px-3 pt-3 pb-1 shrink-0">
                <button onClick={() => setBidderExpanded(v => !v)}
                    className="w-full flex items-center px-3 py-2 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-800 transition-colors">
                    <Building2 className={clsx('w-4 h-4 mr-3 shrink-0', activeProject && bidderConfigured ? 'text-brand-500' : 'text-gray-400')} />
                    <span className="flex-1 text-left">投标人信息</span>
                    {activeProject ? (
                        <span className={clsx('text-xs px-1.5 py-0.5 rounded-full font-medium mr-2',
                            bidderConfigured ? 'bg-brand-50 text-brand-600' : 'bg-gray-100 text-gray-400')}>
                            {bidderConfigured ? '已配置' : '未配置'}
                        </span>
                    ) : (
                        <span className="text-xs text-gray-300 mr-2">选择项目后配置</span>
                    )}
                    {bidderExpanded ? <ChevronUp className="w-3.5 h-3.5 text-gray-400 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />}
                </button>

                {bidderExpanded && (
                    <div className="mt-2 mx-1 p-3 bg-gray-50 rounded-xl space-y-2">
                        {!activeProject ? (
                            <p className="text-xs text-gray-400 text-center py-2">请先选择或创建项目</p>
                        ) : (
                            <>
                                <p className="text-xs text-gray-500 pb-1">
                                    仅存于本地设备，<span className="font-medium text-danger">绝不传输到任何云端服务器</span>。生成时会以匿名占位符传入模型。
                                </p>
                                {BIDDER_FIELDS.map(field => (
                                    <div key={field.key}>
                                        <label className="block text-xs text-gray-500 mb-0.5">{field.label}</label>
                                        <input
                                            type={field.type || 'text'}
                                            value={(bidderDraft[field.key] as string) || ''}
                                            onChange={e => setBidderDraft(prev => ({ ...prev, [field.key]: e.target.value }))}
                                            placeholder={field.placeholder}
                                            className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:border-brand-500 focus:ring-1 focus:ring-brand-200 bg-white"
                                        />
                                    </div>
                                ))}
                                <button onClick={handleBidderSave}
                                    className={clsx('w-full mt-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-colors',
                                        bidderSaved ? 'bg-[var(--color-success-bg)] text-success' : 'bg-brand-500 hover:bg-brand-600 text-white')}>
                                    {bidderSaved
                                        ? <><CheckCircle2 className="w-3.5 h-3.5" />已保存到此项目</>
                                        : <><Save className="w-3.5 h-3.5" />保存到此项目</>
                                    }
                                </button>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* ── 隐私保护 ── */}
            <div className="border-t border-gray-100 px-3 pt-1 pb-1 shrink-0">
                <button onClick={() => setDesenExpanded(v => !v)}
                    className="w-full flex items-center px-3 py-2 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-800 transition-colors">
                    <ShieldCheck className={clsx('w-4 h-4 mr-3 shrink-0', desen.enabled ? 'text-success' : 'text-gray-400')} />
                    <span className="flex-1 text-left">隐私保护</span>
                    <span className={clsx('text-xs px-1.5 py-0.5 rounded-full font-medium mr-2',
                        desen.enabled ? 'bg-[var(--color-success-bg)] text-success' : 'bg-gray-100 text-gray-400')}>
                        {desen.enabled ? '已开启' : '已关闭'}
                    </span>
                    {desenExpanded ? <ChevronUp className="w-3.5 h-3.5 text-gray-400 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />}
                </button>
                {desenExpanded && (
                    <div className="mt-2 mx-1 p-3 bg-gray-50 rounded-xl space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-gray-600">启用隐私保护模式</span>
                            <button onClick={() => updateDesen({ enabled: !desen.enabled })}
                                className={clsx('relative w-9 h-5 rounded-full transition-colors', desen.enabled ? 'bg-[var(--color-success-icon)]' : 'bg-gray-300')}>
                                <span className={clsx('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-none transition-all', desen.enabled ? 'left-4' : 'left-0.5')} />
                            </button>
                        </div>
                        <div className="space-y-1.5">
                            <p className="text-xs text-gray-500 font-medium">保护策略</p>
                            {[
                                { value: 'tender', label: '招标文件（轻度）', desc: '仅隐藏姓名、电话、邮箱、身份证' },
                                { value: 'default', label: '标准（严格）', desc: '额外包含机构名、地址、银行账号' },
                            ].map(opt => (
                                <label key={opt.value} className={clsx('flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors',
                                    desen.profile === opt.value ? 'bg-white border border-brand-200 shadow-none' : 'hover:bg-white/60')}>
                                    <input type="radio" name="desen_profile" value={opt.value}
                                        checked={desen.profile === opt.value}
                                        onChange={() => updateDesen({ profile: opt.value as 'tender' | 'default' })}
                                        className="mt-0.5 accent-sky-600 shrink-0" />
                                    <div>
                                        <p className="text-xs font-medium text-gray-700">{opt.label}</p>
                                        <p className="text-xs text-gray-400 mt-0.5">{opt.desc}</p>
                                    </div>
                                </label>
                            ))}
                        </div>
                        {!desen.enabled && (
                            <p className="text-xs text-warning bg-[var(--color-warning-bg)] px-2.5 py-1.5 rounded-lg">
                                ⚠️ 关闭后文件将以原始格式处理，请确认数据安全
                            </p>
                        )}
                    </div>
                )}
            </div>

            {/* ── 视觉增强解析 ── */}
            <div className="border-t border-gray-100 px-3 pt-1 pb-1 shrink-0">
                <button onClick={() => updateVision(!useVision)}
                    className="w-full flex items-center px-3 py-2 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-800 transition-colors"
                    title="在提取 PDF 时识别图片并使用本地视觉模型生成标注"
                >
                    <Image className={clsx('w-4 h-4 mr-3 shrink-0', useVision ? 'text-brand-500' : 'text-gray-400')} />
                    <span className="flex-1 text-left">视觉辅助解析</span>
                    <span className={clsx('text-xs px-1.5 py-0.5 rounded-full font-medium',
                        useVision ? 'bg-brand-50 text-brand-600' : 'bg-gray-100 text-gray-400')}>
                        {useVision ? '已开启' : '已关闭'}
                    </span>
                </button>
            </div>

            {/* ── 知识库管理 ── */}
            <div className="border-t border-gray-50 p-3 space-y-1 shrink-0">
                <button onClick={onOpenKnowledge}
                    className={clsx('w-full flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                        globalTab === 'knowledge' ? 'bg-brand-50 text-brand-600' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800')}>
                    <Database className={clsx('w-4 h-4 mr-3', globalTab === 'knowledge' ? 'text-brand-500' : 'text-gray-400')} />
                    知识库管理
                </button>
                <div className="px-3 py-2 text-xs text-gray-400 flex items-center">
                    <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-success-icon)] mr-2" />
                    智能服务已就绪
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
                    <div className="px-2 pb-3 space-y-1">
                        <button
                            type="button"
                            title="投标人信息"
                            aria-label="投标人信息"
                            className="w-full h-8 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                        >
                            <Building2 className="w-4 h-4" />
                        </button>
                        <button
                            type="button"
                            title="隐私保护"
                            aria-label="隐私保护"
                            className={clsx(
                                'w-full h-8 rounded-lg flex items-center justify-center hover:bg-gray-50',
                                desen.enabled ? 'text-success' : 'text-gray-400',
                            )}
                        >
                            <ShieldCheck className="w-4 h-4" />
                        </button>
                        <button
                            type="button"
                            title="视觉辅助解析"
                            aria-label="视觉辅助解析"
                            className={clsx(
                                'w-full h-8 rounded-lg flex items-center justify-center hover:bg-gray-50',
                                useVision ? 'text-brand-500' : 'text-gray-400',
                            )}
                        >
                            <Image className="w-4 h-4" />
                        </button>
                    </div>
                    <div className="border-t border-gray-50 p-2 shrink-0">
                        <button
                            onClick={onOpenKnowledge}
                            title="知识库管理"
                            aria-label="知识库管理"
                            className={clsx(
                                'w-full flex items-center justify-center py-2 rounded-lg transition-colors',
                                globalTab === 'knowledge' ? 'bg-brand-50 text-brand-600' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800',
                            )}
                        >
                            <Database className={clsx('w-4 h-4', globalTab === 'knowledge' ? 'text-brand-500' : 'text-gray-400')} />
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
