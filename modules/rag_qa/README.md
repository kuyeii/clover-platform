# modules/rag_qa

## 模块当前状态

RAG 问答模块当前后端主路径已迁入 `apps/api`，前端仍在 `legacy/chat_with_rag_and_websearch/frontend` 并通过 iframe 接入 Portal。

## 后端状态

`apps/api` direct 已承载 RAG health、sessions、conversations、conversations sync、chat stream 和 knowledge Dataset 主要业务 API。`ANY /api/v1/rag/{path:path}` catch-all proxy 仅保留为未知路径和回滚兜底。

## 前端状态

真实业务前端仍在 legacy RAG 前端。第 10-A 只在 `apps/web` 新增 `/modules/rag` 占位页，不迁移聊天、知识库或上传 UI。

## 后续迁移目标

第 10-D 迁移 RAG 前端到 `apps/web/src/modules/rag`，优先确认 chat SSE、知识库上传下载、会话列表和 Markdown 渲染边界。

## 关键风险点

- SSE chat stream 事件格式、取消和错误事件。
- Dify Chat / Dataset key、上游 timeout 和 502 处理。
- knowledge 文件上传临时文件清理和下载鉴权。
- 本地会话 UI 状态与服务端 conversation 同步。
- Markdown、公式、代码块和复制交互兼容。

## 验收重点

- chat stream 保持 `text/event-stream`，前端体验不回退。
- conversations sync 和历史会话兼容。
- knowledge list/upload/detail/download/delete 行为不变。
- token 不进入 URL，不写 console，不写长期 localStorage。
