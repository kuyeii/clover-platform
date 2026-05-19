import {
  getAssistantDisplayedContent,
  getActiveUserContent,
  messagesToTurns,
} from "@/lib/messageTurns";
import type { ChatMessage } from "@/types/chat";

/** 与接口约定：history 中可选的 system 文案 */
export const CHAT_HISTORY_SYSTEM_PROMPT = "你是一个机器人助手";

const MAX_PRIOR_ROUNDS = 3;

export type ChatHistoryMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/**
 * 将「当前请求之前」的线性 messages 转为 API 所需的 history 字符串。
 * - 新建会话且尚无已完成轮次：`"[]"`
 * - 否则：`[{"role":"system",...}, {"role":"user",...}, {"role":"assistant",...}, ...]` 的 JSON 字符串，
 *   仅包含至多最近 3 轮**已完成**（user + assistant）对话。
 */
export function buildChatHistoryPayload(priorMessages: ChatMessage[]): string {
  const turns = messagesToTurns(priorMessages);
  const complete = turns.filter((t) => t.assistant != null);
  const lastRounds = complete.slice(-MAX_PRIOR_ROUNDS);
  if (lastRounds.length === 0) {
    return "[]";
  }

  const payload: ChatHistoryMessage[] = [
    { role: "system", content: CHAT_HISTORY_SYSTEM_PROMPT },
  ];
  for (const t of lastRounds) {
    payload.push(
      { role: "user", content: getActiveUserContent(t.user) },
      { role: "assistant", content: getAssistantDisplayedContent(t.assistant!) },
    );
  }
  return JSON.stringify(payload);
}
