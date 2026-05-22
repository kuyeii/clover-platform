import { useMemo, useState } from "react";

import { Icon } from "../../../shared/components/Icon";
import type { Conversation } from "../types";
import {
  conversationListLabel,
  conversationMatchesSearchText,
  sortConversationsForSidebar,
} from "../utils";

interface SessionListProps {
  conversations: Conversation[];
  activeConversationId: string;
  onNewChat: () => void;
  onSelectConversation: (id: string) => void;
  onTogglePinConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
  onDeleteConversation: (id: string) => void;
}

export function SessionList({
  conversations,
  activeConversationId,
  onNewChat,
  onSelectConversation,
  onTogglePinConversation,
  onRenameConversation,
  onDeleteConversation,
}: SessionListProps) {
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const recent = useMemo(
    () => sortConversationsForSidebar(conversations.filter((conversation) => conversation.messages.some((message) => message.role === "user"))),
    [conversations],
  );
  const filtered = useMemo(
    () => recent.filter((conversation) => conversationMatchesSearchText(conversation, query)),
    [query, recent],
  );

  const saveRename = () => {
    const title = renaming?.title.trim();
    if (renaming && title) {
      onRenameConversation(renaming.id, title);
    }
    setRenaming(null);
  };

  return (
    <aside className="rag-sidebar">
      <button type="button" className="primary-button full" onClick={onNewChat}>
        <Icon name="plus" />
        新聊天
      </button>

      <label className="rag-search-field">
        <Icon name="search" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题或对话" />
      </label>

      <section className="rag-session-section">
        <div className="rag-section-title">
          <span>最近对话</span>
          <strong>{recent.length}</strong>
        </div>
        <div className="rag-session-list">
          {filtered.length === 0 ? (
            <p className="empty-mini">{recent.length === 0 ? "发送第一条消息后会出现记录" : "没有匹配的对话"}</p>
          ) : (
            filtered.map((conversation) => (
              <article
                key={conversation.id}
                className={conversation.id === activeConversationId ? "rag-session-row active" : "rag-session-row"}
              >
                <button type="button" className="rag-session-main" onClick={() => onSelectConversation(conversation.id)}>
                  <strong>{conversationListLabel(conversation)}</strong>
                  <span>{new Date(conversation.updatedAt).toLocaleString()}</span>
                </button>
                <div className="rag-session-actions">
                  <button
                    type="button"
                    className="icon-button small"
                    onClick={() => onTogglePinConversation(conversation.id)}
                    aria-label={conversation.pinned ? "取消置顶" : "置顶"}
                  >
                    <Icon name={conversation.pinned ? "check" : "spark"} />
                  </button>
                  <button
                    type="button"
                    className="icon-button small"
                    onClick={() => setRenaming({ id: conversation.id, title: conversationListLabel(conversation) })}
                    aria-label="重命名"
                  >
                    <Icon name="save" />
                  </button>
                  <button
                    type="button"
                    className="icon-button small"
                    onClick={() => {
                      if (window.confirm("确定删除此对话？删除后无法恢复。")) {
                        onDeleteConversation(conversation.id);
                      }
                    }}
                    aria-label="删除"
                  >
                    <Icon name="close" />
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      {renaming ? (
        <div className="modal-backdrop">
          <section className="dialog" role="dialog" aria-modal="true">
            <button className="icon-button dialog-close" type="button" onClick={() => setRenaming(null)} aria-label="关闭">
              <Icon name="close" />
            </button>
            <h3>重命名对话</h3>
            <label className="form-field">
              <span>标题</span>
              <input
                value={renaming.title}
                onChange={(event) => setRenaming({ ...renaming, title: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    saveRename();
                  }
                }}
                autoFocus
              />
            </label>
            <div className="dialog-actions">
              <button type="button" className="ghost-button" onClick={() => setRenaming(null)}>
                取消
              </button>
              <button type="button" className="primary-button" onClick={saveRename}>
                保存
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </aside>
  );
}
