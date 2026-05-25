import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiRequestError } from "../../shared/api/client";
import { useAuth } from "../../shared/auth/AuthProvider";
import { Icon } from "../../shared/components/Icon";
import { DownloadActions } from "./components/DownloadActions";
import { ReviewHistory } from "./components/ReviewHistory";
import { ReviewStatus } from "./components/ReviewStatus";
import { ReviewUploader } from "./components/ReviewUploader";
import { RiskList } from "./components/RiskList";
import {
  acceptAllRisks,
  aiAcceptRisk,
  aiApplyAllRisks,
  aiApplyRisk,
  aiEditRisk,
  aiRejectRisk,
  createReview,
  fetchContractReviewConfig,
  fetchContractReviewHealth,
  fetchConverterDiagnostics,
  fetchReviewDocument,
  fetchReviewHistory,
  fetchReviewedDownload,
  fetchReviewResult,
  fetchReviewStatus,
  patchRiskStatus,
  saveBlobToDisk,
} from "./services/contractReviewApi";
import type {
  AnalysisScopeOption,
  ContractReviewConfig,
  ContractReviewHealth,
  ConverterDiagnostics,
  ReviewHistoryItem,
  ReviewMeta,
  ReviewResultPayload,
  ReviewSideOption,
  RiskItem,
  RiskMutationResponse,
} from "./types";

const ACTIVE_RUN_STORAGE_KEY = "clover.contractReview.activeRunId";
const POLL_INTERVAL_MS = 1800;

export function ContractReviewPage() {
  const { canAccessApp } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [reviewSide, setReviewSide] = useState<ReviewSideOption | null>(null);
  const [analysisScope, setAnalysisScope] = useState<AnalysisScopeOption>("full_detail");
  const [config, setConfig] = useState<ContractReviewConfig | null>(null);
  const [health, setHealth] = useState<ContractReviewHealth | null>(null);
  const [diagnostics, setDiagnostics] = useState<ConverterDiagnostics | null>(null);
  const [history, setHistory] = useState<ReviewHistoryItem[]>([]);
  const [runId, setRunId] = useState<string | null>(() => getInitialRunId());
  const [meta, setMeta] = useState<ReviewMeta | null>(null);
  const [result, setResult] = useState<ReviewResultPayload | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [pageError, setPageError] = useState("");
  const [pageNotice, setPageNotice] = useState("");
  const [busyRiskId, setBusyRiskId] = useState("");
  const [applyAllBusy, setApplyAllBusy] = useState(false);
  const [acceptAllBusy, setAcceptAllBusy] = useState(false);
  const [downloadingDocument, setDownloadingDocument] = useState(false);
  const [downloadingReviewed, setDownloadingReviewed] = useState(false);
  const pollAbortRef = useRef<AbortController | null>(null);
  const statusAbortRef = useRef<AbortController | null>(null);
  const bootstrappedRunRef = useRef(false);

  const allowed = canAccessApp("contract-review");
  const status = String(meta?.status || "").toLowerCase();
  const isReviewing = status === "queued" || status === "running" || submitting;
  const sourceDocumentReady = Boolean(meta?.document_ready || result || status === "completed");
  const reviewedDocumentReady = Boolean(result?.download_ready && status === "completed");
  const riskItems = result?.risk_result_validated?.risk_result?.risk_items || [];
  const riskStats = useMemo(() => buildRiskStats(riskItems), [riskItems]);

  const loadHistory = useCallback(async (signal?: AbortSignal) => {
    setLoadingHistory(true);
    try {
      setHistory(await fetchReviewHistory(30, { signal }));
    } catch (error) {
      if (!isAbortError(error)) {
        setPageError(toUserMessage(error, "审查记录加载失败。"));
      }
    } finally {
      if (!signal?.aborted) {
        setLoadingHistory(false);
      }
    }
  }, []);

  const loadResult = useCallback(async (targetRunId: string, signal?: AbortSignal) => {
    const payload = await fetchReviewResult(targetRunId, { signal });
    if (!signal?.aborted) {
      setResult(payload);
    }
    return payload;
  }, []);

  const loadStatus = useCallback(
    async (targetRunId = runId, options: { silent?: boolean; signal?: AbortSignal } = {}) => {
      if (!targetRunId) {
        return null;
      }
      if (!options.silent) {
        setStatusLoading(true);
      }
      try {
        const nextMeta = await fetchReviewStatus(targetRunId, { signal: options.signal });
        if (options.signal?.aborted) {
          return null;
        }
        setMeta(nextMeta);
        setRunId(targetRunId);
        syncRunIdToUrl(targetRunId);
        const nextStatus = String(nextMeta.status || "").toLowerCase();
        setResult((current) => (current && current.run_id !== targetRunId ? null : current));
        if (nextStatus === "queued" || nextStatus === "running") {
          writeSessionValue(ACTIVE_RUN_STORAGE_KEY, targetRunId);
        } else {
          removeSessionValue(ACTIVE_RUN_STORAGE_KEY);
        }
        if (nextStatus === "completed") {
          await loadResult(targetRunId, options.signal);
        }
        return nextMeta;
      } catch (error) {
        if (!isAbortError(error)) {
          setPageError(toUserMessage(error, "审查状态加载失败。"));
        }
        return null;
      } finally {
        if (!options.silent && !options.signal?.aborted) {
          setStatusLoading(false);
        }
      }
    },
    [loadResult, runId],
  );

  const refreshResult = useCallback(async () => {
    if (!runId) {
      return;
    }
    try {
      await loadResult(runId);
      await loadStatus(runId);
      setPageNotice("结果已刷新。");
    } catch (error) {
      setPageError(toUserMessage(error, "审查结果刷新失败。"));
    }
  }, [loadResult, loadStatus, runId]);

  useEffect(() => {
    if (!allowed) {
      return;
    }
    const abortController = new AbortController();
    void (async () => {
      try {
        const [nextConfig, nextHealth, nextDiagnostics] = await Promise.all([
          fetchContractReviewConfig({ signal: abortController.signal }),
          fetchContractReviewHealth({ signal: abortController.signal }),
          fetchConverterDiagnostics({ signal: abortController.signal }),
        ]);
        if (abortController.signal.aborted) {
          return;
        }
        setConfig(nextConfig);
        setHealth(nextHealth);
        setDiagnostics(nextDiagnostics);
        const normalizedScope = normalizeAnalysisScope(nextConfig.analysis_scope);
        setAnalysisScope(normalizedScope);
        setReviewSide(normalizeReviewSide(nextConfig.review_side));
      } catch (error) {
        if (!isAbortError(error)) {
          setPageError(toUserMessage(error, "合同审查配置加载失败。"));
        }
      }
      await loadHistory(abortController.signal);
    })();
    return () => abortController.abort();
  }, [allowed, loadHistory]);

  useEffect(() => {
    if (!allowed || bootstrappedRunRef.current) {
      return;
    }
    bootstrappedRunRef.current = true;
    const restoredRunId = getInitialRunId();
    if (!restoredRunId) {
      return;
    }
    setRunId(restoredRunId);
    syncRunIdToUrl(restoredRunId, true);
  }, [allowed]);

  useEffect(() => {
    if (!allowed || !runId) {
      return undefined;
    }
    statusAbortRef.current?.abort();
    const abortController = new AbortController();
    statusAbortRef.current = abortController;
    void loadStatus(runId, { signal: abortController.signal });
    return () => abortController.abort();
  }, [allowed, loadStatus, runId]);

  useEffect(() => {
    pollAbortRef.current?.abort();
    if (!runId || result || !(status === "queued" || status === "running")) {
      return undefined;
    }

    let cancelled = false;
    const abortController = new AbortController();
    pollAbortRef.current = abortController;

    async function poll() {
      while (!cancelled) {
        try {
          const nextMeta = await fetchReviewStatus(runId as string, { signal: abortController.signal });
          if (cancelled) {
            return;
          }
          setMeta(nextMeta);
          const nextStatus = String(nextMeta.status || "").toLowerCase();
          setResult((current) => (current && current.run_id !== runId ? null : current));
          if (nextStatus === "completed") {
            const payload = await fetchReviewResult(runId as string, { signal: abortController.signal });
            if (!cancelled) {
              setResult(payload);
              syncRunIdToUrl(runId as string);
              removeSessionValue(ACTIVE_RUN_STORAGE_KEY);
              void loadHistory();
            }
            return;
          }
          if (nextStatus === "failed") {
            syncRunIdToUrl(runId as string);
            removeSessionValue(ACTIVE_RUN_STORAGE_KEY);
            void loadHistory();
            return;
          }
        } catch (error) {
          if (!cancelled && !isAbortError(error)) {
            setPageError(toUserMessage(error, "轮询审查状态失败。"));
            return;
          }
        }
        await sleep(POLL_INTERVAL_MS);
      }
    }

    void poll();
    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [loadHistory, result, runId, status]);

  const handleStartReview = async () => {
    if (!file || !reviewSide || isReviewing) {
      return;
    }
    setSubmitting(true);
    setPageError("");
    setPageNotice("");
    setResult(null);
    setMeta(null);
    try {
      const created = await createReview({
        file,
        reviewSide,
        contractTypeHint: String(config?.contract_type_hint || "service_agreement"),
        analysisScope,
      });
      setRunId(created.run_id);
      syncRunIdToUrl(created.run_id);
      writeSessionValue(ACTIVE_RUN_STORAGE_KEY, created.run_id);
      setMeta({
        run_id: created.run_id,
        status: created.status || "queued",
        file_name: file.name,
        review_side: reviewSide,
        analysis_scope: analysisScope,
        step: "已上传，等待开始审查",
        progress: 8,
        document_ready: false,
      });
      setPageNotice(`审查任务已创建：${created.run_id}`);
      await loadHistory();
    } catch (error) {
      setPageError(toUserMessage(error, "发起审查失败。"));
    } finally {
      setSubmitting(false);
    }
  };

  const openHistoryItem = async (item: ReviewHistoryItem) => {
    setPageError("");
    setPageNotice("");
    setResult(null);
    setRunId(item.run_id);
    syncRunIdToUrl(item.run_id);
    writeSessionValue(ACTIVE_RUN_STORAGE_KEY, item.run_id);
    const nextMeta = await loadStatus(item.run_id);
    if (String(nextMeta?.status || "").toLowerCase() !== "completed") {
      return;
    }
    await loadResult(item.run_id);
  };

  const mergeRiskMutation = (riskId: string | number, payload: RiskMutationResponse) => {
    if (payload.item) {
      mergeRiskItem(payload.item);
      return;
    }
    if (payload.risk_items) {
      replaceRiskItems(payload.risk_items);
      return;
    }
    void refreshResult();
  };

  const mergeRiskItem = (nextItem: RiskItem) => {
    setResult((current) => {
      if (!current) {
        return current;
      }
      const nextItems = (current.risk_result_validated?.risk_result?.risk_items || []).map((item) =>
        String(item.risk_id) === String(nextItem.risk_id) ? { ...item, ...nextItem } : item,
      );
      return withRiskItems(current, nextItems);
    });
  };

  const replaceRiskItems = (nextItems: RiskItem[]) => {
    setResult((current) => (current ? withRiskItems(current, nextItems) : current));
  };

  const runRiskAction = async (riskId: string | number, action: () => Promise<RiskMutationResponse>, fallback: string) => {
    setBusyRiskId(String(riskId));
    setPageError("");
    try {
      mergeRiskMutation(riskId, await action());
    } catch (error) {
      setPageError(toUserMessage(error, fallback));
    } finally {
      setBusyRiskId("");
    }
  };

  const handleDownloadDocument = async () => {
    if (!runId) {
      return;
    }
    setDownloadingDocument(true);
    try {
      saveBlobToDisk(await fetchReviewDocument(runId));
    } catch (error) {
      setPageError(toUserMessage(error, "原始 DOCX 下载失败。"));
    } finally {
      setDownloadingDocument(false);
    }
  };

  const handleDownloadReviewed = async () => {
    if (!runId) {
      return;
    }
    setDownloadingReviewed(true);
    try {
      saveBlobToDisk(await fetchReviewedDownload(runId, `${result?.file_name || meta?.file_name || runId}.docx`));
    } catch (error) {
      setPageError(toUserMessage(error, "修订文档下载失败。"));
    } finally {
      setDownloadingReviewed(false);
    }
  };

  if (!allowed) {
    return (
      <section className="page-stack">
        <div className="notice warning">
          <Icon name="lock" />
          当前账号没有访问合同审查的权限。
        </div>
      </section>
    );
  }

  return (
    <section className="contract-review-page">
      <header className="page-hero compact contract-review-hero">
        <div>
          <span className="eyebrow">Contract Review</span>
          <h1>合同审查</h1>
          <p>原生页面已接入 apps/api，支持合同上传、状态轮询、风险卡片、AI 改写和 DOCX 鉴权下载。</p>
        </div>
        <div className="hero-metrics">
          <div>
            <span>服务状态</span>
            <strong>{health?.status || health?.service || "—"}</strong>
          </div>
          <div>
            <span>风险总数</span>
            <strong>{riskStats.total}</strong>
          </div>
          <div>
            <span>待处理</span>
            <strong>{riskStats.pending}</strong>
          </div>
        </div>
      </header>

      {pageError ? (
        <div className="notice warning">
          <span>{pageError}</span>
          <button type="button" className="ghost-button small" onClick={() => setPageError("")}>关闭</button>
        </div>
      ) : null}
      {pageNotice ? (
        <div className="success-message">
          {pageNotice}
        </div>
      ) : null}

      <div className="contract-review-layout">
        <aside className="contract-left-rail">
          <ReviewUploader
            file={file}
            reviewSide={reviewSide}
            analysisScope={analysisScope}
            locked={isReviewing}
            submitting={submitting}
            onFileChange={setFile}
            onReviewSideChange={setReviewSide}
            onAnalysisScopeChange={setAnalysisScope}
            onSubmit={handleStartReview}
          />
          <ReviewHistory
            items={history}
            loading={loadingHistory}
            activeRunId={runId}
            onOpen={(item) => {
              void openHistoryItem(item);
            }}
            onRefresh={() => void loadHistory()}
          />
        </aside>

        <main className="contract-main-panel">
          <ReviewStatus meta={meta} runId={runId} loading={statusLoading} onRefresh={() => void loadStatus()} />
          <DownloadActions
            disabled={!runId}
            sourceDocumentReady={sourceDocumentReady}
            reviewedDocumentReady={reviewedDocumentReady}
            downloadingDocument={downloadingDocument}
            downloadingReviewed={downloadingReviewed}
            onDownloadDocument={() => void handleDownloadDocument()}
            onDownloadReviewed={() => void handleDownloadReviewed()}
          />

          <section className="contract-result-panel">
            <div className="section-title-row">
              <div>
                <span className="eyebrow">Result</span>
                <h2>审查结果</h2>
              </div>
              <span className="muted-text">{result?.analysis_scope_label || meta?.analysis_scope_label || "—"}</span>
            </div>
            {result ? (
              <div className="contract-result-grid">
                <div>
                  <span>文件</span>
                  <strong>{result.file_name || meta?.file_name || "—"}</strong>
                </div>
                <div>
                  <span>审查视角</span>
                  <strong>{result.review_side || meta?.review_side || "—"}</strong>
                </div>
                <div>
                  <span>条款数量</span>
                  <strong>{result.merged_clauses?.length || 0}</strong>
                </div>
                <div>
                  <span>下载状态</span>
                  <strong>{reviewedDocumentReady ? "修订文档可下载" : sourceDocumentReady ? "原始 DOCX 可下载" : "未就绪"}</strong>
                </div>
              </div>
            ) : (
              <div className="contract-empty-state">
                {isReviewing ? "审查完成后会自动加载结果。" : "请选择历史记录或发起新的审查。"}
              </div>
            )}
          </section>

          <RiskList
            result={result}
            busyRiskId={busyRiskId}
            applyAllBusy={applyAllBusy}
            acceptAllBusy={acceptAllBusy}
            onRefresh={() => void refreshResult()}
            onApplyAll={async () => {
              if (!runId) {
                return;
              }
              setApplyAllBusy(true);
              setPageError("");
              try {
                const payload = await aiApplyAllRisks(runId);
                if (payload.risk_items) {
                  replaceRiskItems(payload.risk_items);
                } else {
                  await refreshResult();
                }
                setPageNotice(formatApplyAllSummary(payload.summary));
              } catch (error) {
                setPageError(toUserMessage(error, "批量 AI 改写失败。"));
              } finally {
                setApplyAllBusy(false);
              }
            }}
            onAcceptAll={async () => {
              if (!runId) {
                return;
              }
              setAcceptAllBusy(true);
              setPageError("");
              try {
                const payload = await acceptAllRisks(runId);
                if (payload.risk_items) {
                  replaceRiskItems(payload.risk_items);
                } else {
                  await refreshResult();
                }
                setPageNotice(formatAcceptAllSummary(payload.summary));
              } catch (error) {
                setPageError(toUserMessage(error, "全部接受失败。"));
              } finally {
                setAcceptAllBusy(false);
              }
            }}
            onRiskStatusChange={(riskId, nextStatus) => {
              if (!runId) {
                return;
              }
              void runRiskAction(riskId, () => patchRiskStatus(runId, riskId, nextStatus), "风险状态更新失败。");
            }}
            onAiApply={(riskId) => {
              if (!runId) {
                return;
              }
              void runRiskAction(riskId, () => aiApplyRisk(runId, riskId), "AI 改写生成失败。");
            }}
            onAiAccept={(riskId, revisedText, targetText) => {
              if (!runId) {
                return;
              }
              void runRiskAction(
                riskId,
                () => aiAcceptRisk(runId, riskId, { revised_text: revisedText, target_text: targetText }),
                "AI 改写接受失败。",
              );
            }}
            onAiEdit={(riskId, revisedText) => {
              if (!runId) {
                return;
              }
              void runRiskAction(riskId, () => aiEditRisk(runId, riskId, revisedText), "AI 改写编辑失败。");
            }}
            onAiReject={(riskId) => {
              if (!runId) {
                return;
              }
              void runRiskAction(riskId, () => aiRejectRisk(runId, riskId), "AI 改写拒绝失败。");
            }}
          />
        </main>
      </div>

      {diagnostics ? (
        <footer className="contract-diagnostics">
          <span>转换器诊断</span>
          <code>LibreOffice: {diagnosticLabel(diagnostics.libreoffice)}</code>
          <code>pdf2docx: {diagnosticLabel(diagnostics.pdf2docx)}</code>
          <code>PyMuPDF: {diagnosticLabel(diagnostics.pymupdf)}</code>
        </footer>
      ) : null}
    </section>
  );
}

function withRiskItems(result: ReviewResultPayload, riskItems: RiskItem[]): ReviewResultPayload {
  return {
    ...result,
    risk_result_validated: {
      ...result.risk_result_validated,
      risk_result: {
        ...result.risk_result_validated?.risk_result,
        risk_items: riskItems,
      },
    },
  };
}

function buildRiskStats(risks: RiskItem[]) {
  return risks.reduce(
    (stats, risk) => {
      stats.total += 1;
      const level = String(risk.risk_level || "").trim().toLowerCase();
      if (level === "high") {
        stats.high += 1;
      } else if (level === "medium") {
        stats.medium += 1;
      } else if (level === "low") {
        stats.low += 1;
      }
      const status = String(risk.status || "pending").toLowerCase();
      if (!status || status === "pending") {
        stats.pending += 1;
      }
      return stats;
    },
    { total: 0, high: 0, medium: 0, low: 0, pending: 0 },
  );
}

function normalizeAnalysisScope(value?: string): AnalysisScopeOption {
  return value === "high_risk_only" ? "high_risk_only" : "full_detail";
}

function normalizeReviewSide(value?: string): ReviewSideOption | null {
  if (value === "甲方" || value === "乙方") {
    return value;
  }
  if (value === "customer") {
    return "甲方";
  }
  if (value === "supplier") {
    return "乙方";
  }
  return "乙方";
}

function toUserMessage(error: unknown, fallback: string) {
  if (error instanceof ApiRequestError) {
    if (error.status === 403) {
      return "当前账号没有合同审查权限。";
    }
    if (error.status === 401) {
      return "登录状态已失效，请重新登录。";
    }
    return error.message || fallback;
  }
  if (error instanceof Error) {
    return error.message || fallback;
  }
  return fallback;
}

function formatApplyAllSummary(summary?: Record<string, number>) {
  if (!summary) {
    return "批量 AI 改写已完成。";
  }
  return `批量 AI 改写完成：生成 ${summary.created || 0}，跳过 ${summary.skipped || 0}，失败 ${summary.failed || 0}。`;
}

function formatAcceptAllSummary(summary?: Record<string, number>) {
  if (!summary) {
    return "全部接受已完成。";
  }
  return `全部接受完成：接受 ${summary.accepted || 0}，跳过 ${summary.skipped || 0}。`;
}

function diagnosticLabel(value: unknown) {
  if (value == null) {
    return "未知";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? "可用" : "不可用";
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return String(record.status || record.ok || record.available || record.version || "已返回");
  }
  return String(value);
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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

function getInitialRunId() {
  return getRunIdFromUrl() || readSessionValue(ACTIVE_RUN_STORAGE_KEY);
}

function getRunIdFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    return sanitizeRunId(params.get("run_id"));
  } catch {
    return null;
  }
}

function syncRunIdToUrl(runId: string, replace = false) {
  const safeRunId = sanitizeRunId(runId);
  if (!safeRunId) {
    return;
  }
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get("run_id") === safeRunId) {
      return;
    }
    url.searchParams.set("run_id", safeRunId);
    if (replace) {
      window.history.replaceState(null, "", url);
    } else {
      window.history.pushState(null, "", url);
    }
  } catch {
    // URL sync is only used for refresh recovery and shareable review links.
  }
}

function sanitizeRunId(value: string | null | undefined) {
  const raw = String(value || "").trim();
  return /^[A-Za-z0-9_-]{6,96}$/.test(raw) ? raw : null;
}

function readSessionValue(key: string) {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSessionValue(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Session storage is only used for refresh recovery.
  }
}

function removeSessionValue(key: string) {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Session storage is only used for refresh recovery.
  }
}
