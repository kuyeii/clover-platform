import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import {
  fetchKnowledgeDocumentDetail,
  type KnowledgeDocumentDetail,
  type KnowledgeSegmentItem,
} from "@/lib/api";

type Props = {
  open: boolean;
  documentId: string | null;
  fallbackName: string;
  onClose: () => void;
};

function formatUnix(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const d = new Date(sec * 1000);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function formatSource(d: KnowledgeDocumentDetail): string {
  const t = d.data_source_type;
  if (t === "upload_file") return "文件上传";
  if (t === "notion_import") return "Notion 导入";
  return t ?? "—";
}

function formatCreatedFrom(cf: string | null | undefined): string {
  if (cf === "api") return "API";
  if (cf === "web") return "控制台";
  return cf ?? "—";
}

export function DocumentDetailModal({
  open,
  documentId,
  fallbackName,
  onClose,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<KnowledgeDocumentDetail | null>(null);
  const [segments, setSegments] = useState<KnowledgeSegmentItem[]>([]);
  const [totalLoaded, setTotalLoaded] = useState(0);

  useEffect(() => {
    if (!open || !documentId) {
      setDoc(null);
      setSegments([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    void fetchKnowledgeDocumentDetail(documentId)
      .then((res) => {
        setDoc(res.document);
        setSegments(res.segments);
        setTotalLoaded(res.segment_total);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "加载失败");
        setDoc(null);
        setSegments([]);
      })
      .finally(() => setLoading(false));
  }, [open, documentId]);

  if (!open || typeof document === "undefined") return null;

  const title = doc?.name?.trim() || fallbackName;

  return createPortal(
    <>
      <button
        type="button"
        aria-label="关闭"
        className="fixed inset-0 z-[120] bg-black/45"
        onClick={onClose}
      />
      <div
        className="fixed left-1/2 top-1/2 z-[130] flex max-h-[min(92vh,880px)] w-[min(calc(100vw-1rem),1024px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-slate-200 bg-white shadow-panel "
        role="dialog"
        aria-modal="true"
        aria-labelledby="doc-detail-title"
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2
            id="doc-detail-title"
            className="min-w-0 truncate text-sm font-semibold text-ink"
            title={title}
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3 md:flex-row md:gap-4 md:p-4">
          {/* 右侧信息区：窄屏在上 */}
          <aside className="order-1 flex max-h-[38vh] w-full shrink-0 flex-col overflow-y-auto rounded-lg border border-slate-200 bg-mist p-3 text-[11px] leading-relaxed md:order-2 md:max-h-none md:w-72">
            <h3 className="mb-2 font-semibold text-slate-800">文档信息</h3>
            {loading ? (
              <div className="flex items-center gap-2 py-4 text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                加载详情…
              </div>
            ) : error ? (
              <p className="text-danger">{error}</p>
            ) : doc ? (
              <dl className="space-y-2 text-slate-700">
                <div className="flex justify-between gap-2">
                  <dt className="shrink-0 text-slate-500">显示名</dt>
                  <dd className="min-w-0 text-right break-all">{doc.name ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="shrink-0 text-slate-500">来源</dt>
                  <dd>{formatSource(doc)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="shrink-0 text-slate-500">创建方式</dt>
                  <dd>{formatCreatedFrom(doc.created_from)}</dd>
                </div>
                {doc.upload_file?.name ? (
                  <div className="flex justify-between gap-2">
                    <dt className="shrink-0 text-slate-500">原始文件</dt>
                    <dd className="min-w-0 text-right break-all">
                      {doc.upload_file.name}
                      {doc.upload_file.size != null
                        ? `（${(doc.upload_file.size / 1024).toFixed(1)} KB）`
                        : ""}
                    </dd>
                  </div>
                ) : null}
                <div className="flex justify-between gap-2">
                  <dt className="shrink-0 text-slate-500">字数</dt>
                  <dd>{doc.word_count ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="shrink-0 text-slate-500">Token</dt>
                  <dd>{doc.tokens ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="shrink-0 text-slate-500">文档命中</dt>
                  <dd>{doc.hit_count ?? 0}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="shrink-0 text-slate-500">索引状态</dt>
                  <dd className="text-right">
                    {doc.indexing_status ?? "—"}{" "}
                    {doc.display_status ? `(${doc.display_status})` : ""}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="shrink-0 text-slate-500">分段模式</dt>
                  <dd>{doc.doc_form ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="shrink-0 text-slate-500">语言</dt>
                  <dd>{doc.doc_language ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="shrink-0 text-slate-500">分段数</dt>
                  <dd>
                    {doc.segment_count ?? totalLoaded ?? 0}
                    {doc.average_segment_length != null
                      ? `（均长 ${Math.round(doc.average_segment_length)} 字）`
                      : ""}
                  </dd>
                </div>
                {doc.indexing_latency != null ? (
                  <div className="flex justify-between gap-2">
                    <dt className="shrink-0 text-slate-500">索引耗时</dt>
                    <dd>{doc.indexing_latency} sec</dd>
                  </div>
                ) : null}
                <div className="flex justify-between gap-2">
                  <dt className="shrink-0 text-slate-500">创建时间</dt>
                  <dd className="text-right">{formatUnix(doc.created_at)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="shrink-0 text-slate-500">更新时间</dt>
                  <dd className="text-right">{formatUnix(doc.updated_at)}</dd>
                </div>
                {doc.error ? (
                  <div className="rounded bg-[var(--color-danger-bg)] p-2 text-danger">
                    <span className="font-medium">错误：</span>
                    {doc.error}
                  </div>
                ) : null}
                {Array.isArray(doc.doc_metadata) && doc.doc_metadata.length > 0 ? (
                  <div className="border-t border-slate-200 pt-2">
                    <p className="mb-1 font-medium text-slate-800">元数据</p>
                    <ul className="space-y-1">
                      {(doc.doc_metadata as { name?: string; value?: string }[]).map(
                        (m, i) => (
                          <li key={i} className="flex justify-between gap-2">
                            <span className="text-slate-500">{m.name ?? "—"}</span>
                            <span className="min-w-0 text-right break-all">
                              {m.value ?? "—"}
                            </span>
                          </li>
                        ),
                      )}
                    </ul>
                  </div>
                ) : null}
              </dl>
            ) : null}
          </aside>

          {/* 分段列表 */}
          <div className="order-2 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 md:order-1">
            <div className="shrink-0 border-b border-slate-100 px-3 py-2 text-xs font-medium text-slate-600">
              {loading
                ? "分段"
                : `共 ${totalLoaded} 个分段`}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2 md:p-3">
              {loading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-slate-300" />
                </div>
              ) : error ? null : segments.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-400">暂无分段</p>
              ) : (
                <ul className="space-y-4">
                  {segments.map((seg, idx) => (
                    <li
                      key={seg.id ?? `seg-${seg.position}-${idx}`}
                      className="rounded-lg border border-slate-100 bg-white px-3 py-2 shadow-none"
                    >
                      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1 text-[11px] text-slate-500">
                        <span className="font-medium text-slate-700">
                          # 分段-
                          {seg.position != null
                            ? String(seg.position).padStart(2, "0")
                            : idx + 1}
                        </span>
                        <span>
                          {seg.word_count != null ? `${seg.word_count} 字` : ""}
                          {seg.tokens != null ? ` · ${seg.tokens} tokens` : ""}
                          {seg.hit_count != null ? ` · 召回 ${seg.hit_count}` : ""}
                        </span>
                        {seg.status ? (
                          <span
                            className={[
                              "rounded px-1.5 py-0.5",
                              seg.status === "completed"
                                ? "bg-[var(--color-success-bg)] text-success"
                                : "bg-slate-100 text-slate-600",
                            ].join(" ")}
                          >
                            {seg.status}
                          </span>
                        ) : null}
                      </div>
                      {seg.keywords && seg.keywords.length > 0 ? (
                        <div className="mb-1.5 flex flex-wrap gap-1">
                          {seg.keywords.map((k) => (
                            <span
                              key={k}
                              className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600"
                            >
                              {k}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <pre className="whitespace-pre-wrap break-words font-sans text-[12px] leading-relaxed text-slate-800">
                        {seg.content || "（空）"}
                      </pre>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
