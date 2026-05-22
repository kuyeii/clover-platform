import { KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";

import { Icon } from "../../../shared/components/Icon";

interface ChatInputProps {
  disabled?: boolean;
  isReceiving?: boolean;
  webSearchEnabled: boolean;
  onWebSearchChange: (enabled: boolean) => void;
  onSend: (text: string) => void;
  onStop?: () => void;
}

export function ChatInput({
  disabled,
  isReceiving = false,
  webSearchEnabled,
  onWebSearchChange,
  onSend,
  onStop,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const swallowPlainEnterUntilRef = useRef(0);
  const imeCommitUsedEnterRef = useRef(false);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 190)}px`;
  }, [value]);

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) {
      return;
    }
    onSend(text);
    setValue("");
    textareaRef.current?.focus();
  };

  const insertNewlineAtCaret = (textarea: HTMLTextAreaElement) => {
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    setValue((current) => `${current.slice(0, start)}\n${current.slice(end)}`);
    const nextCursor = start + 1;
    queueMicrotask(() => {
      const nextTextarea = textareaRef.current;
      if (!nextTextarea) {
        return;
      }
      nextTextarea.selectionStart = nextTextarea.selectionEnd = nextCursor;
      nextTextarea.focus();
    });
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") {
      return;
    }
    if (event.nativeEvent.isComposing) {
      imeCommitUsedEnterRef.current = true;
      return;
    }
    if ((event as unknown as { keyCode?: number }).keyCode === 229) {
      return;
    }
    if (event.shiftKey) {
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      insertNewlineAtCaret(event.currentTarget);
      return;
    }
    if (Date.now() < swallowPlainEnterUntilRef.current) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    submit();
  };

  return (
    <div className="rag-chat-input">
      <div className="rag-chat-input-box">
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          disabled={disabled}
          placeholder="输入问题，按 Enter 发送"
          onChange={(event) => setValue(event.target.value)}
          onCompositionStart={() => {
            imeCommitUsedEnterRef.current = false;
          }}
          onCompositionEnd={() => {
            if (imeCommitUsedEnterRef.current) {
              imeCommitUsedEnterRef.current = false;
              swallowPlainEnterUntilRef.current = Date.now() + 200;
            }
          }}
          onKeyDown={handleKeyDown}
        />
        {isReceiving ? (
          <button type="button" className="icon-button" onClick={onStop} aria-label="停止生成">
            <span className="rag-stop-icon" />
          </button>
        ) : (
          <button type="button" className="primary-button" disabled={disabled || !value.trim()} onClick={submit}>
            <Icon name="send" />
            发送
          </button>
        )}
      </div>
      <button
        type="button"
        className={webSearchEnabled ? "rag-search-toggle active" : "rag-search-toggle"}
        aria-pressed={webSearchEnabled}
        onClick={() => onWebSearchChange(!webSearchEnabled)}
      >
        <Icon name="search" />
        联网检索 {webSearchEnabled ? "开" : "关"}
      </button>
    </div>
  );
}
