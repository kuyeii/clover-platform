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

const statusMeta: Record<KnowledgeStatus, { label: string; className: string }> = {
  enabled: {
    label: "已启用",
    className: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  },
  disabled: {
    label: "未启用",
    className: "bg-slate-100 text-slate-700 ring-slate-200",
  },
  processing: {
    label: "处理中",
    className: "bg-sky-50 text-sky-700 ring-sky-100",
  },
  error: {
    label: "异常",
    className: "bg-rose-50 text-rose-700 ring-rose-100",
  },
};

const actionButtonClass =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50";

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
        "inline-flex min-w-16 items-center justify-center whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ring-1",
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
    if (!keyword) return documents;
    return documents.filter((item) =>
      [item.name, item.description ?? "", item.data_source_type ?? ""].some((value) =>
        value.toLowerCase().includes(keyword),
      ),
    );
  }, [documents, query]);

  const enabledCount = documents.filter((item) => resolveStatus(item) === "enabled").length;
  const processingCount = documents.filter((item) => resolveStatus(item) === "processing").length;

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
    <div className="legacy-portal-ui mx-auto w-full max-w-7xl space-y-6 px-4 py-6 md:px-8">
      <section className="rounded-2xl border border-white/80 bg-white p-6 shadow-lg">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold text-slate-950">知识库</h1>
            <p className="text-sm leading-6 text-slate-600">
              当前操作的是 Dify 共享 Dataset，标书生成和 RAG 问答共用同一个知识库。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void reload()}
            disabled={loading}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={["h-4 w-4", loading ? "animate-spin" : ""].join(" ")} />
            刷新
          </button>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-sm text-slate-500">文档数</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{documents.length}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-sm text-slate-500">已启用</p>
            <p className="mt-2 text-2xl font-semibold text-emerald-700">{enabledCount}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-sm text-slate-500">处理中</p>
            <p className="mt-2 text-2xl font-semibold text-sky-700">{processingCount}</p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-white/80 bg-white p-5 shadow-lg">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setUploadMode("file")}
            className={[
              "inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-medium ring-1",
              uploadMode === "file"
                ? "bg-sky-50 text-sky-700 ring-sky-100"
                : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50",
            ].join(" ")}
          >
            <Upload className="h-4 w-4" />
            上传文件
          </button>
          <button
            type="button"
            onClick={() => setUploadMode("text")}
            className={[
              "inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-medium ring-1",
              uploadMode === "text"
                ? "bg-sky-50 text-sky-700 ring-sky-100"
                : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50",
            ].join(" ")}
          >
            <FileText className="h-4 w-4" />
            新建文本
          </button>
        </div>

        {uploadMode === "file" ? (
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              ref={fileInputRef}
              type="file"
              disabled={submitting}
              onChange={(event) => void handleFileUpload(event.target.files?.[0] ?? null)}
              className="block w-full rounded-lg border border-slate-200 bg-white text-sm text-slate-700 file:mr-4 file:h-10 file:border-0 file:bg-slate-100 file:px-4 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200 disabled:opacity-50"
            />
            {submitting ? (
              <span className="inline-flex items-center gap-2 whitespace-nowrap text-sm text-sky-700">
                <Loader2 className="h-4 w-4 animate-spin" />
                入库中
              </span>
            ) : null}
          </div>
        ) : (
          <div className="mt-4 grid gap-3">
            <input
              value={textName}
              onChange={(event) => setTextName(event.target.value)}
              placeholder="文档名称"
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
            />
            <textarea
              value={textBody}
              onChange={(event) => setTextBody(event.target.value)}
              placeholder="正文内容"
              rows={5}
              className="resize-y rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm leading-6 text-slate-700 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
            />
            <button
              type="button"
              onClick={() => void handleTextCreate()}
              disabled={submitting}
              className="inline-flex h-10 w-fit items-center gap-2 rounded-lg bg-sky-600 px-4 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              提交入库
            </button>
          </div>
        )}

        {error ? (
          <div className="mt-4 rounded-lg border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-white/80 bg-white p-4 shadow-lg md:p-6">
        <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-xl font-semibold text-slate-950">文档列表</h2>
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索文档"
              className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-4 text-sm text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-sky-300 focus:ring-2 focus:ring-sky-100 sm:w-64"
            />
          </label>
        </div>

        <div className="mt-5 hidden overflow-hidden rounded-xl border border-slate-200 lg:block">
          <table className="min-w-full table-fixed divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="w-2/5 px-5 py-4 text-left text-xs font-semibold uppercase text-slate-500">文档</th>
                <th className="w-24 px-5 py-4 text-left text-xs font-semibold uppercase text-slate-500">分段</th>
                <th className="w-28 px-5 py-4 text-left text-xs font-semibold uppercase text-slate-500">Tokens</th>
                <th className="w-32 px-5 py-4 text-left text-xs font-semibold uppercase text-slate-500">更新时间</th>
                <th className="w-28 px-5 py-4 text-center text-xs font-semibold uppercase text-slate-500">状态</th>
                <th className="w-36 px-5 py-4 text-center text-xs font-semibold uppercase text-slate-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-sm text-slate-500">
                    <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-sky-600" />
                    加载中
                  </td>
                </tr>
              ) : null}
              {!loading && filteredDocuments.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-sm text-slate-500">
                    暂无文档。
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
                        <td className="px-5 py-4 text-sm text-slate-600">{file.segment_count ?? "-"}</td>
                        <td className="px-5 py-4 text-sm text-slate-600">{file.tokens ?? "-"}</td>
                        <td className="px-5 py-4 text-sm text-slate-600">
                          {formatTimestamp(file.updated_at ?? file.created_at)}
                        </td>
                        <td className="px-5 py-4 text-center">
                          <StatusBadge status={status} />
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
              <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-sky-600" />
              加载中
            </div>
          ) : null}
          {!loading && filteredDocuments.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
              暂无文档。
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
          <section className="max-h-full w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl">
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
