import { Globe2, SendHorizontal, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Props = {
  disabled?: boolean;
  /** 模型正在生成（含等待首 token），主按钮显示为「停止」 */
  isReceiving?: boolean;
  onStop?: () => void;
  placeholder?: string;
  webSearchEnabled: boolean;
  onWebSearchChange: (enabled: boolean) => void;
  onSend: (text: string) => void;
};

export function ChatInput({
  disabled,
  isReceiving = false,
  onStop,
  placeholder = "有问题，尽管问",
  webSearchEnabled,
  onWebSearchChange,
  onSend,
}: Props) {
  const [value, setValue] = useState("");
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  /** 用回车在候选中选词结束时，紧随其后的那一次「裸」Enter 不当作发送 */
  const swallowPlainEnterUntilRef = useRef(0);
  /** 最近一次 Enter keydown 是否在 isComposing 中（即从候选中用回车上屏） */
  const imeCommitUsedEnterRef = useRef(false);

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue("");
    taRef.current?.focus();
  };

  /** Ctrl+Enter / ⌘+Enter：换行（textarea 默认不显式插入） */
  const insertNewlineAtCaret = (ta: HTMLTextAreaElement) => {
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    setValue((prev) => `${prev.slice(0, start)}\n${prev.slice(end)}`);
    const pos = start + 1;
    queueMicrotask(() => {
      const el = taRef.current;
      if (!el) return;
      el.selectionStart = el.selectionEnd = pos;
      el.focus();
    });
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-3 pb-7 pt-2">
      <div className="rounded-[28px] border border-brand-100 bg-white shadow-soft">
        <div className="flex items-center gap-2 px-4 py-2.5">
          <textarea
            ref={taRef}
            rows={1}
            value={value}
            disabled={disabled}
            onChange={(e) => setValue(e.target.value)}
            onCompositionStart={() => {
              imeCommitUsedEnterRef.current = false;
            }}
            onCompositionEnd={() => {
              if (imeCommitUsedEnterRef.current) {
                imeCommitUsedEnterRef.current = false;
                swallowPlainEnterUntilRef.current = Date.now() + 200;
              }
            }}
            placeholder={placeholder}
            title="Enter 发送；Shift+Enter 或 Ctrl+Enter（⌘+Enter）换行；输入法选词时的回车不会触发发送"
            className="scrollbar-none max-h-[200px] min-h-[44px] w-full resize-none overflow-y-auto bg-transparent py-2.5 text-[15px] leading-relaxed text-ink outline-none placeholder:text-slate-400 disabled:text-slate-400"
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              const ne = e.nativeEvent as KeyboardEvent;

              // 输入法组字 / 候选列表中用回车上屏 —— 不交给我们处理
              if (ne.isComposing) {
                if (e.key === "Enter") {
                  imeCommitUsedEnterRef.current = true;
                }
                return;
              }
              if ((e as unknown as { keyCode?: number }).keyCode === 229) return;

              if (e.shiftKey) return;

              if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                insertNewlineAtCaret(e.currentTarget);
                return;
              }

              // 紧跟在 compositionEnd 后的多余 Enter（常见于用回车从候选中选词）
              if (Date.now() < swallowPlainEnterUntilRef.current) {
                e.preventDefault();
                return;
              }

              e.preventDefault();
              submit();
            }}
          />

          <div className="flex shrink-0 items-center gap-1 self-center">
            {isReceiving ? (
              <button
                type="button"
                onClick={() => onStop?.()}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-ink shadow-sm transition hover:border-brand-100 hover:bg-brand-50"
                aria-label="停止生成"
                title="停止生成"
              >
                <Square className="h-3.5 w-3.5 fill-current" aria-hidden />
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={disabled || !value.trim()}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white shadow-sm shadow-slate-950/20 transition enabled:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="发送"
              >
                <SendHorizontal className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 flex justify-start">
        <button
          type="button"
          onClick={() => onWebSearchChange(!webSearchEnabled)}
          className={[
            "inline-flex min-w-[112px] items-center justify-center gap-2 rounded-full border px-4 py-2 text-[15px] font-bold tracking-wide transition",
            webSearchEnabled
              ? "border-[#A8BCFF] bg-[#F3F6FF] text-[#356BFF] shadow-[0_10px_28px_rgba(53,107,255,0.14)] hover:bg-[#EEF3FF]"
              : "border-brand-100 bg-white text-slate-600 shadow-sm hover:bg-brand-50 hover:text-brand-600",
          ].join(" ")}
          aria-pressed={webSearchEnabled}
          title='打开时 upstream 传入 allow_search="1"，关闭时为 "0"'
        >
          <Globe2 className="h-5 w-5" aria-hidden />
          联网
          <span className={webSearchEnabled ? "opacity-100" : "text-slate-400"}>
            {webSearchEnabled ? "开" : "关"}
          </span>
        </button>
      </div>
    </div>
  );
}
