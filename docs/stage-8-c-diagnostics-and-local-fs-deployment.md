# 第 8-C：错误诊断与本地文件系统版部署准备

## 1. 当前阶段结论

第 8-C 是诊断和部署准备阶段，不新增业务功能，不迁移新的 direct API，不修改数据库结构，不去 iframe，不接 MinIO，不接 Celery / RQ / Dramatiq，不统一文件存储，不搬迁业务文件目录。

当前稳定架构仍是：

- Portal 前端承载登录、用户管理、应用占用、feedback 和 iframe 容器。
- `apps/api` 承载 `/api/v1/core` 平台 API、四个业务统一代理入口和部分低风险 direct API。
- 四个业务 iframe 前端优先通过 auth bridge 调用 `apps/api`。
- 四个 legacy 业务后端继续执行未 direct 的业务逻辑、Dify / LLM 调用、文件上传下载、长任务和 stream。
- PostgreSQL 18 保存平台核心数据、已迁移的历史 / 会话 / 任务元数据和业务结构化索引。
- 本地文件系统或部署 volume 保存合同审查与标书生成的主要文件产物。

第 8-C 的交付重点是明确错误边界、request_id 传递、代理日志安全、本地文件系统版部署准备和下一阶段迁移建议。

## 2. 当前运行架构

| 层级 | 当前职责 | 典型路径 / 进程 |
| --- | --- | --- |
| Portal 前端 | 登录、菜单、应用权限、iframe 容器、auth bridge | `legacy/portal-launchpad` |
| `apps/api` | 平台核心 API、统一鉴权、业务代理、部分 direct API | `apps/api`，默认端口 `5220` |
| 业务 iframe 前端 | 四个业务模块 UI，优先调用 `apps/api` 代理入口 | `legacy/*/frontend` 或模块根前端 |
| legacy 业务后端 | 未 direct 的业务逻辑、Dify / LLM、文件处理、stream、任务状态 | 四个 legacy backend |
| PostgreSQL | 平台核心、业务历史、会话、任务元数据、结构化 artifact 索引 | `DATABASE_URL` 或 `POSTGRES_*` |
| Dify / LLM | 工作流、Dataset、LLM 编排与上游流式响应 | 各模块环境变量 |
| 本地文件系统 | 合同审查与标书生成文件产物、缓存、导出、日志 | `legacy/contract_review/data/*`、`legacy/bid-generator/data/*` |

当前不是五个后端已经合并完成的状态。`apps/api` 是统一入口和代理边界，不是统一文件存储、统一任务队列或完整业务执行层。

## 3. 请求链路排错

### Portal core API

- 前端入口：Portal 前端调用 `/api/v1/core/*` 和 `/ws/core/app-usage`。
- 后端入口：`apps/api` 的 `/api/v1/core` router。
- 真实执行方：`apps/api`，数据库访问经 `portal_store` 和 `packages.py_common.db`。
- 常见错误：401 未登录、403 管理员权限不足、PostgreSQL connection error、CORS error、WebSocket 连接失败。
- 日志优先级：浏览器 Network、`apps/api` 日志、PostgreSQL 日志。

### competitor-analysis

- 前端入口：iframe 前端优先请求 `/api/v1/competitor-analysis/...`。
- `apps/api` 入口：`/api/v1/competitor-analysis/{path:path}`。
- direct 路径：`/api/health`、`/api/history*` 由 `apps/api` 直接处理。
- legacy 真实入口：`legacy/company-competitors-analysis` 后端的 `/api/analysis`、`/api/analysis/stream`、`/api/workflows/*`。
- 常见错误：401 / 403、history PostgreSQL 异常、legacy 后端 502、Dify workflow 502、NDJSON stream interrupted。
- 日志优先级：浏览器 Network 和 NDJSON 读取状态、`apps/api` request_id 日志、competitor-analysis 后端日志、Dify workflow 日志、PostgreSQL 日志。

### RAG

- 前端入口：RAG iframe 前端和 Portal knowledgeService 优先请求 `/api/v1/rag/api/v1/...`。
- `apps/api` 入口：`/api/v1/rag/{path:path}`。
- direct 路径：`/api/v1/health`、`/api/v1/sessions`、`/api/v1/conversations`、`/api/v1/conversations/sync`。
- legacy 真实入口：RAG 后端 `/api/v1/chat/stream` 和 `/api/v1/knowledge/*`。
- 常见错误：401 / 403、chat SSE interrupted、Dify Dataset 502、knowledge upload multipart 失败、download `Content-Disposition` 丢失、PostgreSQL conversations 表异常。
- 日志优先级：浏览器 EventStream / Network、`apps/api` 日志、RAG legacy 后端日志、Dify Dataset / Workflow 日志、PostgreSQL 日志。

### contract-review

- 前端入口：合同审查 iframe 前端优先请求 `/api/v1/contract-review/api/...`。
- `apps/api` 入口：`/api/v1/contract-review/{path:path}`。
- legacy 真实入口：合同审查后端 `/api/*`。
- 常见错误：401 / 403、legacy backend unavailable、DOCX/PDF 转换失败、Dify 工作流失败、上传 multipart 失败、`data/uploads` 或 `data/runs` 权限问题、下载 file not found。
- 日志优先级：浏览器 Network、`apps/api` 日志、合同审查后端日志、`data/runs/<run_id>/` 下导出和 pipeline 日志、Dify 日志、PostgreSQL 日志。

### bid-generator

- 前端入口：标书生成 iframe 前端优先请求 `/api/v1/bid-generator/...`。
- `apps/api` 入口：`/api/v1/bid-generator/{path:path}`。
- legacy 真实入口：pipt-lite 后端 `/health` 和 `/api/*`。
- 常见错误：401 / 403、workflow key 缺失、Dify workflow 502、SSE progress interrupted、TaskManager memory 状态丢失、PDF / DOCX / image cache 文件缺失、`PIPT_DB_KEY` 生产配置缺失。
- 日志优先级：浏览器 Network / EventStream、`apps/api` 日志、pipt-lite 后端日志、Dify 日志、PostgreSQL 日志、本地 `data/*` 目录。

## 4. 错误码和排查建议

| 现象 | 边界判断 | 排查建议 |
| --- | --- | --- |
| 401 | 未登录、token 缺失、token 过期或 session 不存在 | 检查 Portal 登录态、请求是否带 `Authorization: Bearer <token>`、`apps/api` auth 日志；401 不 fallback |
| 403 | 当前用户没有应用权限或管理员权限不足 | 检查 Portal 用户权限、`core.user_app_permissions`、iframe appCode；403 不 fallback |
| 404 | 路径错误、代理 path 拼接错误或 legacy 路由不存在 | 对照 `config/apps.yaml` 的 `target_api_prefix`、浏览器请求路径和 legacy README 的真实路径 |
| 502 | legacy backend 不可用、connection refused、Dify / LLM upstream error 或 legacy 自身返回 502 | 先看响应体 code；`BUSINESS_BACKEND_UNAVAILABLE` 是代理连接边界，Dify 502 是 legacy 上游边界 |
| 503 | 服务暂不可用、代理 timeout 或上游主动返回 503 | 检查长任务、Dify / LLM 延迟、文件转换、数据库慢查询；`BUSINESS_PROXY_TIMEOUT` 优先看 legacy 耗时 |
| timeout | 连接、读取、写入或连接池超时 | 看 `request_id`、`app_code`、安全 path；区分 `apps/api` 超时和 legacy 内部上游超时 |
| CORS error | 浏览器 origin、headers 或 credentials 不被后端允许 | 检查 Portal / iframe origin、`apps/api` CORS、legacy CORS；生产环境不要配置无边界 `*` |
| Dify upstream error | legacy 后端调用 Dify / Dataset / LLM 失败 | 检查对应 legacy 后端日志和 Dify 日志；Dify 502 不等于 `apps/api` 崩溃 |
| PostgreSQL connection error | `DATABASE_URL` 或 `POSTGRES_*` 错误、数据库不可达、schema 未初始化 | 执行 `python scripts/check_db.py`、`python scripts/preflight.py --only platform-api`，检查 PostgreSQL 日志 |
| `runtime/ports.json` missing | 启动器尚未写端口文件 | 执行 `python scripts/dev.py --write-ports-only` 或正常通过 `scripts/dev.py` 启动 |
| `runtime/ports.json` stale | 端口文件里的 backend_url 指向旧端口或已退出进程 | 重新执行 `python scripts/dev.py --write-ports-only`，确认实际进程端口和 health URL |
| file not found | legacy 本地文件产物不存在、路径引用过期或 volume 未挂载 | 检查 `run_id` / `project_id`、对应 `data/*` 目录、PostgreSQL 元数据和文件权限 |
| permission denied | 运行用户无本地目录读写权限 | 检查部署用户、volume owner、目录权限；容器内外 UID/GID 必须一致或明确映射 |
| `Content-Disposition` 丢失 | legacy 未返回下载文件名或代理层未暴露响应头 | `business_proxy` 会透传 `Content-Disposition`；继续检查 legacy 响应头和反向代理配置 |
| stream interrupted | SSE / NDJSON 中途断开、浏览器取消、上游异常或代理连接关闭 | 检查浏览器 Network、legacy stream 日志、Dify 上游事件、反向代理 buffering / timeout |

## 5. request_id / 日志边界

`apps/api` 的 `RequestIdMiddleware` 会读取请求头 `X-Request-ID`；如果缺失，则生成新的 request id。响应头始终返回 `X-Request-ID`，平台 envelope 的 `request_id` 也使用同一值。

`business_proxy` 会把 request id 透传给 legacy 后端：

- 传入 header：`X-Request-ID`
- 用户上下文 header：`X-Portal-User-Id`、`X-Portal-User-Account`、`X-Portal-User-Role`
- 客户端上下文 header：`X-Portal-Client-Id`

日志推荐字段：

- `request_id`
- `app_code`
- `method`
- `path` 或安全 path
- `status_code`
- `duration_ms`
- `error_code`

日志禁止内容：

- Portal token、`Authorization`
- Cookie、`Set-Cookie`
- Dify key、workflow key、dataset key
- 数据库密码、SMTP 密码、`PIPT_DB_KEY`
- 文件正文、上传文件内容、DOCX / PDF 原文
- 敏感 query 值

fallback 日志只应说明 fallback 原因、appCode、状态码和安全路径，不应打印完整 auth context。401 / 403 不 fallback。502 / 503 / network error 只允许安全方法自动 fallback；非幂等请求不能自动重发。

## 6. business_proxy 诊断边界

`business_proxy` 的职责是鉴权后代理请求，不重写业务逻辑。当前边界：

- 目标 backend URL 优先来自 `runtime/ports.json`，再回退到 `config/apps.yaml` 开发配置。
- upstream url 日志只打印安全路径；如果存在 query，只打印 `?[redacted]`，不打印敏感 query。
- 连接阶段不可用返回 `BUSINESS_BACKEND_UNAVAILABLE`。
- 代理超时返回 `BUSINESS_PROXY_TIMEOUT`。
- 其它代理请求错误返回 `BUSINESS_PROXY_ERROR`。
- legacy 已返回的业务状态码和响应体保持流式透传，不包装为平台 envelope。
- 保留 `Content-Type` 和 `Content-Disposition`。
- 不转发 `Authorization`、`Cookie`、`Host`。
- 不向浏览器透传 legacy `Set-Cookie`。
- 可转发 `X-Portal-User-Id`、`X-Portal-User-Account`、`X-Portal-User-Role`、`X-Portal-Client-Id`、`X-Request-ID`。
- 请求 body 使用 `request.stream()` 透传，避免破坏 multipart boundary。
- 响应使用 `StreamingResponse`，避免缓冲 SSE / NDJSON / 文件下载。

## 7. 本地文件系统部署边界

需要持久化挂载的目录：

| 模块 | 目录 | 部署要求 |
| --- | --- | --- |
| contract-review | `legacy/contract_review/data/uploads/` | 上传原始合同文件，必须持久化 |
| contract-review | `legacy/contract_review/data/runs/` | 审查产物、转换文件、导出 DOCX、日志，必须持久化 |
| bid-generator | `legacy/bid-generator/data/pdf_cache/` | PDF 预览缓存，建议持久化 |
| bid-generator | `legacy/bid-generator/data/docx_cache/` | 原始 DOCX 和定位恢复缓存，必须持久化 |
| bid-generator | `legacy/bid-generator/data/raw_doc_cache/` | 原文文本缓存，建议持久化 |
| bid-generator | `legacy/bid-generator/data/extracted_images/` | 图片预览和 forge 还原依赖，必须持久化 |
| bid-generator | `legacy/bid-generator/data/projects/` | 项目报告 JSON 镜像，建议持久化 |
| bid-generator | `legacy/bid-generator/data/kb_sync_status/` | 知识库同步状态 JSON，建议短期持久化 |
| bid-generator | `legacy/bid-generator/data/templates/` | 模板配置资产，不按运行缓存清理 |
| bid-generator | `legacy/bid-generator/data/knowledge_base/` | 业务资料，不按运行缓存清理 |

RAG 当前知识库文件由 Dify Dataset 管理，本地 `legacy/chat_with_rag_and_websearch/data/` 只是 legacy 占位或旧缓存。competitor-analysis 当前主要状态在 PostgreSQL，未发现后端报告文件缓存。

容器或 systemd 部署时，以上目录不能放在会随容器重建而丢失的临时层。缺失目录在开发环境可由 legacy 后端按需创建，但生产部署应显式创建、挂载和备份。

## 8. 进程部署边界

建议进程边界：

- `apps/api`：独立 FastAPI / Uvicorn 进程，对外暴露 `/api/v1/core`、四个业务代理入口和 `/ws/core/app-usage`。
- Portal 前端：静态资源部署或 Vite dev server；生产建议静态托管并由反向代理转发 API / WebSocket。
- competitor-analysis 前端：iframe 静态资源；后端为 `backend/server.py`。
- RAG 前端：iframe 静态资源；后端为 FastAPI `app.main:app`。
- contract-review 前端：iframe 静态资源；后端为 FastAPI `web_api:app`。
- bid-generator 前端：iframe 静态资源；后端为 pipt-lite FastAPI `main_lite:app`。
- PostgreSQL：独立数据库服务，不与应用临时容器生命周期绑定。
- Dify / LLM：外部服务；应用只通过环境变量配置其 URL 和 key。

本阶段不做正式 Docker 化大改。现有 `docker/` 和 legacy Docker 文件只能作为参考，不能代表最终生产编排方案。

本地文件系统版部署准备：

- `apps/api`：安装 `apps/api/requirements.txt`，用 Uvicorn / systemd / supervisor 运行 `main:app`，环境变量指向同一 PostgreSQL 和可信 CORS / origin 配置。
- Portal 前端：执行 `npm --prefix legacy/portal-launchpad run build` 后静态托管 `dist/`，或开发环境继续由 `scripts/dev.py` 启动 Vite。
- 四个业务前端：分别构建并静态托管各自 `dist/`，iframe URL 写入运行时配置或反向代理路由；开发环境由 `config/apps.yaml` 的端口规划生成 iframe URL。
- 四个 legacy 后端：分别作为独立进程部署，监听内网端口；浏览器优先访问 `apps/api`，legacy backend 不应作为绕过鉴权的公网入口。
- PostgreSQL：使用 `DATABASE_URL` 或完整 `POSTGRES_*` 指向持久数据库，部署前执行 `python scripts/init_db.py`、`alembic upgrade head` 和 `python scripts/check_db.py`。
- Dify / workflow key：只通过环境变量或部署 secret 注入，不写入 Git；`config/workflows.yaml` 只保留变量名映射。
- 本地文件目录：按第 7 节挂载持久化磁盘，并纳入备份策略；容器部署时不能依赖容器临时层。
- `runtime/ports.json`：只用于本地开发端口发现，不提交；生产部署应由反向代理和环境变量提供稳定地址。

日志目录规划：

- 推荐按进程拆分日志目录，例如 `/var/log/clover-platform/apps-api/`、`/var/log/clover-platform/portal/`、`/var/log/clover-platform/contract-review/`、`/var/log/clover-platform/bid-generator/`、`/var/log/clover-platform/rag-web-search/`、`/var/log/clover-platform/competitor-analysis/`。
- 应用日志至少包含 `request_id`、`app_code`、path、安全错误码和状态码；长任务日志要能关联 `run_id`、`project_id` 或 `task_id`。
- 合同审查 `data/runs/<run_id>/` 下的 pipeline / export 日志属于业务运行产物，应随 run 目录持久化；不要把它们混同为可随意轮转删除的通用进程日志。
- 日志轮转应避免压缩或删除仍在排查窗口内的长任务日志；日志中不得写 token、key、密码、Cookie 或文件正文。

## 9. 环境变量边界

数据库：

- 优先使用 `DATABASE_URL`。
- 或使用 `POSTGRES_HOST`、`POSTGRES_PORT`、`POSTGRES_DB`、`POSTGRES_USER`、`POSTGRES_PASSWORD`。

Dify / workflow：

- contract-review：`DIFY_BASE_URL`、`DIFY_CLAUSE_WORKFLOW_API_KEY`、`DIFY_ANCHORED_RISK_WORKFLOW_API_KEY`、`DIFY_MISSING_MULTI_RISK_WORKFLOW_API_KEY`、`DIFY_FAST_SCREEN_WORKFLOW_API_KEY`、`DIFY_REWRITE_WORKFLOW_API_KEY` 等。
- RAG：`UPSTREAM_URL`、`UPSTREAM_BEARER_TOKEN`、`DIFY_API_BASE_URL`、`DIFY_DATASET_API_KEY`、`DIFY_DEFAULT_DATASET_ID`。
- competitor-analysis：`WORKFLOW_URL`、`WORKFLOW_API_KEY`、`WORKFLOW_USER`、`COMPANY_*`、`COMPARE_REPORT_*`、`SCORE_*` 等模块变量。
- bid-generator：`DIFY_API_URL`、`DIFY_DATASET_API_KEY`、`DIFY_WORKFLOW_*`、`PIPT_DB_KEY`、`PIPT_ENV`。

平台与反馈：

- `PORTAL_SMTP_*`
- `PORTAL_TICKET_EMAIL_TO`
- `PORTAL_FEATURE_REQUEST_EMAIL_TO`
- `PORTAL_CAPTCHA_SECRET`

CORS / origin：

- `apps/api` 在 dev / local / test 只允许 `localhost` 和 `127.0.0.1` 任意端口。
- 生产环境应显式配置可信 Portal 和 iframe origin，不要使用无边界 `*`。

配置原则：

- 不要把 secret 写入 `config/apps.yaml`。
- `config/workflows.yaml` 只登记 env 变量名，不保存真实 key。
- 不要提交 `.env`、`.env.local`、日志文件、数据库文件或 `runtime/ports.json`。
- 部署时用 secret manager、环境变量或受控配置注入真实 key。

## 10. 健康检查路径

| 服务 | 通过 `apps/api` | legacy 直连 |
| --- | --- | --- |
| `apps/api` core | `GET /api/v1/core/health` | 同左 |
| `apps/api` DB | `GET /api/v1/core/health/db` | 同左 |
| competitor-analysis | `GET /api/v1/competitor-analysis/api/health` | `GET /api/health` |
| RAG | `GET /api/v1/rag/api/v1/health` | `GET /api/v1/health` |
| contract-review | `GET /api/v1/contract-review/api/health` | `GET /api/health` |
| bid-generator | `GET /api/v1/bid-generator/health` | `GET /health` |

注意：

- competitor-analysis 和 RAG 的 health 已 direct 到 `apps/api`，不代表 legacy 后端所有复杂业务可用。
- contract-review 和 bid-generator 的 health 仍经代理访问 legacy 后端。
- `GET /api/v1/core/modules/health` 用于平台模块注册健康概览，不替代真实业务 smoke test。

## 11. 反向代理 / CORS 边界

生产反向代理建议：

- Portal 前端、四个 iframe 前端、`apps/api` 和四个 legacy 后端分别有清晰 upstream。
- 浏览器业务 API 优先只暴露 `apps/api` 统一入口；legacy 后端可只在内网被 `apps/api` 访问。
- WebSocket `/ws/core/app-usage` 需要反向代理支持 Upgrade。
- SSE / NDJSON 路径要关闭或放宽代理 buffering，并配置足够长的 read timeout。
- 下载路径要保留 `Content-Type`、`Content-Disposition` 和 `X-Request-ID`。

CORS 边界：

- Portal 前端 origin 和四个业务 iframe 前端 origin 必须是可信 origin。
- `apps/api` 需要允许 `Authorization`、`X-Portal-Client-Id`、`X-Request-ID`、multipart 所需 headers。
- 生产环境不能无脑使用 `Access-Control-Allow-Origin: *` 搭配凭证请求。
- iframe auth bridge 的 origin 校验依赖可信 `iframeUrl` 配置；runtime apps 或静态配置被污染会影响 bridge 信任边界。
- fallback 到 legacy backend 时不能携带 Portal `Authorization` 和 `X-Portal-Client-Id`。

## 12. 当前明确不做

- 不接 MinIO。
- 不接 S3 SDK。
- 不引入 Celery / RQ / Dramatiq。
- 不新增统一任务表。
- 不统一文件存储。
- 不搬迁业务文件目录。
- 不改文件上传 / 下载逻辑。
- 不改业务任务状态机制。
- 不去 iframe。
- 不完整迁业务逻辑。
- 不迁移新的 direct API。
- 不修改数据库结构。
- 不新增 Alembic migration。
- 不做生产 Docker 化大改。

## 13. 第 8-D 建议

下一阶段建议进入第 8-D：低风险 direct API 迁移评估与试点。

可优先评估的对象应满足：

- 无长任务。
- 无复杂文件副作用。
- 不依赖 stream 协议。
- 不要求立即改变前端交互协议。
- 可保持 legacy 成功响应兼容。

不要直接迁移以下复杂链路：

- RAG chat stream。
- RAG knowledge Dataset。
- contract-review 主审查流程、DOCX 导出、AI 改写。
- bid-generator Dify workflow、SSE 任务、forge-document。
