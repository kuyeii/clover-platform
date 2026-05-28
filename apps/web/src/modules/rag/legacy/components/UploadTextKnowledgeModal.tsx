import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { createTextDocument } from "@/lib/api";

type Props = {
  open: boolean;
  onClose: () => void;
  /** 创建并索引完成后回调（用于 Toast 文案） */
  onCreated: (documentName: string) => void;
};

export function UploadTextKnowledgeModal({
  open,
  onClose,
  onCreated,
}: Props) {
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setText("");
    setError(null);
    setSubmitting(false);
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    const t = text.trim();
    if (!n || !t || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await createTextDocument(n, t);
      onCreated(res.name);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <>
      <button
        type="button"
        aria-label="关闭"
        className="fixed inset-0 z-[100] bg-black/40"
        onClick={() => !submitting && onClose()}
      />
      <div
        className="fixed left-1/2 top-1/2 z-[110] flex max-h-[min(90vh,640px)] w-[min(calc(100vw-2rem),440px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-slate-200 bg-white shadow-panel "
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-text-kb-title"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2
            id="upload-text-kb-title"
            className="text-sm font-semibold text-ink"
          >
            上传文本至知识库
          </h2>
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4"
        >
          <div>
            <label
              htmlFor="kb-doc-name"
              className="mb-1 block text-xs font-medium text-slate-600"
            >
              文档名
            </label>
            <input
              id="kb-doc-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              placeholder="请输入文档名称"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none ring-brand-100/70 focus:ring-4 focus:ring-brand-100/70 disabled:bg-mist"
              autoComplete="off"
            />
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <label
              htmlFor="kb-doc-text"
              className="mb-1 block text-xs font-medium text-slate-600"
            >
              文档内容
            </label>
            <textarea
              id="kb-doc-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={submitting}
              placeholder="粘贴或输入正文…"
              rows={12}
              className="min-h-[200px] w-full flex-1 resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none ring-brand-100/70 focus:ring-4 focus:ring-brand-100/70 disabled:bg-mist"
            />
          </div>

          {error ? (
            <p className="text-xs text-danger">{error}</p>
          ) : null}

          <div className="flex shrink-0 flex-col gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:items-end sm:justify-between">
            <p className="text-[11px] leading-snug text-slate-500 sm:max-w-[55%]">
              创建文档可能花费一点时间
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={onClose}
                className="rounded-lg px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={
                  submitting || !name.trim() || !text.trim()
                }
                className="inline-flex min-w-[88px] items-center justify-center gap-2 rounded-lg bg-ink px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:bg-slate-300 disabled:text-slate-500"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    <span>创建中</span>
                  </>
                ) : (
                  "确认"
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </>,
    document.body,
  );
}
