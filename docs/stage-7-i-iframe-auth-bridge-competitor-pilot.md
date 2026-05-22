# 第 7-I 阶段：iframe auth bridge 与竞对分析前端试点

## 1. 阶段目标

第 7-I 建立 Portal 父页面到业务 iframe 的安全鉴权桥接机制，并只将 `competitor-analysis` 前端作为第一个试点切到 `apps/api` 代理入口。

本阶段不去 iframe，不迁移新的后端业务逻辑，不修改 RAG、合同审查或标书生成 iframe 前端。

## 2. Portal auth bridge

Portal iframe 父页面新增 `clover:auth-request` / `clover:auth-context` / `clover:auth-error` 消息协议。业务 iframe reload 后可以重新发送 auth request。

父页面只在以下条件都满足时返回 auth context：

- `event.source` 等于当前 iframe window。
- `event.origin` 等于当前 iframe URL origin。
- 请求里的 `appCode` 等于当前 iframe 应用编码。
- 当前用户已登录。
- 当前用户拥有该应用权限。

返回的 auth context 包含：

- Portal session token
- `X-Portal-Client-Id`
- `appCode`
- 当前应用在 platform-api 下的 proxy API base，例如 `http://127.0.0.1:5220/api/v1/competitor-analysis`

Portal token 不写入 iframe URL query/hash，不写入日志，不广播给其它 iframe。

## 3. 竞对分析前端试点

`legacy/company-competitors-analysis` 新增内存态 bridge client。竞对分析 API service 现在按以下顺序选择请求目标：

1. 优先通过 Portal bridge 获取 `apiBaseUrl`、Portal token 和 client id。
2. 成功获取后，请求 `apiBaseUrl + legacy path`，例如 `/api/v1/competitor-analysis/api/history`。
3. 对走 `apps/api` 的请求添加 `Authorization: Bearer <portal token>` 和 `X-Portal-Client-Id`。
4. bridge 不可用时回退到 legacy `VITE_API_BASE_URL`。

fallback 规则：

- 401 / 403 不 fallback，避免绕过 Portal 应用权限。
- 502 或 network error 可回退一次 legacy backend，保留开发环境回滚能力。
- fallback 只打印一次 `console.warn`，不打印 token 或完整 auth context。

## 4. 行为边界

竞对分析现有业务路径保持 legacy-compatible 拼接：

- `/api/history` -> `/api/v1/competitor-analysis/api/history`
- `/api/analysis` -> `/api/v1/competitor-analysis/api/analysis`
- `/api/analysis/stream` -> `/api/v1/competitor-analysis/api/analysis/stream`
- `/api/workflows/...` -> `/api/v1/competitor-analysis/api/workflows/...`

响应解析保持 legacy 结构，不强制 unwrap 平台 `success/data` envelope。`analysis/stream` 的 NDJSON 逐行读取逻辑保持不变。

`apps/api` 当前 CORS 在 dev/local/test 环境允许 `localhost` 与 `127.0.0.1` 任意端口，并允许 `Authorization`、`X-Portal-Client-Id` 等请求头，因此无需额外放宽生产默认。

## 5. 未切换模块

以下模块 iframe 前端本阶段未切换：

- `rag-web-search`
- `contract-review`
- `bid-generator`

这些模块仍按原有 iframe 前端到 legacy backend 的链路运行。

## 6. 后续方向

下一阶段可选择：

- 将 RAG iframe 前端接入 auth bridge。
- 或将合同审查 iframe 前端接入 auth bridge。
- 或继续做 `competitor-analysis` direct API 迁移。
