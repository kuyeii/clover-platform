# 第 7-J 阶段：RAG iframe auth bridge 接入

## 1. 阶段目标

第 7-J 将 `rag-web-search` iframe 前端接入第 7-I 建立的 Portal -> iframe auth bridge，并将 RAG iframe 前端 API base 优先切到 `apps/api` 的 RAG 统一入口。

本阶段不去 iframe，不迁移 RAG chat stream 业务逻辑，不重写 RAG knowledge Dataset API，不修改 RAG legacy 后端核心逻辑，也不切换合同审查或标书生成 iframe 前端。

## 2. Auth Bridge

RAG iframe 沿用 `clover:auth-request` / `clover:auth-context` / `clover:auth-error` 消息协议。iframe reload 后会重新通过 `postMessage` 请求 auth context：

```json
{
  "type": "clover:auth-request",
  "appCode": "rag-web-search",
  "requestId": "..."
}
```

Portal 父页面只在以下条件都满足时返回 auth context：

- `event.source` 等于当前 iframe window。
- `event.origin` 等于当前 iframe URL origin。
- 请求中的 `appCode` 等于当前 iframe 应用编码 `rag-web-search`。
- 当前用户已登录。
- 当前用户拥有 `rag-web-search` 应用权限。

返回的 auth context 包含 Portal session token、`X-Portal-Client-Id`、`appCode` 和 RAG proxy API base。token 只通过 `postMessage` 传递，不进入 iframe URL query/hash，不写入日志，也不写入 RAG 子应用长期 `localStorage`。

## 3. RAG iframe API base

RAG iframe 前端当前优先请求：

```text
/api/v1/rag/api/v1/...
```

如果 Portal 向前端注入了 platform-api 完整地址，则请求形态为：

```text
http://127.0.0.1:<platform_api_port>/api/v1/rag/api/v1/...
```

RAG legacy path 保持不变，只在前面拼接 `apps/api` RAG proxy base。例如：

| Legacy RAG path | apps/api path |
| --- | --- |
| `/api/v1/conversations` | `/api/v1/rag/api/v1/conversations` |
| `/api/v1/conversations/sync` | `/api/v1/rag/api/v1/conversations/sync` |
| `/api/v1/chat/stream` | `/api/v1/rag/api/v1/chat/stream` |
| `/api/v1/knowledge/documents` | `/api/v1/rag/api/v1/knowledge/documents` |
| `/api/v1/knowledge/documents/create-by-file` | `/api/v1/rag/api/v1/knowledge/documents/create-by-file` |

对走 `apps/api` 的请求，RAG iframe 会添加：

- `Authorization: Bearer <portal token>`
- `X-Portal-Client-Id: <client id>`

bridge 不可用时，RAG iframe 保留原 legacy `VITE_API_BASE_URL` fallback。fallback 请求不会强行携带 Portal token。

## 4. Fallback 与错误边界

- `401` / `403` 不 fallback，避免绕过 Portal 登录和 `rag-web-search` 应用权限。
- `502` / `503` / network error 可 fallback 到 legacy RAG backend 一次，保留开发回滚能力。
- fallback 只输出一次 `console.warn`，且不打印 token 或完整 auth context。

SSE chat stream 仍保持 legacy `text/event-stream` 事件格式和读取逻辑。knowledge `create-by-file` 仍使用 `FormData`，不手动设置 multipart boundary。knowledge download 仍由 legacy RAG 后端通过 proxy 提供 blob / `Content-Disposition` 语义；本阶段未重写该业务。

## 5. 未影响范围

- Portal `knowledgeService` 未修改，仍按第 7-F 的 proxy/direct 混合策略运行。
- RAG chat stream 业务逻辑仍由 legacy RAG 后端通过 proxy 执行。
- RAG knowledge Dataset API 仍由 legacy RAG 后端通过 proxy 执行。
- `competitor-analysis` iframe 前端试点不受影响。
- `contract-review` / `bid-generator` iframe 前端未切换，仍保持原链路。

## 6. 后续方向

下一阶段可选择：

- 将 `contract-review` iframe 前端接入 auth bridge。
- 将 `bid-generator` iframe 前端接入 auth bridge。
- 继续评估 RAG chat stream direct 迁移。
