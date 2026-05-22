# modules/rag_qa

## 模块当前状态

RAG 问答模块当前后端主路径已迁入 `apps/api`，真实前端页面已在第 10-C 迁入 `apps/web/src/modules/rag`。`legacy/chat_with_rag_and_websearch/frontend` 继续保留为回滚入口。

## 后端状态

`apps/api` direct 已承载 RAG health、sessions、conversations、conversations sync、chat stream 和 knowledge Dataset 主要业务 API。`ANY /api/v1/rag/{path:path}` catch-all proxy 仅保留为未知路径和回滚兜底。

当前 `apps/web` RAG 前端调用：

- `/api/v1/rag/api/v1/health`
- `/api/v1/rag/api/v1/sessions`
- `/api/v1/rag/api/v1/conversations`
- `/api/v1/rag/api/v1/conversations/sync`
- `/api/v1/rag/api/v1/chat/stream`
- `/api/v1/rag/api/v1/knowledge/documents`
- `/api/v1/rag/api/v1/knowledge/documents/create-by-text`
- `/api/v1/rag/api/v1/knowledge/documents/create-by-file`
- `/api/v1/rag/api/v1/knowledge/documents/{document_id}/detail`
- `/api/v1/rag/api/v1/knowledge/documents/{document_id}`

## 前端状态

`apps/web` 已承载：

- RAG 主页面。
- 会话列表、新建、切换、置顶、重命名和删除。
- 对话历史展示、用户消息编辑和助手重新回答。
- SSE chat stream 增量展示、取消和错误处理。
- knowledge documents 列表、文本创建、文件上传、详情和删除。

legacy RAG 前端不删除、不改业务源码，仍可通过原 Vite 项目构建和作为 iframe 回滚入口。

## 关键风险点

- SSE chat stream 事件格式、取消和错误事件。
- 切换会话时避免上一会话流式内容写入当前会话。
- Dify Chat / Dataset key、上游 timeout 和 502 处理。
- knowledge 文件上传使用 multipart/form-data，不能破坏 boundary。
- 本地会话 UI 状态与服务端 conversation 同步。
- Markdown / 代码块展示目前在 `apps/web` 使用轻量渲染，后续如需完整公式和 GFM 可单独评估依赖。

## 验收重点

- chat stream 保持 `text/event-stream`，前端体验不回退为一次性回答。
- conversations sync 和历史会话兼容。
- knowledge list/upload/detail/delete 行为兼容。
- token 不进入 URL，不写 console，不写长期 localStorage。
- 合同审查和标书生成仍保持 iframe。
