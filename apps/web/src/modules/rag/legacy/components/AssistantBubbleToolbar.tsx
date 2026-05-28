import { ChevronLeft, ChevronRight, Copy, RefreshCw } from "lucide-react";
import {
  assistantActiveVariantIndex,
  assistantVariantCount,
  getAssistantDisplayedContent,
} from "@/lib/messageTurns";
import type { ChatMessage } from "@/types/chat";

type Props = {
  assistant: ChatMessage;
  sending: boolean;
  onCopy: () => void;
  onRegenerate: () => void;
  onVariantDelta: (delta: number) => void;
};

export function AssistantBubbleToolbar({
  assistant,
  sending,
  onCopy,
  onRegenerate,
  onVariantDelta,
}: Props) {
  const total = assistantVariantCount(assistant);
  const activeIdx = assistantActiveVariantIndex(assistant);
  const showPager = total >= 2;
  const displayPage = activeIdx + 1;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1 text-slate-400 opacity-0 transition group-hover/asst:opacity-100 max-md:opacity-100">
      {showPager ? (
        <div className="mr-1 flex items-center gap-0.5 text-xs text-slate-500">
          <button
            type="button"
            disabled={activeIdx <= 0}
            onClick={() => onVariantDelta(-1)}
            className="rounded p-1 hover:bg-brand-50 disabled:opacity-25"
            aria-label="上一版回复"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[2.25rem] text-center tabular-nums">
            {displayPage}/{total}
          </span>
          <button
            type="button"
            disabled={activeIdx >= total - 1}
            onClick={() => onVariantDelta(1)}
            className="rounded p-1 hover:bg-brand-50 disabled:opacity-25"
            aria-label="下一版回复"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      <span className="group/acopy relative inline-flex">
        <button
          type="button"
          onClick={() => void onCopy()}
          className="rounded-md p-1.5 transition hover:bg-brand-50 hover:text-brand-600"
          aria-label="复制回复"
        >
          <Copy className="h-4 w-4" />
        </button>
        <span
          role="tooltip"
          className="pointer-events-none absolute left-1/2 top-full z-20 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-full bg-ink px-2.5 py-1 text-xs font-medium text-white opacity-0 shadow-none transition-opacity duration-150 group-hover/acopy:opacity-100"
        >
          复制回复
        </span>
      </span>

      <span className="group/aregen relative inline-flex">
        <button
          type="button"
          disabled={sending}
          onClick={() => onRegenerate()}
          className="rounded-md p-1.5 transition hover:bg-brand-50 hover:text-brand-600 disabled:opacity-30"
          aria-label="重新回答"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
        <span
          role="tooltip"
          className="pointer-events-none absolute left-1/2 top-full z-20 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-full bg-ink px-2.5 py-1 text-xs font-medium text-white opacity-0 shadow-none transition-opacity duration-150 group-hover/aregen:opacity-100"
        >
          重新回答
        </span>
      </span>
    </div>
  );
}

/** 供复制：当前展示版本的完整正文 */
export function getAssistantCopyText(assistant: ChatMessage): string {
  return getAssistantDisplayedContent(assistant);
}
