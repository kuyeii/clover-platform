# 第 7-A 阶段：业务模块 API 迁入 apps/api 评估

## 0. 阶段边界

- 当前分支已确认：`codex/stage-6-platform-api`。
- 本文只做源码审计、接口清单、风险评估、迁移顺序设计和验收/回滚方案。
- 本阶段不迁移任何业务模块 API，不修改 legacy 业务逻辑、前端、iframe、JWT、Portal session、数据库表结构或 Alembic migration。
- 审计依据包含四个 legacy 模块源码、`apps/api` 当前实现、`config/apps.yaml`、`config/workflows.yaml`、`packages/py_common/db/ddl.py` 以及整合规范文档。

## 1. 问题原因与当前结论

当前 `apps/api` 只承载统一后端基座能力，包括 health、runtime apps、auth/users、app-usage、feedback 和 WebSocket app-usage；它还没有承载四个业务模块的业务 API。四个业务模块仍由各自 legacy 后端直接服务 iframe 前端：

| 模块 | 当前后端形态 | 当前 API 前缀 | 主要复杂点 |
| --- | --- | --- | --- |
| competitor-analysis | Python `http.server` + `ThreadingHTTPServer` | `/api/*` | NDJSON 流式分析、多个 Dify workflow、PostgreSQL 历史/缓存 |
| rag-web-search | FastAPI | `/api/v1/*` | SSE 问答、Dify Dataset 代理、文件上传到 Dify、知识库导出 |
| contract-review | FastAPI | `/api/*` | 文件上传/下载、后台线程、子进程、DOCX/PDF 转换、AI 改写、强文件产物依赖 |
| bid-generator | FastAPI | `/api/*` | 大量项目/任务/知识库/文档 API、SSE、后台任务、Dify workflow、文件缓存、DocumentForge |

总体判断：

- 可以先用 `apps/api` 做权限校验后的反向代理，保持 legacy 后端和 iframe 可回滚。
- 直接重写业务逻辑的顺序应从 `competitor-analysis` 试点开始，再迁 `rag-web-search`，随后 `bid-generator`，最后 `contract-review`。
- `contract-review` 和 `bid-generator` 的长任务、文件产物和生成链路复杂，不适合在第一个业务迁移阶段直接重写。
- 本阶段不建议去 iframe，也不建议改 JWT 或 Portal session。

## 2. 统一规范约束

整合规范要求统一 API 最终采用 `/api/v1` 前缀，并按业务模块分组：

- `/api/v1/competitor-analysis/...`
- `/api/v1/rag/...`
- `/api/v1/contract-review/...`
- `/api/v1/bid-generator/...`

第一阶段允许保留旧路径代理，前端逐步切换。业务模块接入 `apps/api` 后应满足：

- router 由 `apps/api/main.py` 或其聚合 router include。
- 业务模块保留 service/repository 分层，router 不直接写复杂业务。
- 数据库模型必须使用业务 schema，不落默认 `public`。
- Dify 调用最终应收敛到公共 client。
- 文件读写最终应收敛到公共 storage，并补齐 `core.files` 元数据。
- 长任务最终应进入 `core.jobs` 或统一任务状态表。

注意：`config/apps.yaml` 中 RAG 当前 `target_api_prefix` 是 `/api/v1/rag-web-search`，整合规范正文建议是 `/api/v1/rag`。后续实施前应统一命名，建议以规范中的 `/api/v1/rag` 作为最终业务前缀，并保留 `/api/v1/rag-web-search` 兼容代理。

## 3. 模块审计：competitor-analysis

### 3.1 当前后端入口

- 目录：`legacy/company-competitors-analysis`
- 后端入口：`legacy/company-competitors-analysis/backend/server.py`
- 启动方式：`python backend/server.py --host 0.0.0.0 --port {backend_port}`
- 技术形态：`BaseHTTPRequestHandler` + `ThreadingHTTPServer`
- 统一启动配置：`config/apps.yaml` 中 `competitor_analysis.dev.backend_command`
- 静态文件：非 `/api` 路径会尝试从 `STATIC_DIR` 托管前端构建产物。

### 3.2 当前 API 清单

| 方法 | 路径 | 说明 | 特性 |
| --- | --- | --- | --- |
| GET | `/api/health` | 健康检查 | 普通 JSON |
| GET | `/api/history` | 历史记录列表 | PostgreSQL |
| GET | `/api/history/{id}` | 单条历史记录 | PostgreSQL |
| POST | `/api/history` | 保存历史记录 | PostgreSQL |
| DELETE | `/api/history` | 清空历史记录 | PostgreSQL |
| DELETE | `/api/history/{id}` | 删除单条历史记录 | PostgreSQL |
| POST | `/api/analysis` | 完整阻塞式分析 | Dify、PostgreSQL |
| POST | `/api/analysis/stream` | 完整流式分析 | NDJSON、Dify、PostgreSQL |
| POST | `/api/workflows/validate` | 输入校验/自动发现竞对 | Dify |
| POST | `/api/workflows/company-name-validate` | 企业名称候选校验与缓存查询 | Dify、PostgreSQL 缓存，支持 `cacheOnly` |
| POST | `/api/workflows/company-detail` | 企业详情补全 | Dify、缓存 |
| POST | `/api/workflows/compare-report` | 对比报告生成 | Dify，内部可能拆产品/技术/近期/汇总子工作流 |
| POST | `/api/workflows/score` | 评分报告生成 | Dify |

`/api/analysis/stream` 返回 `application/x-ndjson`，事件格式是每行 JSON：`{"type": "...", "data": ...}`。这与统一规范推荐的 SSE 事件格式不同，迁移时应保留旧 NDJSON 兼容层，后续再增加 SSE 或统一事件结构。

### 3.3 当前前端调用

前端 API 入口集中在 `legacy/company-competitors-analysis/src/services`：

| 文件 | 调用路径 |
| --- | --- |
| `analysisApi.js` | `/api/analysis`、`/api/analysis/stream`、`/api/history`、`/api/history/{id}` |
| `workflowApi.js` | `/api/workflows/validate`、`/api/workflows/company-name-validate` |
| `companyDetailApi.js` | `/api/workflows/company-detail` |
| `compareReportApi.js` | `/api/workflows/compare-report` |
| `scoreApi.js` | `/api/workflows/score` |

前端通过 `VITE_API_BASE_URL` 拼接后端基址。报告 DOCX 导出由前端 `docxExport.js` 客户端生成，不依赖后端下载接口。

### 3.4 PostgreSQL schema / 表

schema：`competitor_analysis`

实际表来自 `packages/py_common/db/ddl.py` 和 `backend/repository.py`：

- `competitor_analysis.history_records`
- `competitor_analysis.storage_meta`
- `competitor_analysis.company_profiles`
- `competitor_analysis.company_validation_queries`

### 3.5 文件系统运行产物

- 后端自身没有核心业务文件产物目录。
- 非 API 路径可托管 `STATIC_DIR` 下构建产物。
- 前端流式状态会用 `sessionStorage` 暂存。
- DOCX 导出在浏览器端生成，不落后端文件。

### 3.6 外部服务依赖

| 依赖 | 环境变量/配置 | 说明 |
| --- | --- | --- |
| Dify Workflow API | `WORKFLOW_URL`、`WORKFLOW_API_KEY`、`WORKFLOW_USER` | 输入校验/竞对发现 |
| Dify 企业名称校验 | `COMPANY_NAME_VALIDATION_URL`、`COMPANY_NAME_VALIDATION_API_KEY` | 企业候选校验与缓存 |
| Dify 企业详情 | `COMPANY_DETAIL_URL`、`COMPANY_DETAIL_API_KEY`、`COMPANY_DETAIL_TIMEOUT_SECONDS` | 企业详情补全 |
| Dify 对比报告 | `COMPARE_REPORT_*` | 产品、技术、近期、汇总子工作流及回退 |
| Dify 评分 | `SCORE_URL`、`SCORE_API_KEY` | 评分报告 |
| PostgreSQL | `DATABASE_URL` 或 `POSTGRES_*` | 历史和缓存 |

未发现 SMTP、WebSocket、本地文件上传下载依赖。Web Search 若存在，应属于 Dify workflow 内部能力，legacy 代码未直接调用搜索服务。

### 3.7 复杂度、风险与迁移方式

| 维度 | 等级 | 说明 |
| --- | --- | --- |
| API 复杂度 | 中 | API 数量少，无上传下载，但有 NDJSON 流式、多个 Dify workflow、并发调用和历史写入 |
| 迁移风险 | 中偏低 | 数据已在 PostgreSQL，文件依赖少，易保留旧路径；主要风险是流式协议和 Dify 输出解析 |
| 推荐迁移方式 | 先代理，再直接复用 service/repository | 先用 `apps/api` 反向代理旧 `/api/*`，再把 repository 和 orchestration 收敛进 `apps/api` |

### 3.8 可低风险迁入的 API

- `GET /api/health`
- `GET /api/history`
- `GET /api/history/{id}`
- `POST /api/history`
- `DELETE /api/history`
- `DELETE /api/history/{id}`
- `POST /api/workflows/company-name-validate` 的 `cacheOnly` 路径

这些 API 主要依赖 PostgreSQL repository 或简单健康检查，文件和长任务边界较少。

### 3.9 不适合马上直接重写的 API

- `POST /api/analysis`
- `POST /api/analysis/stream`
- `POST /api/workflows/validate`
- `POST /api/workflows/company-detail`
- `POST /api/workflows/compare-report`
- `POST /api/workflows/score`

原因是这些路径包含大量 Dify 输出清洗、兼容旧字段、重试、并发编排、demo fallback 和阶段性保存逻辑。第一步应通过代理保持行为不变，第二步再迁移 service。

## 4. 模块审计：rag-web-search

### 4.1 当前后端入口

- 目录：`legacy/chat_with_rag_and_websearch`
- 后端入口：`legacy/chat_with_rag_and_websearch/backend/app/main.py`
- 启动方式：`python -m uvicorn app.main:app --host 0.0.0.0 --port {backend_port}`
- 技术形态：FastAPI
- include router：
  - `app.api.routes`
  - `app.api.conversation_routes`
  - `app.api.knowledge_routes`

### 4.2 当前 API 清单

| 方法 | 路径 | 说明 | 特性 |
| --- | --- | --- | --- |
| GET | `/api/v1/health` | 健康检查 | 普通 JSON |
| POST | `/api/v1/sessions` | 创建会话 ID | 普通 JSON |
| POST | `/api/v1/chat/stream` | 流式问答 | SSE，保存 chat turn |
| GET | `/api/v1/conversations` | 对话列表 bootstrap | PostgreSQL |
| PUT | `/api/v1/conversations/sync` | 同步前端对话列表 | PostgreSQL |
| GET | `/api/v1/knowledge/documents` | Dify 知识库文档列表 | Dify Dataset 代理 |
| POST | `/api/v1/knowledge/documents/create-by-text` | 文本创建知识库文档 | Dify Dataset，轮询 indexing |
| POST | `/api/v1/knowledge/documents/create-by-file` | 文件创建知识库文档 | 上传文件转发 Dify，轮询 indexing |
| GET | `/api/v1/knowledge/documents/{document_id}/detail` | 文档详情+segments 聚合 | Dify Dataset 代理 |
| GET | `/api/v1/knowledge/documents/{document_id}/download` | 导出文档详情 | markdown/json 下载响应 |
| DELETE | `/api/v1/knowledge/documents/{document_id}` | 删除知识库文档 | Dify Dataset 代理 |

`/api/v1/chat/stream` 输出 `text/event-stream`，事件内容为 `data: {"type": "session|delta|done|error", ...}`。

### 4.3 当前前端调用

前端集中在 `legacy/chat_with_rag_and_websearch/frontend/src/lib/api.ts`：

- `GET /api/v1/conversations`
- `PUT /api/v1/conversations/sync`
- `POST /api/v1/chat/stream`
- `GET /api/v1/knowledge/documents`
- `POST /api/v1/knowledge/documents/create-by-file`
- `POST /api/v1/knowledge/documents/create-by-text`
- `GET /api/v1/knowledge/documents/{document_id}/detail`
- `DELETE /api/v1/knowledge/documents/{document_id}`

Portal 的 `legacy/portal-launchpad/src/services/knowledgeService.ts` 会读取 runtime apps 中 `rag-web-search` 的 `backendUrl`，再访问 RAG 后端知识库接口。RAG API 迁入 `apps/api` 后，这一处需要同步评估，不能只改 RAG iframe 前端。

### 4.4 PostgreSQL schema / 表

schema：`rag`

实际表：

- `rag.conversations`
- `rag.chat_turns`

当前未发现本地 `rag.knowledge_documents` 表，知识库文档状态主要代理 Dify Dataset。

### 4.5 文件系统运行产物

- 后端没有长期本地文件产物。
- 上传文件由 `UploadFile` 读入内存后以 multipart 转发到 Dify Dataset。
- 文档下载接口动态聚合 Dify segments，返回 markdown/json，不落本地文件。
- 前端仍有本地/会话存储的兼容逻辑。

### 4.6 外部服务依赖

| 依赖 | 环境变量/配置 | 说明 |
| --- | --- | --- |
| Dify-style streaming workflow | `UPSTREAM_URL`、`UPSTREAM_BEARER_TOKEN`、`UPSTREAM_TIMEOUT_SECONDS` | 问答流，`allow_search` 作为输入传给上游 |
| Dify Dataset API | `DIFY_API_BASE_URL`、`DIFY_DATASET_API_KEY`、`DIFY_DEFAULT_DATASET_ID` | 知识库文档列表、上传、详情、删除 |
| PostgreSQL | `DATABASE_URL` 或 `POSTGRES_*` | 对话和 chat turn |

未发现 SMTP、WebSocket。Web Search 由上游 workflow 根据 `allow_search` 执行，legacy 后端不直接调用搜索 API。

### 4.7 复杂度、风险与迁移方式

| 维度 | 等级 | 说明 |
| --- | --- | --- |
| API 复杂度 | 中偏高 | API 数量适中，但有 SSE、文件上传、Dify Dataset 轮询、下载响应 |
| 迁移风险 | 中 | FastAPI 结构清晰，容易迁入；风险在 streaming、Portal knowledgeService backendUrl 和 Dataset API 密钥隔离 |
| 推荐迁移方式 | 并行实现/直接复用现有 router + service | 先代理保持 `/api/v1/*`，再把 router/service 移入 `apps/api` 并挂到 `/api/v1/rag`，保留旧前缀兼容 |

### 4.8 可低风险迁入的 API

- `GET /api/v1/health`
- `POST /api/v1/sessions`
- `GET /api/v1/conversations`
- `PUT /api/v1/conversations/sync`

### 4.9 不适合马上直接重写的 API

- `POST /api/v1/chat/stream`
- `POST /api/v1/knowledge/documents/create-by-file`
- `POST /api/v1/knowledge/documents/create-by-text`
- `GET /api/v1/knowledge/documents/{document_id}/detail`
- `GET /api/v1/knowledge/documents/{document_id}/download`
- `DELETE /api/v1/knowledge/documents/{document_id}`

这些接口需要保持 SSE、上传、Dify Dataset 错误映射和轮询行为。可以先代理或直接搬迁原 service，不建议重写协议。

## 5. 模块审计：contract-review

### 5.1 当前后端入口

- 目录：`legacy/contract_review`
- 后端入口：`legacy/contract_review/web_api.py`
- 启动方式：`python -m uvicorn web_api:app --host 0.0.0.0 --port {backend_port}`
- 技术形态：FastAPI
- 关键后台流程：
  - `POST /api/reviews` 接收文件后写入 `data/uploads`
  - 后台 daemon thread 调 `_run_pipeline`
  - `_run_pipeline_impl` 调 `app.py` 子进程执行主审查流程
  - 结果写入 `data/runs/{run_id}`
  - JSON/text/file artifact 同步索引到 PostgreSQL

### 5.2 当前 API 清单

| 方法 | 路径 | 说明 | 特性 |
| --- | --- | --- | --- |
| GET | `/api/config` | 当前审查配置 | 普通 JSON |
| GET | `/api/health` | 健康检查 | 普通 JSON |
| GET | `/api/diagnostics/converters` | LibreOffice/pdf2docx/PyMuPDF 诊断 | 本地依赖检查 |
| POST | `/api/reviews` | 创建审查任务 | 文件上传、后台线程、子进程 |
| GET | `/api/reviews/history` | 审查历史 | PostgreSQL + 文件状态修复 |
| GET | `/api/reviews/{run_id}` | 审查状态 | PostgreSQL + 文件状态修复 |
| GET | `/api/reviews/{run_id}/result` | 审查结果 | 读取 JSON artifacts |
| GET | `/api/reviews/{run_id}/document` | 原/工作 DOCX | 文件下载 |
| GET | `/api/reviews/{run_id}/download` | 导出接受改写后的 DOCX | 文件生成 + 下载 |
| PATCH | `/api/reviews/{run_id}/risks/{risk_id}` | 更新风险状态 | 修改 reviewed artifact |
| POST | `/api/reviews/{run_id}/risks/accept_all` | 批量接受风险 | 修改 reviewed artifact |
| POST | `/api/reviews/{run_id}/risks/{risk_id}/ai_apply` | 单风险 AI 改写 | Dify rewrite |
| POST | `/api/reviews/{run_id}/ai_apply_all` | 批量 AI 改写 | Dify rewrite，并发 |
| POST | `/api/reviews/{run_id}/risks/{risk_id}/ai_accept` | 接受 AI 改写 | 修改 reviewed artifact |
| PATCH | `/api/reviews/{run_id}/risks/{risk_id}/ai_edit` | 编辑 AI 改写文本 | 修改 reviewed artifact |
| POST | `/api/reviews/{run_id}/risks/{risk_id}/ai_reject` | 拒绝 AI 改写 | 修改 reviewed artifact |

未发现独立 `undo` API。前端的撤销主要通过重新 PATCH 风险状态为 `pending`、`ai_reject` 或前端记录的 undo 状态完成。

### 5.3 当前前端调用

前端主要在 `legacy/contract_review/frontend/src/App.tsx` 内直接使用相对路径：

- `POST /api/reviews`
- `GET /api/reviews/history?limit=30`
- `GET /api/reviews/{run_id}`
- `GET /api/reviews/{run_id}/result`
- `GET /api/reviews/{run_id}/document`
- `GET /api/reviews/{run_id}/download` 由结果里的 `download_url` 使用
- `PATCH /api/reviews/{run_id}/risks/{risk_id}`
- `POST /api/reviews/{run_id}/risks/{risk_id}/ai_accept`
- `PATCH /api/reviews/{run_id}/risks/{risk_id}/ai_edit`
- `POST /api/reviews/{run_id}/risks/{risk_id}/ai_reject`
- `POST /api/reviews/{run_id}/risks/{risk_id}/ai_apply`
- `GET /api/config`

如果迁到 `/api/v1/contract-review` 且不保留旧 `/api` 代理，前端改动面较大。

### 5.4 PostgreSQL schema / 表

schema：`contract_review`

实际表：

- `contract_review.review_runs`
- `contract_review.review_json_artifacts`
- `contract_review.review_text_artifacts`
- `contract_review.review_file_assets`

这些表保存运行元数据、JSON artifact、文本 artifact 和文件资产索引，但 `data/runs` 仍是关键产物主存储。

### 5.5 文件系统运行产物

强依赖本地文件系统：

- `legacy/contract_review/data/uploads/{run_id}.*`
- `legacy/contract_review/data/runs/{run_id}/source.docx`
- `merged_clauses.json`
- `risk_result_validated.json`
- `risk_result_reviewed.json`
- `reviewed_comments.docx`
- `ai_patched.docx`
- `app.stdout.log` / `app.stderr.log`
- `export.stdout.log` / `export.stderr.log`
- `pipeline.exception.log`

同时依赖 LibreOffice/soffice、PDF/DOC/DOCX 转换、`python-docx`、PyMuPDF/pdf2docx 等本地能力。

### 5.6 外部服务依赖

| 依赖 | 环境变量/配置 | 说明 |
| --- | --- | --- |
| Dify clause split | `DIFY_CLAUSE_WORKFLOW_API_KEY` | 条款拆分 |
| Dify anchored risk | `DIFY_ANCHORED_RISK_WORKFLOW_API_KEY` 或 `DIFY_RISK_WORKFLOW_API_KEY` | 定位风险识别 |
| Dify missing multi risk | `DIFY_MISSING_MULTI_RISK_WORKFLOW_API_KEY` 或 `DIFY_RISK_WORKFLOW_API_KEY` | 多条款/缺失风险 |
| Dify fast screen | `FAST_SCREEN_ENABLED`、`DIFY_FAST_SCREEN_WORKFLOW_API_KEY` | 快筛 |
| Dify rewrite | `DIFY_REWRITE_WORKFLOW_API_KEY` | AI 改写 |
| Dify aggregate rewrite | `DIFY_AGGREGATE_REWRITE_WORKFLOW_API_KEY` 或 rewrite key | 聚合改写 |
| 本地文档转换 | `LIBREOFFICE_PATH`、系统 LibreOffice | `.doc`/PDF 转 DOCX |
| PostgreSQL | `DATABASE_URL` 或 `POSTGRES_*` | 运行元数据和 artifact 索引 |

未发现 SMTP、WebSocket、SSE。长任务通过后台线程 + 轮询状态 API 实现。

### 5.7 复杂度、风险与迁移方式

| 维度 | 等级 | 说明 |
| --- | --- | --- |
| API 复杂度 | 高 | 文件上传/下载、后台线程、子进程、多个 Dify workflow、DOCX 导出、状态修复 |
| 迁移风险 | 高 | 强依赖 `data/runs` 文件布局和本地转换工具，任何路径变化都可能影响结果、下载和历史恢复 |
| 推荐迁移方式 | 先 `apps/api` 反向代理 legacy 后端，暂缓重写 | 只适合最后迁移。直接迁入前应先完成 storage/jobs 抽象和端到端回归 |

### 5.8 可低风险迁入的 API

- `GET /api/health`
- `GET /api/config`
- `GET /api/diagnostics/converters` 可以代理，直接重写意义不大。

`GET /api/reviews/history` 和 `GET /api/reviews/{run_id}` 虽然看似只读，但包含状态修复和文件探测逻辑，建议先代理。

### 5.9 不适合马上直接重写的 API

- `POST /api/reviews`
- `GET /api/reviews/{run_id}/result`
- `GET /api/reviews/{run_id}/document`
- `GET /api/reviews/{run_id}/download`
- 所有 `/risks/*` 状态、AI 改写、接受、编辑、拒绝 API

这些接口都依赖 reviewed artifact、DOCX locator、patch/comment 导出逻辑和文件路径。

## 6. 模块审计：bid-generator

### 6.1 当前后端入口

- 目录：`legacy/bid-generator/pipt-flask`
- 后端入口：`legacy/bid-generator/pipt-flask/main_lite.py`
- 启动方式：`python -m uvicorn main_lite:app --host 0.0.0.0 --port {backend_port}`
- 技术形态：FastAPI
- include router：
  - `app.api_lite.routes`，prefix `/api`
  - `app.api_lite.project_routes`，prefix `/api`
  - `app.api_lite.task_routes`，prefix `/api`
- 文档地址：`docs_url="/apidoc"`，`redoc_url="/redoc"`。FastAPI 默认应暴露 `/openapi.json`；本机只读 import 检查因缺少 `uvicorn` 未能验证，后续迁移前应在完整 Python 环境下实际访问确认。

### 6.2 当前 API 清单

通用和脱敏：

| 方法 | 路径 | 说明 | 特性 |
| --- | --- | --- | --- |
| GET | `/health` | 健康检查 | 普通 JSON |
| GET | `/` | 服务信息 | 普通 JSON |
| GET | `/api/config/workflow-status` | 工作流配置状态 | Dify key 状态 |
| GET | `/api/config/analysis-framework` | 解析框架配置 | 读 JSON 配置 |
| POST | `/api/recognize` | NER 识别 | 本地模型/正则/可选 LLM |
| POST | `/api/desensitize` | 文本脱敏 | PostgreSQL mapping/entity |
| POST | `/api/desensitize/batch` | 批量脱敏 | PostgreSQL mapping/entity |
| GET | `/api/entities` | 支持的实体类型 | 普通 JSON |
| POST | `/api/restore` | 文本还原 | PostgreSQL mapping/entity |
| GET | `/api/config/template` | 模板配置读取 | 文件配置 |
| PUT | `/api/config/template` | 模板配置更新 | 文件写入 |
| DELETE | `/api/config/template` | 模板配置删除 | 文件写入 |
| PUT | `/api/config/global` | 全局配置更新 | 文件写入 |
| POST | `/api/config/template/generate` | 动态生成标书架构 | Dify/本地临时文件 |

项目 CRUD：

| 方法 | 路径 | 说明 | 特性 |
| --- | --- | --- | --- |
| GET | `/api/projects` | 项目列表 | PostgreSQL |
| GET | `/api/projects/{project_id}` | 项目详情 | PostgreSQL |
| POST | `/api/projects` | 创建项目 | PostgreSQL |
| PUT | `/api/projects/{project_id}` | 更新/Upsert 项目 | PostgreSQL |
| PATCH | `/api/projects/{project_id}` | 字段级 patch | PostgreSQL |
| DELETE | `/api/projects/{project_id}` | 删除项目记录 | PostgreSQL |
| GET | `/api/projects/{project_id}/mappings` | 项目映射表 | PostgreSQL project JSON |
| POST | `/api/projects/batch` | 批量导入项目 | PostgreSQL |

招标文件解析、缓存和附件：

| 方法 | 路径 | 说明 | 特性 |
| --- | --- | --- | --- |
| POST | `/api/projects/extract` | 上传招标文件并提取需求 | 文件上传、脱敏、Dify |
| POST | `/api/projects/extract-stream` | SSE 实时解析招标文件 | 文件上传、SSE、Dify |
| GET | `/api/projects/pdf/{project_id}` | 获取缓存 PDF | 文件响应 |
| GET | `/api/extracted-images/by-hash/{image_hash}` | 通过 hash 获取图片 | PostgreSQL + 文件响应 |
| GET | `/api/extracted-images/{filename}` | 获取提取图片 | 文件响应 |
| POST | `/api/projects/upload-pdf` | 上传 PDF 到缓存 | 文件上传 |
| POST | `/api/bid-attachment/extract` | 按定位符提取 DOCX 附件内容 | DOCX cache |
| GET | `/api/bid-attachment/test-locators` | 调试定位符映射 | DOCX cache |
| GET | `/api/projects/{project_id}/doc-blocks` | 文档块级索引 | PostgreSQL project JSON / cache |
| POST | `/api/projects/{project_id}/rebuild-locator` | 重建 DOCX 定位缓存 | 文件上传 |
| GET | `/api/projects/{project_id}/source-docx` | 获取原始 DOCX | 文件响应 |
| POST | `/api/bid-attachment/extract-by-block` | 按 block 提取附件 HTML | DOCX cache |
| POST | `/api/bid-attachment/extract-by-block-docx` | 按 block 返回 DOCX 切片 | 文件下载 |
| DELETE | `/api/projects/{project_id}/caches` | 删除项目缓存 | 文件删除/内存 cache |

生成和导出：

| 方法 | 路径 | 说明 | 特性 |
| --- | --- | --- | --- |
| POST | `/api/projects/re-extract` | 基于缓存原文重新提取 | Dify、raw_doc_cache |
| POST | `/api/projects/generate-outline` | 阻塞式大纲生成 | Dify |
| POST | `/api/projects/generate-outline-stream` | 流式大纲生成 | SSE、Dify |
| POST | `/api/projects/generate-content` | 阻塞式正文生成 | Dify |
| POST | `/api/projects/generate-content-stream` | 流式正文生成 | SSE、Dify |
| POST | `/api/projects/generate-attachment` | 生成附件正文 | Dify |
| POST | `/api/projects/build-scoring-table` | 构建自评评分表 | 本地/Dify |
| POST | `/api/projects/fill-scoring-row` | AI 填写评分行 | Dify |
| POST | `/api/projects/export-scoring-table` | 导出评分表 Excel | 文件下载 |
| POST | `/api/projects/generate-blueprint` | 生成全局蓝图 | Dify |
| POST | `/api/projects/forge-document` | 组装最终 DOCX | gateway-out / DocumentForge，文件下载 |
| POST | `/api/projects/export-report` | 导出解析报告 PDF | 文件下载 |

知识库：

| 方法 | 路径 | 说明 | 特性 |
| --- | --- | --- | --- |
| GET | `/api/knowledge/documents` | 获取远端 Dify 数据集文档状态 | Dify Dataset |
| POST | `/api/knowledge/sync` | 触发知识库同步 | 后台任务/子进程 |
| POST | `/api/knowledge/sync/{doc_name}` | 同步单文件 | 后台任务/子进程 |
| POST | `/api/kb/sync` | 触发知识库异步同步 | 后台任务 |
| GET | `/api/kb/sync-status/{job_id}` | 查询知识库同步状态 | 文件/任务状态 |
| GET | `/api/kb/sync-jobs` | 最近同步任务 | 文件/任务状态 |

后台任务：

| 方法 | 路径 | 说明 | 特性 |
| --- | --- | --- | --- |
| POST | `/api/tasks/start-outline` | 发起大纲生成后台任务 | in-memory task、Dify |
| POST | `/api/tasks/start-extract` | 发起文档解析后台任务 | 文件上传、in-memory task、Dify |
| POST | `/api/tasks/start-content` | 发起正文生成后台任务 | in-memory task、Dify |
| POST | `/api/tasks/start-content-rewrite` | 发起单章节重生成 | in-memory task、Dify |
| POST | `/api/tasks/start-content-group` | H2 分组正文生成 | in-memory task、Dify |
| POST | `/api/tasks/start-group-review` | H2 分组手动评估 | in-memory task、Dify |
| POST | `/api/tasks/start-diagram` | 图表生成任务 | in-memory task、Dify，当前产品态禁用图表生成 |
| POST | `/api/tasks/start-analyze` | 解析报告后台任务 | in-memory task、SSE 重连 |
| GET | `/api/tasks/{task_id}/status` | 任务状态轮询 | in-memory task |
| GET | `/api/tasks/{task_id}/progress` | 任务进度 SSE | SSE，支持重连 |
| POST | `/api/tasks/{task_id}/cancel` | 取消任务 | 本地 cancel + Dify Stop API |

解析报告：

| 方法 | 路径 | 说明 | 特性 |
| --- | --- | --- | --- |
| POST | `/api/projects/analyze` | 解析报告 SSE 生成 | SSE、Dify |
| POST | `/api/projects/{project_id}/analyze-node` | 单节点重新提取 | SSE、Dify |
| POST | `/api/projects/{project_id}/analysis-report` | 保存解析报告 | 文件写入 |
| GET | `/api/projects/{project_id}/analysis-report` | 读取解析报告 | 文件读取 |

### 6.3 当前前端调用

前端 API 基址在 `legacy/bid-generator/frontend-web/src/services/apiBase.ts`：

- 默认：`http://localhost:5000/api`
- 若配置 `VITE_API_BASE_URL`，会自动补 `/api`
- 若配置 `VITE_API_URL`，直接使用

主要调用分布：

- `configService.ts`：`/config/template`、`/config/global`
- `projectService.ts`：项目 CRUD、任务启动/状态/SSE、解析、生成、导出、附件、定位符、analysis-report
- `Dashboard/KnowledgeHub.tsx`：`/knowledge/documents`、`/knowledge/sync`
- `Project/ScoringTable.tsx`：`/projects/build-scoring-table`、`/projects/fill-scoring-row`、`/projects/export-scoring-table`
- `Project/AttachmentFiller.tsx`：`/projects/generate-attachment`
- `BlueprintGenerator.tsx`：`/projects/generate-blueprint`

如果只通过 `apps/api` 代理旧 `/api/*`，前端可基本不改。若切换到 `/api/v1/bid-generator/*`，`apiBase.ts` 和大量服务调用需要同步调整。

### 6.4 PostgreSQL schema / 表

schema：`bid_generator`

实际表：

- `bid_generator.mapping_records`
- `bid_generator.entity_registry`
- `bid_generator.image_registry`
- `bid_generator.projects`

### 6.5 文件系统运行产物

强依赖本地文件系统：

- `legacy/bid-generator/data/pdf_cache/{project_id}.pdf`
- `legacy/bid-generator/data/docx_cache/{project_id}.docx`
- `legacy/bid-generator/data/raw_doc_cache/{project_id}.txt`
- `legacy/bid-generator/data/extracted_images/*`
- `legacy/bid-generator/data/projects/{project_id}_analysis.json`
- `legacy/bid-generator/gateway-out`
- `legacy/bid-generator/pipt-flask/config/analysis_framework.json`
- `legacy/bid-generator/pipt-flask/config.yaml` / 模板配置
- 知识库同步状态文件和后台任务状态文件

此外，TaskManager 是进程内存储，服务重启后只能依赖 project JSON/runtime 信息和部分 stages 设计恢复，不能跨进程天然共享。

### 6.6 外部服务依赖

| 依赖 | 环境变量/配置 | 说明 |
| --- | --- | --- |
| Dify API | `DIFY_API_URL` | workflow Stop API 等 |
| Dify Dataset | `DIFY_BID_BASE_ID`、`DIFY_DATASET_API_KEY` | 知识库同步/文档状态 |
| Dify managed workflows | `DIFY_WORKFLOW_STRUCTURE_GENERATOR`、`CONTENT_WRITER`、`CONTENT_GROUP_WRITER`、`CONTENT_REWRITE`、`RESPONSE_CONTENT_WRITER`、`DIAGRAM_GENERATOR`、`DOC_ANALYSIS` | 标书主流程 |
| Dify legacy workflows | `DIFY_WORKFLOW_REQUIREMENT_EXTRACTOR`、`BLUEPRINT_GENERATOR`、`GROUP_REVIEW_WRITER`、`ATTACHMENT_GENERATOR`、`SCORING_ASSISTANT` | 兼容链路 |
| NER/LLM | HanLP、本地模型目录、`PIPT_LLM_*`、可能的 Ollama/OpenAI-compatible endpoint | 脱敏识别增强 |
| DocumentForge | `gateway-out/src/forge.py` | 最终 DOCX 生成 |
| PostgreSQL | `DATABASE_URL` 或 `POSTGRES_*`、`PIPT_DB_KEY` | 项目、映射、图片注册 |

未发现 SMTP。Web Search 不在本模块后端直接出现。

### 6.7 复杂度、风险与迁移方式

| 维度 | 等级 | 说明 |
| --- | --- | --- |
| API 复杂度 | 高 | API 数量多，包含上传、下载、SSE、后台任务、Dify Stop、文档生成、知识库同步 |
| 迁移风险 | 高 | TaskManager 是进程内状态，文件缓存分散，前端路径多，生成链路依赖 gateway-out |
| 推荐迁移方式 | 先完整反向代理，再拆分低风险子集 | 先不要重写任务和文档生成；可逐步迁 project CRUD、health、workflow-status |

### 6.8 可低风险迁入的 API

- `GET /health`
- `GET /api/config/workflow-status`
- `GET /api/entities`
- `GET /api/projects`
- `GET /api/projects/{project_id}`
- `POST /api/projects`
- `PUT /api/projects/{project_id}`
- `PATCH /api/projects/{project_id}`
- `DELETE /api/projects/{project_id}`
- `GET /api/projects/{project_id}/mappings`
- `POST /api/projects/batch`

项目 CRUD 已经使用 PostgreSQL，且与文件生成解耦度较高，但仍要注意 `ProjectRecord.data` 里包含前端运行态。

### 6.9 不适合马上直接重写的 API

- 所有 `/api/tasks/*`
- 所有 SSE：`extract-stream`、`generate-outline-stream`、`generate-content-stream`、`projects/analyze`、`analyze-node`、`tasks/{task_id}/progress`
- 文件上传/下载：`projects/extract`、`upload-pdf`、`source-docx`、`extract-by-block-docx`、`forge-document`、`export-scoring-table`、`export-report`
- 知识库同步：`knowledge/sync`、`kb/sync*`
- 配置写入：`PUT/DELETE /api/config/template`、`PUT /api/config/global`

这些接口依赖文件系统、进程内任务、Dify Stop API、DocumentForge 或本地配置写入。第一步应代理。

## 7. 横向能力矩阵

| 模块 | 流式响应 | 文件上传 | 文件下载 | WebSocket | 长任务 | 强文件产物 | 外部服务 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| competitor-analysis | 是，NDJSON `/api/analysis/stream` | 否 | 否，前端生成 DOCX | 否 | 阻塞式长请求，不入队 | 低 | Dify、PostgreSQL |
| rag-web-search | 是，SSE `/api/v1/chat/stream` | 是，知识库上传到 Dify | 是，知识库 markdown/json 导出 | 否 | Dify indexing 轮询 | 低 | Dify Workflow、Dify Dataset、PostgreSQL |
| contract-review | 否 | 是，合同文件 | 是，DOCX | 否 | 是，后台线程 + 子进程 | 高 | Dify、LibreOffice、文档解析、PostgreSQL |
| bid-generator | 是，多处 SSE | 是，招标文件/PDF/DOCX | 是，PDF/DOCX/Excel/图片 | 否 | 是，进程内 TaskManager | 高 | Dify、Dify Dataset、HanLP/LLM、DocumentForge、PostgreSQL |

业务模块中未发现 WebSocket API。`apps/api` 当前有 app-usage WebSocket，但它属于平台能力，不属于四个业务模块迁移范围。

## 8. 前端改造影响

| 模块 | 若保留旧路径代理 | 若切到统一路径 |
| --- | --- | --- |
| competitor-analysis | 基本不改，只把 `VITE_API_BASE_URL` 指向 `apps/api` 或由 Portal runtime 注入 | `src/services/*.js` 从 `/api/...` 改为 `/api/v1/competitor-analysis/...`，流式解析需兼容 SSE/NDJSON |
| rag-web-search | iframe 前端可不改；Portal `knowledgeService` 仍需确认 backendUrl 指向 | `src/lib/api.ts` 改为 `/api/v1/rag/...`；Portal `knowledgeService` 改用 platform API 或 runtime apps 的 platform backend |
| contract-review | 基本不改，Vite proxy 或 iframe 后端基址指向 `apps/api` | `App.tsx` 多处 `/api/reviews...` 改为 `/api/v1/contract-review/reviews...`，下载 URL 也要改 |
| bid-generator | 基本不改，`apiBase.ts` 仍返回 `/api` | `apiBase.ts` 需要支持 `/api/v1/bid-generator`，`projectService.ts`、组件服务内大量路径需确认 |

建议第一轮全部保留旧路径代理；稳定后再逐个模块新增统一路径并渐进切换前端。

## 9. 可代理优先级

| 模块 | 建议先代理的 API | 原因 |
| --- | --- | --- |
| competitor-analysis | `/api/analysis*`、`/api/workflows/*` | 避免首次迁移破坏 Dify 编排和 NDJSON |
| rag-web-search | `/api/v1/chat/stream`、`/api/v1/knowledge/*` | 保持 SSE、上传、Dataset 轮询行为 |
| contract-review | 几乎全部 `/api/*` | 文件产物和后台流程强耦合，直接重写风险高 |
| bid-generator | 几乎全部 `/api/*` 和 `/health` | API 数量大，任务和文件缓存复杂 |

代理层最低要求：

- 从 Portal session 识别当前用户。
- 检查用户是否有对应 app 权限。
- 透传 HTTP method、query、headers、body、multipart、streaming response。
- 对 SSE/NDJSON 禁用缓冲。
- 对下载接口透传 `Content-Disposition`、`Content-Type`、状态码。
- 代理目标从 runtime apps `backendUrl` 或配置读取，不硬编码端口。

## 10. 推荐迁移顺序

### Step 1：建立 apps/api 业务代理基座

范围：

- 在 `apps/api` 增加通用 legacy proxy 能力，但不改变业务模块代码。
- 每个模块先挂兼容旧路径代理，例如 competitor 的 `/api/analysis/stream`、contract 的 `/api/reviews/*`、bid 的 `/api/*`、RAG 的 `/api/v1/*`。
- 代理前做 Portal session 和 app permission 校验。

验收标准：

- Portal 登录后进入四个 iframe 模块，核心流程仍可用。
- 流式接口不被缓冲：competitor NDJSON、RAG SSE、bid SSE 均可持续收到事件。
- 文件上传下载可用：contract 上传/下载 DOCX、bid 上传/导出 DOCX/Excel/PDF。
- 关闭代理开关后仍能直接访问 legacy 后端回滚。

回滚方案：

- 禁用 `apps/api` proxy router。
- Portal runtime apps 继续指向 legacy backendUrl。
- 不改 legacy 后端和前端，因此回滚只涉及配置/启动路径。

### Step 2：competitor-analysis 试点迁移

范围：

- 先直接迁 `health`、`history`、企业缓存读取/写入。
- 后迁 `analysis/stream`，保留旧 NDJSON 响应，同时可新增统一 SSE。
- 统一路径为 `/api/v1/competitor-analysis`，旧 `/api/*` 保留兼容代理一个迭代周期。

验收标准：

- 自动匹配和精确匹配均可完成。
- 分析中刷新/返回后可从历史恢复。
- `competitor_analysis.history_records`、`company_profiles`、`company_validation_queries` 读写正常。
- Dify key 未配置时 demo/fallback 行为不退化。
- 前端无需立即改路径，或统一路径切换后所有服务调用通过。

回滚方案：

- 前端 `VITE_API_BASE_URL` 指回 legacy competitor 后端。
- 禁用 `apps/api` competitor router，保留 PostgreSQL 表不变。
- 旧 `/api/*` 代理继续可用。

### Step 3：rag-web-search 迁移

范围：

- 将现有 FastAPI router/service 平移或复用到 `apps/api`。
- 统一最终路径 `/api/v1/rag`，保留 `/api/v1` 或 `/api/v1/rag-web-search` 兼容代理。
- 先迁 conversations/sessions，再迁 chat stream，最后迁 knowledge Dataset 代理。
- 同步修改 Portal `knowledgeService` 的 backendUrl 获取策略，避免仍直接打 legacy RAG 后端。

验收标准：

- 新会话、对话列表、对话同步正常。
- `/chat/stream` SSE 可连续输出，完成后 `rag.chat_turns` 有记录。
- 文本和文件知识库上传能等到 indexing completed。
- 知识库列表、详情、删除、导出 markdown/json 正常。
- 允许联网开关 `allow_search` 透传上游 workflow。

回滚方案：

- Portal runtime apps 恢复 RAG legacy backendUrl。
- 保留 legacy RAG 后端启动。
- 禁用 `apps/api` RAG router 或将统一路径代理回 legacy。

### Step 4：bid-generator 分层迁移

范围：

1. 先保留全量代理。
2. 再迁低风险 project CRUD、workflow-status、entities。
3. 后迁 desensitize/restore，确认 PIPT_DB_KEY、EntityRegistry 和 NER 加载边界。
4. 最后评估任务、SSE、知识库同步、forge-document 和文件缓存。

验收标准：

- 项目创建、更新、删除、批量同步不丢字段。
- 脱敏和还原映射一致，`bid_generator.entity_registry` 加密/明文降级行为一致。
- 大纲/正文/解析任务可启动、轮询、SSE 重连、取消。
- PDF 预览、图片预览、DOCX 附件切片、最终 DOCX/Excel/PDF 导出可用。
- Dify Stop API 仍能取消 running 任务。

回滚方案：

- 统一路径保留旧 `/api/*` 代理。
- 业务任务仍由 legacy pipt-lite 执行。
- 如果 project CRUD 直迁出问题，可临时让 `/api/projects*` 也回到代理。
- 文件缓存目录不移动，避免产物找不到。

### Step 5：contract-review 最后迁移

范围：

- 长期先代理全量 `/api/*`。
- 迁移前先完成 storage/jobs 统一抽象设计。
- 直接迁移时应先只读状态和历史，再迁上传启动，最后迁 AI 改写和 DOCX 导出。

验收标准：

- PDF/DOC/DOCX 上传均可生成 run。
- 轮询状态可从 queued/running 到 completed/failed。
- `document`、`result`、`download` 均可用。
- 风险接受、拒绝、pending 恢复、accept_all、AI apply、AI accept/edit/reject 不退化。
- `data/runs` 和 PostgreSQL artifacts 一致。
- LibreOffice 不可用时错误响应仍清晰。

回滚方案：

- Portal iframe 继续指向 legacy contract backend。
- 禁用 `apps/api` direct contract router，保留 proxy。
- 不迁移或移动 `data/runs`，避免历史结果不可下载。

## 11. 是否建议先从 competitor-analysis 做试点

建议。

理由：

- 数据已迁入 PostgreSQL，schema 简单。
- 文件系统依赖最少，没有上传/下载。
- API 数量较少，前端调用集中在 `src/services`。
- 失败时可通过 `VITE_API_BASE_URL` 或 runtime backendUrl 快速回滚。
- 可以验证 `apps/api` 对业务 app permission、旧路径兼容、Dify 调用、流式响应和历史记录的完整迁移模式。

试点时仍需注意：

- 不要一开始把 NDJSON 改成只支持 SSE。
- 不要改 Dify key 名称和 workflow 输出解析。
- 不要改历史记录 JSON 结构，否则前端历史回看可能失效。

## 12. 本阶段自检

- 未迁移任何业务 API。
- 未修改四个业务模块后端或前端。
- 未去 iframe。
- 未改 JWT 或 Portal session。
- 未改数据库表结构。
- 未新增 Alembic migration。
- 未接 MinIO、Celery、RQ 或 Docker 正式部署。
- 未删除 legacy 后端。
- 未修改 Dify key、dataset key/id、SimSun.ttf 等保留内容。
- 未提交 `node_modules`、`dist`、`build`、`runtime/ports.json`、`.env`、`tsbuildinfo` 或数据库文件。
