import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { renderAsync } from "docx-preview";
import { CaseCreatePanel } from "./components/CaseCreatePanel";
import { CaseList } from "./components/CaseList";
import { JobSseProgressPanel } from "./components/JobSseProgressPanel";
import {
  createPatentCase,
  downloadArtifact,
  fetchPatentDisclosureHealth,
  fetchPatentCaseDetail,
  fetchPatentGenerationJob,
  listCaseArtifacts,
  listPatentCases,
  openJobProgressEventSource,
  saveBlobToDisk,
  startPatentDisclosureGeneration,
  startPatentDisclosureRevision,
  uploadCaseMaterials,
} from "./services/patentDisclosureApi";
import type {
  CreatePatentCaseInput,
  GenerateSettings,
  PatentArtifact,
  PatentCase,
  PatentDisclosureHealth,
  PatentGenerationJob,
  PatentMaterial,
  PatentProgressEvent,
} from "./types";
import "./PatentDisclosurePage.css";

const DEFAULT_SETTINGS: GenerateSettings = {
  patentType: "invention",
  includePriorArtSearch: true,
  enableDesensitization: false,
  outputFormat: "docx",
  technicalField: "",
  claimFocus: "",
  additionalInstructions: "",
};

const MAX_PROGRESS_EVENTS = 80;

export function PatentDisclosurePage() {
  const [cases, setCases] = useState<PatentCase[]>([]);
  const [activeCaseId, setActiveCaseId] = useState<string | undefined>();
  const [materials, setMaterials] = useState<PatentMaterial[]>([]);
  const [artifacts, setArtifacts] = useState<PatentArtifact[]>([]);
  const [allArtifacts, setAllArtifacts] = useState<PatentArtifact[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [settings, setSettings] = useState<GenerateSettings>(DEFAULT_SETTINGS);
  const [job, setJob] = useState<PatentGenerationJob | null>(null);
  const [health, setHealth] = useState<PatentDisclosureHealth | null>(null);
  const [events, setEvents] = useState<PatentProgressEvent[]>([]);
  const [isSseConnected, setIsSseConnected] = useState(false);
  const [isLoadingCases, setIsLoadingCases] = useState(true);
  const [isLoadingCase, setIsLoadingCase] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRevising, setIsRevising] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [isArtifactsDrawerOpen, setIsArtifactsDrawerOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<{ close: () => void } | null>(null);
  const progressPollRef = useRef<number | null>(null);
  const progressJobIdRef = useRef<string | null>(null);

  const activeCase = useMemo(
    () => cases.find((item) => item.id === activeCaseId) || null,
    [activeCaseId, cases],
  );
  const isHistoryMode = Boolean(activeCaseId);
  const displayArtifacts = allArtifacts.length ? allArtifacts : artifacts;
  const hasDisclosureMarkdown = displayArtifacts.some((artifact) => artifact.artifactType === "disclosure_md" || artifact.kind === "markdown");
  const versions = useMemo(() => buildDisclosureVersions(displayArtifacts), [displayArtifacts]);
  const latestVersion = versions[0] || null;
  const activeVersion = versions.find((version) => version.versionNo === selectedVersion) || latestVersion;
  const isJobRunning = job?.status === "running" || job?.status === "pending";
  const isTaskRunning = isGenerating || isRevising || isJobRunning;
  const isLatestVersionSelected = Boolean(activeVersion && latestVersion && activeVersion.versionNo === latestVersion.versionNo);
  const isRevisionJob = job?.jobType === "revise_disclosure";
  const isGenerateJob = !job?.jobType || job.jobType === "generate_disclosure";
  const isGeneratingDisclosurePreview = !isRevising && !isRevisionJob && (isGenerating || (isJobRunning && isGenerateJob));

  const healthBlockReason = useMemo(() => getHealthBlockReason(health), [health]);

  const refreshCases = useCallback(async () => {
    setIsLoadingCases(true);
    setError(null);
    try {
      const nextCases = await listPatentCases();
      setCases(nextCases);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setIsLoadingCases(false);
    }
  }, []);

  const refreshHealth = useCallback(async () => {
    try {
      const nextHealth = await fetchPatentDisclosureHealth();
      setHealth(nextHealth);
    } catch (caught) {
      setHealth(null);
      setError(getErrorMessage(caught));
    }
  }, []);

  const refreshActiveCase = useCallback(async (caseId: string) => {
    setIsLoadingCase(true);
    setError(null);
    try {
      const detail = await fetchPatentCaseDetail(caseId);
      setCases((current) => upsertCase(current, detail.case));
      setMaterials(detail.materials);
      setArtifacts(detail.artifacts);
      const scopedArtifacts = await listCaseArtifacts(caseId, { scope: "all" });
      setAllArtifacts(scopedArtifacts);
      const nextVersions = buildDisclosureVersions(scopedArtifacts.length ? scopedArtifacts : detail.artifacts);
      setSelectedVersion(nextVersions[0]?.versionNo || null);
      setJob(detail.latestJob || null);
      if (detail.latestJob?.status === "running" || detail.latestJob?.status === "pending") {
        connectJobStream(detail.latestJob.id, caseId);
      }
      setSettings((current) => ({
        ...current,
        technicalField: current.technicalField || detail.case.technicalField || detail.case.technicalTopic || "",
      }));
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setIsLoadingCase(false);
    }
  }, []);

  useEffect(() => {
    void refreshCases();
    void refreshHealth();
  }, [refreshCases, refreshHealth]);

  useEffect(() => {
    if (!activeCaseId) {
      setMaterials([]);
      setArtifacts([]);
      setAllArtifacts([]);
      setSelectedVersion(null);
      return;
    }
    void refreshActiveCase(activeCaseId);
  }, [activeCaseId, refreshActiveCase]);

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
      stopProgressPolling();
    };
  }, []);

  async function handleCreate(input: CreatePatentCaseInput, files: File[]) {
    setIsCreating(true);
    setError(null);
    try {
      const created = await createPatentCase(input);
      setCases((current) => upsertCase(current, created));
      setActiveCaseId(created.id);
      if (files.length) {
        setIsUploading(true);
        const uploaded = await uploadCaseMaterials(created.id, files);
        setMaterials(uploaded);
        await refreshActiveCase(created.id);
      } else {
        setMaterials([]);
        setArtifacts([]);
        setAllArtifacts([]);
        setSelectedVersion(null);
        setJob(null);
        setEvents([]);
        setNotice("案件已创建。");
      }
      return created.id;
    } catch (caught) {
      setError(getErrorMessage(caught));
      return undefined;
    } finally {
      setIsCreating(false);
      setIsUploading(false);
    }
  }

  async function handleGenerate(caseId = activeCaseId) {
    if (!caseId || healthBlockReason) {
      if (healthBlockReason) {
        setError(healthBlockReason);
      }
      return;
    }
    eventSourceRef.current?.close();
    stopProgressPolling();
    setIsGenerating(true);
    setIsSseConnected(false);
    setEvents([]);
    setError(null);
    setNotice(null);
    try {
      const nextJob = await startPatentDisclosureGeneration(caseId, settings);
      setJob(nextJob);
      connectJobStream(nextJob.id, caseId);
    } catch (caught) {
      setError(getErrorMessage(caught));
      setIsGenerating(false);
    }
  }

  async function handleRevise(instruction: string, caseId = activeCaseId) {
    if (!caseId || healthBlockReason) {
      if (healthBlockReason) {
        setError(healthBlockReason);
      }
      return;
    }
    const trimmed = instruction.trim();
    if (!trimmed) {
      setError("请先填写优化要求。");
      return;
    }
    eventSourceRef.current?.close();
    stopProgressPolling();
    setIsRevising(true);
    setIsSseConnected(false);
    setEvents([]);
    setError(null);
    try {
      const nextJob = await startPatentDisclosureRevision(caseId, trimmed);
      setJob(nextJob);
      connectJobStream(nextJob.id, caseId);
    } catch (caught) {
      setError(getErrorMessage(caught));
      setIsRevising(false);
    }
  }

  function handleNewCase() {
    eventSourceRef.current?.close();
    stopProgressPolling();
    setActiveCaseId(undefined);
    setMaterials([]);
    setArtifacts([]);
    setAllArtifacts([]);
    setSelectedVersion(null);
    setJob(null);
    setEvents([]);
    setIsRevising(false);
    setError(null);
    setNotice(null);
  }

  function connectJobStream(jobId: string, caseId: string) {
    eventSourceRef.current?.close();
    stopProgressPolling();
    progressJobIdRef.current = jobId;
    startProgressPolling(jobId, caseId);
    eventSourceRef.current = openJobProgressEventSource(jobId, {
      onOpen: () => setIsSseConnected(true),
      onEvent: (event) => {
        updateJobFromProgressEvent(jobId, caseId, event);
        recordProgressEvent(event);
        if (event.artifact) {
          setArtifacts((current) => mergeById(current, [event.artifact as PatentArtifact]));
        }
        if (event.artifacts?.length) {
          setArtifacts((current) => mergeById(current, event.artifacts || []));
        }
        if (event.status === "succeeded" || event.status === "completed" || event.type === "done" || event.event === "done") {
          setIsGenerating(false);
          setIsRevising(false);
          setIsSseConnected(false);
          eventSourceRef.current?.close();
          stopProgressPolling();
          void refreshActiveCase(caseId);
        }
        if (event.status === "failed" || event.error) {
          handleJobFailed(caseId, event.message || event.error || "专利交底书生成失败。");
        }
      },
      onError: () => {
        setIsSseConnected(false);
        void refreshJobSnapshot(jobId, caseId, false);
      },
    });
  }

  function updateJobFromProgressEvent(jobId: string, caseId: string, event: PatentProgressEvent) {
    setJob((current) => ({
      id: current?.id || jobId,
      caseId: current?.caseId || caseId,
      jobType: current?.jobType,
      status: event.status || current?.status || "running",
      progress: event.progress ?? current?.progress,
      step: event.step || event.currentStep || current?.step,
      currentStep: event.currentStep || event.step || current?.currentStep,
      message: event.message || event.error || current?.message,
      errorMessage: event.error || (event.status === "failed" ? event.message : current?.errorMessage),
      createdAt: current?.createdAt,
      updatedAt: current?.updatedAt,
    }));
  }

  function startProgressPolling(jobId: string, caseId: string) {
    if (progressJobIdRef.current !== jobId) {
      return;
    }
    progressPollRef.current = window.setTimeout(() => {
      void refreshJobSnapshot(jobId, caseId, true);
    }, 5000);
  }

  async function refreshJobSnapshot(jobId: string, caseId: string, shouldContinue: boolean) {
    if (progressJobIdRef.current !== jobId) {
      return;
    }
    try {
      const nextJob = await fetchPatentGenerationJob(jobId);
      if (progressJobIdRef.current !== jobId) {
        return;
      }
      setJob(nextJob);
      recordProgressEvent({
        status: nextJob.status,
        step: nextJob.step,
        currentStep: nextJob.currentStep,
        progress: nextJob.progress,
        message: nextJob.message || nextJob.errorMessage || "",
      });
      if (nextJob.status === "succeeded") {
        setIsGenerating(false);
        setIsRevising(false);
        setIsSseConnected(false);
        eventSourceRef.current?.close();
        stopProgressPolling();
        void refreshActiveCase(caseId);
        return;
      }
      if (nextJob.status === "failed") {
        handleJobFailed(caseId, nextJob.errorMessage || nextJob.message || "专利交底书生成失败。");
        return;
      }
    } catch {
      // SSE remains the primary channel; polling is only a recovery path.
    }
    if (shouldContinue) {
      startProgressPolling(jobId, caseId);
    }
  }

  function stopProgressPolling() {
    if (progressPollRef.current !== null) {
      window.clearTimeout(progressPollRef.current);
      progressPollRef.current = null;
    }
    progressJobIdRef.current = null;
  }

  function recordProgressEvent(event: PatentProgressEvent) {
    setEvents((current) => mergeProgressEvent(current, event));
  }

  function handleJobFailed(caseId: string, message: string) {
    setIsGenerating(false);
    setIsRevising(false);
    setIsSseConnected(false);
    eventSourceRef.current?.close();
    stopProgressPolling();
    void refreshActiveCase(caseId).then(() => setError(message));
  }

  async function handleDownload(artifact: PatentArtifact) {
    setDownloadingId(artifact.id);
    setError(null);
    try {
      saveBlobToDisk(await downloadArtifact({ ...artifact, caseId: artifact.caseId || activeCaseId }));
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <main className="patent-disclosure-page">
      {(error || notice) ? (
        <div className={`pd-message ${error ? "is-error" : "is-success"}`}>
          {error || notice}
          <button type="button" onClick={() => { setError(null); setNotice(null); }}>关闭</button>
        </div>
      ) : null}

      <div className="pd-workbench">
        <aside className="pd-history-sidebar" aria-label="专利交底书历史记录">
          <CaseList
            cases={cases}
            activeCaseId={activeCaseId}
            isLoading={isLoadingCases}
            onCreateNew={handleNewCase}
            onSelect={setActiveCaseId}
          />
        </aside>
        <section className={`pd-main-column ${isHistoryMode ? "is-history" : "is-create"}`}>
          {!isHistoryMode ? (
            <CaseCreatePanel
              disabledReason={healthBlockReason}
              isCreating={isCreating || isUploading}
              isGenerating={isGenerating}
              settings={settings}
              onCreate={handleCreate}
              onGenerate={handleGenerate}
              onSettingsChange={setSettings}
            />
          ) : null}
          {isHistoryMode ? (
            <div className="pd-result-workspace">
              <DocumentPreviewPanel
                activeCase={activeCase}
                activeVersion={activeVersion}
                isBusy={isGeneratingDisclosurePreview && isLatestVersionSelected}
                isDownloadingId={downloadingId}
                isLoading={isLoadingCase}
                onDownload={handleDownload}
                onOpenArtifacts={() => setIsArtifactsDrawerOpen(true)}
              />
              <aside className="pd-result-side" aria-label="任务进度和修订">
                <JobSseProgressPanel job={job} events={events} connected={isSseConnected} />
                <VersionRecordPanel
                  activeVersion={activeVersion}
                  versions={versions}
                  onVersionChange={setSelectedVersion}
                />
                <RevisionPanel
                  disabledReason={getRevisionDisabledReason({
                    healthBlockReason,
                    hasDisclosureMarkdown,
                    isBusy: isGenerating || isRevising,
                  })}
                  isRevising={isRevising}
                  onRevise={handleRevise}
                />
              </aside>
              <ArtifactsDrawer
                artifacts={displayArtifacts}
                isDownloadingId={downloadingId}
                open={isArtifactsDrawerOpen}
                onClose={() => setIsArtifactsDrawerOpen(false)}
                onDownload={handleDownload}
              />
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function upsertCase(items: PatentCase[], item: PatentCase) {
  const exists = items.some((current) => current.id === item.id);
  if (!exists) return [item, ...items];
  return items.map((current) => (current.id === item.id ? { ...current, ...item } : current));
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]) {
  const merged = new Map(current.map((item) => [item.id, item]));
  incoming.forEach((item) => merged.set(item.id, { ...merged.get(item.id), ...item }));
  return Array.from(merged.values());
}

type DisclosureVersion = {
  versionNo: number;
  docx: PatentArtifact | null;
  markdown: PatentArtifact | null;
  artifacts: PatentArtifact[];
};

function buildDisclosureVersions(items: PatentArtifact[]): DisclosureVersion[] {
  const grouped = new Map<number, DisclosureVersion>();
  items.forEach((artifact) => {
    const isDisclosure = artifact.kind === "docx" || artifact.kind === "markdown" || artifact.artifactType === "disclosure_docx" || artifact.artifactType === "disclosure_md";
    if (!isDisclosure) return;
    const versionNo = artifact.versionNo || 1;
    const current = grouped.get(versionNo) || { versionNo, docx: null, markdown: null, artifacts: [] };
    const next = {
      ...current,
      artifacts: mergeById(current.artifacts, [artifact]),
    };
    if (artifact.kind === "docx" || artifact.artifactType === "disclosure_docx") {
      next.docx = artifact;
    }
    if (artifact.kind === "markdown" || artifact.artifactType === "disclosure_md") {
      next.markdown = artifact;
    }
    grouped.set(versionNo, next);
  });
  return Array.from(grouped.values())
    .filter((version) => version.docx || version.markdown)
    .sort((left, right) => right.versionNo - left.versionNo);
}

function DocumentPreviewPanel({
  activeCase,
  activeVersion,
  isBusy,
  isDownloadingId,
  isLoading,
  onDownload,
  onOpenArtifacts,
}: {
  activeCase: PatentCase | null;
  activeVersion: DisclosureVersion | null;
  isBusy: boolean;
  isDownloadingId: string | null;
  isLoading: boolean;
  onDownload: (artifact: PatentArtifact) => Promise<void>;
  onOpenArtifacts: () => void;
}) {
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const docxArtifact = activeVersion?.docx || null;
  const markdownArtifact = activeVersion?.markdown || null;

  useEffect(() => {
    let cancelled = false;
    const target = previewRef.current;
    if (!target) return;
    target.innerHTML = "";

    if (!docxArtifact) {
      setPreviewState("idle");
      return;
    }

    setPreviewState("loading");
    (async () => {
      try {
        const { blob } = await downloadArtifact(docxArtifact);
        const buffer = await blob.arrayBuffer();
        if (cancelled || !previewRef.current) return;
        previewRef.current.innerHTML = "";
        await renderAsync(buffer, previewRef.current, undefined, {
          className: "docx",
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreLastRenderedPageBreak: false,
        });
        stripDisclosureDeliveryMetadataFromPreview(previewRef.current);
        if (!cancelled) {
          setPreviewState("ready");
        }
      } catch (caught) {
        if (!cancelled) {
          console.error("[PatentDisclosurePage] DOCX preview render failed:", caught);
          if (previewRef.current) previewRef.current.innerHTML = "";
          setPreviewState("failed");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [docxArtifact?.id]);

  return (
    <section className="pd-panel pd-document-preview-panel" aria-labelledby="pd-docx-preview-title">
      <div className="pd-preview-toolbar">
        <div className="pd-preview-heading">
          <h2 id="pd-docx-preview-title">{isLoading ? "正在读取历史案件" : activeCase?.title || "交底书预览"}</h2>
        </div>

        <div className="pd-preview-actions">
          <button
            className="pd-primary-button"
            type="button"
            disabled={!docxArtifact || isDownloadingId === docxArtifact.id}
            onClick={() => docxArtifact && onDownload(docxArtifact)}
          >
            {docxArtifact && isDownloadingId === docxArtifact.id ? "下载中" : "下载 DOCX"}
          </button>

          <div className="pd-more-menu">
            <button className="pd-secondary-button" type="button" onClick={() => setIsMoreOpen((value) => !value)}>
              更多
            </button>
            {isMoreOpen ? (
              <div className="pd-more-popover">
                <button type="button" disabled={!markdownArtifact} onClick={() => markdownArtifact && onDownload(markdownArtifact)}>
                  下载 Markdown
                </button>
                <button type="button" onClick={onOpenArtifacts}>查看全部文件</button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className={`pd-docx-preview-shell is-${previewState}${isBusy ? " is-busy" : ""}`}>
        <div className="pd-docx-render" ref={previewRef} />
        {!docxArtifact ? (
          <div className="pd-preview-empty">暂无可预览文档</div>
        ) : previewState === "loading" ? (
          <div className="pd-preview-empty">正在加载 DOCX 预览</div>
        ) : previewState === "failed" ? (
          <div className="pd-preview-empty">
            <strong>预览加载失败，请下载 DOCX 查看</strong>
            <button className="pd-primary-button" type="button" onClick={() => onDownload(docxArtifact)}>
              下载 DOCX
            </button>
          </div>
        ) : null}
        {isBusy ? (
          <div className="pd-preview-busy" aria-live="polite">
            <span>文档生成中，请稍候......</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

const DISCLOSURE_DELIVERY_MARKERS = [
  "交付文件路径",
  "若您希望权利要求/保护点表述",
];

function stripDisclosureDeliveryMetadataFromPreview(container: HTMLElement) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let markerNode: Text | null = null;
  while (!markerNode) {
    const current = walker.nextNode();
    if (!current) break;
    const text = current.textContent || "";
    if (DISCLOSURE_DELIVERY_MARKERS.some((marker) => text.includes(marker))) {
      markerNode = current as Text;
    }
  }
  if (!markerNode) return;

  const block = closestPreviewBlock(markerNode);
  if (!block) return;
  block.textContent = "";

  let sibling = block.nextSibling;
  while (sibling) {
    const next = sibling.nextSibling;
    sibling.parentNode?.removeChild(sibling);
    sibling = next;
  }
}

function closestPreviewBlock(node: Node): HTMLElement | null {
  let current: Node | null = node.parentNode;
  while (current && current instanceof HTMLElement && !current.classList.contains("docx-wrapper")) {
    const tagName = current.tagName.toLowerCase();
    if (["p", "div", "section", "article", "table"].includes(tagName)) {
      return current;
    }
    current = current.parentNode;
  }
  return node.parentElement;
}

function VersionRecordPanel({
  activeVersion,
  versions,
  onVersionChange,
}: {
  activeVersion: DisclosureVersion | null;
  versions: DisclosureVersion[];
  onVersionChange: (versionNo: number) => void;
}) {
  return (
    <section className="pd-panel pd-version-record-panel" aria-labelledby="pd-version-record-title">
      <div className="pd-panel-header">
        <div>
          <h2 id="pd-version-record-title">版本记录</h2>
        </div>
      </div>
      <div className="pd-version-select" aria-label="交底书版本">
        <label htmlFor="pd-version-picker">版本</label>
        <select
          id="pd-version-picker"
          value={activeVersion?.versionNo ?? ""}
          disabled={versions.length === 0}
          onChange={(event) => onVersionChange(Number(event.target.value))}
        >
          {versions.length === 0 ? (
            <option value="">暂无版本</option>
          ) : (
            versions.map((version, index) => (
              <option key={version.versionNo} value={version.versionNo}>
                {formatVersionLabel(version.versionNo, index === 0)}
              </option>
            ))
          )}
        </select>
      </div>
    </section>
  );
}

function ArtifactsDrawer({
  artifacts,
  isDownloadingId,
  open,
  onClose,
  onDownload,
}: {
  artifacts: PatentArtifact[];
  isDownloadingId: string | null;
  open: boolean;
  onClose: () => void;
  onDownload: (artifact: PatentArtifact) => Promise<void>;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="pd-artifact-drawer-backdrop" role="presentation" onClick={onClose}>
      <div className="pd-artifact-drawer" role="dialog" aria-modal="true" aria-labelledby="pd-artifact-drawer-title" onClick={(event) => event.stopPropagation()}>
        <div className="pd-drawer-header">
          <div>
            <p className="pd-eyebrow">全部文件</p>
            <h2 id="pd-artifact-drawer-title">产物与历史版本</h2>
          </div>
          <button className="pd-icon-button" type="button" aria-label="关闭全部文件" onClick={onClose}>关闭</button>
        </div>
        <div className="pd-drawer-list">
          {artifacts.length === 0 ? (
            <div className="pd-empty">暂无文件产物。</div>
          ) : (
            artifacts.map((artifact) => (
              <div className="pd-drawer-row" key={artifact.id}>
                <span>
                  <strong>{artifact.name}</strong>
                  <small>{formatVersionName(artifact.versionNo)} · {formatKind(artifact.kind)} · {formatFileSize(artifact.size || artifact.sizeBytes || 0)}</small>
                </span>
                <button
                  className="pd-secondary-button"
                  type="button"
                  disabled={isDownloadingId === artifact.id}
                  onClick={() => onDownload(artifact)}
                >
                  {isDownloadingId === artifact.id ? "下载中" : "下载"}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function RevisionPanel({
  disabledReason,
  isRevising,
  onRevise,
}: {
  disabledReason: string | null;
  isRevising: boolean;
  onRevise: (instruction: string) => Promise<void>;
}) {
  const [instruction, setInstruction] = useState("");
  const trimmed = instruction.trim();
  const submitDisabled = Boolean(disabledReason) || isRevising || !trimmed;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitDisabled) {
      return;
    }
    await onRevise(trimmed);
    setInstruction("");
  }

  return (
    <section className="pd-panel pd-revision-panel" aria-labelledby="pd-revision-title">
      <div className="pd-panel-header">
        <div>
          <h2 id="pd-revision-title">交底书优化方案</h2>
        </div>
      </div>
      <form className="pd-revision-form" onSubmit={handleSubmit}>
        <textarea
          id="pd-revision-input"
          value={instruction}
          maxLength={12000}
          rows={5}
          placeholder="例如：第三章流程这里不对，把回退逻辑改为先灰度再全量。"
          onChange={(event) => setInstruction(event.target.value)}
          disabled={Boolean(disabledReason) || isRevising}
        />
        <div className="pd-revision-actions">
          <span>{disabledReason || `${trimmed.length}/12000`}</span>
          <button className="pd-primary-button" type="submit" disabled={submitDisabled}>
            {isRevising ? "修订中" : "生成修订版"}
          </button>
        </div>
      </form>
    </section>
  );
}

function mergeProgressEvent(current: PatentProgressEvent[], event: PatentProgressEvent) {
  const latest = current[current.length - 1];
  if (latest && getProgressEventKey(latest) === getProgressEventKey(event)) {
    return [
      ...current.slice(0, -1),
      {
        ...latest,
        ...event,
        message: event.message || latest.message,
        error: event.error || latest.error,
        artifacts: event.artifacts || latest.artifacts,
        artifact: event.artifact || latest.artifact,
      },
    ];
  }
  return [...current, event].slice(-MAX_PROGRESS_EVENTS);
}

function formatVersionName(versionNo?: number) {
  const version = versionNo || 1;
  return version === 1 ? "初稿 V1" : `修订版 V${version}`;
}

function formatVersionLabel(versionNo: number, isCurrent: boolean) {
  return `${formatVersionName(versionNo)}${isCurrent ? "（当前版本）" : ""}`;
}

function formatKind(kind?: string) {
  if (kind === "markdown") return "Markdown";
  if (kind === "docx") return "Word";
  if (kind === "prior_art") return "查新记录";
  if (kind === "patent_points") return "专利点";
  if (kind === "self_check") return "自检记录";
  if (kind === "revision_log") return "修订记录";
  return kind || "文件";
}

function formatFileSize(size: number) {
  if (!size) return "大小未知";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function getProgressEventKey(event: PatentProgressEvent) {
  return [
    event.step || event.currentStep || "",
    event.currentStep || event.step || "",
    event.status || "",
    event.event || event.type || "",
  ].join("|");
}

function getErrorMessage(caught: unknown) {
  if (caught instanceof Error) return caught.message;
  return "操作失败，请稍后重试。";
}

function getHealthBlockReason(health: PatentDisclosureHealth | null) {
  if (!health) {
    return "正在检查专利交底书生成环境。";
  }
  if (health.ok) {
    return null;
  }
  if (!health.skillFound) {
    return "专利交底书 Skill 未安装，暂不能生成。";
  }
  if (!health.openaiCompatibleConfigured) {
    return "专利交底书生成模型尚未配置。";
  }
  if (!health.cnipaAvailable) {
    return "国知局查新工具不可用，暂不能生成。";
  }
  if (!health.docxExportAvailable) {
    return "Word 导出工具不可用，暂不能生成。";
  }
  return "专利交底书生成环境未就绪。";
}

function getRevisionDisabledReason({
  healthBlockReason,
  hasDisclosureMarkdown,
  isBusy,
}: {
  healthBlockReason: string | null;
  hasDisclosureMarkdown: boolean;
  isBusy: boolean;
}) {
  if (healthBlockReason) return healthBlockReason;
  if (!hasDisclosureMarkdown) return "请先生成交底书，再提交优化要求。";
  if (isBusy) return "当前任务运行中，请等待完成。";
  return null;
}
