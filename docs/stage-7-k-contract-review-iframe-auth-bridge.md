# 第 7-K 阶段：合同审查 iframe auth bridge 接入

## 1. 阶段目标

第 7-K 将 `contract-review` iframe 前端接入 Portal -> iframe auth bridge，并将合同审查 iframe 前端 API base 优先切到 `apps/api` 的合同审查代理入口。

本阶段不去 iframe，不迁移合同审查业务逻辑，不重写合同审查 pipeline，不修改 legacy 合同审查后端核心逻辑，也不切换 `bid-generator` iframe 前端。

## 2. Auth Bridge

合同审查 iframe 沿用 `clover:auth-request` / `clover:auth-context` / `clover:auth-error` 消息协议。iframe reload 后会重新通过 `postMessage` 请求 auth context：

```json
{
  "type": "clover:auth-request",
  "appCode": "contract-review",
  "requestId": "..."
}
```

Portal 父页面只在以下条件都满足时返回 auth context：

- `event.source` 等于当前 iframe window。
- `event.origin` 等于当前 iframe URL origin。
- 请求中的 `appCode` 等于当前 iframe 应用编码 `contract-review`。
- 当前用户已登录。
- 当前用户拥有 `contract-review` 应用权限。

返回的 auth context 包含 Portal session token、`X-Portal-Client-Id`、`appCode` 和合同审查 proxy API base。token 只通过 `postMessage` 传递，不进入 iframe URL query/hash，不写入日志，也不写入合同审查子应用长期 `localStorage`。

## 3. 合同审查 iframe API base

合同审查 iframe 前端当前优先请求：

```text
/api/v1/contract-review/api/...
```

如果 Portal 向前端注入了 platform-api 完整地址，则请求形态为：

```text
http://127.0.0.1:<platform_api_port>/api/v1/contract-review/api/...
```

合同审查 legacy path 保持不变，只在前面拼接 `apps/api` 合同审查 proxy base。例如：

| Legacy 合同审查 path | apps/api path |
| --- | --- |
| `/api/config` | `/api/v1/contract-review/api/config` |
| `/api/reviews` | `/api/v1/contract-review/api/reviews` |
| `/api/reviews/history?limit=30` | `/api/v1/contract-review/api/reviews/history?limit=30` |
| `/api/reviews/{run_id}/result` | `/api/v1/contract-review/api/reviews/{run_id}/result` |
| `/api/reviews/{run_id}/document` | `/api/v1/contract-review/api/reviews/{run_id}/document` |
| `/api/reviews/{run_id}/download` | `/api/v1/contract-review/api/reviews/{run_id}/download` |

对走 `apps/api` 的请求，合同审查 iframe 会添加：

- `Authorization: Bearer <portal token>`
- `X-Portal-Client-Id: <client id>`

bridge 不可用时，合同审查 iframe 保留原 legacy `VITE_API_BASE_URL` fallback。fallback 请求不会强行携带 Portal token。

## 4. Fallback 与文件边界

- `401` / `403` 不 fallback，避免绕过 Portal 登录和 `contract-review` 应用权限。
- `502` / `503` / network error 可 fallback 到 legacy 合同审查 backend 一次，保留开发回滚能力。
- fallback 只输出一次 `console.warn`，且不打印 token 或完整 auth context。
- 文件上传仍使用 `FormData` 直传，不手动设置 `Content-Type` 或 multipart boundary。
- DOCX 下载改为 authenticated `fetch` blob，支持受保护的 `apps/api` 下载接口，并从 `Content-Disposition` 解析文件名。

## 5. 未影响范围

- 合同审查业务逻辑仍由 legacy 合同审查后端通过 proxy 执行，包括上传、审查 pipeline、AI 改写、接受、撤销、导出和 DOCX 产物。
- `competitor-analysis` iframe 前端不受影响。
- `rag-web-search` iframe 前端不受影响。
- `bid-generator` iframe 前端未切换，仍保持原链路。
- JWT、Portal session、apps/api 鉴权逻辑、数据库结构和 Alembic migration 均未修改。

## 6. 后续方向

下一阶段可选择：

- 将 `bid-generator` iframe 前端接入 auth bridge。
- 或继续做 `contract-review` direct API 迁移评估。
