import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, UploadCloud, X } from "lucide-react";
import { createFileDocument } from "@/lib/api";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (documentName: string) => void;
};

export function UploadFileKnowledgeModal({
  open,
  onClose,
  onCreated,
}: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setDragOver(false);
    setError(null);
    setSubmitting(false);
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const pickFiles = (list: FileList | null) => {
    const f = list?.[0];
    if (f) setFile(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    pickFiles(e.dataTransfer.files);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await createFileDocument(file);
      onCreated(res.name);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
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
        className="fixed left-1/2 top-1/2 z-[110] flex max-h-[min(90vh,560px)] w-[min(calc(100vw-2rem),440px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/15"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-file-kb-title"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2
            id="upload-file-kb-title"
            className="text-sm font-semibold text-ink"
          >
            上传文件至知识库
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
          <input
            ref={inputRef}
            type="file"
            className="sr-only"
            aria-hidden
            tabIndex={-1}
            onChange={(e) => pickFiles(e.target.files)}
          />

          <button
            type="button"
            disabled={submitting}
            onDragEnter={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            className={[
              "flex min-h-[180px] w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition",
              dragOver
                ? "border-brand-500 bg-brand-50"
                : "border-slate-200 bg-mist/80 hover:border-brand-200 hover:bg-mist",
              submitting ? "pointer-events-none opacity-60" : "",
            ].join(" ")}
          >
            <UploadCloud
              className="h-10 w-10 text-slate-400"
              strokeWidth={1.25}
              aria-hidden
            />
            <span className="text-sm font-medium text-slate-800">
              拖拽文件到此处，或点击选择
            </span>
            <span className="text-xs text-slate-500">
              每次仅 1 个文件；名称以文件名为准
            </span>
            {file ? (
              <span className="mt-1 max-w-full truncate px-2 text-xs font-medium text-slate-700">
                已选：{file.name}
              </span>
            ) : null}
          </button>

          {error ? (
            <p className="text-xs text-red-600">{error}</p>
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
                disabled={submitting || !file}
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
