import { Loader2, RefreshCw, X } from "lucide-react";

interface FeedbackCaptchaDialogProps {
  hint: string;
  code: string | null;
  captchaInput: string;
  loadingCaptcha: boolean;
  submitting: boolean;
  error?: string;
  onCaptchaInputChange: (value: string) => void;
  onRefresh: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function FeedbackCaptchaDialog({
  hint,
  code,
  captchaInput,
  loadingCaptcha,
  submitting,
  error,
  onCaptchaInputChange,
  onRefresh,
  onConfirm,
  onCancel,
}: FeedbackCaptchaDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-captcha-title"
        className="w-full max-w-md overflow-hidden rounded-3xl border border-white/70 bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div>
            <h2 id="feedback-captcha-title" className="text-lg font-semibold text-slate-950">
              验证码
            </h2>
            <p className="mt-1 text-sm text-amber-800">{hint}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-6 py-6">
          {code ? (
            <div className="rounded-2xl border border-amber-100 bg-amber-50/80 px-4 py-4">
              <p className="text-xs font-medium text-slate-500">请对照输入以下数字</p>
              <p className="mt-2 font-mono text-3xl font-bold tracking-[0.35em] text-slate-900">{code}</p>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 py-6 text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" />
              正在获取验证码…
            </div>
          )}

          <button
            type="button"
            onClick={onRefresh}
            disabled={loadingCaptcha || submitting}
            className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs font-semibold text-amber-900 transition-colors hover:bg-amber-50 disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingCaptcha ? "animate-spin" : ""}`} />
            刷新验证码
          </button>

          <label className="block">
            <span className="text-sm font-semibold text-slate-700">
              输入验证码
              <span className="text-rose-500"> *</span>
            </span>
            <input
              value={captchaInput}
              onChange={(e) => onCaptchaInputChange(e.target.value.replace(/\D/g, "").slice(0, 5))}
              inputMode="numeric"
              maxLength={5}
              autoFocus
              placeholder="5 位数字"
              disabled={submitting}
              className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-4 font-mono text-lg tracking-widest outline-none transition-colors focus:border-sky-300 focus:ring-2 focus:ring-sky-100 disabled:bg-slate-50"
            />
          </label>

          {error ? (
            <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>
          ) : null}
        </div>

        <div className="flex justify-end gap-3 bg-slate-50 px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting || !code || captchaInput.length !== 5}
            className="inline-flex min-w-[120px] items-center justify-center gap-2 rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {submitting ? "提交中…" : "确认提交"}
          </button>
        </div>
      </section>
    </div>
  );
}
