import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Menu } from "lucide-react";
import { ChatInput } from "@/components/ChatInput";
import { Header } from "@/components/Header";
import { MessageList, type SearchJumpPayload } from "@/components/MessageList";
import { PendingReplyStrip } from "@/components/PendingReplyStrip";
import { Toast } from "@/components/Toast";
import { UploadFileKnowledgeModal } from "@/components/UploadFileKnowledgeModal";
import { UploadTextKnowledgeModal } from "@/components/UploadTextKnowledgeModal";
import {
  Sidebar,
  type KnowledgeBaseNavKey,
} from "@/components/Sidebar";
import {
  fetchConversationsBootstrap,
  putConversationsSync,
  streamChatCompletion,
} from "@/lib/api";
import {
  createEmptyConversation,
  trimConversationsForSync,
  truncateTitle,
  withFreshComposeSession,
} from "@/lib/conversationStorage";
import { buildChatHistoryPayload } from "@/lib/chatHistory";
import { getActiveUserContent } from "@/lib/messageTurns";
import type { ChatMessage } from "@/types/chat";
import type { Conversation } from "@/types/conversation";

const SYNC_DEBOUNCE_MS = 450;

function newId() {
  return crypto.randomUUID();
}

function buildUserMessageAfterEdit(
  oldUser: ChatMessage,
  oldAssistant: ChatMessage | null,
  newText: string,
): ChatMessage {
  const snapshot = {
    userContent: oldUser.content,
    assistant: oldAssistant
      ? {
          id: oldAssistant.id,
          content: oldAssistant.content,
          stopped: oldAssistant.stopped,
        }
      : { id: newId(), content: "" },
  };
  const prev = oldUser.editHistory ?? [];
  const editHistory = [...prev, snapshot];
  return {
    id: newId(),
    role: "user",
    content: newText,
    editHistory,
    activeVersionIndex: editHistory.length,
  };
}

function mergeRegeneratedAssistantMessage(
  m: ChatMessage,
  assistantText: string,
  stopped: boolean,
): ChatMessage {
  const prevVers =
    m.regenerateVersions && m.regenerateVersions.length > 0
      ? m.regenerateVersions
      : [{ content: m.content, stopped: m.stopped ?? false }];
  const newVers = [...prevVers, { content: assistantText, stopped }];
  return {
    ...m,
    content: assistantText,
    stopped,
    regenerateVersions: newVers,
    activeRegenerateIndex: newVers.length - 1,
  };
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [persistError, setPersistError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState("");
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  const [streaming, setStreaming] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [webSearchEnabled, setWebSearchEnabled] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const streamSoFarRef = useRef("");

  const [knowledgeNavActive, setKnowledgeNavActive] =
    useState<KnowledgeBaseNavKey | null>(null);
  const [uploadTextModalOpen, setUploadTextModalOpen] = useState(false);
  const [uploadFileModalOpen, setUploadFileModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [searchJump, setSearchJump] = useState<SearchJumpPayload | null>(null);
  /** 非空表示正在对该条助手消息做「重新回答」，等待条与流式输出挂在该轮旁 */
  const [streamingAssistantId, setStreamingAssistantId] = useState<string | null>(
    null,
  );

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId),
    [conversations, activeId],
  );

  const messages: ChatMessage[] = activeConversation?.messages ?? [];

  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setPersistError(null);
        const boot = await fetchConversationsBootstrap();
        if (cancelled) return;

        if (boot.conversations.length > 0) {
          const { conversations: list, activeConversationId: aid } =
            withFreshComposeSession(boot.conversations);
          setConversations(list);
          setActiveId(aid);
          return;
        }

        const empty = createEmptyConversation();
        await putConversationsSync([empty], empty.id);
        if (cancelled) return;
        setConversations([empty]);
        setActiveId(empty.id);
      } catch (e) {
        if (cancelled) return;
        const empty = createEmptyConversation();
        setConversations([empty]);
        setActiveId(empty.id);
        setPersistError(
          e instanceof Error ? e.message : "无法加载或同步历史对话",
        );
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated || conversations.length === 0 || !activeId) return;
    const trimmed = trimConversationsForSync(conversations);
    const syncActive =
      trimmed.some((c) => c.id === activeId) && activeId ? activeId : trimmed[0].id;
    const t = window.setTimeout(() => {
      void putConversationsSync(trimmed, syncActive)
        .then(() => setPersistError(null))
        .catch((err) => {
          setPersistError(
            err instanceof Error ? err.message : "历史记录同步失败",
          );
        });
    }, SYNC_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [conversations, activeId, hydrated]);

  const hasConversation =
    messages.length > 0 || streaming.length > 0;

  const handleNewChat = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming("");
    setError(null);
    setSending(false);
    streamSoFarRef.current = "";

    const next = createEmptyConversation();
    setConversations((prev) => {
      const rest = prev.filter((c) => !(c.messages.length === 0 && c.id === activeId));
      return [next, ...rest];
    });
    setActiveId(next.id);
    setSidebarOpen(false);
    setKnowledgeNavActive(null);
  };

  const handleTogglePinConversation = useCallback((id: string) => {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const nextPinned = !c.pinned;
        return {
          ...c,
          pinned: nextPinned || undefined,
          pinnedAt: nextPinned ? Date.now() : undefined,
        };
      }),
    );
  }, []);

  const handleRenameConversation = useCallback((id: string, title: string) => {
    const t = title.trim();
    if (!t) return;
    setConversations((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, title: t, updatedAt: Date.now() } : c,
      ),
    );
  }, []);

  const handleDeleteConversation = useCallback((id: string) => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming("");
    setSending(false);
    setError(null);
    streamSoFarRef.current = "";
    setStreamingAssistantId(null);

    setConversations((prev) => {
      const filtered = prev.filter((c) => c.id !== id);
      if (filtered.length === 0) {
        const empty = createEmptyConversation();
        setActiveId(empty.id);
        return [empty];
      }
      if (activeIdRef.current === id) {
        setActiveId(filtered[0].id);
      }
      return filtered;
    });
  }, []);

  const handleSelectConversation = (
    id: string,
    options?: { jumpToSearchQuery?: string },
  ) => {
    const jump = options?.jumpToSearchQuery?.trim();
    const shouldJump = Boolean(jump && jump.length > 0);

    if (id !== activeId) {
      abortRef.current?.abort();
      abortRef.current = null;
      setStreaming("");
      setSending(false);
      setError(null);
      streamSoFarRef.current = "";
      setActiveId(id);
      setSidebarOpen(false);
      setKnowledgeNavActive(null);
      if (shouldJump && jump) {
        setSearchJump({ query: jump, key: Date.now() });
      } else {
        setSearchJump(null);
      }
      return;
    }

    setSidebarOpen(false);
    if (shouldJump && jump) {
      setSearchJump({ query: jump, key: Date.now() });
    }
  };

  const handleKnowledgeNavSelect = (key: KnowledgeBaseNavKey) => {
    setKnowledgeNavActive(key);
    if (key === "uploadText") {
      setUploadTextModalOpen(true);
    }
    if (key === "uploadFile") {
      setUploadFileModalOpen(true);
    }
  };

  const handleUploadTextModalClose = () => {
    setUploadTextModalOpen(false);
    setKnowledgeNavActive(null);
  };

  const handleUploadFileModalClose = () => {
    setUploadFileModalOpen(false);
    setKnowledgeNavActive(null);
  };

  const handleTextDocumentCreated = (documentName: string) => {
    setToastMessage(`文档「${documentName}」上传与创建完成`);
  };

  const handleFileDocumentCreated = (documentName: string) => {
    setToastMessage(`文档「${documentName}」上传与创建完成`);
  };

  const dismissToast = useCallback(() => setToastMessage(null), []);

  const clearSearchJump = useCallback(() => setSearchJump(null), []);

  const handleStopGeneration = () => {
    abortRef.current?.abort();
  };

  const runAssistantStream = useCallback(
    async (
      userText: string,
      sessionForRequest: string,
      options?: { replaceAssistantMessageId?: string; history?: string },
    ) => {
      const replaceAssistantMessageId = options?.replaceAssistantMessageId;
      const historyJson = options?.history ?? "[]";

      setStreamingAssistantId(replaceAssistantMessageId ?? null);

      setStreaming("");
      streamSoFarRef.current = "";

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      let assistant = "";

      try {
        await streamChatCompletion(
          userText,
          sessionForRequest,
          webSearchEnabled,
          {
            onSession: (sid) => {
              const aid = activeIdRef.current;
              setConversations((prev) =>
                prev.map((c) =>
                  c.id === aid ? { ...c, sessionId: sid, updatedAt: Date.now() } : c,
                ),
              );
            },
            onDelta: (chunk) => {
              assistant += chunk;
              streamSoFarRef.current = assistant;
              setStreaming(assistant);
            },
            onDone: () => {
              const aid = activeIdRef.current;
              setConversations((prev) =>
                prev.map((c) => {
                  if (c.id !== aid) return c;
                  if (replaceAssistantMessageId) {
                    return {
                      ...c,
                      messages: c.messages.map((m) =>
                        m.id === replaceAssistantMessageId && m.role === "assistant"
                          ? mergeRegeneratedAssistantMessage(m, assistant, false)
                          : m,
                      ),
                      updatedAt: Date.now(),
                    };
                  }
                  return {
                    ...c,
                    messages: [
                      ...c.messages,
                      { id: newId(), role: "assistant", content: assistant },
                    ],
                    updatedAt: Date.now(),
                  };
                }),
              );
              setStreaming("");
              setSending(false);
              streamSoFarRef.current = "";
              abortRef.current = null;
              setStreamingAssistantId(null);
            },
            onError: (detail) => {
              setError(detail);
              setSending(false);
              setStreaming("");
              streamSoFarRef.current = "";
              abortRef.current = null;
              setStreamingAssistantId(null);
            },
          },
          ac.signal,
          historyJson,
        );
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          const aid = activeIdRef.current;
          const partial = streamSoFarRef.current;
          if (partial.trim().length > 0) {
            setConversations((prev) =>
              prev.map((c) => {
                if (c.id !== aid) return c;
                if (replaceAssistantMessageId) {
                  return {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === replaceAssistantMessageId && m.role === "assistant"
                        ? mergeRegeneratedAssistantMessage(m, partial, true)
                        : m,
                    ),
                    updatedAt: Date.now(),
                  };
                }
                return {
                  ...c,
                  messages: [
                    ...c.messages,
                    {
                      id: newId(),
                      role: "assistant",
                      content: partial,
                      stopped: true,
                    },
                  ],
                  updatedAt: Date.now(),
                };
              }),
            );
          }
          setStreaming("");
          setSending(false);
          streamSoFarRef.current = "";
          abortRef.current = null;
          setStreamingAssistantId(null);
          return;
        }
        setError(e instanceof Error ? e.message : "网络异常");
        setSending(false);
        setStreaming("");
        streamSoFarRef.current = "";
        abortRef.current = null;
        setStreamingAssistantId(null);
      }
    },
    [webSearchEnabled],
  );

  const handleSend = async (text: string) => {
    const cid = activeIdRef.current;
    const convBefore = conversations.find((c) => c.id === cid);
    const sessionForRequest = convBefore?.sessionId ?? "";
    const priorMessages = convBefore?.messages ?? [];
    const historyJson = buildChatHistoryPayload(priorMessages);

    setError(null);
    setSending(true);

    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== cid) return c;
        const hasPriorUser = c.messages.some((m) => m.role === "user");
        return {
          ...c,
          title: !hasPriorUser ? truncateTitle(text) : c.title,
          messages: [...c.messages, { id: newId(), role: "user", content: text }],
          updatedAt: Date.now(),
        };
      }),
    );

    await runAssistantStream(text, sessionForRequest, { history: historyJson });
  };

  const handleEditUserMessage = async (userMessageId: string, newText: string) => {
    const cid = activeIdRef.current;
    const prep = {
      ok: false as boolean,
      session: "",
      streamText: newText,
      history: "[]",
    };

    abortRef.current?.abort();
    abortRef.current = null;
    streamSoFarRef.current = "";

    setConversations((prev) => {
      const c = prev.find((x) => x.id === cid);
      if (!c) return prev;
      const userIdx = c.messages.findIndex(
        (m) => m.id === userMessageId && m.role === "user",
      );
      if (userIdx < 0) return prev;
      prep.ok = true;
      prep.session = c.sessionId;
      const oldUser = c.messages[userIdx];
      const oldAsst =
        c.messages[userIdx + 1]?.role === "assistant"
          ? c.messages[userIdx + 1]
          : null;
      const newUser = buildUserMessageAfterEdit(oldUser, oldAsst, newText);
      prep.streamText = newUser.content;
      const head = c.messages.slice(0, userIdx);
      prep.history = buildChatHistoryPayload(head);
      return prev.map((x) =>
        x.id !== cid
          ? x
          : {
              ...x,
              messages: [...head, newUser],
              title: userIdx === 0 ? truncateTitle(newText) : x.title,
              updatedAt: Date.now(),
            },
      );
    });

    if (!prep.ok) return;

    setError(null);
    setSending(true);
    setStreaming("");

    await runAssistantStream(prep.streamText, prep.session, {
      history: prep.history,
    });
  };

  const handleUserVersionChange = useCallback((userMessageId: string, newIndex: number) => {
    const cid = activeIdRef.current;
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== cid) return c;
        return {
          ...c,
          messages: c.messages.map((m) =>
            m.id === userMessageId && m.role === "user"
              ? { ...m, activeVersionIndex: newIndex }
              : m,
          ),
          updatedAt: Date.now(),
        };
      }),
    );
  }, []);

  const handleAssistantVariantChange = useCallback(
    (assistantMessageId: string, newIndex: number) => {
      const cid = activeIdRef.current;
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== cid) return c;
          return {
            ...c,
            messages: c.messages.map((m) => {
              if (m.id !== assistantMessageId || m.role !== "assistant") return m;
              const vs = m.regenerateVersions;
              const max = vs && vs.length > 0 ? vs.length - 1 : 0;
              const safe = Math.min(Math.max(0, newIndex), max);
              return { ...m, activeRegenerateIndex: safe };
            }),
            updatedAt: Date.now(),
          };
        }),
      );
    },
    [],
  );

  const handleRegenerateAssistant = useCallback(
    async (assistantMessageId: string) => {
      const cid = activeIdRef.current;
      const conv = conversationsRef.current.find((x) => x.id === cid);
      if (!conv) return;
      const ai = conv.messages.findIndex(
        (m) => m.id === assistantMessageId && m.role === "assistant",
      );
      if (ai <= 0) return;
      const userMsg = conv.messages[ai - 1];
      if (userMsg.role !== "user") return;
      const userText = getActiveUserContent(userMsg).trim();
      if (!userText) return;

      const historyJson = buildChatHistoryPayload(conv.messages.slice(0, ai - 1));

      abortRef.current?.abort();
      abortRef.current = null;
      streamSoFarRef.current = "";

      setError(null);
      setSending(true);
      setStreaming("");

      await runAssistantStream(userText, conv.sessionId, {
        replaceAssistantMessageId: assistantMessageId,
        history: historyJson,
      });
    },
    [runAssistantStream],
  );

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white px-4">
        <p className="rounded-full border border-brand-100 bg-white px-4 py-2 text-sm font-medium text-slate-500 shadow-soft">正在载入历史对话…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen overflow-x-hidden bg-white text-ink">
      <Toast message={toastMessage} onDismiss={dismissToast} />

      <UploadTextKnowledgeModal
        open={uploadTextModalOpen}
        onClose={handleUploadTextModalClose}
        onCreated={handleTextDocumentCreated}
      />

      <UploadFileKnowledgeModal
        open={uploadFileModalOpen}
        onClose={handleUploadFileModalClose}
        onCreated={handleFileDocumentCreated}
      />

      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onNewChat={handleNewChat}
        conversations={conversations}
        activeConversationId={activeId}
        onSelectConversation={handleSelectConversation}
        knowledgeNavActive={knowledgeNavActive}
        onKnowledgeNavSelect={handleKnowledgeNavSelect}
        onTogglePinConversation={handleTogglePinConversation}
        onRenameConversation={handleRenameConversation}
        onDeleteConversation={handleDeleteConversation}
      />

      <div className="relative flex min-w-0 flex-1 flex-col bg-white md:ml-[298px]">
        <Header />

        {persistError ? (
          <div className="shrink-0 border-b border-amber-200 bg-amber-50/90 px-4 py-2 text-center text-xs text-amber-900">
            {persistError}（仅本页有效，刷新可重试）
          </div>
        ) : null}

        <div className="flex shrink-0 items-center px-3 py-2 md:hidden">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 transition hover:bg-brand-50 hover:text-brand-600"
            aria-label="打开侧边栏"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>

        <main className="flex flex-1 flex-col bg-white">
          {!hasConversation ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 pb-12 pt-10 text-center">
              <div className="inline-flex rounded-full border border-brand-100 bg-white px-4 py-1.5 text-xs font-semibold text-brand-600 shadow-sm shadow-brand-500/10">
                RAG 知识库 · 联网检索 · 流式回答
              </div>
              <h1 className="mt-6 text-center text-4xl font-bold tracking-tight text-ink md:text-5xl">
                我们先从哪里开始呢？
              </h1>
              
              <div className="mt-7 w-full">
                <ChatInput
                  disabled={sending}
                  isReceiving={sending}
                  onStop={handleStopGeneration}
                  webSearchEnabled={webSearchEnabled}
                  onWebSearchChange={setWebSearchEnabled}
                  onSend={handleSend}
                />
              </div>
            </div>
          ) : (
            <>
              <div className="pb-[184px]">
                <MessageList
                  messages={messages}
                  streamingText={streaming}
                  sending={sending}
                  streamingAssistantId={streamingAssistantId}
                  searchJump={searchJump}
                  onSearchJumpHandled={clearSearchJump}
                  onEditUserMessage={handleEditUserMessage}
                  onUserVersionChange={handleUserVersionChange}
                  onRegenerateAssistant={handleRegenerateAssistant}
                  onAssistantVariantChange={handleAssistantVariantChange}
                  onCopied={() => setToastMessage("已复制到剪贴板")}
                />
                {sending && streaming.length === 0 && streamingAssistantId === null ? (
                  <PendingReplyStrip />
                ) : null}

                {error ? (
                  <div className="px-4 pb-2">
                    <div className="mx-auto max-w-3xl rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 shadow-sm">
                      {error}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="fixed bottom-0 left-0 right-0 z-20 bg-white md:left-[298px]">
                <ChatInput
                  disabled={sending}
                  isReceiving={sending}
                  onStop={handleStopGeneration}
                  webSearchEnabled={webSearchEnabled}
                  onWebSearchChange={setWebSearchEnabled}
                  onSend={handleSend}
                />
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
