import type { ChatMessage, Conversation, UserTurnSnapshot } from "./types";

export const MAX_CONVERSATIONS = 80;
export const CHAT_HISTORY_SYSTEM_PROMPT = "你是一个机器人助手";

const MAX_PRIOR_ROUNDS = 3;

export function newClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    const nibble = char === "x" ? value : (value & 0x3) | 0x8;
    return nibble.toString(16);
  });
}

export function truncateTitle(text: string, maxChars = 28): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  const chars = [...normalized];
  if (chars.length <= maxChars) {
    return normalized;
  }
  return `${chars.slice(0, maxChars).join("")}...`;
}

export function createEmptyConversation(): Conversation {
  const now = Date.now();
  return {
    id: newClientId(),
    title: "",
    sessionId: newClientId(),
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function conversationListLabel(conversation: Conversation): string {
  if (conversation.title.trim()) {
    return conversation.title;
  }
  const first = conversation.messages.find((message) => message.role === "user")?.content ?? "";
  return first.trim() ? truncateTitle(first) : "（空白对话）";
}

export function sortConversationsForSidebar(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => {
    const pinnedDiff = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
    if (pinnedDiff !== 0) {
      return pinnedDiff;
    }
    if (a.pinned && b.pinned) {
      return (b.pinnedAt ?? b.updatedAt) - (a.pinnedAt ?? a.updatedAt);
    }
    return b.updatedAt - a.updatedAt;
  });
}

export function trimConversationsForSync(list: Conversation[]): Conversation[] {
  const pinned = list.filter((conversation) => conversation.pinned);
  const unpinned = list.filter((conversation) => !conversation.pinned);
  const pinnedSorted = [...pinned].sort(
    (a, b) => (b.pinnedAt ?? b.updatedAt) - (a.pinnedAt ?? a.updatedAt),
  );
  if (pinnedSorted.length >= MAX_CONVERSATIONS) {
    return pinnedSorted.slice(0, MAX_CONVERSATIONS);
  }
  const unpinnedSorted = [...unpinned].sort((a, b) => b.updatedAt - a.updatedAt);
  return [...pinnedSorted, ...unpinnedSorted.slice(0, MAX_CONVERSATIONS - pinnedSorted.length)];
}

export function withFreshComposeSession(list: Conversation[]): {
  conversations: Conversation[];
  activeConversationId: string;
} {
  const fresh = createEmptyConversation();
  const rest = list.filter((conversation) => conversation.messages.length > 0);
  return {
    conversations: [fresh, ...rest],
    activeConversationId: fresh.id,
  };
}

export interface MessageTurn {
  user: ChatMessage;
  assistant: ChatMessage | null;
}

export function messagesToTurns(messages: ChatMessage[]): MessageTurn[] {
  const turns: MessageTurn[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role !== "user") {
      continue;
    }
    const next = messages[index + 1];
    const assistant = next?.role === "assistant" ? next : null;
    turns.push({ user: message, assistant });
    if (assistant) {
      index += 1;
    }
  }
  return turns;
}

export function getActiveUserContent(user: ChatMessage): string {
  const history = user.editHistory ?? [];
  const index = user.activeVersionIndex ?? history.length;
  if (index < history.length) {
    return history[index].userContent;
  }
  return user.content;
}

export function getActiveAssistantForTurn(
  user: ChatMessage,
  linearAssistant: ChatMessage | null,
): ChatMessage | null {
  const history = user.editHistory ?? [];
  const index = user.activeVersionIndex ?? history.length;
  if (index < history.length) {
    const assistant = history[index].assistant;
    return {
      id: assistant.id,
      role: "assistant",
      content: assistant.content,
      stopped: assistant.stopped,
    };
  }
  return linearAssistant;
}

export function getAssistantDisplayedContent(message: ChatMessage): string {
  if (message.role !== "assistant") {
    return message.content;
  }
  const versions = message.regenerateVersions;
  if (!versions || versions.length === 0) {
    return message.content;
  }
  const index = message.activeRegenerateIndex ?? versions.length - 1;
  const safeIndex = Math.max(0, Math.min(index, versions.length - 1));
  return versions[safeIndex].content;
}

export function assistantStoppedForDisplay(message: ChatMessage): boolean | undefined {
  if (message.role !== "assistant") {
    return message.stopped;
  }
  const versions = message.regenerateVersions;
  if (!versions || versions.length === 0) {
    return message.stopped;
  }
  const index = message.activeRegenerateIndex ?? versions.length - 1;
  const safeIndex = Math.max(0, Math.min(index, versions.length - 1));
  return versions[safeIndex]?.stopped ?? message.stopped;
}

export function assistantVariantCount(message: ChatMessage): number {
  if (message.role !== "assistant" || !message.regenerateVersions?.length) {
    return 1;
  }
  return message.regenerateVersions.length;
}

export function assistantActiveVariantIndex(message: ChatMessage): number {
  if (message.role !== "assistant" || !message.regenerateVersions?.length) {
    return 0;
  }
  return message.activeRegenerateIndex ?? message.regenerateVersions.length - 1;
}

export function userTurnVersionCount(user: ChatMessage): number {
  return (user.editHistory?.length ?? 0) + 1;
}

export function userTurnActiveIndex(user: ChatMessage): number {
  const history = user.editHistory ?? [];
  return user.activeVersionIndex ?? history.length;
}

export function buildChatHistoryPayload(priorMessages: ChatMessage[]): string {
  const completeTurns = messagesToTurns(priorMessages).filter((turn) => turn.assistant);
  const lastRounds = completeTurns.slice(-MAX_PRIOR_ROUNDS);
  if (lastRounds.length === 0) {
    return "[]";
  }

  const payload: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: CHAT_HISTORY_SYSTEM_PROMPT },
  ];
  for (const turn of lastRounds) {
    payload.push(
      { role: "user", content: getActiveUserContent(turn.user) },
      { role: "assistant", content: getAssistantDisplayedContent(turn.assistant!) },
    );
  }
  return JSON.stringify(payload);
}

export function buildUserMessageAfterEdit(
  oldUser: ChatMessage,
  oldAssistant: ChatMessage | null,
  newText: string,
): ChatMessage {
  const snapshot: UserTurnSnapshot = {
    userContent: oldUser.content,
    assistant: oldAssistant
      ? {
          id: oldAssistant.id,
          content: oldAssistant.content,
          stopped: oldAssistant.stopped,
        }
      : { id: newClientId(), content: "" },
  };
  const editHistory = [...(oldUser.editHistory ?? []), snapshot];
  return {
    id: newClientId(),
    role: "user",
    content: newText,
    editHistory,
    activeVersionIndex: editHistory.length,
  };
}

export function mergeRegeneratedAssistantMessage(
  message: ChatMessage,
  assistantText: string,
  stopped: boolean,
): ChatMessage {
  const previousVersions =
    message.regenerateVersions && message.regenerateVersions.length > 0
      ? message.regenerateVersions
      : [{ content: message.content, stopped: message.stopped ?? false }];
  const nextVersions = [...previousVersions, { content: assistantText, stopped }];
  return {
    ...message,
    content: assistantText,
    stopped,
    regenerateVersions: nextVersions,
    activeRegenerateIndex: nextVersions.length - 1,
  };
}

export function conversationMatchesSearchText(conversation: Conversation, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase();
  if (!query) {
    return true;
  }
  if (conversationListLabel(conversation).toLowerCase().includes(query)) {
    return true;
  }
  return conversation.messages.some((message) => {
    if (message.content.toLowerCase().includes(query)) {
      return true;
    }
    if (message.role === "user" && message.editHistory) {
      return message.editHistory.some(
        (snapshot) =>
          snapshot.userContent.toLowerCase().includes(query) ||
          snapshot.assistant.content.toLowerCase().includes(query),
      );
    }
    if (message.role === "assistant" && message.regenerateVersions) {
      return message.regenerateVersions.some((version) => version.content.toLowerCase().includes(query));
    }
    return false;
  });
}

export function findFirstMatchingMessageId(messages: ChatMessage[], rawQuery: string): string | null {
  const query = rawQuery.trim().toLowerCase();
  if (!query) {
    return null;
  }
  for (const message of messages) {
    if (message.content.toLowerCase().includes(query)) {
      return message.id;
    }
    if (message.role === "assistant" && message.regenerateVersions) {
      if (message.regenerateVersions.some((version) => version.content.toLowerCase().includes(query))) {
        return message.id;
      }
    }
    if (message.role === "user" && message.editHistory) {
      for (const snapshot of message.editHistory) {
        if (snapshot.userContent.toLowerCase().includes(query)) {
          return message.id;
        }
        if (snapshot.assistant.content.toLowerCase().includes(query)) {
          return snapshot.assistant.id;
        }
      }
    }
  }
  return null;
}

export function formatUnixTime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) {
    return "-";
  }
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString();
}
