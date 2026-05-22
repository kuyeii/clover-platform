# 第 8-B 阶段：本地文件系统与任务状态边界

本文档用于收口第 8-B 阶段的本地文件系统产物边界和现有任务状态边界。结论基于当前代码实现和整合规范文档中的阶段约束：本阶段继续使用本地文件系统或部署 volume，暂不接 MinIO / S3，暂不引入 Celery / RQ / Dramatiq，暂不新增统一任务表，暂不改变现有前端任务协议和后端任务执行方式。

## 阶段结论

- 当前必须持久化本地文件的模块主要是 `contract-review` 和 `bid-generator`。
- `rag-web-search` 的知识库文件由 Dify Dataset 管理，会话和问答 turn 写入 PostgreSQL，本地 `data/` 仅保留 legacy 占位或旧缓存。
- `competitor-analysis` 的历史、企业画像和企业校验缓存主要写入 PostgreSQL，本地没有明确的报告文件缓存或企业信息文件缓存。
- 文件目录边界本阶段只做文档与轻量 preflight warning，不搬迁目录、不改上传下载逻辑、不新增文件元数据表。
- 任务状态继续沿用各 legacy 模块已有机制，未来如接统一队列，应通过 adapter 包装，而不是一次性重写业务逻辑。

## 文件系统边界总览

| 模块 | 当前本地目录 | 用途 | 部署持久化 | 清理建议 |
| --- | --- | --- | --- | --- |
| `contract-review` | `legacy/contract_review/data/uploads/` | Web 上传原始合同文件，文件名与 `run_id` 关联 | 是 | 不要随便删除；删除会影响历史审查和导出追溯 |
| `contract-review` | `legacy/contract_review/data/runs/<run_id>/` | 单次审查产物、转换后的 `source.docx`、JSON 结果、DOCX 导出、日志 | 是 | 只清理确认废弃的 run；清理前应确认 PostgreSQL 元数据和前端历史不再引用 |
| `bid-generator` | `legacy/bid-generator/data/pdf_cache/` | PDF 预览缓存，含上传 PDF 或 DOCX 转换后的 PDF | 是 | 可按项目清理；清理后前端 PDF 预览需重新上传或重建 |
| `bid-generator` | `legacy/bid-generator/data/docx_cache/` | 原始 DOCX 和定位符缓存恢复依据 | 是 | 不要随便删除；删除会影响 DOCX 定位、附件切片和源文件预览 |
| `bid-generator` | `legacy/bid-generator/data/raw_doc_cache/` | 脱敏或定位后的原文文本缓存，用于重提取 | 建议持久化 | 可按项目清理；清理后重提取能力下降 |
| `bid-generator` | `legacy/bid-generator/data/extracted_images/` | 从 PDF/DOCX 提取的图片文件，数据库 `image_registry.abs_path` 指向这里 | 是 | 不要只删文件；否则图片预览和 forge 图片还原会断 |
| `bid-generator` | `legacy/bid-generator/data/projects/` | 解析报告 JSON 文件镜像 | 建议持久化 | PostgreSQL 项目记录是主存储时可重建部分信息，但仍建议随项目保留 |
| `bid-generator` | `legacy/bid-generator/data/kb_sync_status/` | 知识库同步任务状态 JSON | 建议持久化短期状态 | 可定期清理旧任务状态；不要清理正在运行的 job |
| `bid-generator` | `legacy/bid-generator/data/templates/` | 解析和大纲模板，当前含版本跟踪文件 | 是，且属于配置资产 | 不按运行缓存清理 |
| `bid-generator` | `legacy/bid-generator/data/knowledge_base/` | 知识库同步源文件，当前含版本跟踪样例资料 | 是，且属于业务资料 | 不按运行缓存清理 |
| `rag-web-search` | `legacy/chat_with_rag_and_websearch/data/` | legacy 占位；当前会话和 turn 不依赖本地文件 | 否 | 旧 JSON / SQLite 历史可在确认不用后清理 |
| `competitor-analysis` | `legacy/company-competitors-analysis/backend/data/` | 旧 SQLite / JSON 历史兼容目录，如存在 | 否 | 已迁 PostgreSQL 后可在确认不用旧历史后清理 |

## contract-review 文件边界

当前合同审查后端在 `legacy/contract_review/web_api.py` 中定义：

- `RUN_ROOT = legacy/contract_review/data/runs`
- `UPLOAD_ROOT = legacy/contract_review/data/uploads`

上传接口将用户文件保存到 `data/uploads/{run_id}{suffix}`，并创建 `data/runs/{run_id}/`。后台 pipeline 会把原始文件归一化为 `source.docx`，再写入条款切分、风险识别、定位、AI 改写和 DOCX 导出相关产物。典型 run 目录包括：

- `source.docx`
- `merged_clauses.json`
- `merged_clauses_raw.json`
- `document_paragraphs.json`
- `risk_result_outputs.json`
- `risk_result_raw.json`
- `risk_result_normalized.full.json`
- `risk_result_normalized.json`
- `risk_result_validated.json`
- `risk_result_reviewed.json`
- `reviewed_comments.docx`
- `ai_patched.docx`
- `export.stdout.log`
- `export.stderr.log`
- `clauses/`
- `risk_checkpoints/`

`contract_review.review_runs` 保存 run 元数据、状态、进度和错误信息；`review_json_artifacts` / `review_text_artifacts` 是结构化索引增强。文件系统仍是 DOCX、PDF 转换物、日志和导出文件的主存储。删除 `data/runs/<run_id>/` 会导致审查结果、AI 接受/撤销状态、下载和排查链路失效。

## bid-generator 文件边界

标书生成当前 `pipt-lite` 数据库状态写入 PostgreSQL `bid_generator` schema，但文档处理和导出链路仍依赖本地文件系统。主要目录如下：

- `data/pdf_cache/`：上传 PDF 或 DOCX 转换后的 PDF 预览缓存，`/api/projects/pdf/{project_id}` 读取。
- `data/docx_cache/`：原始 DOCX 持久化，服务重启后用于重建定位符、获取源 DOCX、执行 DOCX 切片。
- `data/raw_doc_cache/`：项目级原文文本缓存，用于 `/projects/re-extract`。
- `data/extracted_images/`：从文档中提取的图片，`ImageRegistry.abs_path` 和 `preview_url` 指向这些文件。
- `data/projects/`：解析报告 JSON 文件镜像，PostgreSQL 项目记录是优先读取来源。
- `data/kb_sync_status/`：知识库同步任务状态文件。
- `data/templates/`：解析和大纲模板，属于配置资产，不是运行缓存。
- `data/knowledge_base/`：知识库同步源文件，属于业务资料，不是可随意清理的缓存。

`export-scoring-table` 当前以内存流返回 Excel；`forge-document` 当前以内存流返回最终 DOCX，不落固定输出目录。`output/` 仍按 legacy 配置忽略，作为旧产物目录处理。

## RAG 文件边界

RAG 后端当前通过 Dify Dataset API 代理知识库文档：

- `create-by-file` 读取 `UploadFile` 后直接 multipart 转发 Dify，不写本地上传目录。
- 知识库文档详情下载由后端聚合 Dify 文档和 segments 后，在内存中生成 Markdown / JSON 响应。
- 会话列表写入 `rag.conversations`。
- 流式问答结束后，每轮问答写入 `rag.chat_turns`。

因此 RAG 当前没有必须挂载持久化磁盘的本地上传目录。`legacy/chat_with_rag_and_websearch/data/` 仅保留 legacy 占位；如存在旧 JSON / SQLite 历史，可在确认不再回看旧历史后清理。

## competitor-analysis 文件边界

竞对分析当前主要状态在 PostgreSQL：

- `competitor_analysis.history_records`
- `competitor_analysis.storage_meta`
- `competitor_analysis.company_profiles`
- `competitor_analysis.company_validation_queries`

未发现当前代码写入报告文件缓存或企业信息文件缓存。前端导出 DOCX 报告在浏览器端生成并下载，不由后端落本地文件。`backend/data/*.sqlite3` 和历史 JSON 属于旧运行产物，已不作为当前主存储；清理前需确认无需回看旧历史。

## .gitignore 边界

必须忽略：

- `.env`、`.env.*`，但保留 `.env.example`
- `runtime/ports.json` 和其他 `runtime/*` 运行时端口产物
- `node_modules/`、`dist/`、`build/`、`.vite/`、`*.tsbuildinfo`
- `__pycache__/`、`*.pyc`
- `*.db`、`*.sqlite`、`*.sqlite3` 及 WAL/SHM 文件
- 合同审查 `data/uploads/`、`data/runs/`
- 标书生成 `data/pdf_cache/`、`data/docx_cache/`、`data/raw_doc_cache/`、`data/extracted_images/`、`data/projects/`、`data/kb_sync_status/`
- RAG 旧本地 JSON / SQLite 历史
- 竞对分析旧 `backend/data` SQLite / JSON 历史

不得误忽略：

- `legacy/bid-generator/data/templates/`
- `legacy/bid-generator/data/knowledge_base/`
- `legacy/chat_with_rag_and_websearch/data/.gitkeep`
- 各模块源码、README、测试和配置样例

## 路径安全边界

本阶段不重写文件读写逻辑，但后续任何文件存储改造必须遵守：

- 所有 `run_id`、`project_id`、`task_id`、`filename` 进入文件路径前必须做 allowlist 校验。
- 禁止接受 `../`、绝对路径、反斜杠穿越和 URL 编码后的路径穿越。
- 用户可控路径必须解析到模块允许的根目录下，必要时使用 `Path.resolve()` 后做 `relative_to()` 校验。
- 下载接口不要直接暴露服务器绝对路径；只返回受控路由、文件名和安全的 `Content-Disposition`。
- 图片、DOCX、PDF、Excel 下载必须限制 MIME 和扩展名范围。
- 删除接口必须限定项目或 run 范围，不提供任意路径删除能力。
- 未来接 MinIO / S3 时仍要保留 namespace、owner、module_code 和对象 key 的边界校验。

## 当前任务状态边界

### competitor-analysis

- `POST /api/analysis/stream` 由 legacy 后端直接维护 NDJSON stream。
- 响应类型为 `application/x-ndjson`，事件包括 `analysis_started`、`competitors_ready`、`target_detail_ready`、`competitor_detail_ready`、`compare_report_ready`、`score_ready`、`analysis_finished`、`analysis_error`。
- 没有独立后台任务状态表。运行中和最终状态通过 NDJSON 事件及 `history_records` 中的 record 表达。
- 本阶段不改变 NDJSON 协议，不新增队列，不新增统一任务表。

### RAG

- `POST /api/v1/chat/stream` 由 legacy RAG 后端调用上游 Dify SSE，并转发为前端 `session`、`delta`、`done`、`error` 事件。
- `sessions` 只是生成会话 UUID。
- `conversations` 和 `conversations/sync` 已部分 direct 到 `apps/api`，存储在 `rag.conversations`。
- 每轮问答在流式完成后写入 `rag.chat_turns`。
- 本阶段不将 chat stream 队列化，不改变前端流式事件协议。

### contract-review

- 审查任务以 `run_id` 为核心标识。
- `contract_review.review_runs` 保存 `queued`、`running`、`completed`、`failed` 等元数据状态、步骤、进度、错误和下载可用性。
- 后台执行方式仍是 legacy 后端中的 daemon thread 调用 pipeline / 子进程，并把文件产物写入 `data/runs/<run_id>/`。
- AI 改写状态同时存在 run 级 `ai_rewrite_status` 和风险项级 `ai_rewrite.state`、`ai_rewrite_decision`、`accepted_patch`，最终落回 `risk_result_reviewed.json`。
- 下载文件与 `run_id`、`source.docx`、`risk_result_reviewed.json` 和导出 DOCX 文件关联。
- 本阶段不修改 pipeline、不改 AI 接受/撤销协议、不改变下载实现。

### bid-generator

- 长任务继续由 legacy `TaskManager` 维护，当前支持进程内 memory 后端。
- `Task` 保存 `task_id`、`task_type`、`project_id`、`status`、`stages`、`current_stage`、`result`、`partial_result`、`partial_events`、`dify_task_id` 等字段。
- `start-outline`、`start-extract`、`start-content`、`start-analyze` 等接口返回 `task_id`。
- 前端通过 `/tasks/{task_id}/status` 轮询、`/tasks/{task_id}/progress` SSE 恢复进度。
- `/tasks/{task_id}/cancel` 取消本地 asyncio task，并尽力调用 Dify Stop API。
- 本阶段不替换 TaskManager，不做跨进程任务队列，不改变前端 `task_id` / progress / cancel 协议。

## 未来任务队列预留模型

以下模型只作为未来兼容边界，本阶段不建表、不写接口、不改现有业务协议。

### TaskDescriptor

```text
task_id
module_code
operation
owner_user_id
created_at
started_at
updated_at
status
progress
message
cancelable
result_ref
error_code
error_message
```

### TaskStatus

```text
pending
running
succeeded
failed
canceled
```

### TaskAdapter

```text
start()
get_status()
stream_progress()
cancel()
get_result()
```

未来接入原则：

- adapter 包装现有 legacy 任务，不一次性重写业务逻辑。
- `contract-review` 可用 `run_id` 映射 `task_id`，但队列化前必须先明确 `data/uploads`、`data/runs` 的持久化挂载、失败恢复和导出重试策略。
- `bid-generator` 可用现有 `task_id` 映射统一任务，但多实例部署前必须专项评审 memory `TaskManager`、Dify stop、SSE 重连和 partial event 存储。
- `rag-web-search` 不应在没有明确 SSE 事件兼容方案前强行队列化 chat stream。
- `competitor-analysis` 不应改变现有 NDJSON stream 协议；如未来纳入 adapter，应保持逐事件透传兼容。
- 队列实现可后续评估 Celery / RQ / Dramatiq / Redis Streams，但不属于第 8-B。

## preflight 边界

第 8-B 允许 preflight 做轻量 warning：

- 检查合同审查 `data/uploads/`、`data/runs/` 是否存在。
- 检查标书生成 `data/pdf_cache/`、`data/docx_cache/`、`data/raw_doc_cache/`、`data/extracted_images/`、`data/projects/`、`data/kb_sync_status/` 是否存在。
- 缺失只提示，不阻塞启动；legacy 后端仍可按需创建。
- RAG 和竞对分析当前没有必须创建的本地运行目录，不强行加目录检查。

这些 warning 的目标是提醒部署时挂载持久化磁盘，而不是改变业务目录结构。
