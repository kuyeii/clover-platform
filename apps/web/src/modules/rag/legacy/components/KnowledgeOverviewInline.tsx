import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Trash2 } from "lucide-react";
import { DocumentDetailModal } from "@/components/DocumentDetailModal";
import {
  deleteKnowledgeDocument,
  fetchKnowledgeDocuments,
  type KnowledgeDocumentItem,
} from "@/lib/api";

const DESC_PREVIEW_CHARS = 72;

function truncateEnd(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

type Props = {
  expanded: boolean;
};

/** 侧边栏内嵌：文档列表 + 删除确认（确认框通过 Portal 挂到 body，避免侧栏 transform 导致 fixed 偏移） */
export function KnowledgeOverviewInline({ expanded }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<KnowledgeDocumentItem[]>([]);
  const [expandedDesc, setExpandedDesc] = useState<Record<string, boolean>>({});
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [detailDoc, setDetailDoc] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchKnowledgeDocuments();
      setItems(res.documents);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!expanded) return;
    void load();
    setExpandedDesc({});
  }, [expanded, load]);

  const handleDeleteConfirm = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteKnowledgeDocument(pendingDelete.id);
      setPendingDelete(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  };

  const deleteModal =
    pendingDelete && typeof document !== "undefined"
      ? createPortal(
          <>
            <button
              type="button"
              aria-label="取消删除"
              className="fixed inset-0 z-[100] bg-black/40"
              onClick={() => !deleting && setPendingDelete(null)}
            />
            <div
              className="fixed left-1/2 top-1/2 z-[110] w-[min(calc(100vw-2rem),360px)] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-200 bg-white p-4 shadow-panel"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="del-confirm-title"
            >
              <p
                id="del-confirm-title"
                className="text-sm font-medium text-ink"
              >
                确认删除
              </p>
              <p className="mt-2 text-xs leading-relaxed text-slate-600">
                确定要从知识库中删除「{pendingDelete.name}」吗？此操作不可撤销。
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => setPendingDelete(null)}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => void handleDeleteConfirm()}
                  className="rounded-lg bg-[var(--color-danger-icon)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--color-danger-text)] disabled:opacity-50"
                >
                  {deleting ? "删除中…" : "删除"}
                </button>
              </div>
            </div>
          </>,
          document.body,
        )
      : null;

  return (
    <>
      {expanded ? (
        <div className="border-l border-border pl-2.5">
          {loading ? (
            <div
              className="flex justify-center py-4"
              aria-busy="true"
              aria-label="加载中"
            >
              <Loader2 className="h-4 w-4 animate-spin text-muted" />
            </div>
          ) : error ? (
            <p className="py-2 text-[11px] leading-snug text-danger">{error}</p>
          ) : items.length === 0 ? (
            <p className="py-2 text-[11px] text-muted">暂无文档</p>
          ) : (
            <ul className="flex max-h-[min(40vh,320px)] flex-col gap-1 overflow-y-auto py-1 pr-1">
              {items.map((doc) => {
                const desc = doc.description?.trim() ?? "";
                const hasDesc = desc.length > 0;
                const showExpand = hasDesc && desc.length > DESC_PREVIEW_CHARS;
                const expandedRow = expandedDesc[doc.id] ?? false;
                const displayed =
                  !hasDesc
                    ? null
                    : showExpand && !expandedRow
                      ? truncateEnd(desc, DESC_PREVIEW_CHARS)
                      : desc;

                return (
                  <li
                    key={doc.id}
                    className="rounded-lg border border-transparent transition-colors hover:bg-surface-soft"
                  >
                    <div className="flex items-start gap-1.5 px-2 py-1.5">
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() =>
                          setDetailDoc({ id: doc.id, name: doc.name })
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setDetailDoc({ id: doc.id, name: doc.name });
                          }
                        }}
                        className="min-w-0 flex-1 cursor-pointer rounded-md px-0.5 text-left"
                      >
                        <div className="text-[12px] font-medium leading-snug text-ink">
                          {doc.name}
                        </div>
                        {hasDesc && displayed !== null ? (
                          <div className="mt-0.5 text-[10px] leading-relaxed text-muted">
                            <span className="break-words">{displayed}</span>
                            {showExpand ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedDesc((prev) => ({
                                    ...prev,
                                    [doc.id]: !expandedRow,
                                  }));
                                }}
                                className="ml-1 inline font-medium text-brand-600 underline decoration-brand-500/50 underline-offset-2 hover:text-brand-700"
                              >
                                {expandedRow ? "收起" : "展开描述"}
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingDelete({ id: doc.id, name: doc.name });
                        }}
                        className="shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:bg-[var(--color-danger-bg)] hover:text-danger"
                        aria-label={`删除 ${doc.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      {deleteModal}

      <DocumentDetailModal
        open={detailDoc != null}
        documentId={detailDoc?.id ?? null}
        fallbackName={detailDoc?.name ?? ""}
        onClose={() => setDetailDoc(null)}
      />
    </>
  );
}
