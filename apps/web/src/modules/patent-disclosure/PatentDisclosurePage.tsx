import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArtifactDownloadList } from "./components/ArtifactDownloadList";
import { CaseCreatePanel } from "./components/CaseCreatePanel";
import { CaseDetailPanel } from "./components/CaseDetailPanel";
import { CaseList } from "./components/CaseList";
import { GenerateSettingsPanel } from "./components/GenerateSettingsPanel";
import { JobSseProgressPanel } from "./components/JobSseProgressPanel";
import { MaterialUploader } from "./components/MaterialUploader";
import {
  createPatentCase,
  downloadArtifact,
  fetchPatentDisclosureHealth,
  fetchPatentCaseDetail,
  fetchPatentGenerationJob,
  listCaseArtifacts,
  listCaseMaterials,
  listPatentCases,
  openJobProgressEventSource,
  saveBlobToDisk,
  startPatentDisclosureGeneration,
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
  outputFormat: "markdown_docx",
  technicalField: "",
  claimFocus: "",
  additionalInstructions: "",
};

export function PatentDisclosurePage() {
  const [cases, setCases] = useState<PatentCase[]>([]);
  const [activeCaseId, setActiveCaseId] = useState<string | undefined>();
  const [materials, setMaterials] = useState<PatentMaterial[]>([]);
  const [artifacts, setArtifacts] = useState<PatentArtifact[]>([]);
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
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const progressPollRef = useRef<number | null>(null);
  const progressJobIdRef = useRef<string | null>(null);

  const activeCase = useMemo(
    () => cases.find((item) => item.id === activeCaseId) || null,
    [activeCaseId, cases],
  );

  const healthBlockReason = useMemo(() => getHealthBlockReason(health), [health]);

  const refreshCases = useCallback(async () => {
    setIsLoadingCases(true);
    setError(null);
    try {
      const nextCases = await listPatentCases();
      setCases(nextCases);
      setActiveCaseId((current) => current || nextCases[0]?.id);
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

  async function handleCreate(input: CreatePatentCaseInput) {
    setIsCreating(true);
    setError(null);
    try {
      const created = await createPatentCase(input);
      setCases((current) => upsertCase(current, created));
      setActiveCaseId(created.id);
      setNotice("案件已创建。");
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setIsCreating(false);
    }
  }

  async function handleUpload(files: File[]) {
    if (!activeCaseId) return;
    setIsUploading(true);
    setError(null);
    try {
      const uploaded = await uploadCaseMaterials(activeCaseId, files);
      setMaterials((current) => mergeById(current, uploaded));
      setNotice("材料已上传。");
      await refreshActiveCase(activeCaseId);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setIsUploading(false);
    }
  }

  async function handleGenerate() {
    if (!activeCaseId || healthBlockReason) {
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
    try {
      const nextJob = await startPatentDisclosureGeneration(activeCaseId, settings);
      setJob(nextJob);
      connectJobStream(nextJob.id, activeCaseId);
    } catch (caught) {
      setError(getErrorMessage(caught));
      setIsGenerating(false);
    }
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
        setEvents((current) => [...current, event].slice(-80));
        if (event.artifact) {
          setArtifacts((current) => mergeById(current, [event.artifact as PatentArtifact]));
        }
        if (event.artifacts?.length) {
          setArtifacts((current) => mergeById(current, event.artifacts || []));
        }
        if (event.status === "succeeded" || event.status === "completed" || event.type === "done" || event.event === "done") {
          setIsGenerating(false);
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
      setEvents((current) => [
        ...current,
        {
          status: nextJob.status,
          step: nextJob.step,
          currentStep: nextJob.currentStep,
          progress: nextJob.progress,
          message: nextJob.message || nextJob.errorMessage || "",
        },
      ].slice(-80));
      if (nextJob.status === "succeeded") {
        setIsGenerating(false);
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

  function handleJobFailed(caseId: string, message: string) {
    setIsGenerating(false);
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
      <header className="pd-topbar">
        <div>
          <p className="pd-eyebrow">Patent Disclosure</p>
          <h1>专利交底书工作台</h1>
        </div>
        <div className="pd-topbar-meta">
          <span>{activeCase ? "当前案件" : "未选择案件"}</span>
          <strong>{activeCase?.title || "请从左侧选择"}</strong>
        </div>
      </header>

      {(error || notice) ? (
        <div className={`pd-message ${error ? "is-error" : "is-success"}`}>
          {error || notice}
          <button type="button" onClick={() => { setError(null); setNotice(null); }}>关闭</button>
        </div>
      ) : null}

      <div className="pd-workbench">
        <aside className="pd-sidebar">
          <CaseCreatePanel isCreating={isCreating} onCreate={handleCreate} />
          <CaseList
            cases={cases}
            activeCaseId={activeCaseId}
            isLoading={isLoadingCases}
            onSelect={setActiveCaseId}
          />
        </aside>
        <section className="pd-main-column">
          <CaseDetailPanel activeCase={activeCase} materials={materials} />
          <div className="pd-two-column">
            <MaterialUploader
              disabled={!activeCaseId || isLoadingCase}
              materials={materials}
              isUploading={isUploading}
              onUpload={handleUpload}
            />
            <GenerateSettingsPanel
              disabled={!activeCaseId || materials.length === 0 || Boolean(healthBlockReason)}
              disabledReason={healthBlockReason}
              isGenerating={isGenerating}
              settings={settings}
              onChange={setSettings}
              onGenerate={handleGenerate}
            />
          </div>
          <div className="pd-two-column">
            <JobSseProgressPanel job={job} events={events} connected={isSseConnected} />
            <ArtifactDownloadList artifacts={artifacts} isDownloadingId={downloadingId} onDownload={handleDownload} />
          </div>
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
