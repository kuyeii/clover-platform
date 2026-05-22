import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "../../shared/components/Icon";
import { ChatInput } from "./components/ChatInput";
import { KnowledgeDocuments } from "./components/KnowledgeDocuments";
import { MessageList } from "./components/MessageList";
import { SessionList } from "./components/SessionList";
import {
  createRagSession,
  fetchConversationsBootstrap,
  fetchRagHealth,
  putConversationsSync,
  streamChatCompletion,
} from "./services/ragApi";
import type { ChatMessage, Conversation } from "./types";
import {
  buildChatHistoryPayload,
  buildUserMessageAfterEdit,
  createEmptyConversation,
  getActiveUserContent,
  mergeRegeneratedAssistantMessage,
  newClientId,
  trimConversationsForSync,
  truncateTitle,
  withFreshComposeSession,
} from "./utils";

const SYNC_DEBOUNCE_MS = 450;

function newMessageId() {
  return newClientId();
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

async function createConversationShell(): Promise<{ conversation: Conversation; warning: string }> {
  const conversation = createEmptyConversation();
  try {
    const payload = await createRagSession();
    if (payload.session_id) {
      return { conversation: { ...conversation, sessionId: payload.session_id }, warning: "" };
    }
  } catch (error) {
    return { conversation, warning: getErrorMessage(error, "新建 RAG session 失败，已使用本地会话继续。") };
  }
  return { conversation, warning: "" };
}

export function RagPage() {
  const [hydrated, setHydrated] = useState(false);
  const [healthError, setHealthError] = useState("");
  const [persistError, setPersistError] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState("");
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  const [streaming, setStreaming] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingAssistantId, setStreamingAssistantId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [webSearchEnabled, setWebSearchEnabled] = useState(true);
  const [knowledgeRefreshSignal, setKnowledgeRefreshSignal] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const streamSoFarRef = useRef("");
  const streamConversationIdRef = useRef("");
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeId) || null,
    [activeId, conversations],
  );
  const messages: ChatMessage[] = activeConversation?.messages ?? [];

  const loadConversations = useCallback(async () => {
    setHydrated(false);
    setPersistError("");
    try {
      const [boot] = await Promise.all([
        fetchConversationsBootstrap(),
        fetchRagHealth().catch((healthLoadError) => {
          setHealthError(getErrorMessage(healthLoadError, "RAG health 检查失败。"));
          return null;
        }),
      ]);

      if (boot.conversations.length > 0) {
        const next = withFreshComposeSession(boot.conversations);
        try {
          const payload = await createRagSession();
          if (payload.session_id) {
            next.conversations = next.conversations.map((conversation) =>
              conversation.id === next.activeConversationId
                ? { ...conversation, sessionId: payload.session_id }
                : conversation,
            );
          }
        } catch {
          // The first real chat request can still use the local UUID; surface hard failures during send.
        }
        setConversations(next.conversations);
        setActiveId(next.activeConversationId);
      } else {
        const { conversation: empty, warning } = await createConversationShell();
        if (warning) {
          setPersistError(warning);
        }
        await putConversationsSync([empty], empty.id);
        setConversations([empty]);
        setActiveId(empty.id);
      }
    } catch (loadError) {
      const empty = createEmptyConversation();
      setConversations([empty]);
      setActiveId(empty.id);
      setPersistError(getErrorMessage(loadError, "无法加载或同步历史对话。"));
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    void loadConversations();
    return () => {
      abortRef.current?.abort();
    };
  }, [loadConversations]);

  useEffect(() => {
    if (!hydrated || conversations.length === 0 || !activeId) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      const trimmed = trimConversationsForSync(conversations);
      const syncActive = trimmed.some((conversation) => conversation.id === activeId)
        ? activeId
        : trimmed[0]?.id || activeId;
      void putConversationsSync(trimmed, syncActive)
        .then(() => setPersistError(""))
        .catch((syncError) => setPersistError(getErrorMessage(syncError, "历史记录同步失败。")));
    }, SYNC_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [activeId, conversations, hydrated]);

  const resetStream = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    streamConversationIdRef.current = "";
    streamSoFarRef.current = "";
    setStreaming("");
    setSending(false);
    setStreamingAssistantId(null);
  }, []);

  const handleNewChat = async () => {
    resetStream();
    setError("");
    const { conversation: next, warning } = await createConversationShell();
    if (warning) {
      setPersistError(warning);
    }
    setConversations((current) => {
      const rest = current.filter((conversation) => !(conversation.messages.length === 0 && conversation.id === activeIdRef.current));
      return [next, ...rest];
    });
    setActiveId(next.id);
  };

  const handleSelectConversation = (id: string) => {
    if (id === activeIdRef.current) {
      return;
    }
    resetStream();
    setError("");
    setActiveId(id);
  };

  const handleTogglePinConversation = useCallback((id: string) => {
    setConversations((current) =>
      current.map((conversation) => {
        if (conversation.id !== id) {
          return conversation;
        }
        const pinned = !conversation.pinned;
        return {
          ...conversation,
          pinned: pinned || undefined,
          pinnedAt: pinned ? Date.now() : undefined,
          updatedAt: Date.now(),
        };
      }),
    );
  }, []);

  const handleRenameConversation = useCallback((id: string, title: string) => {
    const normalized = title.trim();
    if (!normalized) {
      return;
    }
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === id ? { ...conversation, title: normalized, updatedAt: Date.now() } : conversation,
      ),
    );
  }, []);

  const handleDeleteConversation = useCallback((id: string) => {
    resetStream();
    setError("");
    setConversations((current) => {
      const filtered = current.filter((conversation) => conversation.id !== id);
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
  }, [resetStream]);

  const runAssistantStream = useCallback(
    async (
      conversationId: string,
      userText: string,
      sessionForRequest: string,
      options?: { replaceAssistantMessageId?: string; history?: string },
    ) => {
      const replaceAssistantMessageId = options?.replaceAssistantMessageId;
      const historyJson = options?.history ?? "[]";

      setStreamingAssistantId(replaceAssistantMessageId ?? null);
      setStreaming("");
      streamSoFarRef.current = "";
      streamConversationIdRef.current = conversationId;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      let assistant = "";

      try {
        await streamChatCompletion(
          userText,
          sessionForRequest,
          webSearchEnabled,
          {
            onSession: (sessionId) => {
              if (streamConversationIdRef.current !== conversationId) {
                return;
              }
              setConversations((current) =>
                current.map((conversation) =>
                  conversation.id === conversationId
                    ? { ...conversation, sessionId, updatedAt: Date.now() }
                    : conversation,
                ),
              );
            },
            onDelta: (chunk) => {
              if (streamConversationIdRef.current !== conversationId) {
                return;
              }
              assistant += chunk;
              streamSoFarRef.current = assistant;
              setStreaming(assistant);
            },
            onDone: () => {
              if (streamConversationIdRef.current !== conversationId) {
                return;
              }
              setConversations((current) =>
                current.map((conversation) => {
                  if (conversation.id !== conversationId) {
                    return conversation;
                  }
                  if (replaceAssistantMessageId) {
                    return {
                      ...conversation,
                      messages: conversation.messages.map((message) =>
                        message.id === replaceAssistantMessageId && message.role === "assistant"
                          ? mergeRegeneratedAssistantMessage(message, assistant, false)
                          : message,
                      ),
                      updatedAt: Date.now(),
                    };
                  }
                  return {
                    ...conversation,
                    messages: [
                      ...conversation.messages,
                      { id: newMessageId(), role: "assistant", content: assistant },
                    ],
                    updatedAt: Date.now(),
                  };
                }),
              );
              setStreaming("");
              setSending(false);
              streamSoFarRef.current = "";
              streamConversationIdRef.current = "";
              abortRef.current = null;
              setStreamingAssistantId(null);
            },
            onError: (detail) => {
              if (streamConversationIdRef.current !== conversationId) {
                return;
              }
              setError(detail || "上游服务错误。");
              setSending(false);
              setStreaming("");
              streamSoFarRef.current = "";
              streamConversationIdRef.current = "";
              abortRef.current = null;
              setStreamingAssistantId(null);
            },
          },
          controller.signal,
          historyJson,
        );
      } catch (streamError) {
        if (isAbortError(streamError)) {
          const partial = streamSoFarRef.current;
          if (partial.trim()) {
            setConversations((current) =>
              current.map((conversation) => {
                if (conversation.id !== conversationId) {
                  return conversation;
                }
                if (replaceAssistantMessageId) {
                  return {
                    ...conversation,
                    messages: conversation.messages.map((message) =>
                      message.id === replaceAssistantMessageId && message.role === "assistant"
                        ? mergeRegeneratedAssistantMessage(message, partial, true)
                        : message,
                    ),
                    updatedAt: Date.now(),
                  };
                }
                return {
                  ...conversation,
                  messages: [
                    ...conversation.messages,
                    { id: newMessageId(), role: "assistant", content: partial, stopped: true },
                  ],
                  updatedAt: Date.now(),
                };
              }),
            );
          }
        } else {
          setError(getErrorMessage(streamError, "网络异常。"));
        }
        setSending(false);
        setStreaming("");
        streamSoFarRef.current = "";
        streamConversationIdRef.current = "";
        abortRef.current = null;
        setStreamingAssistantId(null);
      }
    },
    [webSearchEnabled],
  );

  const handleSend = async (text: string) => {
    const conversationId = activeIdRef.current;
    const conversationBefore = conversationsRef.current.find((conversation) => conversation.id === conversationId);
    const priorMessages = conversationBefore?.messages ?? [];
    const sessionForRequest = conversationBefore?.sessionId ?? "";
    const history = buildChatHistoryPayload(priorMessages);

    setError("");
    setSending(true);
    setConversations((current) =>
      current.map((conversation) => {
        if (conversation.id !== conversationId) {
          return conversation;
        }
        const hasPriorUser = conversation.messages.some((message) => message.role === "user");
        return {
          ...conversation,
          title: hasPriorUser ? conversation.title : truncateTitle(text),
          messages: [...conversation.messages, { id: newMessageId(), role: "user", content: text }],
          updatedAt: Date.now(),
        };
      }),
    );
    await runAssistantStream(conversationId, text, sessionForRequest, { history });
  };

  const handleEditUserMessage = async (userMessageId: string, newText: string) => {
    const conversationId = activeIdRef.current;
    let prepared: { ok: boolean; session: string; streamText: string; history: string } = {
      ok: false,
      session: "",
      streamText: newText,
      history: "[]",
    };
    resetStream();

    setConversations((current) => {
      const conversation = current.find((item) => item.id === conversationId);
      if (!conversation) {
        return current;
      }
      const userIndex = conversation.messages.findIndex((message) => message.id === userMessageId && message.role === "user");
      if (userIndex < 0) {
        return current;
      }
      const oldUser = conversation.messages[userIndex];
      const oldAssistant = conversation.messages[userIndex + 1]?.role === "assistant" ? conversation.messages[userIndex + 1] : null;
      const newUser = buildUserMessageAfterEdit(oldUser, oldAssistant, newText);
      const head = conversation.messages.slice(0, userIndex);
      prepared = {
        ok: true,
        session: conversation.sessionId,
        streamText: newUser.content,
        history: buildChatHistoryPayload(head),
      };
      return current.map((item) =>
        item.id === conversationId
          ? {
              ...item,
              messages: [...head, newUser],
              title: userIndex === 0 ? truncateTitle(newText) : item.title,
              updatedAt: Date.now(),
            }
          : item,
      );
    });

    if (!prepared.ok) {
      return;
    }
    setError("");
    setSending(true);
    await runAssistantStream(conversationId, prepared.streamText, prepared.session, { history: prepared.history });
  };

  const handleUserVersionChange = useCallback((userMessageId: string, nextIndex: number) => {
    const conversationId = activeIdRef.current;
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              messages: conversation.messages.map((message) =>
                message.id === userMessageId && message.role === "user"
                  ? { ...message, activeVersionIndex: nextIndex }
                  : message,
              ),
              updatedAt: Date.now(),
            }
          : conversation,
      ),
    );
  }, []);

  const handleAssistantVariantChange = useCallback((assistantMessageId: string, nextIndex: number) => {
    const conversationId = activeIdRef.current;
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              messages: conversation.messages.map((message) => {
                if (message.id !== assistantMessageId || message.role !== "assistant") {
                  return message;
                }
                const max = message.regenerateVersions?.length ? message.regenerateVersions.length - 1 : 0;
                return { ...message, activeRegenerateIndex: Math.max(0, Math.min(nextIndex, max)) };
              }),
              updatedAt: Date.now(),
            }
          : conversation,
      ),
    );
  }, []);

  const handleRegenerateAssistant = useCallback(
    async (assistantMessageId: string) => {
      const conversationId = activeIdRef.current;
      const conversation = conversationsRef.current.find((item) => item.id === conversationId);
      if (!conversation) {
        return;
      }
      const assistantIndex = conversation.messages.findIndex(
        (message) => message.id === assistantMessageId && message.role === "assistant",
      );
      if (assistantIndex <= 0) {
        return;
      }
      const userMessage = conversation.messages[assistantIndex - 1];
      if (userMessage.role !== "user") {
        return;
      }
      const userText = getActiveUserContent(userMessage).trim();
      if (!userText) {
        return;
      }
      resetStream();
      setError("");
      setSending(true);
      await runAssistantStream(conversationId, userText, conversation.sessionId, {
        replaceAssistantMessageId: assistantMessageId,
        history: buildChatHistoryPayload(conversation.messages.slice(0, assistantIndex - 1)),
      });
    },
    [resetStream, runAssistantStream],
  );

  if (!hydrated) {
    return (
      <section className="page-center-state">
        <div className="loading-spinner" />
        正在载入 RAG 历史对话...
      </section>
    );
  }

  const hasConversation = messages.length > 0 || streaming.length > 0 || sending;

  return (
    <section className="rag-page">
      <header className="page-hero compact rag-hero">
        <div>
          <span className="eyebrow">RAG</span>
          <h1>RAG 问答</h1>
          <p>原生接入 apps/api 的会话、流式问答和 Dify Dataset 知识库文档能力。</p>
        </div>
        <div className="hero-metrics">
          <div>
            <span>对话</span>
            <strong>{Math.max(0, conversations.filter((conversation) => conversation.messages.length > 0).length)}</strong>
          </div>
          <div>
            <span>联网</span>
            <strong>{webSearchEnabled ? "开" : "关"}</strong>
          </div>
        </div>
      </header>

      {healthError ? (
        <div className="notice warning">
          <span>{healthError}</span>
          <button type="button" className="ghost-button" onClick={() => setHealthError("")}>
            忽略
          </button>
        </div>
      ) : null}
      {persistError ? <div className="notice warning">{persistError}</div> : null}

      <div className="rag-layout">
        <SessionList
          conversations={conversations}
          activeConversationId={activeId}
          onNewChat={() => void handleNewChat()}
          onSelectConversation={handleSelectConversation}
          onTogglePinConversation={handleTogglePinConversation}
          onRenameConversation={handleRenameConversation}
          onDeleteConversation={handleDeleteConversation}
        />

        <main className="rag-chat-panel">
          {!hasConversation ? (
            <section className="rag-empty">
              <span className="module-icon">
                <Icon name="message" />
              </span>
              <h2>从一个问题开始</h2>
              <p>支持知识库问答、联网检索和 SSE 流式输出。</p>
            </section>
          ) : (
            <MessageList
              messages={messages}
              streamingText={streaming}
              sending={sending}
              streamingAssistantId={streamingAssistantId}
              onEditUserMessage={handleEditUserMessage}
              onUserVersionChange={handleUserVersionChange}
              onRegenerateAssistant={(assistantMessageId) => void handleRegenerateAssistant(assistantMessageId)}
              onAssistantVariantChange={handleAssistantVariantChange}
            />
          )}
          {error ? (
            <div className="rag-stream-error">
              <Icon name="shield" />
              <span>{error}</span>
            </div>
          ) : null}
          <ChatInput
            disabled={sending}
            isReceiving={sending}
            webSearchEnabled={webSearchEnabled}
            onWebSearchChange={setWebSearchEnabled}
            onStop={() => abortRef.current?.abort()}
            onSend={(text) => void handleSend(text)}
          />
        </main>

        <KnowledgeDocuments
          refreshSignal={knowledgeRefreshSignal}
          onCreated={() => setKnowledgeRefreshSignal((current) => current + 1)}
        />
      </div>
    </section>
  );
}
