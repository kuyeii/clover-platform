# 第 7-L 阶段：标书生成 iframe auth bridge 接入

## 1. 阶段目标

第 7-L 将 `bid-generator` iframe 前端接入 Portal -> iframe auth bridge，并将标书生成 iframe 前端 API base 优先切到 `apps/api` 的标书生成代理入口。

本阶段不去 iframe，不迁移标书生成业务逻辑，不重写 `pipt-lite` 后端，不修改 Dify workflow 调用逻辑，也不切换其它业务模块前端。

## 2. Auth Bridge

标书生成 iframe 沿用 `clover:auth-request` / `clover:auth-context` / `clover:auth-error` 消息协议。iframe reload 后会重新通过 `postMessage` 请求 auth context：

```json
{
  "type": "clover:auth-request",
  "appCode": "bid-generator",
  "requestId": "..."
}
```

Portal 父页面只在以下条件都满足时返回 auth context：

- `event.source` 等于当前 iframe window。
- `event.origin` 等于当前 iframe URL origin。
- 请求中的 `appCode` 等于当前 iframe 应用编码 `bid-generator`。
- 当前用户已登录。
- 当前用户拥有 `bid-generator` 应用权限。

返回的 auth context 包含 Portal session token、`X-Portal-Client-Id`、`appCode` 和标书生成 proxy API base。token 只通过 `postMessage` 传递，不进入 iframe URL query/hash，不写入日志，也不写入标书生成子应用长期 `localStorage`。

## 3. 标书生成 iframe API base

标书生成 iframe 前端当前优先请求：

```text
/api/v1/bid-generator/api/...
```

如果 Portal 向前端注入了 platform-api 完整地址，则请求形态为：

```text
http://127.0.0.1:<platform_api_port>/api/v1/bid-generator/api/...
```

标书生成 legacy path 保持不变，只在前面拼接 `apps/api` 标书生成 proxy base。例如：

| Legacy 标书生成 path | apps/api path |
| --- | --- |
| `/api/projects` | `/api/v1/bid-generator/api/projects` |
| `/api/tasks/start-extract` | `/api/v1/bid-generator/api/tasks/start-extract` |
| `/api/tasks/{task_id}/progress` | `/api/v1/bid-generator/api/tasks/{task_id}/progress` |
| `/api/projects/export-report` | `/api/v1/bid-generator/api/projects/export-report` |
| `/api/projects/forge-document` | `/api/v1/bid-generator/api/projects/forge-document` |
| `/api/knowledge/documents` | `/api/v1/bid-generator/api/knowledge/documents` |

对走 `apps/api` 的请求，标书生成 iframe 会添加：

- `Authorization: Bearer <portal token>`
- `X-Portal-Client-Id: <client id>`

bridge 不可用时，标书生成 iframe 保留原 legacy `VITE_API_BASE_URL` / `VITE_API_URL` fallback。fallback 请求不会强行携带 Portal token。

## 4. Fallback 与文件边界

- `401` / `403` 不 fallback，避免绕过 Portal 登录和 `bid-generator` 应用权限。
- `502` / `503` / network error 可 fallback 到 legacy 标书生成 backend 一次，保留开发回滚能力。
- fallback 只输出一次 `console.warn`，且不打印 token 或完整 auth context。
- 文件上传仍使用 `FormData` 直传，不手动设置 multipart boundary。
- 任务进度和解析相关 SSE 仍使用 `ReadableStream` 读取，不改变 legacy 事件格式。
- DOCX / PDF / Excel / 图片等文件响应仍通过 blob / `Content-Disposition` 语义处理。
- PDF iframe 预览、Markdown 图片预览和 Tiptap 图片节点改为 authenticated fetch 后使用内存态 object URL 渲染，避免把 token 放进 URL。

## 5. 未影响范围

- 标书生成业务逻辑仍由 legacy `pipt-lite` 后端通过 proxy 执行，包括脱敏、还原、映射、实体注册、项目 CRUD、任务状态、SSE、DocumentForge、知识库同步和图片预览。
- `competitor-analysis` iframe 前端不受影响。
- `rag-web-search` iframe 前端不受影响。
- `contract-review` iframe 前端不受影响。
- JWT、Portal session、apps/api 鉴权逻辑、数据库结构和 Alembic migration 均未修改。

## 6. 验证

已执行：

- `npm run build` in `legacy/bid-generator/frontend-web`
- `npm run build` in `legacy/portal-launchpad`
- `python3 -m compileall apps/api`
