export type ChatRole = "user" | "assistant";

/** 编辑前保留的一轮：用户当时的文案 + 助手回复快照 */
export type UserTurnSnapshot = {
  userContent: string;
  assistant: {
    id: string;
    content: string;
    stopped?: boolean;
  };
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  /** 用户点击「停止」中止流式输出 */
  stopped?: boolean;
  /** 仅 user：历次被替换掉的轮次（与 ChatGPT 的 1/2 分页一致） */
  editHistory?: UserTurnSnapshot[];
  /**
   * 仅 user：展示第几版，0..editHistory.length（含），
   * 等于 editHistory.length 时表示展示当前 content + 线性下一条助手消息。
   */
  activeVersionIndex?: number;
  /** 仅 assistant：多次「重新回答」的完整版本，自旧到新；缺省时仅用 content */
  regenerateVersions?: { content: string; stopped?: boolean }[];
  /** 仅 assistant：当前展示的版本下标，缺省为最后一版 */
  activeRegenerateIndex?: number;
};
