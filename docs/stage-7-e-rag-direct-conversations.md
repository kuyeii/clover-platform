# 第 7-E 阶段：RAG health/sessions/conversations 直接迁入 apps/api

## 范围

本阶段在第 7-D RAG 业务代理基础上，将 `rag-web-search` 的低风险会话类 API 并行迁入 `apps/api`：

- `GET /api/v1/rag/api/v1/health`
- `POST /api/v1/rag/api/v1/sessions`
- `GET /api/v1/rag/api/v1/conversations`
- `PUT /api/v1/rag/api/v1/conversations/sync`

这些 direct routes 继续复用 Portal session token 和 `rag-web-search` 应用权限校验。未登录返回平台统一 401 envelope，无权限返回平台统一 403 envelope。无权限时不会访问 PostgreSQL 或 legacy RAG 后端。

## Legacy 兼容

这些接口虽然由 `apps/api` 直接实现，但路径仍保持 legacy-compatible 形式：`/api/v1/rag/api/v1/...`。

成功响应保持 legacy 结构，不包装为平台 `success/data` envelope：

- health 返回 `{ "status": "ok" }`
- sessions 返回 `{ "session_id": "<uuid>" }`
- conversations 返回 `{ "conversations": [...], "activeConversationId": null }`
- conversations sync 成功返回 204，无响应体

会话列表读写保持 legacy `conversation_store` / `conversation_db` 的 PostgreSQL 语义：

- 只读写 `rag.conversations`
- 不落 `public` schema
- 不新增表，不修改表结构，不新增 Alembic migration
- `messages` 以 camelCase 前端结构写入 JSONB
- 最多同步 80 条会话，置顶会话优先，未置顶按 `updatedAt` 倒序
- 非 UUID 的 `id` / `sessionId` 稳定映射为 UUID 后写入 PostgreSQL
- `activeConversationId` 仅为历史兼容字段，不落盘
- 保持 legacy 全局共享会话行为，不新增 Portal 用户隔离

## Proxy fallback

除以上 4 个 direct routes 外，其它 RAG API 仍走第 7-D proxy fallback 到 legacy RAG 后端，包括：

- `POST /api/v1/rag/api/v1/chat/stream`
- `GET /api/v1/rag/api/v1/knowledge/documents`
- `POST /api/v1/rag/api/v1/knowledge/documents/create-by-text`
- `POST /api/v1/rag/api/v1/knowledge/documents/create-by-file`
- `GET /api/v1/rag/api/v1/knowledge/documents/{document_id}/detail`
- `GET /api/v1/rag/api/v1/knowledge/documents/{document_id}/download`
- `DELETE /api/v1/rag/api/v1/knowledge/documents/{document_id}`

本阶段未重写 RAG chat stream、未修改 SSE 事件格式、未迁移 Dify Dataset knowledge API、未修改 Dify key / dataset id、未修改 RAG legacy 后端和前端。

## Router 注册

`apps/api/app/__init__.py` 只 include 统一 `api_router`。`apps/api/app/api/router.py` 统一聚合：

- `/api/v1/core/*` 平台 API
- `/api/v1/competitor-analysis/*` 竞对分析 direct routes 和 proxy fallback
- `/api/v1/rag/*` RAG direct routes 和 proxy fallback

RAG direct routes 定义在 catch-all proxy 之前，避免被 `/{path:path}` 抢先匹配。

最终路径保持：

- `/api/v1/core/health`
- `/api/v1/competitor-analysis/{path:path}`
- `/api/v1/rag/{path:path}`

不会注册为 `/api/v1/core/rag/...`。

## 回滚

本阶段未修改 RAG legacy 前端和后端，iframe 仍可继续直连 legacy RAG 后端。需要回滚 direct routes 时，可移除 `apps/api/app/api/rag_proxy.py` 中 4 个 direct route，保留第 7-D catch-all proxy 即可恢复为全量代理。
