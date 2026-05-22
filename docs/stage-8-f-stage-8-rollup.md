# 第 8-F：第 8 阶段收口

## 1. 当前阶段结论

第 8 阶段已经完成工程化稳定、文件与任务边界、错误诊断、本地文件系统部署准备，以及两批低风险 direct API 迁移。当前系统进入 `apps/api` direct/proxy 混合阶段：已确认低风险接口由 `apps/api` 直接执行，复杂业务链路仍由 legacy backend 执行并通过 `apps/api` 鉴权代理透传。

当前稳定边界如下：

- 继续保留四个业务 iframe。
- 继续保留本地文件系统，合同审查和标书生成的运行产物目录仍需持久化挂载。
- 继续沿用各业务模块原有任务状态机制。
- 暂不引入 MinIO / S3。
- 暂不引入 Celery / RQ / Dramatiq。
- 不规划长任务队列预留口。
- 不规划对象存储预留口。
- 暂不修改数据库结构，不新增 Alembic migration。
- 不迁移新的 API，不改业务前端，不改 legacy 后端。
- 第 8 阶段可以按当前边界收口。
- 第 9 阶段将在第 8 阶段收口后单独规划，本阶段不展开第 9 阶段详细任务。

## 2. 第 8 阶段完成情况

### 8-A：回归基线与开发启动稳定化

- 将第 7-M 的业务代理与 iframe auth bridge 验收结果固化为回归基线。
- 稳定 `scripts/dev.py`、`scripts/preflight.py` 和 `--write-ports-only` 验证路径。
- 明确四个业务 iframe、业务 proxy、direct API 和 fallback 安全边界的回归清单。

### 8-B：本地文件系统与任务状态边界

- 梳理合同审查、标书生成、RAG 和竞对分析的本地文件产物目录。
- 明确合同审查 `data/uploads`、`data/runs` 和标书生成 `data/pdf_cache`、`data/docx_cache`、`data/raw_doc_cache`、`data/extracted_images`、`data/projects`、`data/kb_sync_status` 等目录需要持久化。
- 明确 RAG 当前知识库文件由 Dify Dataset 管理，竞对分析当前主要写 PostgreSQL。
- 明确可清理目录和不可随意清理的配置 / 业务资料目录。
- 明确任务状态继续沿用 legacy：合同审查继续使用 `run_id`、后台 pipeline 和 run 目录产物；标书生成继续使用 legacy `TaskManager`、`task_id`、SSE progress、status 轮询和 cancel 协议。
- 明确当前不引入 MinIO、不引入 Celery/RQ、不做统一任务队列。

### 8-C：错误诊断与本地文件系统版部署准备

- 明确 Portal core API、四个业务入口、legacy backend、PostgreSQL、Dify / LLM 和本地文件系统的请求链路排错边界。
- 明确 `request_id` / `X-Request-ID` 的生成、响应和透传边界。
- 明确 `business_proxy` 的诊断边界：目标地址解析、连接失败、超时、日志安全、流式请求和流式响应。
- 明确本地文件系统版部署准备，包括独立进程、持久化目录、日志目录、健康检查、反向代理和 CORS 边界。
- 明确 401 / 403 不 fallback，502 / network error fallback 受控。

### 8-D：低风险 direct API 批次 1

第 8-D 完成第一批低风险、只读、无副作用、不依赖 legacy 进程内任务状态、不访问 Dify、不读写业务文件的 direct API：

- `GET /api/v1/contract-review/api/health`
- `GET /api/v1/contract-review/api/config`
- `GET /api/v1/bid-generator/health`
- `GET /api/v1/bid-generator/api/config/workflow-status`
- `GET /api/v1/bid-generator/api/config/analysis-framework`
- `GET /api/v1/bid-generator/api/entities`

本批暂缓：

- `GET /api/v1/contract-review/api/diagnostics/converters` 继续 proxy，因为该接口应反映 legacy 合同审查后端所在 Python / LibreOffice / PDF 转换环境。
- RAG `chat/stream`、RAG `knowledge/**`、合同审查 `reviews/**`、标书生成 Dify workflow / SSE task / forge / export / 文件预览下载、bid-generator `knowledge/**` 和 `kb/**` 继续 proxy。

### 8-E：低风险查询类 direct API 批次 2

第 8-E 完成第二批低风险、查询类、只读、无副作用、不依赖 legacy 进程内任务状态、不访问 Dify、不读写业务文件的 direct API：

- `GET /api/v1/bid-generator/api/projects`
- `GET /api/v1/bid-generator/api/projects/{project_id}`
- `GET /api/v1/bid-generator/api/projects/{project_id}/mappings`

本批暂缓：

- 合同审查 `GET /api/v1/contract-review/api/reviews/history` 和 `GET /api/v1/contract-review/api/reviews/{run_id}` 继续 proxy，因为 legacy 实现会读取 `data/runs` 产物并推断 / 修复运行状态。
- RAG chat stream、RAG knowledge Dataset、竞对分析 analysis / workflows / stream、标书生成 Dify workflow / SSE task / forge / export / 文件预览下载继续 proxy。

## 3. 当前统一业务入口

当前四个业务统一入口为：

- `/api/v1/competitor-analysis/**`
- `/api/v1/rag/**`
- `/api/v1/contract-review/**`
- `/api/v1/bid-generator/**`

所有入口都经过 Portal session 鉴权和 app permission 校验。未登录返回 401，无应用权限返回 403，401 / 403 不 fallback。未 direct 的 API 继续 proxy 到 legacy backend；fallback 到 legacy backend 时不携带 Portal token。

## 4. 当前 direct API 清单

以下清单以当前 `apps/api` 源码为准。

### A. competitor-analysis

- `GET /api/v1/competitor-analysis/api/health`
- `GET /api/v1/competitor-analysis/api/history`
- `GET /api/v1/competitor-analysis/api/history/{history_id}`
- `POST /api/v1/competitor-analysis/api/history`
- `DELETE /api/v1/competitor-analysis/api/history`
- `DELETE /api/v1/competitor-analysis/api/history/{history_id}`

### B. RAG

- `GET /api/v1/rag/api/v1/health`
- `POST /api/v1/rag/api/v1/sessions`
- `GET /api/v1/rag/api/v1/conversations`
- `PUT /api/v1/rag/api/v1/conversations/sync`

### C. contract-review

- `GET /api/v1/contract-review/api/health`
- `GET /api/v1/contract-review/api/config`

`diagnostics/converters`、history、status、result、document、download、风险状态修改和 AI 改写相关接口仍 proxy。

### D. bid-generator

- `GET /api/v1/bid-generator/health`
- `GET /api/v1/bid-generator/api/config/workflow-status`
- `GET /api/v1/bid-generator/api/config/analysis-framework`
- `GET /api/v1/bid-generator/api/entities`
- `GET /api/v1/bid-generator/api/projects`
- `GET /api/v1/bid-generator/api/projects/{project_id}`
- `GET /api/v1/bid-generator/api/projects/{project_id}/mappings`

项目写入、Dify workflow、SSE task、tasks progress / cancel、文件预览下载、knowledge / kb 和导出相关接口仍 proxy。

## 5. 当前仍 proxy 的 API 清单

### A. competitor-analysis

- `POST /api/v1/competitor-analysis/api/analysis`
- `POST /api/v1/competitor-analysis/api/analysis/stream`
- `POST /api/v1/competitor-analysis/api/workflows/validate`
- `POST /api/v1/competitor-analysis/api/workflows/company-name-validate`
- `POST /api/v1/competitor-analysis/api/workflows/company-detail`
- `POST /api/v1/competitor-analysis/api/workflows/compare-report`
- `POST /api/v1/competitor-analysis/api/workflows/score`
- 其它 LLM / 外部搜索 / Dify 类复杂分析链路。

### B. RAG

- `POST /api/v1/rag/api/v1/chat/stream`
- `/api/v1/rag/api/v1/knowledge/**`
- knowledge Dataset 文件上传 / 下载 / 删除相关接口。
- Dify Dataset 相关文档创建、列表、详情、下载和删除接口。

### C. contract-review

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

### D. bid-generator

- Dify workflow 启动类接口。
- `POST /api/v1/bid-generator/api/projects`、`PUT /api/v1/bid-generator/api/projects/{project_id}`、`PATCH /api/v1/bid-generator/api/projects/{project_id}`、`DELETE /api/v1/bid-generator/api/projects/{project_id}`、`POST /api/v1/bid-generator/api/projects/batch`。
- `POST /api/v1/bid-generator/api/projects/extract`
- `POST /api/v1/bid-generator/api/projects/extract-stream`
- `POST /api/v1/bid-generator/api/projects/generate-outline`
- `POST /api/v1/bid-generator/api/projects/generate-outline-stream`
- `POST /api/v1/bid-generator/api/projects/generate-content`
- `POST /api/v1/bid-generator/api/projects/generate-content-stream`
- `/api/v1/bid-generator/api/tasks/**`，包括 start、status、progress、cancel。
- `POST /api/v1/bid-generator/api/projects/forge-document`
- `POST /api/v1/bid-generator/api/projects/export-report`
- `POST /api/v1/bid-generator/api/projects/export-scoring-table`
- `/api/v1/bid-generator/api/knowledge/**`
- `/api/v1/bid-generator/api/kb/**`
- PDF / DOCX / 图片预览下载、附件提取、DOCX 切片、缓存重建和缓存删除相关接口。

## 6. 暂缓 direct 的原因

复杂链路暂缓 direct 的原因如下：

- 涉及 Dify / LLM 外部调用，失败语义、超时、重试和上游错误需要按模块专项迁移。
- 涉及 SSE / NDJSON 流式协议，不能在没有兼容方案时改变事件格式、重连和中断处理。
- 涉及本地文件系统产物，例如合同审查 `data/runs`、标书生成 PDF / DOCX / 图片缓存。
- 涉及 DOCX / PDF / Excel 生成和下载，必须保留 `Content-Type`、`Content-Disposition` 和文件路径安全边界。
- 涉及 AI 改写、接受、撤销和风险状态落盘，状态同时存在数据库和 JSON artifact。
- 涉及进程内 `TaskManager`、pipeline、后台线程和取消语义，当前不引入统一任务队列。
- 涉及 knowledge Dataset 和 Dify Dataset，同步状态、远端文档状态和本地业务资料不能零散迁移。
- 这些链路后续需要按模块逐步迁移，而不是在第 8 阶段跨模块零散迁移。

## 7. 当前部署边界

- `apps/api` 独立 FastAPI 进程，承载 `/api/v1/core`、四个业务统一入口和 `/ws/core/app-usage`。
- Portal 前端独立部署，承载登录、菜单、权限、app usage、feedback 和 iframe 容器。
- 四个业务前端仍作为 iframe 应用部署。
- 四个 legacy 业务后端当前仍作为真实业务执行方或 fallback。
- PostgreSQL 作为统一数据库，保存平台核心数据、已迁移业务历史、会话、运行元数据和结构化索引。
- 本地文件系统目录必须持久化挂载，尤其是合同审查和标书生成的运行产物目录。
- Dify / LLM 作为外部依赖，通过环境变量或部署 secret 注入。
- 不接 MinIO，不接 Celery / RQ，不做统一任务队列。

## 8. 当前安全边界

- Portal token 只通过 auth bridge 传给 iframe。
- token 不进入 URL query/hash。
- token 不写 console。
- token 不写长期 `localStorage`。
- iframe 调用 `apps/api` 时携带 `Authorization: Bearer <token>` 和 `X-Portal-Client-Id`。
- `business_proxy` 不转发 `Authorization`、`Cookie`、`Host` 给 legacy backend。
- `business_proxy` 不向浏览器透传 legacy `Set-Cookie`。
- legacy backend 只接收 `X-Portal-User-Id`、`X-Portal-User-Account`、`X-Portal-User-Role`、`X-Portal-Client-Id`、`X-Request-ID` 等非敏感上下文。
- 401 / 403 不 fallback。
- 502 / 503 / network error fallback 受控，非幂等请求不自动重复提交到 legacy。

## 9. 第 8 阶段验收清单

必须保留的验证命令：

```bash
python -m compileall -q packages scripts alembic apps/api legacy/portal-launchpad/backend
python scripts/preflight.py --only platform-api
python scripts/dev.py --write-ports-only
npm --prefix legacy/portal-launchpad run build
```

如修改了四个业务前端，必须额外执行对应业务前端 build。本阶段只做文档收口，不要求业务前端 build。

必须确认的路由：

- `/api/v1/core/health`
- `/api/v1/competitor-analysis/{path:path}`
- `/api/v1/rag/{path:path}`
- `/api/v1/contract-review/{path:path}`
- `/api/v1/bid-generator/{path:path}`

## 10. 当前风险和注意事项

- direct/proxy 混合状态需要文档持续同步，避免 README、阶段文档和源码不一致。
- direct routes 必须定义在 catch-all proxy 前，否则会被 proxy 捕获。
- 复杂 API 不要因为路径简单或 HTTP 方法是 GET 就 direct，必须确认没有文件、任务、Dify、stream 或状态修复副作用。
- Dify 502 不等于 `apps/api` 崩溃，应结合 legacy backend 日志和 Dify 日志排查。
- 本地文件目录部署时必须挂载持久化磁盘，容器临时层不能作为合同审查和标书生成产物主存储。
- 如果未来要多实例部署，需要重新评估本地文件系统、进程内任务状态、SSE 重连和取消语义。
- 后续阶段按模块迁移时，每个模块都要先读源码并给出阶段内迁移清单。

## 11. 后续阶段说明

- 第 9 阶段将在第 8 阶段收口后单独规划。
- 第 9 阶段预计围绕业务模块实现迁移展开。
- 本阶段不制定第 9 阶段详细路线。
- 本阶段不拆分第 9 阶段任务。
- 本阶段不迁移新 API。
