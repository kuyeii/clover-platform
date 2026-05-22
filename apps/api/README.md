# apps/api

`apps/api` 是 Clover Platform 统一后端基座。第 8-F 阶段在第 7-M 的业务代理与 iframe auth bridge 总体验收、第 8-A 回归基线、第 8-B 本地文件系统边界、第 8-C 诊断边界、第 8-D 第一批 direct API 和第 8-E 第二批低风险查询类 direct API 基础上，对第 8 阶段做整体收口。Portal 核心平台能力继续使用 `/api/v1/core`，四个业务模块已经具备统一代理入口和 iframe auth bridge 接入。当前处于 `apps/api` direct/proxy 混合阶段，legacy Portal 后端和四个 legacy 业务后端仍保留，未 direct 的复杂业务逻辑继续由 legacy 后端执行。

## 当前职责

- FastAPI 统一入口，应用标题为 `Clover Platform API`。
- API 主前缀为 `/api/v1/core`，业务代理前缀为 `/api/v1/<module>`。
- 读取根目录 `.env`、`config/apps.yaml` 和 `runtime/ports.json`。
- 复用 `packages/py_common` 的配置、数据库健康检查、模块注册、运行时端口能力。
- 复用 Portal session token、`Authorization: Bearer <token>` 和 `X-Portal-Client-Id`。
- 提供统一响应 envelope、request id middleware、统一 404 / 422 / 500 错误响应和基础日志。
- 为 Portal 前端提供 auth、users、app-usage、runtime apps、feedback 和 `/ws/core/app-usage`。
- 为 `competitor-analysis`、`rag-web-search`、`contract-review` 和 `bid-generator` 提供鉴权后的业务 API 入口。
- 支持业务 iframe 前端通过 Portal auth bridge 获取内存态 token 和 `apiBaseUrl` 后调用 `apps/api`；token 不通过 iframe URL 传递。
- 当前不持有统一文件存储，也不是统一任务调度器；复杂文件产物仍由 legacy backend 读写本地文件系统，任务状态继续沿用各 legacy 模块现有机制。

第 8-A 回归基线见 `docs/stage-8-a-regression-and-dev-baseline.md`，其中包含业务代理入口、fallback 安全边界、上传/下载/stream 约束，以及 `dev.py` / `preflight` 的必跑检查。第 8-B 文件系统和任务状态边界见 `docs/stage-8-b-local-files-and-task-boundary.md`。第 8-C 诊断和部署边界见 `docs/stage-8-c-diagnostics-and-local-fs-deployment.md`。第 8-D 低风险 direct API 批次 1 见 `docs/stage-8-d-low-risk-direct-api-batch-1.md`。第 8-E 低风险查询类 direct API 批次 2 见 `docs/stage-8-e-low-risk-query-direct-batch-2.md`。第 8-F 第 8 阶段收口见 `docs/stage-8-f-stage-8-rollup.md`。

## 业务代理入口

- `ANY /api/v1/competitor-analysis/{path:path}`
- `ANY /api/v1/rag/{path:path}`
- `ANY /api/v1/contract-review/{path:path}`
- `ANY /api/v1/bid-generator/{path:path}`

Direct / proxy 混合状态：

- `competitor-analysis`：`/api/health` 和 `/api/history*` direct 到 `apps/api`；`analysis`、`analysis/stream`、`workflows/*` 仍 proxy 到 legacy 竞对分析后端。
- `rag-web-search`：`/api/v1/health`、`/api/v1/sessions`、`/api/v1/conversations`、`/api/v1/conversations/sync` direct 到 `apps/api`；chat stream 和 knowledge API 仍 proxy 到 legacy RAG 后端。
- `contract-review`：`/api/health`、`/api/config` direct 到 `apps/api`；`diagnostics/converters`、`reviews/**`、DOCX 下载和 AI 相关接口仍 proxy 到 legacy 合同审查后端。
- `bid-generator`：`/health`、`/api/config/workflow-status`、`/api/config/analysis-framework`、`/api/entities`、`GET /api/projects`、`GET /api/projects/{project_id}`、`GET /api/projects/{project_id}/mappings` direct 到 `apps/api`；项目写入、Dify workflow、SSE task、项目文件、knowledge/kb、forge/export/download/preview 相关接口仍 proxy 到 legacy 标书生成后端。

业务 proxy 会在访问 legacy 后端前完成 Portal session 和应用权限校验。代理不会向 legacy 后端转发 `Authorization`、`Cookie` 或 `Set-Cookie`，只转发 `X-Portal-User-Id`、`X-Portal-User-Account`、`X-Portal-User-Role`、`X-Portal-Client-Id`、`X-Request-ID` 等非敏感上下文。multipart、SSE/NDJSON、DOCX/PDF/Excel/图片下载响应通过流式请求和流式响应保留，`Content-Type` 与 `Content-Disposition` 会透传。

诊断边界：

- `RequestIdMiddleware` 会复用请求头 `X-Request-ID`，缺失时生成 request id，并在响应头返回 `X-Request-ID`。
- `business_proxy` 会向 legacy 后端透传 `X-Request-ID`，便于串联 `apps/api` 与 legacy 后端日志。
- `BUSINESS_BACKEND_UNAVAILABLE` 表示后端地址解析失败、connection refused 或连接阶段不可用，通常检查 legacy 后端进程、端口和 `runtime/ports.json`。
- `BUSINESS_PROXY_TIMEOUT` 表示代理连接已进入超时边界，通常检查上游长任务、Dify / LLM、文件处理或数据库慢请求。
- `BUSINESS_PROXY_ERROR` 表示其它代理请求错误，优先结合 `request_id`、`app_code`、安全路径和 legacy 日志排查。
- 代理日志只记录安全路径，不记录敏感 query，不打印 token、key、密码、Cookie 或文件内容。
- legacy 后端返回的业务错误响应会保持原状态码和响应体流式透传；代理只包装自身无法完成转发时的错误 envelope。

文件上传、下载和 stream 当前只经 `apps/api` 做鉴权代理透传；合同审查 `data/uploads` / `data/runs`、标书生成 `data/*_cache` / `data/projects` / `data/kb_sync_status` 等真实文件产物仍由对应 legacy 后端维护。当前不引入 MinIO / S3 SDK，不引入 Celery / RQ，也不新增统一任务表。

## 当前接口

- `GET /api/v1/core/health`
- `GET /api/v1/core/health/db`
- `GET /api/v1/core/modules`
- `GET /api/v1/core/modules/health`
- `GET /api/v1/core/runtime/apps`
- `POST /api/v1/core/auth/login`
- `GET /api/v1/core/auth/me`
- `POST /api/v1/core/auth/logout`
- `PATCH /api/v1/core/auth/password`
- `GET /api/v1/core/users`
- `POST /api/v1/core/users`
- `PATCH /api/v1/core/users/{user_id}`
- `GET /api/v1/core/app-usage`
- `POST /api/v1/core/app-usage/{app_code}/enter`
- `POST /api/v1/core/app-usage/{app_code}/heartbeat`
- `DELETE /api/v1/core/app-usage/{app_code}/leave`
- `DELETE /api/v1/core/app-usage/leave-all`
- `POST /api/v1/core/app-usage/leave-all-beacon`
- `GET /api/v1/core/tickets/submission-context`
- `GET /api/v1/core/tickets/captcha`
- `POST /api/v1/core/tickets`
- `GET /api/v1/core/feature-requests/submission-context`
- `GET /api/v1/core/feature-requests/captcha`
- `POST /api/v1/core/feature-requests`
- `GET /api/v1/contract-review/api/health`
- `GET /api/v1/contract-review/api/config`
- `GET /api/v1/bid-generator/health`
- `GET /api/v1/bid-generator/api/config/workflow-status`
- `GET /api/v1/bid-generator/api/config/analysis-framework`
- `GET /api/v1/bid-generator/api/entities`
- `GET /api/v1/bid-generator/api/projects`
- `GET /api/v1/bid-generator/api/projects/{project_id}`
- `GET /api/v1/bid-generator/api/projects/{project_id}/mappings`
- `ANY /api/v1/competitor-analysis/{path:path}`
- `ANY /api/v1/rag/{path:path}`
- `ANY /api/v1/contract-review/{path:path}`
- `ANY /api/v1/bid-generator/{path:path}`
- `WS /ws/core/app-usage`

## 响应格式

成功响应：

```json
{
  "success": true,
  "data": {},
  "message": "ok",
  "request_id": "..."
}
```

失败响应：

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "错误说明",
    "details": {}
  },
  "request_id": "..."
}
```

Direct 业务接口会按 legacy 兼容要求保留原成功响应结构；未登录、无权限、平台层校验失败和代理连接失败仍使用平台 envelope。被 legacy 后端返回的业务响应会尽量原样流式透传。

WebSocket 不使用统一 envelope。`/ws/core/app-usage` 保持 legacy `/ws/app-usage` 消息结构：连接后先发送 `auth` 消息，成功后收到 `snapshot`，`heartbeat` 返回 `heartbeat_ack`，`refresh` 返回 `snapshot`，占用状态广播为 `app_usage_changed`。

## 当前不做

- 不重写业务模块 API。
- 不替换 legacy 后端。
- 不修改 Portal session。
- 不改 JWT。
- 不去掉 iframe。
- 不接 MinIO。
- 不引入 Celery / RQ。
- 不新增统一文件存储或统一任务队列。
- 不规划任务队列预留口。
- 不规划对象存储预留口。
- 第 9 阶段后续单独规划。

## 本地文件系统版部署边界

`apps/api` 负责统一鉴权、平台 API、运行时应用列表和业务代理，不持有合同审查、标书生成、RAG Dataset 或竞对分析报告文件主存储。部署时需要分别运行 `apps/api`、Portal 前端、四个业务 iframe 前端和四个 legacy 后端，并为 PostgreSQL、Dify / workflow key、本地持久化目录、日志目录和反向代理 / CORS 做独立配置。

需要持久化挂载的业务目录以第 8-B 文档为准，重点包括 `legacy/contract_review/data/uploads`、`legacy/contract_review/data/runs`、`legacy/bid-generator/data/pdf_cache`、`legacy/bid-generator/data/docx_cache`、`legacy/bid-generator/data/raw_doc_cache`、`legacy/bid-generator/data/extracted_images`、`legacy/bid-generator/data/projects` 和 `legacy/bid-generator/data/kb_sync_status`。RAG 知识库文件当前由 Dify Dataset 管理；竞对分析当前主要写 PostgreSQL。

生产反向代理应把 Portal 与四个 iframe 前端的可信 origin 配入 `apps/api` CORS，不应使用无边界的 `*`。iframe auth bridge 依赖 runtime app 的可信 `iframeUrl` origin；`Authorization` 和 `X-Portal-Client-Id` 只发送到 `apps/api`，fallback 到 legacy backend 时不能携带 Portal token。

## 本地启动

安装依赖：

```bash
python -m pip install -r apps/api/requirements.txt
```

只启动统一后端：

```bash
python scripts/dev.py --only platform-api
```

启动 Portal + 统一后端，不启动四个业务模块：

```bash
python scripts/dev.py --no-business
```

`--no-business` 会启动 Portal 前端 + platform-api，并向 Portal 前端注入 `VITE_PLATFORM_API_BASE_URL` 和 `VITE_PLATFORM_WS_BASE_URL`。Portal 前端的 `/api/v1/core` 与 `/ws/core` 需要 platform-api；如果通过 `--skip platform-api` 跳过统一后端，登录、用户管理、应用占用、runtime apps 和 feedback 可能不可用。

默认全量启动会同时启动 platform-api、Portal 和四个业务模块，四个 iframe 前端会优先调用对应 `apps/api` 业务代理入口。legacy Portal 后端不在 `--no-business` 默认链路中启动，可通过 `python scripts/dev.py --only portal` 保留回滚和兼容排查路径。

生成端口规划：

```bash
python scripts/dev.py --write-ports-only
```
