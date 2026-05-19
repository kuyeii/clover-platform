type Props = {
  /** 贴在某一轮助手气泡旁（重新回答）；默认贴输入框上方的全宽容器 */
  variant?: "footer" | "inline";
};

export function PendingReplyStrip({ variant = "footer" }: Props) {
  const outer =
    variant === "inline"
      ? "w-full shrink-0 pb-1 pt-0.5"
      : "mx-auto w-full max-w-3xl shrink-0 px-3 pb-1 pt-0.5";

  return (
    <div
      className={outer}
      role="status"
      aria-live="polite"
      aria-label="正在分析问题与检索资料"
    >
      <div className="inline-flex max-w-[85%] items-center gap-2 rounded-full border border-brand-100 bg-white px-3 py-1.5 text-xs font-medium leading-snug text-slate-500 shadow-sm shadow-slate-900/5">
        <span
          className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-solid border-brand-100 border-t-brand-500"
          aria-hidden
        />
        <span>正在分析问题与检索资料</span>
      </div>
    </div>
  );
}
