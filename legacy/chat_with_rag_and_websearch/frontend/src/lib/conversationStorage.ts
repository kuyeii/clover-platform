import type { Conversation } from "@/types/conversation";
import type { ChatMessage, UserTurnSnapshot } from "@/types/chat";
import { isUuid, newClientId } from "@/lib/id";

/** 仅在从浏览器 localStorage 一次性迁移时使用（旧版本） */
const LEGACY_STORAGE_KEY = "chat_llm_conversations_v1";
const LEGACY_ACTIVE_KEY = "chat_llm_active_conversation_v1";

export const MAX_CONVERSATIONS = 80;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** 侧边栏条目：截取首句，超长加 …（按 Unicode 字符计） */
export function truncateTitle(text: string, maxChars = 28): string {
  const t = text.trim().replace(/\s+/g, " ");
  const chars = [...t];
  if (chars.length <= maxChars) return t;
  return chars.slice(0, maxChars).join("") + "...";
}

function normalizeAssistantSnapshot(
  raw: unknown,
): UserTurnSnapshot["assistant"] | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === "string" ? raw.id : newClientId("snapshot");
  const content = typeof raw.content === "string" ? raw.content : "";
  return {
    id,
    content,
    stopped: raw.stopped === true,
  };
}

function normalizeEditHistory(raw: unknown): UserTurnSnapshot[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: UserTurnSnapshot[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const userContent =
      typeof item.userContent === "string" ? item.userContent : "";
    const asst = normalizeAssistantSnapshot(item.assistant);
    if (!asst) continue;
    out.push({ userContent, assistant: asst });
  }
  return out.length > 0 ? out : undefined;
}

function normalizeLoadedMessage(m: unknown): ChatMessage | null {
  if (!isRecord(m)) return null;
  const id = typeof m.id === "string" ? m.id : newClientId("msg");
  const role = m.role === "user" || m.role === "assistant" ? m.role : null;
  const content = typeof m.content === "string" ? m.content : "";
  if (!role) return null;
  const base: ChatMessage = {
    id,
    role,
    content,
    stopped: m.stopped === true,
  };
  if (role === "user") {
    const hist = normalizeEditHistory(m.editHistory);
    if (hist) base.editHistory = hist;
    const avi = m.activeVersionIndex;
    if (hist && typeof avi === "number" && Number.isFinite(avi)) {
      const max = hist.length;
      base.activeVersionIndex = Math.min(Math.max(0, Math.floor(avi)), max);
    }
  }
  if (role === "assistant") {
    const rawRv = m.regenerateVersions;
    if (Array.isArray(rawRv) && rawRv.length > 0) {
      const vers: { content: string; stopped?: boolean }[] = [];
      for (const v of rawRv) {
        if (!isRecord(v)) continue;
        const content = typeof v.content === "string" ? v.content : "";
        vers.push({ content, stopped: v.stopped === true });
      }
      if (vers.length > 0) base.regenerateVersions = vers;
    }
    const ari = m.activeRegenerateIndex;
    if (typeof ari === "number" && Number.isFinite(ari) && base.regenerateVersions) {
      const max = base.regenerateVersions.length - 1;
      base.activeRegenerateIndex = Math.min(Math.max(0, Math.floor(ari)), max);
    }
  }
  return base;
}

function normalizeConversation(raw: unknown): Conversation | null {
  if (!isRecord(raw)) return null;
  const id =
    typeof raw.id === "string" && isUuid(raw.id)
      ? raw.id
      : newClientId("conversation");
  const sessionId =
    typeof raw.sessionId === "string" && isUuid(raw.sessionId)
      ? raw.sessionId
      : newClientId("session");
  const title = typeof raw.title === "string" ? raw.title : "";
  const createdAt = typeof raw.createdAt === "number" ? raw.createdAt : Date.now();
  const updatedAt = typeof raw.updatedAt === "number" ? raw.updatedAt : createdAt;
  const msgArr = Array.isArray(raw.messages) ? raw.messages : [];
  const messages = msgArr.map(normalizeLoadedMessage).filter(Boolean) as ChatMessage[];
  const pinned = raw.pinned === true;
  const pinnedAtRaw = raw.pinnedAt;
  const pinnedAt =
    typeof pinnedAtRaw === "number" && Number.isFinite(pinnedAtRaw)
      ? pinnedAtRaw
      : undefined;
  return {
    id,
    title,
    sessionId,
    messages,
    createdAt,
    updatedAt,
    ...(pinned ? { pinned: true, pinnedAt: pinnedAt ?? updatedAt } : {}),
  };
}

/** 侧边栏「最近」：置顶在前，按 pinnedAt 倒序；其余按 updatedAt 倒序 */
export function sortConversationsForSidebar(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => {
    const ap = a.pinned ? 1 : 0;
    const bp = b.pinned ? 1 : 0;
    if (ap !== bp) return bp - ap;
    if (a.pinned && b.pinned) {
      return (b.pinnedAt ?? b.updatedAt) - (a.pinnedAt ?? a.updatedAt);
    }
    return b.updatedAt - a.updatedAt;
  });
}

function loadLegacyConversationsRaw(): Conversation[] {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeConversation).filter(Boolean) as Conversation[];
  } catch {
    return [];
  }
}

function loadLegacyActiveConversationId(): string | null {
  try {
    const v = localStorage.getItem(LEGACY_ACTIVE_KEY);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/**
 * 若存在旧版本 localStorage 对话数据则返回其一键导入结构；服务端已有数据时不要调用写入逻辑。
 */
export function readLegacyConversationArchive(): {
  conversations: Conversation[];
  activeConversationId: string | null;
} | null {
  const list = loadLegacyConversationsRaw();
  if (list.length === 0) return null;
  let activeConversationId = loadLegacyActiveConversationId();
  const sorted = [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  const trimmed = sorted.slice(0, MAX_CONVERSATIONS);
  if (!activeConversationId || !trimmed.some((c) => c.id === activeConversationId)) {
    activeConversationId = trimmed[0]?.id ?? null;
  }
  return { conversations: trimmed, activeConversationId };
}

export function clearLegacyConversationStorage(): void {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    localStorage.removeItem(LEGACY_ACTIVE_KEY);
  } catch {
    /* ignore */
  }
}

/** 列表展示用标题（兜底从首条用户消息截取） */
export function conversationListLabel(c: Conversation): string {
  if (c.title.trim()) return c.title;
  const first = c.messages.find((m) => m.role === "user")?.content ?? "";
  return first.trim() ? truncateTitle(first) : "（空白对话）";
}

/** 搜索聊天：标题或任意消息正文包含子串即匹配（不区分大小写） */
export function conversationMatchesSearchText(
  c: Conversation,
  queryTrimmed: string,
): boolean {
  const q = queryTrimmed.trim().toLowerCase();
  if (!q) return true;
  if (conversationListLabel(c).toLowerCase().includes(q)) return true;
  if (c.title.toLowerCase().includes(q)) return true;
  return c.messages.some((m) => {
    if (m.content.toLowerCase().includes(q)) return true;
    if (m.role === "user" && m.editHistory) {
      for (const snap of m.editHistory) {
        if (snap.userContent.toLowerCase().includes(q)) return true;
        if (snap.assistant.content.toLowerCase().includes(q)) return true;
      }
    }
    if (m.role === "assistant" && m.regenerateVersions) {
      for (const v of m.regenerateVersions) {
        if (v.content.toLowerCase().includes(q)) return true;
      }
    }
    return false;
  });
}

/** 首条内容与 query 匹配的消息 id（全文搜索，顺序遍历；含用户编辑历史） */
export function findFirstMatchingMessageId(
  messages: ChatMessage[],
  queryTrimmed: string,
): string | null {
  const q = queryTrimmed.trim().toLowerCase();
  if (!q) return null;
  for (const m of messages) {
    if (m.content.toLowerCase().includes(q)) return m.id;
    if (m.role === "assistant" && m.regenerateVersions) {
      for (const v of m.regenerateVersions) {
        if (v.content.toLowerCase().includes(q)) return m.id;
      }
    }
    if (m.role === "user" && m.editHistory) {
      for (const snap of m.editHistory) {
        if (snap.userContent.toLowerCase().includes(q)) return m.id;
        if (snap.assistant.content.toLowerCase().includes(q)) {
          return snap.assistant.id;
        }
      }
    }
  }
  return null;
}

export function createEmptyConversation(): Conversation {
  const now = Date.now();
  return {
    id: newClientId("conversation"),
    title: "",
    sessionId: newClientId("session"),
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** 与后端上限一致；同步前截取，减轻请求体体积（置顶永不被未置顶挤出） */
export function trimConversationsForSync(list: Conversation[]): Conversation[] {
  const pinned = list.filter((c) => c.pinned);
  const unpinned = list.filter((c) => !c.pinned);
  const pinnedSorted = [...pinned].sort(
    (a, b) =>
      (b.pinnedAt ?? b.updatedAt) - (a.pinnedAt ?? a.updatedAt),
  );
  if (pinnedSorted.length >= MAX_CONVERSATIONS) {
    return pinnedSorted.slice(0, MAX_CONVERSATIONS);
  }
  const unpinnedSorted = [...unpinned].sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
  const rest = MAX_CONVERSATIONS - pinnedSorted.length;
  return [...pinnedSorted, ...unpinnedSorted.slice(0, rest)];
}

/** 无消息的占位会话（未发送过）整页加载时不恢复，避免多标签共享「当前草稿」 */
export function dropEmptyShellConversations(
  list: Conversation[],
): Conversation[] {
  return list.filter((c) => c.messages.length > 0);
}

/** 每次完整载入页面时在列表前插入新的空白会话作为当前会话（与刷新 / 新开标签一致） */
export function withFreshComposeSession(list: Conversation[]): {
  conversations: Conversation[];
  activeConversationId: string;
} {
  const fresh = createEmptyConversation();
  const rest = dropEmptyShellConversations(list);
  return {
    conversations: [fresh, ...rest],
    activeConversationId: fresh.id,
  };
}
