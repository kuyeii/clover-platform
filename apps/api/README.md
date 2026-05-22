# apps/api

`apps/api` 是 Clover Platform 统一后端基座。第 9-E 阶段完成四个业务模块后端迁移收口，并将 legacy 业务后端调整为非默认启动。Portal 核心平台能力继续使用 `/api/v1/core`，四个业务模块继续具备统一业务入口和 iframe auth bridge 接入。当前 `apps/api` 是主业务后端：竞对分析、RAG、合同审查和标书生成主要业务已由 `apps/api` direct 承载，legacy 后端进程仅作为回滚 / 调试路径保留。

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
- 当前不持有统一文件存储，也不是统一任务调度器；合同审查 direct API 仍读写原 legacy 本地目录，标书生成 direct API 仍复用 legacy `api_lite` 业务实现、本地 `data/*` 目录和进程内 `TaskManager`，任务状态继续沿用各模块现有机制。

第 8-A 回归基线见 `docs/stage-8-a-regression-and-dev-baseline.md`，其中包含业务代理入口、fallback 安全边界、上传/下载/stream 约束，以及 `dev.py` / `preflight` 的必跑检查。第 8-B 文件系统和任务状态边界见 `docs/stage-8-b-local-files-and-task-boundary.md`。第 8-C 诊断和部署边界见 `docs/stage-8-c-diagnostics-and-local-fs-deployment.md`。第 8-D 低风险 direct API 批次 1 见 `docs/stage-8-d-low-risk-direct-api-batch-1.md`。第 8-E 低风险查询类 direct API 批次 2 见 `docs/stage-8-e-low-risk-query-direct-batch-2.md`。第 8-F 第 8 阶段收口见 `docs/stage-8-f-stage-8-rollup.md`。第 9-A 竞对分析完整迁移见 `docs/stage-9-a-competitor-analysis-full-migration.md`。第 9-B RAG 问答完整迁移见 `docs/stage-9-b-rag-full-migration.md`。第 9-C 合同审查完整迁移见 `docs/stage-9-c-contract-review-full-migration.md`。第 9-D 标书生成完整迁移见 `docs/stage-9-d-bid-generator-full-migration.md`。第 9-E 四模块迁移收口见 `docs/stage-9-e-post-migration-startup-rollup.md`。

## 业务代理入口

- `ANY /api/v1/competitor-analysis/{path:path}`
- `ANY /api/v1/rag/{path:path}`
- `ANY /api/v1/contract-review/{path:path}`
- `ANY /api/v1/bid-generator/{path:path}`

Direct / proxy 混合状态：

- `competitor-analysis`：`/api/health`、`/api/history*`、`/api/analysis`、`/api/analysis/stream` 和 `/api/workflows/*` 已 direct 到 `apps/api`；catch-all proxy 仍保留，仅作为未知路径或临时回滚兜底。
- `rag-web-search`：`/api/v1/health`、`/api/v1/sessions`、`/api/v1/conversations`、`/api/v1/conversations/sync`、`/api/v1/chat/stream` 和 `/api/v1/knowledge/**` 已 direct 到 `apps/api`；catch-all proxy 仍保留，仅作为未知路径或临时回滚兜底。
- `contract-review`：`/api/health`、`/api/config`、`/api/diagnostics/converters`、`/api/reviews/**`、DOCX document/download 和 AI 改写相关接口已 direct 到 `apps/api`；catch-all proxy 仍保留，仅作为未知路径或临时回滚兜底。
- `bid-generator`：`/health`、`/api/health`、`/api/config/**`、脱敏/还原、项目 CRUD、文件预览/下载、需求提取、Dify workflow、SSE task、forge/export、knowledge/kb 和解析报告相关接口已 direct 到 `apps/api`；catch-all proxy 仍保留，仅作为未知路径或临时回滚兜底。

业务 proxy 会在访问 legacy 后端前完成 Portal session 和应用权限校验。代理不会向 legacy 后端转发 `Authorization`、`Cookie` 或 `Set-Cookie`，只转发 `X-Portal-User-Id`、`X-Portal-User-Account`、`X-Portal-User-Role`、`X-Portal-Client-Id`、`X-Request-ID` 等非敏感上下文。multipart、SSE/NDJSON、DOCX/PDF/Excel/图片下载响应通过流式请求和流式响应保留，`Content-Type` 与 `Content-Disposition` 会透传。

诊断边界：

- `RequestIdMiddleware` 会复用请求头 `X-Request-ID`，缺失时生成 request id，并在响应头返回 `X-Request-ID`。
- `business_proxy` 会向 legacy 后端透传 `X-Request-ID`，便于串联 `apps/api` 与 legacy 后端日志。
- `BUSINESS_BACKEND_UNAVAILABLE` 表示后端地址解析失败、connection refused 或连接阶段不可用，通常检查 legacy 后端进程、端口和 `runtime/ports.json`。
- `BUSINESS_PROXY_TIMEOUT` 表示代理连接已进入超时边界，通常检查上游长任务、Dify / LLM、文件处理或数据库慢请求。
- `BUSINESS_PROXY_ERROR` 表示其它代理请求错误，优先结合 `request_id`、`app_code`、安全路径和 legacy 日志排查。
- 代理日志只记录安全路径，不记录敏感 query，不打印 token、key、密码、Cookie 或文件内容。
- legacy 后端返回的业务错误响应会保持原状态码和响应体流式透传；代理只包装自身无法完成转发时的错误 envelope。

竞对分析 `analysis/stream` 当前由 `apps/api` direct 输出 NDJSON；RAG `chat/stream` 当前由 `apps/api` direct 输出 SSE，并在完成后写入 `rag.chat_turns`；RAG knowledge API 当前由 `apps/api` direct 调用 Dify Dataset，文件上传仍使用本地临时文件并在请求结束后清理。合同审查 reviews、DOCX 下载和 AI 改写当前由 `apps/api` direct 执行，文件产物仍写入 `legacy/contract_review/data/uploads` 与 `legacy/contract_review/data/runs`。标书生成当前由 `apps/api` direct 加载 legacy `api_lite` 业务路由，继续使用 PostgreSQL `bid_generator` schema、legacy `TaskManager`、SSE progress、Dify workflow、DocumentForge 和 `legacy/bid-generator/data/*` 本地目录。当前不引入 MinIO / S3 SDK，不引入 Celery / RQ，也不新增统一任务表。

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
- `GET /api/v1/contract-review/api/diagnostics/converters`
- `POST /api/v1/contract-review/api/reviews`
- `GET /api/v1/contract-review/api/reviews/history`
- `GET /api/v1/contract-review/api/reviews/{run_id}`
- `GET /api/v1/contract-review/api/reviews/{run_id}/result`
- `GET /api/v1/contract-review/api/reviews/{run_id}/document`
- `GET /api/v1/contract-review/api/reviews/{run_id}/download`
- `PATCH /api/v1/contract-review/api/reviews/{run_id}/risks/{risk_id}`
- `POST /api/v1/contract-review/api/reviews/{run_id}/risks/accept_all`
- `POST /api/v1/contract-review/api/reviews/{run_id}/risks/{risk_id}/ai_apply`
- `POST /api/v1/contract-review/api/reviews/{run_id}/ai_apply_all`
- `POST /api/v1/contract-review/api/reviews/{run_id}/risks/{risk_id}/ai_accept`
- `PATCH /api/v1/contract-review/api/reviews/{run_id}/risks/{risk_id}/ai_edit`
- `POST /api/v1/contract-review/api/reviews/{run_id}/risks/{risk_id}/ai_reject`
- `GET /api/v1/bid-generator/health`
- `GET /api/v1/bid-generator/api/config/workflow-status`
- `GET /api/v1/bid-generator/api/config/analysis-framework`
- `POST /api/v1/bid-generator/api/recognize`
- `POST /api/v1/bid-generator/api/desensitize`
- `POST /api/v1/bid-generator/api/desensitize/batch`
- `GET /api/v1/bid-generator/api/entities`
- `POST /api/v1/bid-generator/api/restore`
- `GET /api/v1/bid-generator/api/config/template`
- `DELETE /api/v1/bid-generator/api/config/template`
- `PUT /api/v1/bid-generator/api/config/template`
- `PUT /api/v1/bid-generator/api/config/global`
- `POST /api/v1/bid-generator/api/config/template/generate`
- `GET /api/v1/bid-generator/api/projects`
- `POST /api/v1/bid-generator/api/projects`
- `GET /api/v1/bid-generator/api/projects/{project_id}`
- `PUT /api/v1/bid-generator/api/projects/{project_id}`
- `PATCH /api/v1/bid-generator/api/projects/{project_id}`
- `DELETE /api/v1/bid-generator/api/projects/{project_id}`
- `GET /api/v1/bid-generator/api/projects/{project_id}/mappings`
- `POST /api/v1/bid-generator/api/projects/batch`
- `POST /api/v1/bid-generator/api/projects/extract`
- `POST /api/v1/bid-generator/api/projects/extract-stream`
- `GET /api/v1/bid-generator/api/projects/pdf/{project_id}`
- `GET /api/v1/bid-generator/api/extracted-images/by-hash/{image_hash}`
- `GET /api/v1/bid-generator/api/extracted-images/{filename}`
- `POST /api/v1/bid-generator/api/projects/upload-pdf`
- `POST /api/v1/bid-generator/api/bid-attachment/extract`
- `GET /api/v1/bid-generator/api/bid-attachment/test-locators`
- `GET /api/v1/bid-generator/api/projects/{project_id}/doc-blocks`
- `POST /api/v1/bid-generator/api/projects/{project_id}/rebuild-locator`
- `GET /api/v1/bid-generator/api/projects/{project_id}/source-docx`
- `POST /api/v1/bid-generator/api/bid-attachment/extract-by-block`
- `POST /api/v1/bid-generator/api/bid-attachment/extract-by-block-docx`
- `DELETE /api/v1/bid-generator/api/projects/{project_id}/caches`
- `POST /api/v1/bid-generator/api/projects/re-extract`
- `POST /api/v1/bid-generator/api/projects/generate-outline`
- `POST /api/v1/bid-generator/api/projects/generate-content`
- `POST /api/v1/bid-generator/api/projects/generate-outline-stream`
- `POST /api/v1/bid-generator/api/projects/generate-content-stream`
- `POST /api/v1/bid-generator/api/projects/generate-attachment`
- `POST /api/v1/bid-generator/api/projects/build-scoring-table`
- `POST /api/v1/bid-generator/api/projects/fill-scoring-row`
- `POST /api/v1/bid-generator/api/projects/export-scoring-table`
- `POST /api/v1/bid-generator/api/projects/generate-blueprint`
- `POST /api/v1/bid-generator/api/projects/forge-document`
- `GET /api/v1/bid-generator/api/knowledge/documents`
- `POST /api/v1/bid-generator/api/knowledge/sync`
- `POST /api/v1/bid-generator/api/knowledge/sync/{doc_name}`
- `POST /api/v1/bid-generator/api/projects/analyze`
- `POST /api/v1/bid-generator/api/projects/{project_id}/analyze-node`
- `POST /api/v1/bid-generator/api/projects/{project_id}/analysis-report`
- `GET /api/v1/bid-generator/api/projects/{project_id}/analysis-report`
- `POST /api/v1/bid-generator/api/kb/sync`
- `GET /api/v1/bid-generator/api/kb/sync-status/{job_id}`
- `GET /api/v1/bid-generator/api/kb/sync-jobs`
- `POST /api/v1/bid-generator/api/projects/export-report`
- `POST /api/v1/bid-generator/api/tasks/start-outline`
- `POST /api/v1/bid-generator/api/tasks/start-extract`
- `POST /api/v1/bid-generator/api/tasks/start-content`
- `POST /api/v1/bid-generator/api/tasks/start-content-rewrite`
- `POST /api/v1/bid-generator/api/tasks/start-content-group`
- `POST /api/v1/bid-generator/api/tasks/start-group-review`
- `POST /api/v1/bid-generator/api/tasks/start-diagram`
- `POST /api/v1/bid-generator/api/tasks/{task_id}/cancel`
- `GET /api/v1/bid-generator/api/tasks/{task_id}/status`
- `GET /api/v1/bid-generator/api/tasks/{task_id}/progress`
- `POST /api/v1/bid-generator/api/tasks/start-analyze`
- `GET /api/v1/competitor-analysis/api/health`
- `GET /api/v1/competitor-analysis/api/history`
- `GET /api/v1/competitor-analysis/api/history/{history_id}`
- `POST /api/v1/competitor-analysis/api/history`
- `DELETE /api/v1/competitor-analysis/api/history`
- `DELETE /api/v1/competitor-analysis/api/history/{history_id}`
- `POST /api/v1/competitor-analysis/api/analysis`
- `POST /api/v1/competitor-analysis/api/analysis/stream`
- `POST /api/v1/competitor-analysis/api/workflows/validate`
- `POST /api/v1/competitor-analysis/api/workflows/company-name-validate`
- `POST /api/v1/competitor-analysis/api/workflows/company-detail`
- `POST /api/v1/competitor-analysis/api/workflows/compare-report`
- `POST /api/v1/competitor-analysis/api/workflows/score`
- `GET /api/v1/rag/api/v1/health`
- `POST /api/v1/rag/api/v1/sessions`
- `GET /api/v1/rag/api/v1/conversations`
- `PUT /api/v1/rag/api/v1/conversations/sync`
- `POST /api/v1/rag/api/v1/chat/stream`
- `GET /api/v1/rag/api/v1/knowledge/documents`
- `POST /api/v1/rag/api/v1/knowledge/documents/create-by-text`
- `POST /api/v1/rag/api/v1/knowledge/documents/create-by-file`
- `GET /api/v1/rag/api/v1/knowledge/documents/{document_id}/detail`
- `GET /api/v1/rag/api/v1/knowledge/documents/{document_id}/download`
- `DELETE /api/v1/rag/api/v1/knowledge/documents/{document_id}`
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

- 不重写 legacy 业务算法或改变 Dify / DocumentForge 语义。
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

`apps/api` 负责统一鉴权、平台 API、运行时应用列表、业务代理，并在第 9-D 后直接执行合同审查与标书生成主要业务 API。合同审查和标书生成文件产物仍保存在 legacy 本地目录；`apps/api` 不是统一对象存储。部署时需要分别运行 `apps/api`、Portal 前端、四个业务 iframe 前端和仍需保留作回滚参考的 legacy 后端，并为 PostgreSQL、Dify / workflow key、本地持久化目录、日志目录和反向代理 / CORS 做独立配置。

第 9-E 后，本地开发默认不再启动四个 legacy 业务后端进程；生产或联调部署也应把 `apps/api` 视为主业务后端。legacy 源码目录仍可能是 `apps/api` 运行依赖，例如合同审查复用 `legacy/contract_review/src`，标书生成复用 `legacy/bid-generator/pipt-flask/app/api_lite`、`gateway-out` 和 `dify-bridge`。这些目录不能仅因为 legacy 后端进程不默认启动就删除。

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

默认全量启动会启动 Portal 前端、platform-api 和四个业务 iframe 前端，默认不启动四个 legacy 业务后端。四个 iframe 前端会优先调用对应 `apps/api` direct 业务入口；`runtime/ports.json` 默认不写未启动 legacy backend 的 `backend_url`，direct API 不依赖该字段。legacy Portal 后端不在默认链路中启动，可通过 `python scripts/dev.py --only portal` 保留回滚和兼容排查路径。

启动全部 legacy 业务后端回滚 / 调试：

```bash
python scripts/dev.py --with-legacy-backends
```

启动单模块回滚 / 调试：

```bash
python scripts/dev.py --only competitor-analysis --with-legacy-backends
python scripts/dev.py --only rag-web-search --with-legacy-backends
python scripts/dev.py --only contract-review --with-legacy-backends
python scripts/dev.py --only bid-generator --with-legacy-backends
```

catch-all proxy 仍保留在四个业务入口末尾，用于未知路径和回滚兜底。默认无 `backend_url` 时，未知 proxy 路径返回 `BUSINESS_BACKEND_UNAVAILABLE` 的 502 envelope；401 / 403 不 fallback，`Authorization`、`Cookie` 和 `Set-Cookie` 不转发给 legacy backend。

生成端口规划：

```bash
python scripts/dev.py --write-ports-only
```
