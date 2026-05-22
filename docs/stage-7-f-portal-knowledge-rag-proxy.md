# 第 7-F 阶段：Portal knowledgeService 切到 RAG 统一代理

## 范围

第 7-F 只切换 Portal 前端的 `knowledgeService`。Portal 知识库入口现在优先访问 `apps/api` 的 RAG 统一代理：

```text
/api/v1/rag/api/v1/knowledge/...
```

本阶段覆盖的知识库接口：

- `GET /api/v1/rag/api/v1/knowledge/documents`
- `POST /api/v1/rag/api/v1/knowledge/documents/create-by-text`
- `POST /api/v1/rag/api/v1/knowledge/documents/create-by-file`
- `GET /api/v1/rag/api/v1/knowledge/documents/{document_id}/detail`
- `GET /api/v1/rag/api/v1/knowledge/documents/{document_id}/download`
- `DELETE /api/v1/rag/api/v1/knowledge/documents/{document_id}`

## 行为边界

`apps/api` 仍只负责 `rag-web-search` 的 Portal session 鉴权、应用权限校验和代理转发。RAG knowledge 业务逻辑仍在 legacy RAG 后端执行，Dify Dataset API 未迁移，Dify key / dataset id 未修改。

Portal 请求继续携带：

- `Authorization: Bearer <portal token>`
- `X-Portal-Client-Id`

`multipart/form-data` 上传仍直接传递 `FormData`，不手动设置 `Content-Type` boundary。下载接口保留 blob 处理，并继续从 `Content-Disposition` 中解析文件名。

## Fallback

Portal knowledgeService 默认优先走 `/api/v1/rag`。如果 RAG 统一代理返回 502 / 503 或发生 network error，会回退到 runtime apps 中 `rag-web-search` 的 legacy `backendUrl`，作为本阶段回滚路径。

401 / 403 不 fallback，表示 Portal 登录或 `rag-web-search` 应用权限异常，需要由平台侧明确暴露给用户。

如果 Dify Dataset 上游返回 502 / 503，前端错误文案会指向 RAG 知识库上游或 Dify Dataset 暂不可用，避免误判为 Portal 或 `apps/api` 崩溃。

## 未切换内容

- RAG iframe 前端未切换。
- RAG chat stream 未迁移，SSE 事件格式未修改。
- RAG legacy 后端核心代码未修改。
- RAG knowledge Dataset API 未重写。
- Portal auth、session 和 JWT 未修改。
- 数据库结构未修改，未新增 Alembic migration。

## 后续阶段

后续可评估：

- RAG iframe 前端鉴权方案。
- RAG chat stream 迁入或代理切换。
- knowledge API 直接迁入 `apps/api`。
