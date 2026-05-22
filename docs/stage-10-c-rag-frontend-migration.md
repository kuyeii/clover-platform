# 第 10-C：RAG 前端迁入 apps/web

## 1. 当前阶段结论

RAG 真实前端页面已迁入 `apps/web`。第 10-C 后：

- `apps/web` 已承载 Portal、竞对分析和 RAG 三部分真实前端能力。
- 合同审查和标书生成仍通过 iframe 接入。
- `legacy/chat_with_rag_and_websearch/frontend` 继续保留为回滚入口。
- 本阶段不修改 `apps/api` 业务 API 行为。
- 本阶段不修改数据库结构，不新增 Alembic migration。

## 2. 本阶段迁移范围

已迁入 `apps/web/src/modules/rag`：

- RAG 主页面。
- 会话列表、新建会话、会话切换、置顶、重命名和删除。
- 对话历史展示、用户消息编辑和助手重新回答。
- `POST /api/v1/rag/api/v1/chat/stream` SSE 流式问答。
- 流式 loading、error、done 和用户取消状态。
- `GET /api/v1/rag/api/v1/knowledge/documents` 文档列表。
- `POST /api/v1/rag/api/v1/knowledge/documents/create-by-text` 文本创建。
- `POST /api/v1/rag/api/v1/knowledge/documents/create-by-file` 文件上传。
- `GET /api/v1/rag/api/v1/knowledge/documents/{document_id}/detail` 文档详情。
- `DELETE /api/v1/rag/api/v1/knowledge/documents/{document_id}` 文档删除。
- loading、empty、error 和重试 / 刷新状态。

## 3. 未迁移范围

本阶段不迁移：

- 合同审查真实页面。
- 标书生成真实页面。
- 去 iframe。
- 删除 legacy 前端。
- `apps/api` API 改造。
- 数据库改造。
- MinIO、Celery/RQ 或统一任务表。

## 4. apps/web RAG 结构

关键结构：

```text
apps/web/src/modules/rag/
  RagPage.tsx
  types.ts
  utils.ts
  services/
    ragApi.ts
  components/
    ChatInput.tsx
    KnowledgeDocuments.tsx
    MessageList.tsx
    SessionList.tsx
```

`RagPage.tsx` 负责页面编排、会话同步、流式请求、AbortController 和知识库刷新；`ragApi.ts` 负责调用统一 `apps/api`；`types.ts` 和 `utils.ts` 保持与 legacy-compatible conversation/message 结构兼容。

## 5. RAG API 说明

RAG 前端现在直接调用 `apps/api`：

- `GET /api/v1/rag/api/v1/health`
- `POST /api/v1/rag/api/v1/sessions`
- `GET /api/v1/rag/api/v1/conversations`
- `PUT /api/v1/rag/api/v1/conversations/sync`
- `POST /api/v1/rag/api/v1/chat/stream`
- `GET /api/v1/rag/api/v1/knowledge/documents`
- `POST /api/v1/rag/api/v1/knowledge/documents/create-by-text`
- `POST /api/v1/rag/api/v1/knowledge/documents/create-by-file`
- `GET /api/v1/rag/api/v1/knowledge/documents/{document_id}/detail`
- `DELETE /api/v1/rag/api/v1/knowledge/documents/{document_id}`

成功响应继续按 RAG legacy-compatible 结构解析；401 由统一 API client 触发会话清理，403 展示平台返回的无权限提示。

## 6. chat stream 说明

`chat/stream` 使用 `fetch + ReadableStream` 读取 `text/event-stream`。前端兼容 `data: {...}\n\n` SSE 帧，并处理：

- `session`：更新当前 conversation 的 `sessionId`。
- `delta`：增量追加助手回答。
- `done`：固化助手消息并结束 loading。
- `error`：展示 Dify / upstream / 配置错误。

页面切换会话、新建会话、删除会话或组件卸载时会通过 `AbortController` 取消当前请求。流式回调会校验发起请求时的 conversation id，避免上一会话内容写入当前会话。

## 7. knowledge documents 说明

legacy RAG 前端已有 knowledge 文档能力，本阶段已迁入：

- 文档列表。
- 文本创建。
- 文件上传，使用 `FormData`，不手动设置 multipart boundary。
- 文档详情和分段预览。
- 删除确认，删除后刷新列表。

Dataset key 缺失、Dify Dataset 502、404 或 timeout 会按后端返回的业务错误在页面显示，不把 key 或文件内容输出到 UI / console。

## 8. 安全边界

- token 不进入 URL query/hash。
- 不 `console.log` token。
- token 继续使用 `apps/web` 统一内存 + `sessionStorage` 刷新恢复策略，不写长期 `localStorage`。
- API client 和 RAG stream 自动携带 `Authorization: Bearer <token>` 与 `X-Portal-Client-Id`。
- RAG 原生页面不再依赖 legacy `portalBridge`。
- 合同审查 / 标书生成 iframe auth bridge 仍保留 origin 和 targetOrigin 控制。

## 9. 回滚策略

`legacy/chat_with_rag_and_websearch/frontend` 未删除、未修改业务源码，仍可独立 build 和作为 iframe 回滚入口。`config/apps.yaml` 中 RAG iframe 配置也继续保留，便于后续回滚或对照验收。

## 10. 验收方式

命令验收：

```bash
python -m compileall -q packages scripts alembic apps/api legacy/portal-launchpad/backend
python scripts/preflight.py --only platform-api
python scripts/dev.py --write-ports-only
npm --prefix legacy/portal-launchpad run build
npm --prefix legacy/chat_with_rag_and_websearch/frontend run build
npm --prefix apps/web run build
```

手工验收重点：

- `/login` 可显示，登录后进入 `/workspace`。
- 刷新后可恢复用户状态。
- 工作台显示四个模块入口。
- 点击 RAG 进入 `apps/web` 原生 RAG 页面，不是 iframe。
- 点击合同审查 / 标书生成仍进入 iframe。
- RAG sessions、conversations 和 sync 可用。
- RAG chat stream 可增量展示、可取消、可显示错误。
- 切换会话不会串内容。
- knowledge documents 列表、文本创建、文件上传、详情和删除可用。
- token 不进 URL，退出登录后 token 清理。
- Portal 和竞对分析功能不被本阶段改动破坏。

安全自查：

```bash
grep -RIn "console\\.log.*token\\|localStorage.*token\\|token=.*\\|Authorization\\|postMessage\\|targetOrigin\\|clover:auth" apps/web/src legacy/chat_with_rag_and_websearch/frontend/src legacy/portal-launchpad/src | head -500
git diff -- legacy/portal-launchpad/vite.config.d.ts
git add -n . | grep -E "node_modules|dist|build|__pycache__|\\.DS_Store|\\.tsbuildinfo|\\.sqlite|\\.sqlite3|\\.db|\\.env$|\\.log|\\.codex|error\\.txt|runtime/ports.json" || echo "OK: clean dry-run"
```

## 11. 后续阶段建议

第 10-D 建议迁入合同审查前端真实页面，重点处理 multipart 上传、审查状态轮询、风险面板、AI 改写和 DOCX 下载。本阶段不展开合同审查迁移细节。
