import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Database,
  FileText,
  MessageSquarePlus,
  Search,
  Upload,
  X,
} from "lucide-react";
import type { Conversation } from "@/types/conversation";
import {
  conversationListLabel,
  conversationMatchesSearchText,
  sortConversationsForSidebar,
} from "@/lib/conversationStorage";
import { ConversationSidebarRow } from "@/components/ConversationSidebarRow";
import { KnowledgeOverviewInline } from "@/components/KnowledgeOverviewInline";

/** 知识库管理子项（删除文档在「知识库概览」展开区内操作） */
export type KnowledgeBaseNavKey = "overview" | "uploadText" | "uploadFile";

type Props = {
  open: boolean;
  onClose: () => void;
  onNewChat: () => void;
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelectConversation: (
    id: string,
    options?: { jumpToSearchQuery?: string },
  ) => void;
  knowledgeNavActive: KnowledgeBaseNavKey | null;
  onKnowledgeNavSelect: (key: KnowledgeBaseNavKey) => void;
  onTogglePinConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
  onDeleteConversation: (id: string) => void;
};

const KB_AFTER_OVERVIEW: {
  key: Exclude<KnowledgeBaseNavKey, "overview">;
  label: string;
  icon: typeof FileText;
}[] = [
  { key: "uploadText", label: "上传文本至知识库", icon: FileText },
  { key: "uploadFile", label: "上传文件至知识库", icon: Upload },
];

export function Sidebar({
  open,
  onClose,
  onNewChat,
  conversations,
  activeConversationId,
  onSelectConversation,
  knowledgeNavActive,
  onKnowledgeNavSelect,
  onTogglePinConversation,
  onRenameConversation,
  onDeleteConversation,
}: Props) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const [renameModal, setRenameModal] = useState<{
    id: string;
    draft: string;
  } | null>(null);

  const recentSorted = useMemo(() => {
    const withUser = conversations.filter((c) =>
      c.messages.some((m) => m.role === "user"),
    );
    return sortConversationsForSidebar(withUser);
  }, [conversations]);

  const filtered = useMemo(() => {
    const raw = searchQuery.trim();
    const base = raw
      ? recentSorted.filter((c) => conversationMatchesSearchText(c, raw))
      : recentSorted;
    return sortConversationsForSidebar(base);
  }, [recentSorted, searchQuery]);

  useEffect(() => {
    if (!renameModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRenameModal(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [renameModal]);

  const toggleOverview = () => {
    setOverviewExpanded((v) => !v);
  };

  return (
    <>
      <aside
        className={[
          "sidebar-shell fixed inset-y-0 left-0 z-40 flex h-screen max-h-screen min-h-0 w-[298px] flex-col border-r border-slate-200/90 bg-white shadow-[8px_0_28px_rgba(15,23,42,0.04)] transition-transform duration-200 md:translate-x-0 md:shadow-none",
          open ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-4">
          <button
            type="button"
            onClick={() => {
              setOverviewExpanded(false);
              onNewChat();
            }}
            className="flex h-[42px] items-center justify-center gap-2 rounded-lg bg-brand-500 px-3 text-sm font-semibold text-white shadow-glow transition hover:bg-brand-600 active:translate-y-px"
          >
            <MessageSquarePlus className="h-4 w-4" />
            新聊天
          </button>

          <button
            type="button"
            onClick={() => setSearchOpen((v) => !v)}
            className={[
              "mt-3 flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition",
              searchOpen
                ? "bg-brand-50 text-brand-700 shadow-sm shadow-brand-500/5"
                : "text-slate-600 hover:bg-white hover:text-ink hover:shadow-sm",
            ].join(" ")}
          >
            <Search className="h-4 w-4 shrink-0 text-brand-500" />
            搜索聊天
          </button>

          {searchOpen ? (
            <div className="mt-2 flex items-center gap-1 rounded-xl border border-brand-100 bg-white px-2 py-1 shadow-sm shadow-slate-900/5">
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索标题或对话全文…"
                className="min-w-0 flex-1 bg-transparent px-1.5 py-1.5 text-xs text-ink outline-none placeholder:text-slate-400"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-brand-50 hover:text-brand-600"
                  aria-label="清空"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="mt-5 border-t border-slate-200/70 pt-4">
            <div className="px-1 text-xs font-semibold text-slate-400">
              知识库管理
            </div>
            <nav
              className="mt-2 flex flex-col gap-1"
              aria-label="知识库管理"
            >
              <button
                type="button"
                onClick={toggleOverview}
                aria-expanded={overviewExpanded}
                className={[
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition",
                  overviewExpanded
                    ? "bg-white text-ink shadow-sm shadow-slate-900/5 ring-1 ring-brand-100"
                    : "text-slate-600 hover:bg-white hover:text-ink hover:shadow-sm",
                ].join(" ")}
              >
                <Database
                  className="h-4 w-4 shrink-0 text-brand-500"
                  aria-hidden
                />
                <span className="min-w-0 flex-1 line-clamp-2 leading-snug">
                  知识库概览
                </span>
                {overviewExpanded ? (
                  <ChevronDown
                    className="h-4 w-4 shrink-0 text-slate-400"
                    aria-hidden
                  />
                ) : (
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-slate-400"
                    aria-hidden
                  />
                )}
              </button>

              <KnowledgeOverviewInline expanded={overviewExpanded} />

              {KB_AFTER_OVERVIEW.map(({ key, label, icon: Icon }) => {
                const active = knowledgeNavActive === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setOverviewExpanded(false);
                      onKnowledgeNavSelect(key);
                    }}
                    className={[
                      "flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition",
                      active
                        ? "bg-white text-ink shadow-sm shadow-slate-900/5 ring-1 ring-brand-100"
                        : "text-slate-600 hover:bg-white hover:text-ink hover:shadow-sm",
                    ].join(" ")}
                  >
                    <Icon
                      className="h-4 w-4 shrink-0 text-brand-500"
                      aria-hidden
                    />
                    <span className="line-clamp-2 leading-snug">{label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="mt-6 flex shrink-0 items-center justify-between px-1">
            <div className="text-xs font-semibold text-slate-400">
              最近对话
            </div>
            <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-600">
              {recentSorted.length}
            </span>
          </div>
          <div className="sidebar-scroll-area mt-2 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
            {filtered.length === 0 ? (
              <p className="rounded-xl bg-white/60 px-3 py-3 text-xs leading-relaxed text-slate-400">
                {recentSorted.length === 0
                  ? "发送第一条消息后会出现记录"
                  : "没有匹配的对话"}
              </p>
            ) : (
              filtered.map((c) => (
                <ConversationSidebarRow
                  key={c.id}
                  conversation={c}
                  label={conversationListLabel(c)}
                  active={c.id === activeConversationId}
                  onSelect={() => {
                    setOverviewExpanded(false);
                    const q = searchQuery.trim();
                    onSelectConversation(c.id, {
                      jumpToSearchQuery:
                        searchOpen && q.length > 0 ? q : undefined,
                    });
                  }}
                  onTogglePin={() => onTogglePinConversation(c.id)}
                  onRename={() =>
                    setRenameModal({
                      id: c.id,
                      draft: conversationListLabel(c),
                    })
                  }
                  onDelete={() => {
                    if (
                      !window.confirm(
                        "确定删除此对话？删除后无法恢复（已持久化的文件将由同步移除）。",
                      )
                    ) {
                      return;
                    }
                    onDeleteConversation(c.id);
                  }}
                />
              ))
            )}
          </div>
        </div>

      </aside>

      {open ? (
        <button
          type="button"
          aria-label="关闭侧边栏"
          className="fixed inset-0 z-30 bg-slate-950/25 backdrop-blur-[1px] md:hidden"
          onClick={onClose}
        />
      ) : null}

      {renameModal ? (
        <div
          className="fixed inset-0 z-[400] flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-sm"
          role="presentation"
          onClick={() => setRenameModal(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-dialog-title"
            className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl shadow-slate-950/15"
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id="rename-dialog-title"
              className="text-sm font-semibold text-ink"
            >
              重命名对话
            </h3>
            <input
              type="text"
              value={renameModal.draft}
              onChange={(e) =>
                setRenameModal((m) =>
                  m ? { ...m, draft: e.target.value } : m,
                )
              }
              className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand-200 focus:ring-4 focus:ring-brand-100/70"
              autoFocus
              placeholder="标题"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const t = renameModal.draft.trim();
                  if (t) {
                    onRenameConversation(renameModal.id, t);
                    setRenameModal(null);
                  }
                }
              }}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-ink"
                onClick={() => setRenameModal(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600"
                onClick={() => {
                  const t = renameModal.draft.trim();
                  if (!t) return;
                  onRenameConversation(renameModal.id, t);
                  setRenameModal(null);
                }}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
