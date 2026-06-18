import { useEffect, useCallback } from 'react';
import { Routes, Route, useParams, useNavigate, Navigate, useMatch } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { ProjectCreator } from './components/Project/ProjectCreator';
import RequirementsReview from './components/Dashboard/RequirementsReview';
import { OutlineGenerator } from './components/Project/OutlineGenerator';
import { TemplateEditor } from './components/TemplateEditor';
import { BidDocWorkbench } from './components/BidDocWorkbench';
import { TechProposalGate } from './components/TechProposalGate';
import { BidderInfoDialog } from './components/BidderInfoDialog';
import { StageTopBar, getCurrentStageIndex, type StageId } from './components/StageTopBar';
import type { BidderInfo, Project, TechProposalConfig } from './services/projectService';
import { buildInitialOutlineFromTechnicalHeadings, projectService } from './services/projectService';
import { shouldBlockProjectNavigation } from './services/navigationPolicy';
import { useState } from 'react';
import { AlertTriangle, FileDown, FolderOpen, Loader2, Lock } from 'lucide-react';
import { buildBidExportSections } from './utils/bidExport';

// ── 合法 Tab 集合 ──
const VALID_TABS: StageId[] = ['analysis', 'outline', 'tech', 'bid'];

function getProjectTabByStatus(project: Project): StageId {
  const stageIdx = getCurrentStageIndex(project.status);
  return VALID_TABS[stageIdx] || 'analysis';
}

// ─────────────────────────────────────────────
// 项目视图（带路由参数）
// ─────────────────────────────────────────────
function ProjectView({
  projects,
  refreshProjects,
}: {
  projects: Project[];
  refreshProjects: () => void;
}) {
  const { id, tab } = useParams<{ id: string; tab: string }>();
  const navigate = useNavigate();

  const activeProject = projects.find(p => p.id === id) ?? null;
  const normalizedTab = tab === 'export' ? 'bid' : tab;
  const activeTab: StageId = (VALID_TABS.includes(normalizedTab as StageId) ? normalizedTab : 'analysis') as StageId;
  const [showTechGate, setShowTechGate] = useState(false);
  const [isContentBusy, setIsContentBusy] = useState(false);
  const [exportingBidDoc, setExportingBidDoc] = useState(false);
  const [exportErrorMessage, setExportErrorMessage] = useState('');
  const [isStartingOutline, setIsStartingOutline] = useState(false);
  const [showBidderGate, setShowBidderGate] = useState(false);
  const activeBusyMeta = projectService.getProjectBusyMeta(activeProject);

  useEffect(() => {
    if (tab === 'export' && id) {
      navigate(`/projects/${id}/bid`, { replace: true });
    }
  }, [tab, id, navigate]);

  // 切 tab → URL 跳转
  const handleTabChange = (newTab: StageId) => {
    navigate(`/projects/${id}/${newTab}`, { replace: true });
  };

  // "下一步"按钮处理（统一由 StageTopBar 触发）
  const handleNextStep = (action: 'go_outline' | 'go_tech' | 'go_bid') => {
    if (action === 'go_outline') {
      // 从「解析报告」下一步到「大纲生成」
      // 如果当前是只读状态（说明大纲已生成在后方），直接跳转即可，不再弹框配置
      if (isLockedReadOnly) {
        navigate(`/projects/${id}/outline`);
      } else {
        setShowTechGate(true);
      }
    } else if (action === 'go_tech') {
      if (activeProject) {
        const hasOutline = Array.isArray(activeProject.outline) && activeProject.outline.length > 0;
        const outlineTaskRunning = activeBusyMeta.busy && activeBusyMeta.activeTaskType === 'outline';
        const canEnterTech = activeProject.status === 'outline_ready' || (hasOutline && !outlineTaskRunning);
        if (!canEnterTech) {
          window.alert('大纲尚未生成完成，请等待大纲任务结束后再进入技术方案。');
          return;
        }
        setShowBidderGate(true);
        return;
      }
    } else if (action === 'go_bid') {
      // 技术方案完成，更新项目状态再跳转
      if (activeProject) {
        projectService.update(activeProject.id, { status: 'bid_assembling' });
        refreshProjects();
      }
      navigate(`/projects/${id}/bid`);
    }
  };

  // TechGate 确认：立即进入大纲页，并立刻发起 start-outline 后台任务
  const handleTechGateConfirm = (config: TechProposalConfig) => {
    if (!activeProject || !id) return;
    const h2Seed = buildInitialOutlineFromTechnicalHeadings(activeProject.analysisV2);
    const shouldPatchOutline = h2Seed.length > 0 && (!activeProject.outline || activeProject.outline.length === 0);
    setIsStartingOutline(true);
    projectService.update(activeProject.id, {
      targetConfig: config,
      status: 'generating_outline',
      ...(shouldPatchOutline && { outline: h2Seed }),
      taskRuntime: {
        state: 'queued',
        taskType: 'outline',
        message: '大纲任务排队中',
        progress: 0,
        startedAt: new Date().toISOString(),
        cancellable: true,
        updatedAt: new Date().toISOString(),
      },
    });
    setIsContentBusy(true);
    refreshProjects();
    setShowTechGate(false);
    navigate(`/projects/${id}/outline`);
    projectService.startOutlineTask(activeProject.id)
      .then(() => {
        refreshProjects();
      })
      .catch((err) => {
        console.error('[App] 启动大纲任务失败:', err);
        localStorage.removeItem(`outline_task_${activeProject.id}`);
        const latest = projectService.getById(activeProject.id);
        projectService.update(activeProject.id, {
          taskRuntime: {
            state: 'failed',
            taskId: latest?.taskRuntime?.taskId,
            taskType: 'outline',
            message: err instanceof Error ? err.message : '大纲任务启动失败',
            progress: 0,
            startedAt: latest?.taskRuntime?.startedAt || new Date().toISOString(),
            cancellable: false,
            updatedAt: new Date().toISOString(),
          },
        });
        refreshProjects();
        window.alert('大纲任务启动失败，请在大纲页点击“重新生成”重试。');
      })
      .finally(() => {
        setIsStartingOutline(false);
      });
  };

  const handleBidderGateConfirm = (bidderInfo: BidderInfo) => {
    if (!activeProject || !id) return;
    projectService.updateBidderInfo(activeProject.id, bidderInfo);
    projectService.update(activeProject.id, { status: 'editing' });
    refreshProjects();
    setShowBidderGate(false);
    navigate(`/projects/${id}/tech`);
  };

  // 大纲生成完成：保持在大纲页（状态 outline_ready），由用户点「下一步」再进技术方案
  const handleOutlineConfirmed = (_updated: Project) => {
    refreshProjects();
  };

  const handleExportBidDocument = async () => {
    if (!activeProject) return;
    const sections = buildBidExportSections(activeProject, activeProject.bidModules || []);
    if (sections.length === 0) {
      setExportErrorMessage('当前没有可导出的模块内容，请先完成模块编排或技术方案生成。');
      return;
    }
    setExportingBidDoc(true);
    setExportErrorMessage('');
    try {
      await projectService.forgeDocument(activeProject.id, sections);
      projectService.update(activeProject.id, { status: 'bid_done' });
      refreshProjects();
    } catch (err) {
      console.error('[App] 导出投标文件失败:', err);
      setExportErrorMessage('导出异常，请稍后重试。');
    } finally {
      setExportingBidDoc(false);
    }
  };


  // ── 未解锁占位 ──
  const LockedPlaceholder = ({ stageLabel, prevLabel }: { stageLabel: string; prevLabel: string }) => (
    <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-4 p-12">
      <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
        <Lock className="w-8 h-8 text-gray-300" />
      </div>
      <h3 className="text-lg font-semibold text-gray-500">{stageLabel}</h3>
      <p className="text-sm text-gray-400 text-center max-w-md">
        请先完成「{prevLabel}」阶段后，点击右上角"下一步"按钮进入此阶段。
      </p>
    </div>
  );

  useEffect(() => {
    if (activeTab !== 'bid' || !activeProject?.id) return;
    let cancelled = false;

    (async () => {
      try {
        await projectService.syncFromServer();
        if (!cancelled) refreshProjects();
      } catch {
        // 静默刷新失败不打断投标文件编排使用。
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeProject?.id, activeTab, refreshProjects]);

  if (!activeProject) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 flex-col gap-3">
        <FolderOpen className="w-12 h-12 text-gray-200" />
        <p>未找到项目，请从左侧选择</p>
      </div>
    );
  }

  const currentStageIdx = getCurrentStageIndex(activeProject.status);
  const tabIdx = VALID_TABS.indexOf(activeTab);
  const isUnlocked = tabIdx <= currentStageIdx;
  const hasSeededTechnicalOutline = buildInitialOutlineFromTechnicalHeadings(activeProject.analysisV2).length > 0;
  const canViewOutline = isUnlocked
    || activeProject.status === 'generating_outline'
    || activeProject.status === 'outline_ready'
    || (activeBusyMeta.busy && activeBusyMeta.activeTaskType === 'outline')
    || hasSeededTechnicalOutline
    || Boolean(activeProject.outline?.length);
  // 前序阶段默认只读，但技术方案在进入投标文件阶段后仍允许继续编辑和生成。
  const isLockedReadOnly = activeTab !== 'tech' && tabIdx < currentStageIdx;

  // ── 内容区渲染 ──
  const renderContent = () => {
    switch (activeTab) {
      case 'analysis': {
        return (
          <div className="flex-1 min-h-0 overflow-hidden p-6">
          <RequirementsReview
              key={activeProject.id}
              project={activeProject}
              onConfirm={() => refreshProjects()}
              isLocked={isLockedReadOnly}
              onBusyChange={setIsContentBusy}
            />
          </div>
        );
      }
      case 'outline': {
        if (!canViewOutline) return <LockedPlaceholder stageLabel="大纲生成" prevLabel="解析报告" />;
        return (
          <div className="flex-1 min-h-0 overflow-hidden p-6">
            <OutlineGenerator 
              key={activeProject.id}
              project={activeProject} 
              onConfirm={handleOutlineConfirmed} 
              onBusyChange={setIsContentBusy} 
              isLocked={isLockedReadOnly}
            />
          </div>
        );
      }
      case 'tech': {
        if (!isUnlocked) return <LockedPlaceholder stageLabel="技术方案" prevLabel="大纲生成" />;
        return (
          <div className="flex-1 min-h-0 overflow-hidden p-6">
            <TemplateEditor
              key={activeProject.id}
              projectId={activeProject.id}
              pdfUrl={activeProject.pdfUrl}
              onBusyChange={setIsContentBusy}
              isLocked={isLockedReadOnly}
            />
          </div>
        );
      }
      case 'bid': {
        if (!isUnlocked) return <LockedPlaceholder stageLabel="投标文件" prevLabel="技术方案" />;
        return (
          <div className="flex-1 min-h-0 overflow-hidden">
            <BidDocWorkbench
              key={activeProject.id}
              project={activeProject}
              onRefresh={refreshProjects}
              isLocked={isLockedReadOnly}
            />
          </div>
        );
      }
      default:
        return null;
    }
  };

  return (
    <>
      <StageTopBar
        projectName={activeProject.name}
        projectStatus={activeProject.status}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        onNextStep={handleNextStep}
        rightAction={activeTab === 'bid' ? (
          <button
            onClick={handleExportBidDocument}
            disabled={exportingBidDoc || activeBusyMeta.busy}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-semibold bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-50"
          >
            {exportingBidDoc ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
            导出投标文件
          </button>
        ) : null}
        isExternallyBusy={isContentBusy || isStartingOutline || activeBusyMeta.busy}
      />
      <div className="flex-1 flex flex-col min-h-0">
        {renderContent()}
      </div>
      {exportErrorMessage ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/28 px-4" role="presentation">
          <section
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-[0_20px_60px_rgba(15,23,42,0.18)]"
            role="dialog"
            aria-modal="true"
            aria-label="导出异常"
          >
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--color-warning-bg)] text-warning">
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h3 className="text-base font-bold text-gray-950">导出异常</h3>
                <p className="mt-2 text-sm leading-6 text-gray-600">{exportErrorMessage}</p>
              </div>
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-600"
                onClick={() => setExportErrorMessage('')}
              >
                知道了
              </button>
            </div>
          </section>
        </div>
      ) : null}
      <TechProposalGate
        visible={showTechGate}
        onCancel={() => setShowTechGate(false)}
        onConfirm={handleTechGateConfirm}
        initialConfig={activeProject?.targetConfig}
        disabled={isStartingOutline}
      />
      <BidderInfoDialog
        visible={showBidderGate}
        title="投标人信息配置"
        subtitle="进入技术方案前请确认投标人信息"
        initialValue={activeProject?.bidderInfo}
        submitLabel="进入技术方案"
        onCancel={() => setShowBidderGate(false)}
        onConfirm={handleBidderGateConfirm}
      />
    </>
  );
}

// ─────────────────────────────────────────────
// 根组件（纯路由 Shell）
// ─────────────────────────────────────────────
export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [bootstrapError, setBootstrapError] = useState('');
  const [repairingLocks, setRepairingLocks] = useState(false);
  const [switchWarn, setSwitchWarn] = useState<{
    open: boolean;
    targetLabel: string;
  }>({ open: false, targetLabel: '' });
  const navigate = useNavigate();

  const refreshProjects = useCallback(() => {
    setProjects(projectService.getAll());
  }, []);

  const reconcileProjectStatuses = useCallback(() => {
    const latest = projectService.getAll();
    latest.forEach((proj) => {
      const busyMeta = projectService.getProjectBusyMeta(proj);
      const patch: Partial<Omit<Project, 'id' | 'createdAt'>> = {};
      let shouldPatch = false;

      if (proj.status === 'parsing_report' && !busyMeta.busy && (proj.analysisV2?.schema_version || proj.analysisReport?.length)) {
        patch.status = 'report_done';
        shouldPatch = true;
      }

      if (proj.status === 'generating_outline' && !(busyMeta.busy && busyMeta.activeTaskType === 'outline')) {
        patch.status = proj.outline?.length ? 'outline_ready' : 'report_done';
        shouldPatch = true;
      }

      if (proj.status === 'generating_content' && !(busyMeta.busy && (busyMeta.activeTaskType === 'content' || busyMeta.activeTaskType === 'diagram'))) {
        patch.status = 'editing';
        shouldPatch = true;
      }

      if (!shouldPatch && !busyMeta.busy && proj.generatedContent) {
        const normalizedGeneratedContent: typeof proj.generatedContent = {};
        let contentChanged = false;
        Object.entries(proj.generatedContent).forEach(([blockId, state]) => {
          const hasTask = busyMeta.taskKeys.includes(`content_task_${proj.id}_${blockId}`);
          if ((state?.status === 'generating' || state?.status === 'queued') && !hasTask) {
            normalizedGeneratedContent[blockId] = { ...state, status: 'idle', stage: undefined, error: undefined };
            contentChanged = true;
            return;
          }
          normalizedGeneratedContent[blockId] = state;
        });
        if (contentChanged) {
          patch.generatedContent = normalizedGeneratedContent;
          shouldPatch = true;
        }
      }

      if (shouldPatch) {
        projectService.update(proj.id, patch as Partial<Omit<Project, 'id' | 'createdAt'>>);
      }
    });
  }, []);

  // 从 URL 读取当前活跃项目 id 和全局视图
  const projectMatch = useMatch('/projects/:id/:tab');
  const activeProjectId = projectMatch?.params.id ?? null;
  const activeProject = projects.find(p => p.id === activeProjectId) ?? null;
  const globalTab: 'project' = 'project';

  const isProjectBusy = useCallback((proj: Project): boolean => {
    return projectService.getProjectBusyMeta(proj).busy;
  }, []);

  const hasBusyTask = projects.some(isProjectBusy);
  const busyProjectIds = projects.filter(isProjectBusy).map((proj) => proj.id);
  const activeProjectBusy = shouldBlockProjectNavigation(activeProjectId, busyProjectIds);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await projectService.syncFromServer();
        await projectService.repairZombieLocks();
        reconcileProjectStatuses();
        if (!cancelled) {
          refreshProjects();
          setBootstrapError('');
        }
      } catch (error) {
        console.warn('[BidGeneratorApp] 首屏同步失败，回退到本地缓存展示。', error);
        if (!cancelled) {
          refreshProjects();
          setBootstrapError('统一后端同步失败，当前已回退到本地缓存展示。');
        }
      } finally {
        if (!cancelled) {
          setBootstrapping(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshProjects, reconcileProjectStatuses]);

  useEffect(() => {
    return projectService.subscribe(() => {
      refreshProjects();
    });
  }, [refreshProjects]);

  useEffect(() => {
    reconcileProjectStatuses();
  }, [projects, reconcileProjectStatuses]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!hasBusyTask) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasBusyTask]);

  const handleSelectProject = (id: string) => {
    const proj = projects.find(p => p.id === id);
    if (!proj) return;
    if (activeProjectId === id) return;
    const tab = getProjectTabByStatus(proj);
    guardNavigation(`切换到项目「${proj.name}」`, () => navigate(`/projects/${id}/${tab}`));
  };

  const handleDeleteProject = (id: string) => {
    projectService.delete(id);
    refreshProjects();
    navigate('/');
  };

  const handleProjectCreated = (project: Project) => {
    refreshProjects();
    navigate(`/projects/${project.id}/analysis`);
  };

  const handleRepairZombieLocks = useCallback(async () => {
    if (repairingLocks) return;
    setRepairingLocks(true);
    try {
      await projectService.repairZombieLocks(undefined, { forceLocalDiagramWait: true });
      reconcileProjectStatuses();
      refreshProjects();
    } finally {
      setRepairingLocks(false);
    }
  }, [refreshProjects, reconcileProjectStatuses, repairingLocks]);

  const guardNavigation = (targetLabel: string, action: () => void) => {
    if (!activeProjectBusy) {
      action();
      return;
    }
    setSwitchWarn({ open: true, targetLabel });
  };

  return (
    <div className="h-full min-h-0 bg-gray-50 flex overflow-hidden">
      {/* 左侧项目导航栏 */}
      <Sidebar
        projects={projects}
        activeProjectId={activeProjectId}
        globalTab={globalTab}
        onSelectProject={handleSelectProject}
        onNewProject={() => guardNavigation('新建项目', () => navigate('/'))}
        onDeleteProject={handleDeleteProject}
        onRepairLocks={handleRepairZombieLocks}
        repairingLocks={repairingLocks}
        projectsLoading={bootstrapping}
        lockedProjectId={activeProjectBusy ? activeProjectId : null}
        disableNewProject={activeProjectBusy}
      />

      {/* 右侧主内容区 */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0 overflow-hidden">
        {bootstrapError ? (
          <div className="border-b border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] px-6 py-3 text-sm text-[var(--color-warning-text)]">
            {bootstrapError}
          </div>
        ) : null}
        <Routes>
          {/* 新建项目 */}
          <Route path="/" element={
            <ProjectCreator onProjectCreated={handleProjectCreated} />
          } />

          {/* 项目视图（必须有 tab） */}
          <Route path="/projects/:id/:tab" element={
            <ProjectView projects={projects} refreshProjects={refreshProjects} />
          } />

          {/* /projects/:id → 重定向到 analysis tab（在 ProjectRedirect 中动态决定） */}
          <Route path="/projects/:id" element={
            <ProjectRedirect projects={projects} />
          } />

          {/* 其他路由 → 回首页 */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>

      {switchWarn.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-panel w-full max-w-md mx-4 overflow-hidden">
            <div className="px-6 pt-6 pb-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-[var(--color-warning-bg)] flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5 text-warning" />
                </div>
                <h3 className="text-base font-bold text-gray-900">检测到生成任务进行中</h3>
              </div>
              <p className="text-sm text-gray-600 leading-relaxed">
                当前项目有真实 AI 任务仍在执行。为避免同一浏览器窗口下的项目状态串扰，任务运行期间不允许切换到「{switchWarn.targetLabel}」。
              </p>
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button
                onClick={() => setSwitchWarn({ open: false, targetLabel: '' })}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
              >
                留在当前项目
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 重定向到项目的正确 tab
function ProjectRedirect({ projects }: { projects: Project[] }) {
  const { id } = useParams<{ id: string }>();
  const proj = projects.find(p => p.id === id);
  if (!proj) return <Navigate to="/" replace />;
  const stageIdx = getCurrentStageIndex(proj.status);
  const tab = VALID_TABS[stageIdx] || 'analysis';
  return <Navigate to={`/projects/${id}/${tab}`} replace />;
}
