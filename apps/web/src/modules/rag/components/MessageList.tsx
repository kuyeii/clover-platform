import { FormEvent, useEffect, useRef, useState } from "react";

import { Icon } from "../../../shared/components/Icon";
import type { ChatMessage } from "../types";
import {
  assistantActiveVariantIndex,
  assistantStoppedForDisplay,
  assistantVariantCount,
  getActiveAssistantForTurn,
  getActiveUserContent,
  getAssistantDisplayedContent,
  messagesToTurns,
  userTurnActiveIndex,
  userTurnVersionCount,
} from "../utils";

interface MessageListProps {
  messages: ChatMessage[];
  streamingText: string;
  sending: boolean;
  streamingAssistantId: string | null;
  onEditUserMessage: (userMessageId: string, newText: string) => void;
  onUserVersionChange: (userMessageId: string, newIndex: number) => void;
  onRegenerateAssistant: (assistantMessageId: string) => void;
  onAssistantVariantChange: (assistantMessageId: string, newIndex: number) => void;
}

export function MessageList({
  messages,
  streamingText,
  sending,
  streamingAssistantId,
  onEditUserMessage,
  onUserVersionChange,
  onRegenerateAssistant,
  onAssistantVariantChange,
}: MessageListProps) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const [editingId, setEditingId] = useState("");
  const [editDraft, setEditDraft] = useState("");
  const turns = messagesToTurns(messages);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, streamingText]);

  const beginEdit = (message: ChatMessage) => {
    setEditingId(message.id);
    setEditDraft(getActiveUserContent(message));
  };

  const submitEdit = (event: FormEvent) => {
    event.preventDefault();
    const text = editDraft.trim();
    if (editingId && text) {
      onEditUserMessage(editingId, text);
    }
    setEditingId("");
    setEditDraft("");
  };

  return (
    <div className="rag-message-list">
      {turns.map((turn, index) => {
        const isLast = index === turns.length - 1;
        const assistant = getActiveAssistantForTurn(turn.user, turn.assistant);
        const streamHere = sending && (streamingAssistantId ? assistant?.id === streamingAssistantId : isLast);
        const displayAssistant = assistant
          ? {
              ...assistant,
              content: streamHere ? streamingText : getAssistantDisplayedContent(assistant),
            }
          : streamHere
            ? ({ id: "streaming", role: "assistant", content: streamingText } satisfies ChatMessage)
            : null;
        const userVersions = userTurnVersionCount(turn.user);
        const userActiveIndex = userTurnActiveIndex(turn.user);
        const assistantVersions = assistant ? assistantVariantCount(assistant) : 1;
        const assistantActiveIndex = assistant ? assistantActiveVariantIndex(assistant) : 0;

        return (
          <section className="rag-turn" key={turn.user.id}>
            <div className="rag-message user" id={`chat-message-${turn.user.id}`}>
              <div className="rag-message-role">你</div>
              {editingId === turn.user.id ? (
                <form className="rag-edit-form" onSubmit={submitEdit}>
                  <textarea value={editDraft} onChange={(event) => setEditDraft(event.target.value)} rows={4} autoFocus />
                  <div className="row-actions">
                    <button type="button" className="ghost-button" onClick={() => setEditingId("")}>
                      取消
                    </button>
                    <button type="submit" className="primary-button" disabled={!editDraft.trim()}>
                      重新发送
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <p>{getActiveUserContent(turn.user)}</p>
                  <div className="rag-message-actions">
                    {userVersions > 1 ? (
                      <VersionPager
                        current={userActiveIndex}
                        total={userVersions}
                        onChange={(next) => onUserVersionChange(turn.user.id, next)}
                      />
                    ) : null}
                    <button type="button" className="ghost-button small" onClick={() => beginEdit(turn.user)}>
                      <Icon name="save" />
                      编辑
                    </button>
                  </div>
                </>
              )}
            </div>

            {displayAssistant ? (
              <div
                className={streamHere && !displayAssistant.content ? "rag-message assistant pending" : "rag-message assistant"}
                id={`chat-message-${displayAssistant.id}`}
                data-stream-anchor={assistant?.id}
              >
                <div className="rag-message-role">助手</div>
                {displayAssistant.content ? (
                  <MarkdownLike content={displayAssistant.content} />
                ) : (
                  <div className="rag-thinking">
                    <div className="loading-spinner" />
                    正在生成回答...
                  </div>
                )}
                {assistantStoppedForDisplay(displayAssistant) ? <span className="status-chip">已停止</span> : null}
                {assistant ? (
                  <div className="rag-message-actions">
                    {assistantVersions > 1 ? (
                      <VersionPager
                        current={assistantActiveIndex}
                        total={assistantVersions}
                        onChange={(next) => onAssistantVariantChange(assistant.id, next)}
                      />
                    ) : null}
                    <button type="button" className="ghost-button small" disabled={sending} onClick={() => onRegenerateAssistant(assistant.id)}>
                      <Icon name="refresh" />
                      重新回答
                    </button>
                    <button
                      type="button"
                      className="ghost-button small"
                      onClick={() => void navigator.clipboard?.writeText(getAssistantDisplayedContent(assistant))}
                    >
                      <Icon name="download" />
                      复制
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}

function VersionPager({
  current,
  total,
  onChange,
}: {
  current: number;
  total: number;
  onChange: (next: number) => void;
}) {
  return (
    <span className="rag-version-pager">
      <button type="button" className="icon-button small" disabled={current <= 0} onClick={() => onChange(current - 1)} aria-label="上一版">
        <Icon name="back" />
      </button>
      <span>
        {current + 1}/{total}
      </span>
      <button
        type="button"
        className="icon-button small"
        disabled={current >= total - 1}
        onClick={() => onChange(current + 1)}
        aria-label="下一版"
      >
        <Icon name="arrow" />
      </button>
    </span>
  );
}

function MarkdownLike({ content }: { content: string }) {
  return (
    <div className="rag-markdown">
      {content.split(/\n{2,}/).map((block, index) => {
        const trimmed = block.trim();
        if (!trimmed) {
          return null;
        }
        if (trimmed.startsWith("```")) {
          return <pre key={index}>{trimmed.replace(/^```[a-zA-Z0-9_-]*\n?/, "").replace(/```$/, "")}</pre>;
        }
        if (/^[-*]\s/m.test(trimmed)) {
          return (
            <ul key={index}>
              {trimmed.split("\n").map((line, lineIndex) => (
                <li key={lineIndex}>{line.replace(/^[-*]\s+/, "")}</li>
              ))}
            </ul>
          );
        }
        return <p key={index}>{trimmed}</p>;
      })}
    </div>
  );
}
