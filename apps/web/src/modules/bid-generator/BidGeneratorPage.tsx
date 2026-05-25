import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiRequestError } from "../../shared/api/client";
import { useAuth } from "../../shared/auth/AuthProvider";
import { Icon } from "../../shared/components/Icon";
import {
  cancelTask,
  createObjectUrlFromDownload,
  createProject,
  deleteProject,
  deleteProjectCaches,
  desensitizeText,
  exportReport,
  exportScoringTable,
  fetchAnalysisFramework,
  fetchBidHealth,
  fetchKbSyncJobs,
  fetchKnowledgeDocuments,
  fetchProjectMappings,
  fetchProjectPdf,
  fetchProtectedAsset,
  fetchSourceDocx,
  fetchSupportedEntities,
  fetchWorkflowStatus,
  forgeDocument,
  getProject,
  listProjects,
  mergeExtractIntoProject,
  normalizeProjectData,
  patchProject,
  restoreText,
  saveBlobToDisk,
  startAnalyzeTask,
  startKbSync,
  startOutlineTask,
  streamExtractRequirements,
  streamGenerateContent,
  streamGenerateOutline,
  streamTaskProgress,
  syncKnowledge,
} from "./services/bidGeneratorApi";
import type {
  BidImageAsset,
  BidKbSyncJob,
  BidKnowledgeDocument,
  BidProjectData,
  BidProjectRecord,
  BidRequirement,
  BidStreamEvent,
  BidWorkflowStatusItem,
} from "./types";

type BidTab = "overview" | "extract" | "generate" | "assets" | "knowledge" | "privacy";

const tabs: Array<{ id: BidTab; label: string }> = [
  { id: "overview", label: "项目" },
  { id: "extract", label: "解析" },
  { id: "generate", label: "生成" },
  { id: "assets", label: "预览" },
  { id: "knowledge", label: "知识库" },
  { id: "privacy", label: "脱敏" },
];

export function BidGeneratorPage() {
  const { canAccessApp } = useAuth();
  const [projects, setProjects] = useState<BidProjectRecord[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [activeTab, setActiveTab] = useState<BidTab>("overview");
  const [health, setHealth] = useState<{ status?: string; service?: string } | null>(null);
  const [workflowStatus, setWorkflowStatus] = useState<Record<string, BidWorkflowStatusItem>>({});
  const [entities, setEntities] = useState<Record<string, string>>({});
  const [analysisFrameworkCount, setAnalysisFrameworkCount] = useState(0);
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<BidKnowledgeDocument[]>([]);
  const [kbJobs, setKbJobs] = useState<BidKbSyncJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [operationBusy, setOperationBusy] = useState("");
  const [pageError, setPageError] = useState("");
  const [pageNotice, setPageNotice] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [enableDesensitize, setEnableDesensitize] = useState(true);
  const [useVisionParsing, setUseVisionParsing] = useState(false);
  const [expectedWords, setExpectedWords] = useState(12000);
  const [contentTitle, setContentTitle] = useState("");
  const [contentHint, setContentHint] = useState("");
  const [contentText, setContentText] = useState("");
  const [streamEvents, setStreamEvents] = useState<BidStreamEvent[]>([]);
  const [activeTaskId, setActiveTaskId] = useState("");
  const [pdfObjectUrl, setPdfObjectUrl] = useState("");
  const [assetPreview, setAssetPreview] = useState<{ label: string; url: string } | null>(null);
  const [privacyText, setPrivacyText] = useState("");
  const [privacyOutput, setPrivacyOutput] = useState("");
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const abortRef = useRef<AbortController | null>(null);

  const allowed = canAccessApp("bid-generator");
  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) || projects[0] || null,
    [activeProjectId, projects],
  );
  const activeData = useMemo(() => normalizeProjectData(activeProject), [activeProject]);
  const workflowSummary = useMemo(() => summarizeWorkflowStatus(workflowStatus), [workflowStatus]);
  const projectStats = useMemo(() => buildProjectStats(projects), [projects]);
  const imageAssets = useMemo(() => collectImageAssets(activeData.imageMap), [activeData.imageMap]);
  const outlineItems = useMemo(() => flattenOutline(activeData.outline || []), [activeData.outline]);
  const generatedEntries = useMemo(() => Object.entries(activeData.generatedContent || {}), [activeData.generatedContent]);

  const setError = (error: unknown, fallback: string) => {
    setPageError(toUserMessage(error, fallback));
  };

  const refreshProjects = useCallback(async (options: { keepActive?: boolean } = {}) => {
    const nextProjects = await listProjects();
    setProjects(nextProjects);
    setActiveProjectId((current) => {
      if (options.keepActive && current && nextProjects.some((project) => project.id === current)) {
        return current;
      }
      if (current && nextProjects.some((project) => project.id === current)) {
        return current;
      }
      return nextProjects[0]?.id || "";
    });
    return nextProjects;
  }, []);

  const refreshKnowledge = useCallback(async () => {
    const [knowledge, jobs] = await Promise.all([
      fetchKnowledgeDocuments(),
      fetchKbSyncJobs().catch(() => ({ jobs: [] })),
    ]);
    setKnowledgeDocuments(Array.isArray(knowledge.documents) ? knowledge.documents : []);
    setKbJobs(Array.isArray(jobs.jobs) ? jobs.jobs : []);
  }, []);

  const loadBootstrap = useCallback(async () => {
    if (!allowed) {
      return;
    }
    setLoading(true);
    setPageError("");
    try {
      const [nextHealth, nextWorkflow, nextEntities, framework] = await Promise.all([
        fetchBidHealth(),
        fetchWorkflowStatus(),
        fetchSupportedEntities(),
        fetchAnalysisFramework().catch(() => []),
      ]);
      setHealth(nextHealth);
      setWorkflowStatus(nextWorkflow || {});
      setEntities(nextEntities.entities || {});
      setAnalysisFrameworkCount(countFrameworkNodes(framework));
      await Promise.all([refreshProjects({ keepActive: true }), refreshKnowledge()]);
    } catch (error) {
      setError(error, "标书生成模块加载失败。");
    } finally {
      setLoading(false);
    }
  }, [allowed, refreshKnowledge, refreshProjects]);

  useEffect(() => {
    void loadBootstrap();
    return () => {
      abortRef.current?.abort();
    };
  }, [loadBootstrap]);

  useEffect(() => {
    setContentTitle(outlineItems[0]?.title || "");
    setContentHint(outlineItems[0]?.writingHint || "");
  }, [activeProject?.id, outlineItems]);

  useEffect(() => {
    return () => {
      if (pdfObjectUrl) {
        URL.revokeObjectURL(pdfObjectUrl);
      }
    };
  }, [pdfObjectUrl]);

  useEffect(() => {
    return () => {
      if (assetPreview?.url) {
        URL.revokeObjectURL(assetPreview.url);
      }
    };
  }, [assetPreview]);

  const persistActiveProjectData = async (project: BidProjectRecord, nextData: BidProjectData, notice?: string) => {
    const updated = await patchProject(project.id, nextData, String(nextData.status || project.status), String(nextData.name || project.name));
    setProjects((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setActiveProjectId(updated.id);
    if (notice) {
      setPageNotice(notice);
    }
    return updated;
  };

  const handleCreateProject = async () => {
    const name = newProjectName.trim() || "未命名标书项目";
    setOperationBusy("create");
    setPageError("");
    try {
      const projectId = createClientProjectId();
      const created = await createProject({
        id: projectId,
        name,
        bidFileName: "",
        status: "uploading",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        requirements: [],
        analysisReport: [],
        outline: [],
        mappingTable: {},
        imageMap: {},
      });
      setProjects((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setActiveProjectId(created.id);
      setNewProjectName("");
      setActiveTab("extract");
      setPageNotice("项目已创建。");
    } catch (error) {
      setError(error, "创建项目失败。");
    } finally {
      setOperationBusy("");
    }
  };

  const ensureProjectForUpload = async () => {
    if (activeProject) {
      return activeProject;
    }
    const fileBaseName = uploadFile?.name ? uploadFile.name.replace(/\.[^.]+$/, "") : "";
    const projectId = createClientProjectId();
    return createProject({
      id: projectId,
      name: newProjectName.trim() || fileBaseName || "未命名标书项目",
      bidFileName: uploadFile?.name || "",
      status: "uploading",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  };

  const handleExtract = async () => {
    if (!uploadFile) {
      setPageError("请选择招标文件。");
      return;
    }
    setOperationBusy("extract");
    setPageError("");
    setPageNotice("");
    setStreamEvents([]);
    abortRef.current?.abort();
    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      const project = await ensureProjectForUpload();
      setActiveProjectId(project.id);
      setProjects((current) =>
        current.some((item) => item.id === project.id)
          ? current.map((item) => (item.id === project.id ? project : item))
          : [project, ...current],
      );
      let resultSeen = false;
      await streamExtractRequirements(
        {
          file: uploadFile,
          projectId: project.id,
          projectName: project.name,
          enableDesensitize,
          useVisionParsing,
        },
        async (event) => {
          setStreamEvents((current) => appendStreamEvent(current, event));
          if (event.event === "result") {
            resultSeen = true;
            const nextData = mergeExtractIntoProject(project, event.data, uploadFile.name);
            await persistActiveProjectData(project, nextData, "文档解析完成。");
          }
          if (event.event === "error" || event.data.error) {
            setPageError(String(event.data.message || event.data.error || "解析失败。"));
          }
        },
        abortController.signal,
      );
      if (!resultSeen) {
        await refreshProjects({ keepActive: true });
      }
      setActiveTab("overview");
    } catch (error) {
      if (!isAbortError(error)) {
        setError(error, "解析招标文件失败。");
      }
    } finally {
      setOperationBusy("");
    }
  };

  const handleStartAnalyzeTask = async () => {
    if (!activeProject) {
      return;
    }
    setOperationBusy("analyze");
    setPageError("");
    setStreamEvents([]);
    abortRef.current?.abort();
    const abortController = new AbortController();
    abortRef.current = abortController;
    try {
      const started = await startAnalyzeTask(activeProject.id);
      setActiveTaskId(started.task_id);
      setPageNotice(`解析报告任务已启动：${shortId(started.task_id)}`);
      await streamTaskProgress(
        started.task_id,
        activeProject.id,
        (event) => {
          setStreamEvents((current) => appendStreamEvent(current, event));
          if (event.event === "done" || event.data.done || event.data.success_count !== undefined) {
            void getProject(activeProject.id).then((project) => {
              setProjects((current) => current.map((item) => (item.id === project.id ? project : item)));
            });
          }
          if (event.event === "error" || event.data.error) {
            setPageError(String(event.data.error || "解析报告任务失败。"));
          }
        },
        abortController.signal,
      );
    } catch (error) {
      if (!isAbortError(error)) {
        setError(error, "启动解析报告任务失败。");
      }
    } finally {
      setOperationBusy("");
    }
  };

  const handleStartOutlineTask = async () => {
    if (!activeProject) {
      return;
    }
    setOperationBusy("outline-task");
    setPageError("");
    setStreamEvents([]);
    abortRef.current?.abort();
    const abortController = new AbortController();
    abortRef.current = abortController;
    try {
      const started = await startOutlineTask(activeProject, expectedWords);
      setActiveTaskId(started.task_id);
      setPageNotice(`后台大纲任务已启动：${shortId(started.task_id)}`);
      await streamTaskProgress(
        started.task_id,
        activeProject.id,
        async (event) => {
          setStreamEvents((current) => appendStreamEvent(current, event));
          if (event.event === "done" || event.data.done) {
            const sections = Array.isArray(event.data.sections) ? event.data.sections : [];
            if (sections.length) {
              await persistActiveProjectData(
                activeProject,
                { ...activeData, outline: sections, status: "outline_ready", updatedAt: new Date().toISOString() },
                "大纲已生成。",
              );
            }
          }
          if (event.event === "error" || event.data.error) {
            setPageError(String(event.data.error || "大纲任务失败。"));
          }
        },
        abortController.signal,
      );
    } catch (error) {
      if (!isAbortError(error)) {
        setError(error, "启动后台大纲任务失败。");
      }
    } finally {
      setOperationBusy("");
    }
  };

  const handleGenerateOutlineStream = async () => {
    if (!activeProject) {
      return;
    }
    setOperationBusy("outline-stream");
    setPageError("");
    setStreamEvents([]);
    abortRef.current?.abort();
    const abortController = new AbortController();
    abortRef.current = abortController;
    try {
      await streamGenerateOutline(
        activeProject,
        expectedWords,
        async (event) => {
          setStreamEvents((current) => appendStreamEvent(current, event));
          if (event.data.done && Array.isArray(event.data.sections)) {
            await persistActiveProjectData(
              activeProject,
              { ...activeData, outline: event.data.sections, status: "outline_ready", updatedAt: new Date().toISOString() },
              "流式大纲已生成。",
            );
          }
          if (event.data.error) {
            setPageError(String(event.data.error));
          }
        },
        abortController.signal,
      );
    } catch (error) {
      if (!isAbortError(error)) {
        setError(error, "流式生成大纲失败。");
      }
    } finally {
      setOperationBusy("");
    }
  };

  const handleGenerateContent = async () => {
    if (!activeProject || !contentTitle.trim()) {
      setPageError("请选择或填写章节标题。");
      return;
    }
    const sectionId = outlineItems.find((item) => item.title === contentTitle)?.id || `manual-${Date.now()}`;
    setOperationBusy("content-stream");
    setPageError("");
    setContentText("");
    setStreamEvents([]);
    abortRef.current?.abort();
    const abortController = new AbortController();
    abortRef.current = abortController;
    try {
      let nextContent = "";
      await streamGenerateContent(
        {
          project: activeProject,
          sectionId,
          sectionTitle: contentTitle,
          writingHint: contentHint,
          expectedWords: Math.max(300, Math.round(expectedWords / 8)),
          globalOutline: outlineItems.map((item) => item.title).join("\n"),
        },
        async (event) => {
          setStreamEvents((current) => appendStreamEvent(current, event));
          if (event.data.text) {
            nextContent += String(event.data.text);
            setContentText(nextContent);
          }
          if (event.data.done) {
            const finalContent = String(event.data.content || nextContent || "");
            setContentText(finalContent);
            await persistActiveProjectData(
              activeProject,
              {
                ...activeData,
                status: "editing",
                generatedContent: {
                  ...(activeData.generatedContent || {}),
                  [sectionId]: {
                    status: "done",
                    content: finalContent,
                    wordCount: Number(event.data.word_count || finalContent.length),
                    qualityScore: Number(event.data.quality_score || 0) || undefined,
                    feedback: String(event.data.feedback || ""),
                  },
                },
                updatedAt: new Date().toISOString(),
              },
              "章节正文已生成。",
            );
          }
          if (event.data.error) {
            setPageError(String(event.data.error));
          }
        },
        abortController.signal,
      );
    } catch (error) {
      if (!isAbortError(error)) {
        setError(error, "生成正文失败。");
      }
    } finally {
      setOperationBusy("");
    }
  };

  const handleCancelTask = async () => {
    if (!activeTaskId || !activeProject) {
      return;
    }
    setOperationBusy("cancel");
    try {
      await cancelTask(activeTaskId, activeProject.id);
      abortRef.current?.abort();
      setPageNotice("任务取消请求已发送。");
      setActiveTaskId("");
    } catch (error) {
      setError(error, "取消任务失败。");
    } finally {
      setOperationBusy("");
    }
  };

  const handleDeleteProject = async () => {
    if (!activeProject) {
      return;
    }
    const confirmed = window.confirm(`确认删除项目「${activeProject.name}」？`);
    if (!confirmed) {
      return;
    }
    setOperationBusy("delete");
    try {
      await deleteProject(activeProject.id);
      setPageNotice("项目已删除。");
      await refreshProjects();
    } catch (error) {
      setError(error, "删除项目失败。");
    } finally {
      setOperationBusy("");
    }
  };

  const handleDeleteCaches = async () => {
    if (!activeProject) {
      return;
    }
    setOperationBusy("caches");
    try {
      await deleteProjectCaches(activeProject.id);
      setPageNotice("项目缓存已清理。");
    } catch (error) {
      setError(error, "清理项目缓存失败。");
    } finally {
      setOperationBusy("");
    }
  };

  const handleLoadMappings = async () => {
    if (!activeProject) {
      return;
    }
    setOperationBusy("mappings");
    try {
      const payload = await fetchProjectMappings(activeProject.id);
      setMappings(payload.mappings || {});
      setPageNotice(`已读取 ${payload.count || 0} 条映射。`);
    } catch (error) {
      setError(error, "读取映射失败。");
    } finally {
      setOperationBusy("");
    }
  };

  const handlePreviewPdf = async () => {
    if (!activeProject) {
      return;
    }
    setOperationBusy("pdf");
    try {
      const download = await fetchProjectPdf(activeProject.id);
      if (pdfObjectUrl) {
        URL.revokeObjectURL(pdfObjectUrl);
      }
      setPdfObjectUrl(createObjectUrlFromDownload(download));
      setActiveTab("assets");
    } catch (error) {
      setError(error, "PDF 预览加载失败。");
    } finally {
      setOperationBusy("");
    }
  };

  const handlePreviewAsset = async (label: string, path: string) => {
    setOperationBusy(`asset:${label}`);
    try {
      const download = await fetchProtectedAsset(path);
      if (assetPreview?.url) {
        URL.revokeObjectURL(assetPreview.url);
      }
      setAssetPreview({ label, url: createObjectUrlFromDownload(download) });
    } catch (error) {
      setError(error, "图片预览加载失败。");
    } finally {
      setOperationBusy("");
    }
  };

  const runDownload = async (kind: string, action: () => Promise<{ blob: Blob; fileName: string }>, fallback: string) => {
    setOperationBusy(kind);
    setPageError("");
    try {
      saveBlobToDisk(await action());
      setPageNotice("文件已生成下载。");
    } catch (error) {
      setError(error, fallback);
    } finally {
      setOperationBusy("");
    }
  };

  const handleKnowledgeSync = async (docName?: string) => {
    setOperationBusy(docName ? `knowledge:${docName}` : "knowledge");
    try {
      const res = await syncKnowledge(docName);
      setPageNotice(res.message || "知识库同步已启动。");
      await refreshKnowledge();
    } catch (error) {
      setError(error, "知识库同步失败。");
    } finally {
      setOperationBusy("");
    }
  };

  const handleKbSync = async () => {
    setOperationBusy("kb-sync");
    try {
      const res = await startKbSync();
      setPageNotice(res.message || "知识库异步同步已启动。");
      await refreshKnowledge();
    } catch (error) {
      setError(error, "启动 KB 同步失败。");
    } finally {
      setOperationBusy("");
    }
  };

  const handleDesensitize = async () => {
    if (!privacyText.trim()) {
      return;
    }
    setOperationBusy("desensitize");
    try {
      const result = await desensitizeText({ text: privacyText, profile: "tender", method: "placeholder" });
      setPrivacyOutput(result.desensitized_text || "");
      setMappings(result.mapping_table || {});
      setPageNotice(`脱敏完成，识别 ${result.entity_count || 0} 处实体。`);
    } catch (error) {
      setError(error, "脱敏失败。");
    } finally {
      setOperationBusy("");
    }
  };

  const handleRestore = async () => {
    const source = privacyOutput || privacyText;
    if (!source.trim()) {
      return;
    }
    setOperationBusy("restore");
    try {
      const result = await restoreText(source);
      setPrivacyOutput(result.restored_text || "");
      setPageNotice(`还原完成，替换 ${result.restored_count || 0} 处占位符。`);
    } catch (error) {
      setError(error, "还原失败。");
    } finally {
      setOperationBusy("");
    }
  };

  if (!allowed) {
    return (
      <section className="page-stack">
        <div className="notice warning">
          <span>当前账号没有访问标书生成的权限。</span>
        </div>
      </section>
    );
  }

  return (
    <section className="bid-page">
      <header className="page-hero compact">
        <div>
          <span className="eyebrow">Bid Generator</span>
          <h1>标书生成</h1>
          <p>项目、解析、生成、导出和知识库已在 apps/web 原生承载，legacy iframe 配置继续保留用于回滚。</p>
        </div>
        <div className="hero-metrics">
          <div>
            <span>项目</span>
            <strong>{projects.length}</strong>
          </div>
          <div>
            <span>解析完成</span>
            <strong>{projectStats.reportDone}</strong>
          </div>
          <div>
            <span>Workflow</span>
            <strong>{workflowSummary.configured}/{workflowSummary.total}</strong>
          </div>
        </div>
      </header>

      {pageError ? (
        <div className="notice warning">
          <span>{pageError}</span>
          <button type="button" className="ghost-button" onClick={() => setPageError("")}>关闭</button>
        </div>
      ) : null}
      {pageNotice ? (
        <div className="success-message">{pageNotice}</div>
      ) : null}

      <div className="bid-layout">
        <aside className="bid-sidebar">
          <div className="section-title-row">
            <div>
              <span className="eyebrow">Projects</span>
              <h2>项目列表</h2>
            </div>
            <button type="button" className="icon-button small" onClick={() => void refreshProjects({ keepActive: true })} aria-label="刷新项目">
              <Icon name="refresh" />
            </button>
          </div>

          <div className="bid-create-row">
            <input
              value={newProjectName}
              onChange={(event) => setNewProjectName(event.target.value)}
              placeholder="项目名称"
            />
            <button type="button" className="primary-button" onClick={handleCreateProject} disabled={Boolean(operationBusy)}>
              <Icon name="plus" />
              新建
            </button>
          </div>

          <div className="bid-project-list">
            {loading ? <div className="page-center-state small"><span className="loading-spinner" />加载中</div> : null}
            {!loading && projects.length === 0 ? <div className="contract-empty-state">暂无项目</div> : null}
            {projects.map((project) => {
              const data = normalizeProjectData(project);
              return (
                <button
                  key={project.id}
                  type="button"
                  className={project.id === activeProject?.id ? "bid-project-row active" : "bid-project-row"}
                  onClick={() => setActiveProjectId(project.id)}
                >
                  <strong>{project.name}</strong>
                  <span>{data.bidFileName || project.id}</span>
                  <small>{statusLabel(project.status)}</small>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="bid-main">
          <div className="bid-status-strip">
            <StatusTile label="后端" value={health?.status || "unknown"} tone={health?.status === "ok" ? "good" : "warn"} />
            <StatusTile label="服务" value={health?.service || "pipt-lite"} />
            <StatusTile label="解析框架" value={`${analysisFrameworkCount} 节点`} />
            <StatusTile label="实体类型" value={`${Object.keys(entities).length} 类`} />
          </div>

          <div className="tabbar bid-tabbar" role="tablist">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={activeTab === tab.id ? "active" : ""}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "overview" ? (
            <OverviewPanel
              project={activeProject}
              data={activeData}
              workflowStatus={workflowStatus}
              mappings={mappings}
              generatedEntries={generatedEntries}
              onLoadMappings={handleLoadMappings}
              onDeleteProject={handleDeleteProject}
              onDeleteCaches={handleDeleteCaches}
              busy={operationBusy}
            />
          ) : null}

          {activeTab === "extract" ? (
            <section className="bid-panel">
              <div className="panel-title">
                <span className="module-icon"><Icon name="upload" /></span>
                <div>
                  <h2>文件上传与需求提取</h2>
                  <p>支持 PDF、DOCX、DOC、TXT、MD，解析产物写回项目数据。</p>
                </div>
              </div>
              <label className="contract-dropzone">
                <span className="contract-dropzone-icon"><Icon name="file" /></span>
                <span>
                  <strong>{uploadFile?.name || "选择招标文件"}</strong>
                  <span>{uploadFile ? formatBytes(uploadFile.size) : "PDF / DOCX / DOC / TXT / MD"}</span>
                </span>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.txt,.md"
                  onChange={(event) => setUploadFile(event.target.files?.[0] || null)}
                />
              </label>
              <div className="bid-switch-row">
                <label className={enableDesensitize ? "permission-chip active" : "permission-chip"}>
                  <span>提取前脱敏</span>
                  <input type="checkbox" checked={enableDesensitize} onChange={(event) => setEnableDesensitize(event.target.checked)} />
                </label>
                <label className={useVisionParsing ? "permission-chip active" : "permission-chip"}>
                  <span>视觉图片解析</span>
                  <input type="checkbox" checked={useVisionParsing} onChange={(event) => setUseVisionParsing(event.target.checked)} />
                </label>
              </div>
              <div className="row-actions">
                <button type="button" className="primary-button" onClick={handleExtract} disabled={!uploadFile || Boolean(operationBusy)}>
                  {operationBusy === "extract" ? <span className="loading-spinner" /> : <Icon name="spark" />}
                  开始解析
                </button>
                <button type="button" className="secondary-button" onClick={handleStartAnalyzeTask} disabled={!activeProject || Boolean(operationBusy)}>
                  <Icon name="search" />
                  生成解析报告任务
                </button>
                {activeTaskId ? (
                  <button type="button" className="ghost-button" onClick={handleCancelTask} disabled={operationBusy === "cancel"}>
                    <Icon name="close" />
                    取消任务
                  </button>
                ) : null}
              </div>
              <StreamLog events={streamEvents} />
            </section>
          ) : null}

          {activeTab === "generate" ? (
            <section className="bid-panel">
              <div className="panel-title">
                <span className="module-icon"><Icon name="spark" /></span>
                <div>
                  <h2>大纲与正文生成</h2>
                  <p>保留 SSE 与后台任务两种标书生成链路。</p>
                </div>
              </div>
              <div className="two-column">
                <label className="form-field">
                  <span>技术方案总字数</span>
                  <input type="number" min={1000} step={500} value={expectedWords} onChange={(event) => setExpectedWords(Number(event.target.value) || 0)} />
                </label>
                <label className="form-field">
                  <span>章节标题</span>
                  <select value={contentTitle} onChange={(event) => {
                    const nextTitle = event.target.value;
                    setContentTitle(nextTitle);
                    setContentHint(outlineItems.find((item) => item.title === nextTitle)?.writingHint || contentHint);
                  }}>
                    <option value="">手动输入</option>
                    {outlineItems.map((item) => (
                      <option key={item.id} value={item.title || item.id}>{item.title || item.id}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="form-field">
                <span>章节标题</span>
                <input value={contentTitle} onChange={(event) => setContentTitle(event.target.value)} placeholder="例如：总体技术方案" />
              </label>
              <label className="form-field">
                <span>写作要求</span>
                <textarea rows={4} value={contentHint} onChange={(event) => setContentHint(event.target.value)} />
              </label>
              <div className="row-actions">
                <button type="button" className="primary-button" onClick={handleStartOutlineTask} disabled={!activeProject || Boolean(operationBusy)}>
                  <Icon name="spark" />
                  后台生成大纲
                </button>
                <button type="button" className="secondary-button" onClick={handleGenerateOutlineStream} disabled={!activeProject || Boolean(operationBusy)}>
                  <Icon name="send" />
                  流式生成大纲
                </button>
                <button type="button" className="secondary-button" onClick={handleGenerateContent} disabled={!activeProject || Boolean(operationBusy)}>
                  <Icon name="send" />
                  流式生成正文
                </button>
                {activeTaskId ? (
                  <button type="button" className="ghost-button" onClick={handleCancelTask} disabled={operationBusy === "cancel"}>
                    <Icon name="close" />
                    取消任务
                  </button>
                ) : null}
              </div>
              {contentText ? (
                <div className="bid-generated-preview">
                  <span className="eyebrow">Generated content</span>
                  <p>{contentText}</p>
                </div>
              ) : null}
              <StreamLog events={streamEvents} />
            </section>
          ) : null}

          {activeTab === "assets" ? (
            <section className="bid-panel">
              <div className="section-title-row">
                <div className="panel-title">
                  <span className="module-icon"><Icon name="download" /></span>
                  <div>
                    <h2>预览与导出</h2>
                    <p>PDF、图片、DOCX、解析报告和评分表均通过鉴权 blob 请求处理。</p>
                  </div>
                </div>
              </div>
              <div className="contract-download-actions">
                <button type="button" className="secondary-button" onClick={handlePreviewPdf} disabled={!activeProject || Boolean(operationBusy)}>
                  <Icon name="file" />
                  PDF 预览
                </button>
                <button type="button" className="secondary-button" onClick={() => activeProject && void runDownload("source-docx", () => fetchSourceDocx(activeProject.id), "源 DOCX 下载失败。")} disabled={!activeProject || Boolean(operationBusy)}>
                  <Icon name="download" />
                  Source DOCX
                </button>
                <button type="button" className="secondary-button" onClick={() => activeProject && void runDownload("export-report", () => exportReport(activeProject.name, activeData.analysisReport || []), "解析报告导出失败。")} disabled={!activeProject || Boolean(operationBusy)}>
                  <Icon name="download" />
                  解析报告 PDF
                </button>
                <button type="button" className="secondary-button" onClick={() => activeProject && void runDownload("export-scoring", () => exportScoringTable(activeProject.name, activeData.scoringRows || activeData.scoringTableTemplate || []), "评分表导出失败。")} disabled={!activeProject || Boolean(operationBusy)}>
                  <Icon name="download" />
                  评分表 Excel
                </button>
                <button type="button" className="primary-button" onClick={() => activeProject && void runDownload("forge", () => forgeDocument(activeProject), "标书 DOCX 生成失败。")} disabled={!activeProject || Boolean(operationBusy)}>
                  <Icon name="save" />
                  生成标书 DOCX
                </button>
              </div>
              <div className="bid-preview-grid">
                <div className="bid-preview-box">
                  {pdfObjectUrl ? <iframe title="标书 PDF 预览" src={pdfObjectUrl} /> : <div className="contract-empty-state">未加载 PDF</div>}
                </div>
                <div className="bid-preview-box">
                  {assetPreview ? (
                    <>
                      <strong>{assetPreview.label}</strong>
                      <img src={assetPreview.url} alt={assetPreview.label} />
                    </>
                  ) : (
                    <div className="contract-empty-state">未选择图片</div>
                  )}
                </div>
              </div>
              <div className="bid-image-grid">
                {imageAssets.length === 0 ? <div className="contract-empty-state">暂无提取图片</div> : null}
                {imageAssets.slice(0, 12).map((asset) => (
                  <button
                    key={asset.label}
                    type="button"
                    className="bid-image-row"
                    onClick={() => void handlePreviewAsset(asset.label, asset.path)}
                    disabled={Boolean(operationBusy)}
                  >
                    <Icon name="file" />
                    <span>{asset.label}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {activeTab === "knowledge" ? (
            <section className="bid-panel">
              <div className="section-title-row">
                <div className="panel-title">
                  <span className="module-icon"><Icon name="grid" /></span>
                  <div>
                    <h2>Knowledge / KB</h2>
                    <p>Dify Dataset 文档状态与本地 KB 同步任务。</p>
                  </div>
                </div>
                <div className="row-actions">
                  <button type="button" className="ghost-button" onClick={() => void refreshKnowledge()}>
                    <Icon name="refresh" />
                    刷新
                  </button>
                  <button type="button" className="secondary-button" onClick={() => void handleKnowledgeSync()} disabled={Boolean(operationBusy)}>
                    <Icon name="send" />
                    同步 Knowledge
                  </button>
                  <button type="button" className="primary-button" onClick={handleKbSync} disabled={Boolean(operationBusy)}>
                    <Icon name="spark" />
                    启动 KB Sync
                  </button>
                </div>
              </div>
              <div className="bid-knowledge-grid">
                <div className="bid-list-panel">
                  <span className="eyebrow">Documents</span>
                  {knowledgeDocuments.length === 0 ? <div className="contract-empty-state">暂无文档</div> : null}
                  {knowledgeDocuments.map((doc) => (
                    <div key={doc.id || doc.name} className="bid-doc-row">
                      <div>
                        <strong>{doc.name}</strong>
                        <span>{doc.status || "-"} · {doc.size || "-"} · {doc.chunks || 0} chunks</span>
                      </div>
                      <button type="button" className="ghost-button" onClick={() => void handleKnowledgeSync(doc.name)} disabled={Boolean(operationBusy)}>
                        同步
                      </button>
                    </div>
                  ))}
                </div>
                <div className="bid-list-panel">
                  <span className="eyebrow">Sync jobs</span>
                  {kbJobs.length === 0 ? <div className="contract-empty-state">暂无任务</div> : null}
                  {kbJobs.map((job) => (
                    <div key={job.job_id || job.task_id} className="bid-doc-row">
                      <div>
                        <strong>{shortId(String(job.job_id || job.task_id || ""))}</strong>
                        <span>{job.status || "-"} · {job.processed || 0}/{job.total || 0} · failed {job.failed || 0}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          ) : null}

          {activeTab === "privacy" ? (
            <section className="bid-panel">
              <div className="panel-title">
                <span className="module-icon"><Icon name="shield" /></span>
                <div>
                  <h2>实体映射与脱敏还原</h2>
                  <p>复用 PIPT entity registry，不在 URL 中携带 token。</p>
                </div>
              </div>
              <div className="two-column">
                <label className="form-field">
                  <span>输入文本</span>
                  <textarea rows={10} value={privacyText} onChange={(event) => setPrivacyText(event.target.value)} />
                </label>
                <label className="form-field">
                  <span>输出文本</span>
                  <textarea rows={10} value={privacyOutput} onChange={(event) => setPrivacyOutput(event.target.value)} />
                </label>
              </div>
              <div className="row-actions">
                <button type="button" className="primary-button" onClick={handleDesensitize} disabled={!privacyText.trim() || Boolean(operationBusy)}>
                  <Icon name="shield" />
                  脱敏
                </button>
                <button type="button" className="secondary-button" onClick={handleRestore} disabled={!(privacyText.trim() || privacyOutput.trim()) || Boolean(operationBusy)}>
                  <Icon name="refresh" />
                  还原
                </button>
                <button type="button" className="ghost-button" onClick={handleLoadMappings} disabled={!activeProject || Boolean(operationBusy)}>
                  <Icon name="key" />
                  读取项目映射
                </button>
              </div>
              <MappingPreview mappings={mappings} />
            </section>
          ) : null}
        </main>
      </div>
    </section>
  );
}

function OverviewPanel({
  project,
  data,
  workflowStatus,
  mappings,
  generatedEntries,
  onLoadMappings,
  onDeleteProject,
  onDeleteCaches,
  busy,
}: {
  project: BidProjectRecord | null;
  data: BidProjectData;
  workflowStatus: Record<string, BidWorkflowStatusItem>;
  mappings: Record<string, string>;
  generatedEntries: Array<[string, { status?: string; content?: string; wordCount?: number; word_count?: number }]>;
  onLoadMappings: () => void;
  onDeleteProject: () => void;
  onDeleteCaches: () => void;
  busy: string;
}) {
  if (!project) {
    return <div className="contract-empty-state">请选择或新建标书项目</div>;
  }

  return (
    <section className="bid-panel">
      <div className="section-title-row">
        <div>
          <span className="eyebrow">Active project</span>
          <h2>{project.name}</h2>
        </div>
        <div className="row-actions">
          <button type="button" className="ghost-button" onClick={onLoadMappings} disabled={Boolean(busy)}>
            <Icon name="key" />
            Mappings
          </button>
          <button type="button" className="ghost-button" onClick={onDeleteCaches} disabled={Boolean(busy)}>
            <Icon name="refresh" />
            清缓存
          </button>
          <button type="button" className="ghost-button" onClick={onDeleteProject} disabled={Boolean(busy)}>
            <Icon name="close" />
            删除
          </button>
        </div>
      </div>
      <div className="contract-run-card">
        <div><span>状态</span><strong>{statusLabel(project.status)}</strong></div>
        <div><span>需求</span><strong>{data.requirements?.length || 0}</strong></div>
        <div><span>解析节点</span><strong>{countAnalysisNodes(data.analysisReport || [])}</strong></div>
        <div><span>大纲节点</span><strong>{flattenOutline(data.outline || []).length}</strong></div>
      </div>
      <div className="bid-overview-grid">
        <SummaryBlock title="项目摘要" text={String(data.summary || data.project_summary || "暂无摘要")} />
        <SummaryBlock title="文件" text={String(data.bidFileName || data.pdfUrl || "暂无文件")} />
        <SummaryBlock title="实体映射" text={`${Object.keys(mappings).length || Object.keys(data.mappingTable || {}).length || 0} 条映射，${data.entityCount || 0} 处实体`} />
        <SummaryBlock title="生成内容" text={`${generatedEntries.length} 个章节缓存`} />
      </div>
      <div className="bid-list-panel">
        <span className="eyebrow">Workflow status</span>
        <div className="bid-workflow-grid">
          {Object.entries(workflowStatus).map(([key, item]) => (
            <span key={key} className={item.configured ? "contract-status-pill completed" : "contract-status-pill failed"}>
              {item.label || key}
            </span>
          ))}
        </div>
      </div>
      <RequirementsPreview requirements={data.requirements || []} />
      <GeneratedPreview entries={generatedEntries} />
    </section>
  );
}

function StatusTile({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "good" | "warn" }) {
  return (
    <div className={`bid-status-tile ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SummaryBlock({ title, text }: { title: string; text: string }) {
  return (
    <article className="bid-summary-block">
      <span>{title}</span>
      <p>{text}</p>
    </article>
  );
}

function RequirementsPreview({ requirements }: { requirements: BidRequirement[] }) {
  return (
    <div className="bid-list-panel">
      <span className="eyebrow">Requirements</span>
      {requirements.length === 0 ? <div className="contract-empty-state">暂无需求</div> : null}
      {requirements.slice(0, 8).map((item, index) => (
        <article key={`${item.id || index}`} className="bid-requirement-row">
          <strong>{item.type || "item"} {item.points ? `· ${item.points} 分` : ""}</strong>
          <p>{item.content || ""}</p>
        </article>
      ))}
    </div>
  );
}

function GeneratedPreview({ entries }: { entries: Array<[string, { status?: string; content?: string; wordCount?: number; word_count?: number }]> }) {
  return (
    <div className="bid-list-panel">
      <span className="eyebrow">Generated content</span>
      {entries.length === 0 ? <div className="contract-empty-state">暂无正文缓存</div> : null}
      {entries.slice(0, 5).map(([id, value]) => (
        <article key={id} className="bid-requirement-row">
          <strong>{id} · {value.status || "unknown"} · {value.wordCount || value.word_count || 0} 字</strong>
          <p>{String(value.content || "").slice(0, 260)}</p>
        </article>
      ))}
    </div>
  );
}

function MappingPreview({ mappings }: { mappings: Record<string, string> }) {
  const entries = Object.entries(mappings || {});
  return (
    <div className="bid-list-panel">
      <span className="eyebrow">Mappings</span>
      {entries.length === 0 ? <div className="contract-empty-state">暂无映射</div> : null}
      {entries.slice(0, 20).map(([placeholder, original]) => (
        <div key={placeholder} className="bid-mapping-row">
          <code>{placeholder}</code>
          <span>{original}</span>
        </div>
      ))}
    </div>
  );
}

function StreamLog({ events }: { events: BidStreamEvent[] }) {
  if (!events.length) {
    return null;
  }
  return (
    <div className="bid-stream-log">
      <span className="eyebrow">Stream</span>
      {events.slice(-12).map((event, index) => (
        <div key={`${event.event}-${index}`}>
          <strong>{event.event}</strong>
          <span>{eventLabel(event)}</span>
        </div>
      ))}
    </div>
  );
}

function toUserMessage(error: unknown, fallback: string) {
  if (error instanceof ApiRequestError) {
    if (error.status === 403) {
      return "当前账号没有访问标书生成的权限。";
    }
    return error.message || fallback;
  }
  if (error instanceof Error) {
    return error.message || fallback;
  }
  return fallback;
}

function isAbortError(error: unknown) {
  return (
    error instanceof DOMException && error.name === "AbortError"
  ) || (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

function appendStreamEvent(current: BidStreamEvent[], next: BidStreamEvent) {
  return [...current.slice(-80), next];
}

function createClientProjectId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `bid-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function summarizeWorkflowStatus(status: Record<string, BidWorkflowStatusItem>) {
  const items = Object.values(status || {});
  return {
    total: items.length,
    configured: items.filter((item) => item.configured).length,
  };
}

function buildProjectStats(projects: BidProjectRecord[]) {
  return {
    reportDone: projects.filter((project) => {
      const status = String(project.status || "");
      return status === "report_done" || status === "outline_ready" || status === "editing" || status === "done";
    }).length,
  };
}

function countFrameworkNodes(payload: unknown): number {
  if (Array.isArray(payload)) {
    return countAnalysisNodes(payload as Array<{ children?: unknown[] }>);
  }
  if (payload && typeof payload === "object") {
    const framework = (payload as { framework?: unknown }).framework;
    if (Array.isArray(framework)) {
      return countAnalysisNodes(framework as Array<{ children?: unknown[] }>);
    }
  }
  return 0;
}

function countAnalysisNodes(nodes: Array<{ children?: unknown[] }>): number {
  let total = 0;
  for (const node of nodes || []) {
    total += 1;
    if (Array.isArray(node.children)) {
      total += countAnalysisNodes(node.children as Array<{ children?: unknown[] }>);
    }
  }
  return total;
}

function flattenOutline(items: Array<{ id: string; title?: string; writingHint?: string; headingLevel?: number; children?: unknown[] }>) {
  const out: Array<{ id: string; title?: string; writingHint?: string; headingLevel?: number }> = [];
  const visit = (nodes: typeof items) => {
    for (const node of nodes || []) {
      out.push(node);
      if (Array.isArray(node.children)) {
        visit(node.children as typeof items);
      }
    }
  };
  visit(items);
  return out;
}

function collectImageAssets(imageMap: BidProjectData["imageMap"]): Array<{ label: string; path: string }> {
  return Object.entries(imageMap || {})
    .map(([label, value]) => {
      if (typeof value === "string") {
        return { label, path: value };
      }
      const asset = value as BidImageAsset;
      return { label, path: asset.preview_url || asset.abs_path || "" };
    })
    .filter((item) => item.path);
}

function eventLabel(event: BidStreamEvent) {
  const data = event.data || {};
  return String(
    data.label ||
      data.stage ||
      data.text ||
      data.message ||
      data.error ||
      (data.done ? "完成" : "") ||
      JSON.stringify(data).slice(0, 180),
  );
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    uploading: "待上传",
    parsing: "解析中",
    parsing_report: "解析报告中",
    report_done: "解析完成",
    generating_outline: "大纲生成中",
    outline_ready: "大纲完成",
    editing: "正文编辑",
    generating_content: "正文生成中",
    bid_assembling: "标书编排",
    bid_done: "标书完成",
    done: "完成",
  };
  return labels[status] || status || "-";
}

function shortId(value: string) {
  return value ? value.slice(0, 8) : "-";
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  if (bytes > 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  if (bytes > 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}
