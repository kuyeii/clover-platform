import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  Eye,
  FileText,
  Loader2,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import {
  createFileDocument,
  deleteKnowledgeDocument,
  downloadKnowledgeDocument,
  fetchKnowledgeDocumentDetail,
  fetchKnowledgeDocuments,
  syncDesensitizedKnowledgeDocument,
  type KnowledgeDocumentDetailResponse,
  type KnowledgeDocumentItem,
} from "./knowledgeService";

type KnowledgeStatus = "enabled" | "disabled" | "processing" | "error";
type KnowledgeStatusFilter = "all" | KnowledgeStatus;
type KnowledgeSyncStatus = "pending" | "syncing" | "synced" | "failed";

const UPLOAD_POLLING_INTERVAL_MS = 10_000;

const statusMeta: Record<KnowledgeStatus, { label: string; className: string }> = {
  enabled: {
    label: "已同步",
    className: "border-[var(--color-success-border)] bg-[var(--color-success-bg)] text-success",
  },
  disabled: {
    label: "待同步",
    className: "border-slate-200 bg-slate-50 text-slate-600",
  },
  processing: {
    label: "同步中",
    className: "border-[var(--color-info-border)] bg-[var(--color-info-bg)] text-brand-600",
  },
  error: {
    label: "异常",
    className: "border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] text-danger",
  },
};

const actionButtonClass =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-white text-slate-500 transition-colors hover:bg-mist hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50";

function resolveStatus(file: KnowledgeDocumentItem): KnowledgeStatus {
  const parseStatus = `${file.parse_status ?? ""}`.toLowerCase();
  if (parseStatus === "failed") return "error";
  if (parseStatus === "pending") return "processing";
  const syncStatus = `${file.sync_status ?? ""}`.toLowerCase();
  if (syncStatus === "failed") return "error";
  if (syncStatus === "syncing") return "processing";
  if (syncStatus === "pending") return "disabled";
  if (syncStatus === "synced") return "enabled";
  const raw = `${file.indexing_status ?? ""} ${file.display_status ?? ""}`.toLowerCase();
  if (raw.includes("error") || raw.includes("failed")) return "error";
  if (raw.includes("index") || raw.includes("process") || raw.includes("wait") || raw.includes("queue")) {
    return "processing";
  }
  if (file.enabled === false || raw.includes("disable")) return "disabled";
  return "enabled";
}

function resolveSyncStatus(file: KnowledgeDocumentItem): KnowledgeSyncStatus {
  const value = `${file.sync_status ?? file.indexing_status ?? file.display_status ?? ""}`.toLowerCase();
  if (value === "syncing") return "syncing";
  if (value === "synced" || value === "completed") return "synced";
  if (value === "failed" || value === "error") return "failed";
  return "pending";
}

function isDocumentWaitingForSync(file: KnowledgeDocumentItem): boolean {
  const parseStatus = `${file.parse_status ?? ""}`.toLowerCase();
  const syncStatus = resolveSyncStatus(file);
  return parseStatus === "pending" || syncStatus === "pending" || syncStatus === "syncing";
}

function formatDocumentWordCount(file: KnowledgeDocumentItem): string {
  const wordCount = file.word_count;
  if (wordCount == null) return "-";
  const parseStatus = `${file.parse_status ?? ""}`.toLowerCase();
  const syncStatus = resolveSyncStatus(file);
  if (wordCount === 0 && (parseStatus === "pending" || syncStatus === "pending" || syncStatus === "syncing")) {
    return "-";
  }
  return `${wordCount} 字`;
}

function upsertKnowledgeDocument(
  items: KnowledgeDocumentItem[],
  document: KnowledgeDocumentItem,
): KnowledgeDocumentItem[] {
  const index = items.findIndex((item) => item.id === document.id);
  if (index < 0) return [document, ...items];
  return items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...document } : item));
}

function markKnowledgeDocumentSyncing(items: KnowledgeDocumentItem[], documentId: string): KnowledgeDocumentItem[] {
  return items.map((item) =>
    item.id === documentId
      ? {
          ...item,
          sync_status: "syncing",
          indexing_status: "syncing",
          display_status: "syncing",
          last_error: null,
        }
      : item,
  );
}

function getDocumentSourceText(file: KnowledgeDocumentItem): string {
  if (file.source_type === "file") return "本地上传文件";
  if (file.source_type === "text") return "本地文本资料";
  return "本地原始资料";
}

function getDocumentPipelineText(file: KnowledgeDocumentItem, syncing: boolean): string {
  const parseStatus = `${file.parse_status ?? ""}`.toLowerCase();
  if (parseStatus === "pending") return `${getDocumentSourceText(file)} · 已保存，等待后台处理`;
  if (parseStatus === "failed") return `${getDocumentSourceText(file)} · 解析失败`;
  const syncStatus = resolveSyncStatus(file);
  if (syncing || syncStatus === "syncing") return `${getDocumentSourceText(file)} · 正在同步`;
  if (syncStatus === "synced") return `${getDocumentSourceText(file)} · 已写入知识库`;
  if (syncStatus === "failed") return `${getDocumentSourceText(file)} · 同步失败，可重试`;
  return `${getDocumentSourceText(file)} · 等待同步`;
}

function StatusBadge({ status }: { status: KnowledgeStatus }) {
  const meta = statusMeta[status];
  return (
    <span
      className={[
        "inline-flex min-w-16 items-center justify-center whitespace-nowrap rounded-md border px-3 py-1 text-xs font-semibold",
        meta.className,
      ].join(" ")}
    >
      {meta.label}
    </span>
  );
}

function formatTimestamp(value?: number | null): string {
  if (!value) return "-";
  const date = new Date(value * 1000);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function KnowledgePage() {
  const [documents, setDocuments] = useState<KnowledgeDocumentItem[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<KnowledgeStatusFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [selectedDetail, setSelectedDetail] = useState<KnowledgeDocumentDetailResponse | null>(null);
  const [pendingDeleteDocument, setPendingDeleteDocument] = useState<KnowledgeDocumentItem | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [busyDocumentId, setBusyDocumentId] = useState<string | null>(null);
  const [syncingDocumentId, setSyncingDocumentId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isKnowledgePageMountedRef = useRef(true);
  const documentsRef = useRef<KnowledgeDocumentItem[]>([]);
  const uploadPollingTimeoutRef = useRef<number | null>(null);

  const applyDocuments = (nextDocuments: KnowledgeDocumentItem[]) => {
    documentsRef.current = nextDocuments;
    setDocuments(nextDocuments);
  };

  const stopUploadPolling = () => {
    if (uploadPollingTimeoutRef.current !== null) {
      window.clearTimeout(uploadPollingTimeoutRef.current);
      uploadPollingTimeoutRef.current = null;
    }
  };

  const hasPendingKnowledgeSync = (items: KnowledgeDocumentItem[]): boolean =>
    items.length > 0 && items.some(isDocumentWaitingForSync);

  const scheduleUploadPolling = (items: KnowledgeDocumentItem[]) => {
    stopUploadPolling();
    if (!isKnowledgePageMountedRef.current || !hasPendingKnowledgeSync(items)) return;
    uploadPollingTimeoutRef.current = window.setTimeout(() => {
      void pollUploadedDocuments();
    }, UPLOAD_POLLING_INTERVAL_MS);
  };

  const reload = async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await fetchKnowledgeDocuments();
      applyDocuments(payload.documents);
      scheduleUploadPolling(payload.documents);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "知识库列表加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(
    () => {
      isKnowledgePageMountedRef.current = true;
      return () => {
        isKnowledgePageMountedRef.current = false;
        stopUploadPolling();
      };
    },
    [],
  );

  useEffect(() => {
    void reload();
  }, []);

  const pollUploadedDocuments = async () => {
    if (!isKnowledgePageMountedRef.current) {
      return;
    }
    try {
      const payload = await fetchKnowledgeDocuments();
      if (!isKnowledgePageMountedRef.current) return;
      applyDocuments(payload.documents);
      if (!hasPendingKnowledgeSync(payload.documents)) {
        stopUploadPolling();
        return;
      }
      scheduleUploadPolling(payload.documents);
      return;
    } catch (err) {
      // 轮询只是上传后的状态补偿，短暂失败不打断用户当前操作。
      console.error(err);
    }
    if (!isKnowledgePageMountedRef.current) return;
    scheduleUploadPolling(documentsRef.current);
  };

  const startUploadPolling = (items: KnowledgeDocumentItem[]) => {
    scheduleUploadPolling(items);
  };

  const filteredDocuments = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return documents.filter((item) => {
      const status = resolveStatus(item);
      const matchesStatus = statusFilter === "all" || status === statusFilter;
      const matchesKeyword =
        !keyword ||
        [item.name, item.description ?? "", item.data_source_type ?? ""].some((value) =>
          value.toLowerCase().includes(keyword),
        );
      return matchesStatus && matchesKeyword;
    });
  }, [documents, query, statusFilter]);

  const statusCounts = useMemo(
    () =>
      documents.reduce<Record<KnowledgeStatus, number>>(
        (counts, item) => {
          counts[resolveStatus(item)] += 1;
          return counts;
        },
        { enabled: 0, disabled: 0, processing: 0, error: 0 },
      ),
    [documents],
  );
  const enabledCount = statusCounts.enabled;
  const processingCount = statusCounts.processing;
  const errorCount = statusCounts.error;
  const latestUpdatedAt = useMemo(
    () => Math.max(0, ...documents.map((item) => item.updated_at ?? item.created_at ?? 0)),
    [documents],
  );

  const handleFileUpload = async (file: File | null) => {
    if (!file) return;
    setSubmitting(true);
    setError("");
    try {
      const result = await createFileDocument(file);
      if (result.document) {
        const nextDocuments = upsertKnowledgeDocument(documentsRef.current, result.document as KnowledgeDocumentItem);
        applyDocuments(nextDocuments);
        startUploadPolling(nextDocuments);
      } else {
        await reload();
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "文件上传失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleView = async (documentId: string) => {
    setDetailLoadingId(documentId);
    setError("");
    try {
      setSelectedDetail(await fetchKnowledgeDocumentDetail(documentId));
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "文档详情加载失败");
    } finally {
      setDetailLoadingId(null);
    }
  };

  const handleDownload = async (documentId: string) => {
    setBusyDocumentId(documentId);
    setError("");
    try {
      const result = await downloadKnowledgeDocument(documentId, "markdown");
      triggerBlobDownload(result.blob, result.filename);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "文档下载失败");
    } finally {
      setBusyDocumentId(null);
    }
  };

  const handleDelete = async () => {
    const document = pendingDeleteDocument;
    if (!document) return;
    const documentId = document.id;
    setBusyDocumentId(documentId);
    setError("");
    try {
      await deleteKnowledgeDocument(documentId);
      if (selectedDetail?.document.id === documentId) setSelectedDetail(null);
      setPendingDeleteDocument(null);
      await reload();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "文档删除失败");
    } finally {
      setBusyDocumentId(null);
    }
  };

  const handleDesensitizedSync = async (documentId: string) => {
    setSyncingDocumentId(documentId);
    applyDocuments(markKnowledgeDocumentSyncing(documentsRef.current, documentId));
    setError("");
    try {
      const result = await syncDesensitizedKnowledgeDocument(documentId);
      if (result.document) {
        applyDocuments(upsertKnowledgeDocument(documentsRef.current, result.document as KnowledgeDocumentItem));
      }
      await reload();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "同步失败");
      await reload();
    } finally {
      setSyncingDocumentId(null);
    }
  };

  return (
    <div className="legacy-portal-ui mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col gap-5 overflow-hidden px-4 py-6 md:px-8">
      <header className="flex shrink-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-3xl font-semibold text-slate-950">知识库</h1>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              fileInputRef.current?.click();
            }}
            disabled={submitting}
            className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-brand-200 bg-brand-50 px-4 text-sm font-semibold text-brand-600 transition-colors hover:bg-brand-100 disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            上传资料
          </button>
        </div>
      </header>

      <section className="shrink-0 rounded-2xl border border-slate-200 bg-white px-5 py-5">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_repeat(5,minmax(88px,112px))] lg:items-center">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-950">本地资料同步</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">原始资料保存在本地，完成脱敏后同步到知识库。</p>
          </div>
          {[
            { label: "资料", value: documents.length, className: "text-brand-600" },
            { label: "已同步", value: enabledCount, className: "text-success" },
            { label: "同步中", value: processingCount, className: "text-brand-600" },
            { label: "异常", value: errorCount, className: "text-danger" },
            { label: "最近更新", value: latestUpdatedAt ? formatTimestamp(latestUpdatedAt) : "--", className: "text-slate-600" },
          ].map((item) => (
            <div key={item.label} className="min-w-0">
              <p className="text-xs font-medium text-slate-500">{item.label}</p>
              <p className={["mt-2 truncate text-xl font-semibold", item.className].join(" ")}>{item.value}</p>
            </div>
          ))}
        </div>
      </section>

      <input
        ref={fileInputRef}
        type="file"
        disabled={submitting}
        onChange={(event) => void handleFileUpload(event.target.files?.[0] ?? null)}
        className="sr-only"
      />

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 md:p-6">
        <div className="flex shrink-0 flex-col gap-5 border-b border-slate-100 pb-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <h2 className="text-xl font-semibold text-slate-950">资料管理</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">统一查看、搜索和维护本地资料。</p>
            </div>
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
              <label className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索资料"
                  className="h-10 w-full rounded-lg border border-border bg-white pl-10 pr-4 text-sm text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-200 sm:w-56"
                />
              </label>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as KnowledgeStatusFilter)}
                className="h-10 rounded-lg border border-border bg-white px-3 text-sm font-medium text-slate-700 outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
                aria-label="资料状态筛选"
              >
                <option value="all">全部状态</option>
                <option value="enabled">已同步</option>
                <option value="processing">同步中</option>
                <option value="error">异常</option>
                <option value="disabled">待同步</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {[
              { value: "all" as const, label: "全部", count: documents.length, className: "border-slate-200 bg-slate-50 text-slate-600" },
              { value: "enabled" as const, label: "已同步", count: enabledCount, className: "border-[var(--color-success-border)] bg-[var(--color-success-bg)] text-success" },
              { value: "processing" as const, label: "同步中", count: processingCount, className: "border-[var(--color-info-border)] bg-[var(--color-info-bg)] text-brand-600" },
              { value: "error" as const, label: "异常", count: errorCount, className: "border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] text-danger" },
            ].map((item) => {
              const active = statusFilter === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setStatusFilter(item.value)}
                  className={[
                    "inline-flex h-8 items-center justify-center whitespace-nowrap rounded-md border px-3 text-xs font-semibold transition-colors",
                    active ? item.className : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50",
                  ].join(" ")}
                >
                  {item.label} {item.count}
                </button>
              );
            })}
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-lg border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-4 py-3 text-sm text-danger">
            {error}
          </div>
        ) : null}

        <div className="mt-5 hidden min-h-0 flex-1 overflow-auto rounded-xl border border-slate-200 lg:block">
          <table className="min-w-full table-fixed divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="w-[38%] px-5 py-4 text-left text-xs font-semibold text-slate-500">资料名称</th>
                <th className="w-28 px-5 py-4 text-center text-xs font-semibold text-slate-500">状态</th>
                <th className="w-32 px-5 py-4 text-left text-xs font-semibold text-slate-500">内容量</th>
                <th className="w-32 px-5 py-4 text-left text-xs font-semibold text-slate-500">更新时间</th>
                <th className="w-48 px-5 py-4 text-center text-xs font-semibold text-slate-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-sm text-slate-500">
                    <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-brand-600" />
                    加载中
                  </td>
                </tr>
              ) : null}
              {!loading && filteredDocuments.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-14 text-center text-sm text-slate-500">
                    <FileText className="mx-auto mb-4 h-12 w-12 rounded-xl border border-slate-200 p-3 text-slate-300" />
                    <p className="text-base font-semibold text-slate-900">暂无资料</p>
                    <p className="mt-2">上传企业文件后，系统会先存储到本地知识库。</p>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => {
                        fileInputRef.current?.click();
                      }}
                      className="mt-4 inline-flex h-10 items-center justify-center whitespace-nowrap rounded-lg border border-brand-200 bg-brand-50 px-4 text-sm font-semibold text-brand-600 transition-colors hover:bg-brand-100 disabled:opacity-50"
                    >
                      上传第一个资料
                    </button>
                  </td>
                </tr>
              ) : null}
              {!loading
                ? filteredDocuments.map((file) => {
                    const status = resolveStatus(file);
                    const syncStatus = resolveSyncStatus(file);
                    const canSync = syncStatus === "failed";
                    const syncing = syncingDocumentId === file.id;
                    return (
                      <tr key={file.id} className="transition-colors hover:bg-slate-50">
                        <td className="px-5 py-4">
                          <div className="truncate text-slate-900">{file.name}</div>
                          <div className="mt-1 truncate text-xs text-slate-500">{getDocumentPipelineText(file, syncing)}</div>
                        </td>
                        <td className="px-5 py-4 text-center">
                          <StatusBadge status={status} />
                        </td>
                        <td className="px-5 py-4 text-sm text-slate-600">
                          {formatDocumentWordCount(file)}
                        </td>
                        <td className="px-5 py-4 text-sm text-slate-600">
                          {formatTimestamp(file.updated_at ?? file.created_at)}
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center justify-center gap-2">
                            {canSync ? (
                              <button
                                type="button"
                                className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 text-xs font-semibold text-brand-600 transition-colors hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
                                disabled={syncing}
                                onClick={() => void handleDesensitizedSync(file.id)}
                              >
                                {syncing ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <ShieldCheck className="h-4 w-4" />
                                )}
                                重试同步
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className={actionButtonClass}
                              aria-label="查看"
                              disabled={detailLoadingId === file.id}
                              onClick={() => void handleView(file.id)}
                            >
                              {detailLoadingId === file.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </button>
                            <button
                              type="button"
                              className={actionButtonClass}
                              aria-label="下载"
                              disabled={busyDocumentId === file.id}
                              onClick={() => void handleDownload(file.id)}
                            >
                              <Download className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              className={actionButtonClass}
                              aria-label="删除"
                              disabled={busyDocumentId === file.id}
                              onClick={() => setPendingDeleteDocument(file)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                : null}
            </tbody>
          </table>
        </div>

        <div className="mt-5 min-h-0 flex-1 space-y-3 overflow-auto lg:hidden">
          {loading ? (
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
              <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-brand-600" />
              加载中
            </div>
          ) : null}
          {!loading && filteredDocuments.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
              <FileText className="mx-auto mb-4 h-12 w-12 rounded-xl border border-slate-200 p-3 text-slate-300" />
              <p className="text-base font-semibold text-slate-900">暂无资料</p>
              <p className="mt-2">上传企业文件后，系统会先存储到本地知识库。</p>
              <button
                type="button"
                disabled={submitting}
                onClick={() => {
                  fileInputRef.current?.click();
                }}
                className="mt-4 inline-flex h-10 items-center justify-center whitespace-nowrap rounded-lg border border-brand-200 bg-brand-50 px-4 text-sm font-semibold text-brand-600 transition-colors hover:bg-brand-100 disabled:opacity-50"
              >
                上传第一个资料
              </button>
            </div>
          ) : null}
          {!loading
            ? filteredDocuments.map((file) => {
                const syncStatus = resolveSyncStatus(file);
                const canSync = syncStatus === "failed";
                const syncing = syncingDocumentId === file.id;
                return (
                  <article key={file.id} className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-slate-950">{file.name}</h3>
                        <p className="mt-1 text-sm text-slate-500">
                          {getDocumentPipelineText(file, syncing)} · {formatDocumentWordCount(file)} ·{" "}
                          {formatTimestamp(file.updated_at ?? file.created_at)}
                        </p>
                      </div>
                      <StatusBadge status={resolveStatus(file)} />
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {canSync ? (
                        <button
                          type="button"
                          disabled={syncing}
                          onClick={() => void handleDesensitizedSync(file.id)}
                          className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 text-xs font-semibold text-brand-600 transition-colors hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                          重试同步
                        </button>
                      ) : null}
                      <button type="button" className={actionButtonClass} onClick={() => void handleView(file.id)}>
                        <Eye className="h-4 w-4" />
                      </button>
                      <button type="button" className={actionButtonClass} onClick={() => void handleDownload(file.id)}>
                        <Download className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        className={actionButtonClass}
                        disabled={busyDocumentId === file.id}
                        onClick={() => setPendingDeleteDocument(file)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </article>
                );
              })
            : null}
        </div>
      </section>

      {pendingDeleteDocument ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6">
          <section className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-white shadow-panel">
            <div className="border-b border-slate-100 px-5 py-4">
              <h3 className="text-lg font-semibold text-slate-950">删除知识库资料</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                删除后会移除本地原始资料。
              </p>
            </div>
            <div className="px-5 py-4">
              <p className="truncate rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                {pendingDeleteDocument.name}
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button
                type="button"
                disabled={busyDocumentId === pendingDeleteDocument.id}
                onClick={() => setPendingDeleteDocument(null)}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                disabled={busyDocumentId === pendingDeleteDocument.id}
                onClick={() => void handleDelete()}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-4 text-sm font-semibold text-danger transition-colors hover:bg-white disabled:opacity-50"
              >
                {busyDocumentId === pendingDeleteDocument.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                删除
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {selectedDetail ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6">
          <section className="max-h-full w-full max-w-3xl overflow-hidden rounded-xl border border-border bg-white shadow-panel">
            <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
              <div className="min-w-0">
                <h3 className="truncate text-lg font-semibold text-slate-950">
                  {selectedDetail.document.name || selectedDetail.document.id}
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  {selectedDetail.segment_total} 个分段 · {selectedDetail.document.tokens ?? "-"} tokens
                </p>
              </div>
              <button
                type="button"
                className={actionButtonClass}
                aria-label="关闭"
                onClick={() => setSelectedDetail(null)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-auto px-5 py-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">命中次数</p>
                  <p className="mt-1 text-base font-semibold text-slate-900">
                    {selectedDetail.document.hit_count ?? "-"}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">字数</p>
                  <p className="mt-1 text-base font-semibold text-slate-900">
                    {selectedDetail.document.word_count ?? "-"}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">完成时间</p>
                  <p className="mt-1 text-base font-semibold text-slate-900">
                    {formatTimestamp(selectedDetail.document.completed_at)}
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {selectedDetail.segments.map((segment, index) => (
                  <article key={segment.id ?? index} className="rounded-xl border border-slate-200 p-4">
                    <div className="mb-2 flex items-center justify-between gap-3 text-xs text-slate-500">
                      <span>Segment {segment.position ?? index + 1}</span>
                      <span>{segment.tokens ?? "-"} tokens</span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{segment.content}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
