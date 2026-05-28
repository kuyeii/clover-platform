import { ChevronLeft, ChevronRight, Copy, Pencil } from "lucide-react";
import {
  AssistantBubbleToolbar,
  getAssistantCopyText,
} from "@/components/AssistantBubbleToolbar";
import { MarkdownBubble } from "@/components/MarkdownBubble";
import { PendingReplyStrip } from "@/components/PendingReplyStrip";
import {
  assistantActiveVariantIndex,
  assistantStoppedForDisplay,
  assistantVariantCount,
  getActiveAssistantForTurn,
  getActiveUserContent,
  getAssistantDisplayedContent,
  userTurnActiveIndex,
  userTurnVersionCount,
} from "@/lib/messageTurns";
import type { ChatMessage } from "@/types/chat";

type Props = {
  user: ChatMessage;
  linearAssistant: ChatMessage | null;
  /** 当前轮是否正在接收流式（含重新回答挂起的助手 id） */
  isStreamingThisTurn: boolean;
  /** 重新回答：等待条与流式内容挂在本轮助手位置 */
  inlineAssistantStream: boolean;
  showInlinePending: boolean;
  streamingText: string;
  sending: boolean;
  highlightQuery?: string;
  highlightTargetId: string | null;
  editingUserMessageId: string | null;
  editDraft: string;
  onEditDraftChange: (v: string) => void;
  onBeginEdit: (userId: string) => void;
  onCancelEdit: () => void;
  onSubmitEdit: (userId: string, text: string) => void;
  onVersionChange: (userId: string, newIndex: number) => void;
  onRegenerateAssistant: (assistantMessageId: string) => void | Promise<void>;
  onAssistantVariantChange: (assistantMessageId: string, newIndex: number) => void;
  onCopied: () => void;
};

export function UserMessageTurn({
  user,
  linearAssistant,
  isStreamingThisTurn,
  inlineAssistantStream,
  showInlinePending,
  streamingText,
  sending,
  highlightQuery,
  highlightTargetId,
  editingUserMessageId,
  editDraft,
  onEditDraftChange,
  onBeginEdit,
  onCancelEdit,
  onSubmitEdit,
  onVersionChange,
  onRegenerateAssistant,
  onAssistantVariantChange,
  onCopied,
}: Props) {
  const displayedUser = getActiveUserContent(user);
  const histLen = user.editHistory?.length ?? 0;
  const activeIdx = userTurnActiveIndex(user);
  const versionTotal = userTurnVersionCount(user);
  const displayPage = activeIdx + 1;
  const isEditing = editingUserMessageId === user.id;
  const viewingLatest = activeIdx === histLen;
  const showPager = histLen > 0;

  const branchAssistant = getActiveAssistantForTurn(user, linearAssistant);
  const showHistoricalAssistant =
    !viewingLatest && branchAssistant && !isStreamingThisTurn;
  const showLatestAssistantBubble =
    viewingLatest && !isStreamingThisTurn && linearAssistant;
  /** 首段 token 未到时：新对话由 App 层 PendingReplyStrip；重新回答由本组件内联 PendingReplyStrip */
  const showStreaming =
    isStreamingThisTurn && streamingText.length > 0;

  const streamingBubble = (
    <div className="flex w-full justify-start">
      <div className="min-w-0 max-w-[85%] rounded-2xl border border-brand-100 bg-white px-4 py-3 text-ink shadow-none ">
        <MarkdownBubble
          content={streamingText}
          variant="assistant"
          onCopied={onCopied}
        />
        <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-brand-500 align-middle" />
      </div>
    </div>
  );

  const copyDisplayed = async () => {
    try {
      await navigator.clipboard.writeText(displayedUser);
      onCopied();
    } catch {
      /* ignore */
    }
  };

  const bumpVersion = (delta: number) => {
    const next = Math.max(0, Math.min(histLen, activeIdx + delta));
    if (next !== activeIdx) onVersionChange(user.id, next);
  };

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex w-full justify-end">
        <div className="group/msg flex min-w-0 max-w-[85%] flex-col items-end gap-1">
          {isEditing ? (
            <div className="w-full min-w-[min(100%,280px)] rounded-2xl border border-brand-100 bg-white px-3 py-3 text-ink shadow-none ">
              <textarea
                value={editDraft}
                onChange={(e) => onEditDraftChange(e.target.value)}
                rows={4}
                className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-[15px] leading-relaxed outline-none transition focus:border-brand-200 focus:ring-4 focus:ring-brand-100/60"
                autoFocus
              />
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onCancelEdit}
                  className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-brand-50 hover:text-brand-600"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={!editDraft.trim() || sending}
                  onClick={() => onSubmitEdit(user.id, editDraft.trim())}
                  className="rounded-full bg-ink px-4 py-1.5 text-sm font-medium text-white transition enabled:hover:bg-slate-800 disabled:opacity-40"
                >
                  发送
                </button>
              </div>
            </div>
          ) : (
            <div
              id={`chat-message-${user.id}`}
              className={[
                "min-w-0 max-w-full rounded-2xl px-4 py-3 shadow-none ",
                "bg-ink text-white",
                highlightTargetId === user.id
                  ? "ring-2 ring-[var(--color-warning-border)] ring-offset-2 ring-offset-mist"
                  : "",
              ].join(" ")}
            >
              <MarkdownBubble
                content={displayedUser}
                variant="user"
                highlightQuery={
                  highlightTargetId === user.id ? highlightQuery : undefined
                }
                onCopied={onCopied}
              />
            </div>
          )}

          {!isEditing ? (
            <div className="flex items-center gap-0.5 pr-0.5 text-slate-400 opacity-0 transition group-hover/msg:opacity-100 max-md:opacity-100">
              <span className="group/copy relative inline-flex">
                <button
                  type="button"
                  onClick={() => void copyDisplayed()}
                  className="rounded-md p-1.5 transition hover:bg-brand-50 hover:text-brand-600"
                  aria-label="复制消息"
                >
                  <Copy className="h-4 w-4" />
                </button>
                <span
                  role="tooltip"
                  className="pointer-events-none absolute left-1/2 top-full z-20 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-full bg-ink px-2.5 py-1 text-xs font-medium text-white opacity-0 shadow-none transition-opacity duration-150 group-hover/copy:opacity-100"
                >
                  复制消息
                </span>
              </span>
              <span className="group/edit relative inline-flex">
                <button
                  type="button"
                  disabled={sending || !viewingLatest}
                  onClick={() => onBeginEdit(user.id)}
                  className="rounded-md p-1.5 transition hover:bg-brand-50 hover:text-brand-600 disabled:opacity-30"
                  aria-label="编辑消息"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <span
                  role="tooltip"
                  className="pointer-events-none absolute left-1/2 top-full z-20 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-full bg-ink px-2.5 py-1 text-xs font-medium text-white opacity-0 shadow-none transition-opacity duration-150 group-hover/edit:opacity-100"
                >
                  编辑消息
                </span>
              </span>
              {showPager ? (
                <div className="ml-1 flex items-center gap-0.5 text-xs text-slate-500">
                  <button
                    type="button"
                    disabled={activeIdx <= 0}
                    onClick={() => bumpVersion(-1)}
                    className="rounded p-1 hover:bg-brand-50 disabled:opacity-25"
                    aria-label="上一版本"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="min-w-[2.25rem] text-center tabular-nums">
                    {displayPage}/{versionTotal}
                  </span>
                  <button
                    type="button"
                    disabled={activeIdx >= histLen}
                    onClick={() => bumpVersion(1)}
                    className="rounded p-1 hover:bg-brand-50 disabled:opacity-25"
                    aria-label="下一版本"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {inlineAssistantStream && linearAssistant ? (
        <div
          data-stream-anchor={linearAssistant.id}
          className="flex w-full flex-col gap-2 scroll-mt-28"
        >
          {showInlinePending ? <PendingReplyStrip variant="inline" /> : null}
          {showStreaming ? streamingBubble : null}
        </div>
      ) : null}

      {showHistoricalAssistant && branchAssistant ? (
        <div className="flex w-full justify-start">
          <div className="group/asst flex min-w-0 max-w-[85%] flex-col items-start">
            <div
              id={`chat-message-${branchAssistant.id}`}
              className={[
                "min-w-0 max-w-full rounded-2xl border border-brand-100 bg-white px-4 py-3 text-ink shadow-none ",
                highlightTargetId === branchAssistant.id
                  ? "ring-2 ring-[var(--color-warning-border)] ring-offset-2 ring-offset-mist"
                  : "",
              ].join(" ")}
            >
              <MarkdownBubble
                content={getAssistantDisplayedContent(branchAssistant)}
                variant="assistant"
                highlightQuery={
                  highlightTargetId === branchAssistant.id
                    ? highlightQuery
                    : undefined
                }
                onCopied={onCopied}
              />
              {assistantStoppedForDisplay(branchAssistant) ? (
                <p className="mt-2 border-t border-slate-200/80 pt-2 text-xs text-slate-500">
                  回答已终止
                </p>
              ) : null}
            </div>
            <AssistantBubbleToolbar
              assistant={branchAssistant}
              sending={sending}
              onCopy={() => {
                void navigator.clipboard.writeText(
                  getAssistantCopyText(branchAssistant),
                );
                onCopied();
              }}
              onRegenerate={() => void onRegenerateAssistant(branchAssistant.id)}
              onVariantDelta={(delta) => {
                const total = assistantVariantCount(branchAssistant);
                const active = assistantActiveVariantIndex(branchAssistant);
                const next = Math.max(0, Math.min(total - 1, active + delta));
                if (next !== active) {
                  onAssistantVariantChange(branchAssistant.id, next);
                }
              }}
            />
          </div>
        </div>
      ) : null}

      {showLatestAssistantBubble && linearAssistant ? (
        <div className="flex w-full justify-start">
          <div className="group/asst flex min-w-0 max-w-[85%] flex-col items-start">
            <div
              id={`chat-message-${linearAssistant.id}`}
              className={[
                "min-w-0 max-w-full rounded-2xl border border-brand-100 bg-white px-4 py-3 text-ink shadow-none ",
                highlightTargetId === linearAssistant.id
                  ? "ring-2 ring-[var(--color-warning-border)] ring-offset-2 ring-offset-mist"
                  : "",
              ].join(" ")}
            >
              <MarkdownBubble
                content={getAssistantDisplayedContent(linearAssistant)}
                variant="assistant"
                highlightQuery={
                  highlightTargetId === linearAssistant.id
                    ? highlightQuery
                    : undefined
                }
                onCopied={onCopied}
              />
              {assistantStoppedForDisplay(linearAssistant) ? (
                <p className="mt-2 border-t border-slate-200/80 pt-2 text-xs text-slate-500">
                  回答已终止
                </p>
              ) : null}
            </div>
            <AssistantBubbleToolbar
              assistant={linearAssistant}
              sending={sending}
              onCopy={() => {
                void navigator.clipboard.writeText(
                  getAssistantCopyText(linearAssistant),
                );
                onCopied();
              }}
              onRegenerate={() => void onRegenerateAssistant(linearAssistant.id)}
              onVariantDelta={(delta) => {
                const total = assistantVariantCount(linearAssistant);
                const active = assistantActiveVariantIndex(linearAssistant);
                const next = Math.max(0, Math.min(total - 1, active + delta));
                if (next !== active) {
                  onAssistantVariantChange(linearAssistant.id, next);
                }
              }}
            />
          </div>
        </div>
      ) : null}

      {!inlineAssistantStream && showStreaming ? streamingBubble : null}
    </div>
  );
}
