import type { ChatMessage } from "@/types/chat";

export type MessageTurn = {
  user: ChatMessage;
  assistant: ChatMessage | null;
};

/** 将线性 messages 拆成 user → assistant 轮次（助手缺省时仅 user） */
export function messagesToTurns(messages: ChatMessage[]): MessageTurn[] {
  const turns: MessageTurn[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const next = messages[i + 1];
    const assistant = next?.role === "assistant" ? next : null;
    turns.push({ user: m, assistant });
    if (assistant) i++;
  }
  return turns;
}

export function getActiveUserContent(user: ChatMessage): string {
  const hist = user.editHistory ?? [];
  const idx = user.activeVersionIndex ?? hist.length;
  if (idx < hist.length) return hist[idx].userContent;
  return user.content;
}

export function getActiveAssistantForTurn(
  user: ChatMessage,
  linearAssistant: ChatMessage | null,
): ChatMessage | null {
  const hist = user.editHistory ?? [];
  const idx = user.activeVersionIndex ?? hist.length;
  if (idx < hist.length) {
    const a = hist[idx].assistant;
    return {
      id: a.id,
      role: "assistant",
      content: a.content,
      stopped: a.stopped,
    };
  }
  return linearAssistant;
}

export function userTurnVersionCount(user: ChatMessage): number {
  const n = user.editHistory?.length ?? 0;
  return n + 1;
}

export function userTurnActiveIndex(user: ChatMessage): number {
  const hist = user.editHistory ?? [];
  return user.activeVersionIndex ?? hist.length;
}

/** 助手气泡当前展示的正文（含多版本分页） */
export function getAssistantDisplayedContent(m: ChatMessage): string {
  if (m.role !== "assistant") return m.content;
  const vs = m.regenerateVersions;
  if (!vs || vs.length === 0) return m.content;
  const idx = m.activeRegenerateIndex ?? vs.length - 1;
  const safe = Math.max(0, Math.min(idx, vs.length - 1));
  return vs[safe].content;
}

export function assistantVariantCount(m: ChatMessage): number {
  if (m.role !== "assistant") return 1;
  const vs = m.regenerateVersions;
  if (!vs || vs.length === 0) return 1;
  return vs.length;
}

export function assistantActiveVariantIndex(m: ChatMessage): number {
  if (m.role !== "assistant") return 0;
  const vs = m.regenerateVersions;
  if (!vs || vs.length === 0) return 0;
  return m.activeRegenerateIndex ?? vs.length - 1;
}

export function assistantStoppedForDisplay(m: ChatMessage): boolean | undefined {
  if (m.role !== "assistant") return m.stopped;
  const vs = m.regenerateVersions;
  if (!vs || vs.length === 0) return m.stopped;
  const idx = assistantActiveVariantIndex(m);
  return vs[idx]?.stopped ?? m.stopped;
}
