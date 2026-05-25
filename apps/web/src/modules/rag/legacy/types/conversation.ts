import type { ChatMessage } from "@/types/chat";

export type Conversation = {
  id: string;
  /** 由首条用户问题截取得来，用于侧边栏列表 */
  title: string;
  /** 发往 / 对齐后端的会话 id */
  sessionId: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  /** 置顶：侧边栏排在前列，不限制数量 */
  pinned?: boolean;
  /** 置顶时间戳，用于同区内排序（越晚置顶越靠前） */
  pinnedAt?: number;
};
