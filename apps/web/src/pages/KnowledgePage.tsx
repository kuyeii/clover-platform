import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  Eye,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import {
  createFileDocument,
  createTextDocument,
  deleteKnowledgeDocument,
  downloadKnowledgeDocument,
  fetchKnowledgeDocumentDetail,
  fetchKnowledgeDocuments,
  type KnowledgeDocumentDetailResponse,
  type KnowledgeDocumentItem,
} from "./knowledgeService";

type KnowledgeStatus = "enabled" | "disabled" | "processing" | "error";
type KnowledgeStatusFilter = "all" | KnowledgeStatus;

const statusMeta: Record<KnowledgeStatus, { label: string; className: string }> = {
  enabled: {
    label: "已启用",
    className: "border-[var(--color-success-border)] bg-[var(--color-success-bg)] text-success",
  },
  disabled: {
    label: "未启用",
    className: "border-slate-200 bg-slate-50 text-slate-600",
  },
  processing: {
    label: "处理中",
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
  const raw = `${file.indexing_status ?? ""} ${file.display_status ?? ""}`.toLowerCase();
  if (raw.includes("error") || raw.includes("failed")) return "error";
  if (raw.includes("index") || raw.includes("process") || raw.includes("wait") || raw.includes("queue")) {
    return "processing";
  }
  if (file.enabled === false || raw.includes("disable")) return "disabled";
  return "enabled";
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
  const [uploadMode, setUploadMode] = useState<"file" | "text">("file");
  const [textName, setTextName] = useState("");
  const [textBody, setTextBody] = useState("");
  const [selectedDetail, setSelectedDetail] = useState<KnowledgeDocumentDetailResponse | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [busyDocumentId, setBusyDocumentId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const reload = async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await fetchKnowledgeDocuments();
      setDocuments(payload.documents);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "知识库列表加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

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
      await createFileDocument(file);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await reload();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "文件上传失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleTextCreate = async () => {
    const name = textName.trim();
    const text = textBody.trim();
    if (!name || !text) {
      setError("文本名称和正文不能为空");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await createTextDocument(name, text);
      setTextName("");
      setTextBody("");
      await reload();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "文本入库失败");
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

  const handleDelete = async (documentId: string) => {
    if (!window.confirm("确认删除该知识库文档？")) return;
    setBusyDocumentId(documentId);
    setError("");
    try {
      await deleteKnowledgeDocument(documentId);
      if (selectedDetail?.document.id === documentId) setSelectedDetail(null);
      await reload();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "文档删除失败");
    } finally {
      setBusyDocumentId(null);
    }
  };

  return (
    <div className="legacy-portal-ui mx-auto w-full max-w-7xl space-y-5 px-4 py-6 md:px-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-3xl font-semibold text-slate-950">知识库</h1>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void reload()}
            disabled={loading}
            className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={["h-4 w-4", loading ? "animate-spin" : ""].join(" ")} />
            刷新
          </button>
          <button
            type="button"
            onClick={() => {
              setUploadMode("file");
              fileInputRef.current?.click();
            }}
            disabled={submitting}
            className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-brand-200 bg-brand-50 px-4 text-sm font-semibold text-brand-600 transition-colors hover:bg-brand-100 disabled:opacity-50"
          >
            {submitting && uploadMode === "file" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            上传资料
          </button>
        </div>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white px-5 py-5">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_repeat(5,minmax(88px,112px))] lg:items-center">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-950">企业共享知识库</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">资料会自动解析为可检索知识，用于问答、检索和标书生成。</p>
          </div>
          {[
            { label: "资料", value: documents.length, className: "text-brand-600" },
            { label: "可检索", value: enabledCount, className: "text-success" },
            { label: "处理中", value: processingCount, className: "text-brand-600" },
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

      <section className="rounded-2xl border border-slate-200 bg-white p-5 md:p-6">
        <div className="flex flex-col gap-5 border-b border-slate-100 pb-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <h2 className="text-xl font-semibold text-slate-950">资料管理</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">统一查看、搜索和维护已进入知识库的资料。</p>
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
                <option value="enabled">可检索</option>
                <option value="processing">处理中</option>
                <option value="error">异常</option>
                <option value="disabled">未启用</option>
              </select>
              <button
                type="button"
                onClick={() => setUploadMode((current) => (current === "text" ? "file" : "text"))}
                className="inline-flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-brand-200 bg-brand-50 px-4 text-sm font-semibold text-brand-600 transition-colors hover:bg-brand-100"
              >
                {uploadMode === "text" ? <X className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                {uploadMode === "text" ? "收起" : "新增"}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {[
              { value: "all" as const, label: "全部", count: documents.length, className: "border-slate-200 bg-slate-50 text-slate-600" },
              { value: "enabled" as const, label: "可检索", count: enabledCount, className: "border-[var(--color-success-border)] bg-[var(--color-success-bg)] text-success" },
              { value: "processing" as const, label: "处理中", count: processingCount, className: "border-[var(--color-info-border)] bg-[var(--color-info-bg)] text-brand-600" },
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

        {uploadMode === "text" ? (
          <div className="mt-5 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <input
              value={textName}
              onChange={(event) => setTextName(event.target.value)}
              placeholder="文档名称"
              className="h-10 rounded-lg border border-border bg-white px-3 text-sm text-slate-700 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
            />
            <textarea
              value={textBody}
              onChange={(event) => setTextBody(event.target.value)}
              placeholder="正文内容"
              rows={5}
              className="resize-y rounded-lg border border-border bg-white px-3 py-3 text-sm leading-6 text-slate-700 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
            />
            <button
              type="button"
              onClick={() => void handleTextCreate()}
              disabled={submitting}
              className="inline-flex h-10 w-fit items-center gap-2 whitespace-nowrap rounded-lg border border-brand-200 bg-brand-50 px-4 text-sm font-semibold text-brand-600 transition-colors hover:bg-brand-100 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              提交入库
            </button>
          </div>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-lg border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-4 py-3 text-sm text-danger">
            {error}
          </div>
        ) : null}

        <div className="mt-5 hidden overflow-hidden rounded-xl border border-slate-200 lg:block">
          <table className="min-w-full table-fixed divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="w-2/5 px-5 py-4 text-left text-xs font-semibold text-slate-500">资料名称</th>
                <th className="w-28 px-5 py-4 text-center text-xs font-semibold text-slate-500">状态</th>
                <th className="w-36 px-5 py-4 text-left text-xs font-semibold text-slate-500">内容量</th>
                <th className="w-32 px-5 py-4 text-left text-xs font-semibold text-slate-500">更新时间</th>
                <th className="w-36 px-5 py-4 text-center text-xs font-semibold text-slate-500">操作</th>
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
                    <p className="mt-2">上传企业文件后，系统会自动解析并进入知识库。</p>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => {
                        setUploadMode("file");
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
                    return (
                      <tr key={file.id} className="transition-colors hover:bg-slate-50">
                        <td className="px-5 py-4">
                          <div className="truncate font-semibold text-slate-900">{file.name}</div>
                          <div className="mt-1 truncate text-xs text-slate-500">
                            {file.description || file.data_source_type || file.id}
                          </div>
                        </td>
                        <td className="px-5 py-4 text-center">
                          <StatusBadge status={status} />
                        </td>
                        <td className="px-5 py-4 text-sm text-slate-600">
                          {file.segment_count ?? "-"} 分段 / {file.tokens ?? "-"} tokens
                        </td>
                        <td className="px-5 py-4 text-sm text-slate-600">
                          {formatTimestamp(file.updated_at ?? file.created_at)}
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center justify-center gap-2">
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
                              onClick={() => void handleDelete(file.id)}
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

        <div className="mt-5 space-y-3 lg:hidden">
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
              <p className="mt-2">上传企业文件后，系统会自动解析并进入知识库。</p>
              <button
                type="button"
                disabled={submitting}
                onClick={() => {
                  setUploadMode("file");
                  fileInputRef.current?.click();
                }}
                className="mt-4 inline-flex h-10 items-center justify-center whitespace-nowrap rounded-lg border border-brand-200 bg-brand-50 px-4 text-sm font-semibold text-brand-600 transition-colors hover:bg-brand-100 disabled:opacity-50"
              >
                上传第一个资料
              </button>
            </div>
          ) : null}
          {!loading
            ? filteredDocuments.map((file) => (
                <article key={file.id} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold text-slate-950">{file.name}</h3>
                      <p className="mt-1 text-sm text-slate-500">
                        分段 {file.segment_count ?? "-"} · {formatTimestamp(file.updated_at ?? file.created_at)}
                      </p>
                    </div>
                    <StatusBadge status={resolveStatus(file)} />
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button type="button" className={actionButtonClass} onClick={() => void handleView(file.id)}>
                      <Eye className="h-4 w-4" />
                    </button>
                    <button type="button" className={actionButtonClass} onClick={() => void handleDownload(file.id)}>
                      <Download className="h-4 w-4" />
                    </button>
                    <button type="button" className={actionButtonClass} onClick={() => void handleDelete(file.id)}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </article>
              ))
            : null}
        </div>
      </section>

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
