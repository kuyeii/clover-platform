# 第 7-D 阶段：RAG 问答业务代理接入 apps/api

## 范围

本阶段在第 7-B 业务代理基座上，将 `rag-web-search` 接入 `apps/api` 的鉴权业务代理：

- 统一入口：`/api/v1/rag/{path:path}`
- 代理目标：legacy RAG 后端
- 权限：继续复用 Portal session token 和 `rag-web-search` 应用权限
- 流式：透传 `/api/v1/chat/stream` 的 `text/event-stream`
- 文件：透传 knowledge 文档上传 multipart/form-data 和下载响应头

本阶段不迁移 RAG 业务逻辑、不重写 RAG service、不修改 RAG 前端业务逻辑、不去 iframe、不修改数据库结构。

## 路径映射

`apps/api` 只移除统一代理入口前缀，后续 legacy 路径保持原样：

| apps/api 请求 | legacy RAG 后端目标 |
| --- | --- |
| `/api/v1/rag/api/v1/health` | `/api/v1/health` |
| `/api/v1/rag/api/v1/sessions` | `/api/v1/sessions` |
| `/api/v1/rag/api/v1/chat/stream` | `/api/v1/chat/stream` |
| `/api/v1/rag/api/v1/conversations` | `/api/v1/conversations` |
| `/api/v1/rag/api/v1/conversations/sync` | `/api/v1/conversations/sync` |
| `/api/v1/rag/api/v1/knowledge/documents` | `/api/v1/knowledge/documents` |
| `/api/v1/rag/api/v1/knowledge/documents/create-by-text` | `/api/v1/knowledge/documents/create-by-text` |
| `/api/v1/rag/api/v1/knowledge/documents/create-by-file` | `/api/v1/knowledge/documents/create-by-file` |
| `/api/v1/rag/api/v1/knowledge/documents/{document_id}/detail` | `/api/v1/knowledge/documents/{document_id}/detail` |
| `/api/v1/rag/api/v1/knowledge/documents/{document_id}/download` | `/api/v1/knowledge/documents/{document_id}/download` |
| `/api/v1/rag/api/v1/knowledge/documents/{document_id}` | `/api/v1/knowledge/documents/{document_id}` |

query string、method、body 和 Content-Type 均由通用 `business_proxy` 透传。

## 后端地址解析

代理目标继续复用 `apps/api/app/services/business_proxy.py`，按以下顺序解析：

1. 优先读取 `runtime/ports.json` 中 `apps["rag-web-search"].backend_url`
2. fallback 到 `config/apps.yaml` 中 `rag_qa.dev.env` 的后端 URL 配置
3. fallback 到 `config/apps.yaml` 中 `rag_qa.dev.backend_preferred_port`

地址解析不到或 legacy RAG 后端连接失败时，返回平台统一 502 错误 envelope，不输出 traceback。

## 权限与安全

- 不带 `Authorization: Bearer <token>`：返回 401，错误码 `UNAUTHORIZED`
- 用户无 `rag-web-search` 权限：返回 403，错误码 `PERMISSION_DENIED`
- admin 默认允许
- 无权限时不会访问 legacy RAG 后端
- `Authorization`、`Cookie`、`Set-Cookie` 不会被代理透传
- 仅透传 `X-Portal-User-Id`、`X-Portal-User-Account`、`X-Portal-User-Role`、`X-Portal-Client-Id`、`X-Request-ID` 等非敏感上下文

## Legacy 兼容

- legacy RAG 后端仍执行真实业务。
- `/api/v1/chat/stream` 的 SSE 事件格式保持 legacy 原样。
- knowledge 文档 `create-by-file` 的 multipart/form-data 由请求流直接透传，不重新组装表单。
- knowledge 文档下载透传 `Content-Type` 和 `Content-Disposition`。
- Portal `knowledgeService` 暂未强制切到 `/api/v1/rag`，仍可通过 runtime apps 获取 RAG `backendUrl`。
- legacy RAG 前端和 iframe 均保留。

## 下一阶段可选方向

- 将 RAG conversations/sessions 等低风险 API 并行迁入 `apps/api`。
- 或将 Portal `knowledgeService` 切到 `/api/v1/rag` 代理入口。
