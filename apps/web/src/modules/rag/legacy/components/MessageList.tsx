import { useEffect, useRef, useState } from "react";
import { findFirstMatchingMessageId } from "@/lib/conversationStorage";
import { getActiveUserContent, messagesToTurns } from "@/lib/messageTurns";
import { UserMessageTurn } from "@/components/UserMessageTurn";
import type { ChatMessage } from "@/types/chat";

export type SearchJumpPayload = { query: string; key: number };

type Props = {
  messages: ChatMessage[];
  streamingText: string;
  sending: boolean;
  /** 正在「重新回答」的目标助手消息 id；null 表示末尾新追加一条助手回复 */
  streamingAssistantId: string | null;
  searchJump: SearchJumpPayload | null;
  onSearchJumpHandled: () => void;
  onEditUserMessage: (userMessageId: string, newText: string) => void;
  onUserVersionChange: (userMessageId: string, newIndex: number) => void;
  onRegenerateAssistant: (assistantMessageId: string) => void | Promise<void>;
  onAssistantVariantChange: (assistantMessageId: string, newIndex: number) => void;
  onCopied?: () => void;
};

export function MessageList({
  messages,
  streamingText,
  sending,
  streamingAssistantId,
  searchJump,
  onSearchJumpHandled,
  onEditUserMessage,
  onUserVersionChange,
  onRegenerateAssistant,
  onAssistantVariantChange,
  onCopied,
}: Props) {
  const turns = messagesToTurns(messages);

  const containerRef = useRef<HTMLDivElement>(null);
  const didSnapScrollThisStream = useRef(false);
  const [searchHighlight, setSearchHighlight] = useState<{
    messageId: string;
    query: string;
  } | null>(null);

  const [editingUserMessageId, setEditingUserMessageId] = useState<string | null>(
    null,
  );
  const [editDraft, setEditDraft] = useState("");

  useEffect(() => {
    if (streamingAssistantId != null) {
      return;
    }
    if (streamingText.length === 0 && !sending) {
      didSnapScrollThisStream.current = false;
      return;
    }
    if (didSnapScrollThisStream.current) {
      return;
    }
    didSnapScrollThisStream.current = true;
    queueMicrotask(() => {
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: "smooth",
      });
    });
  }, [streamingText, sending, streamingAssistantId]);

  useEffect(() => {
    if (!streamingAssistantId || !containerRef.current) return;
    const el = containerRef.current.querySelector(
      `[data-stream-anchor="${streamingAssistantId}"]`,
    );
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [streamingAssistantId, sending]);

  useEffect(() => {
    if (!searchJump) return;
    const mid = findFirstMatchingMessageId(messages, searchJump.query);
    if (!mid) {
      onSearchJumpHandled();
      return;
    }
    const run = () => {
      const el = document.getElementById(`chat-message-${mid}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      const q = searchJump.query.trim();
      setSearchHighlight({ messageId: mid, query: q });
      window.setTimeout(() => setSearchHighlight(null), 2200);
      onSearchJumpHandled();
    };
    requestAnimationFrame(() => requestAnimationFrame(run));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅随 searchJump 触发
  }, [searchJump, onSearchJumpHandled]);

  const handleBeginEdit = (userId: string) => {
    const u = messages.find((m) => m.id === userId && m.role === "user");
    if (!u) return;
    setEditingUserMessageId(userId);
    setEditDraft(getActiveUserContent(u));
  };

  const handleCancelEdit = () => {
    setEditingUserMessageId(null);
    setEditDraft("");
  };

  const handleSubmitEdit = (userId: string, text: string) => {
    setEditingUserMessageId(null);
    setEditDraft("");
    onEditUserMessage(userId, text);
  };

  return (
    <div
      ref={containerRef}
      className="mx-auto w-full max-w-3xl space-y-4 px-3 py-6"
    >
      {turns.map((turn, idx) => {
        const isLast = idx === turns.length - 1;
        const streamHere =
          sending &&
          (streamingAssistantId != null
            ? turn.assistant?.id === streamingAssistantId
            : isLast);
        const inlineAssistantStream =
          streamingAssistantId != null &&
          turn.assistant?.id === streamingAssistantId;
        const showInlinePending =
          inlineAssistantStream &&
          sending &&
          streamingText.length === 0;
        return (
          <UserMessageTurn
            key={turn.user.id}
            user={turn.user}
            linearAssistant={turn.assistant}
            isStreamingThisTurn={streamHere}
            inlineAssistantStream={inlineAssistantStream}
            showInlinePending={showInlinePending}
            streamingText={streamHere ? streamingText : ""}
            sending={sending}
            highlightQuery={searchHighlight?.query}
            highlightTargetId={searchHighlight?.messageId ?? null}
            editingUserMessageId={editingUserMessageId}
            editDraft={editDraft}
            onEditDraftChange={setEditDraft}
            onBeginEdit={handleBeginEdit}
            onCancelEdit={handleCancelEdit}
            onSubmitEdit={handleSubmitEdit}
            onVersionChange={onUserVersionChange}
            onRegenerateAssistant={onRegenerateAssistant}
            onAssistantVariantChange={onAssistantVariantChange}
            onCopied={onCopied ?? (() => {})}
          />
        );
      })}
    </div>
  );
}
