# 第 8-E：低风险查询类 direct API 批次 2

## 1. 当前阶段结论

第 8-E 继续推进低风险 direct API 迁移，但只迁移查询类、只读、无副作用、无文件读写、无任务状态依赖、无 Dify 调用的接口。本阶段不迁移复杂业务链路，不引入 MinIO / S3，不引入 Celery / RQ / Dramatiq，不修改数据库结构，不新增 Alembic migration，不改业务前端，不改 legacy 后端核心逻辑。

本阶段结论：

- `bid-generator` 项目列表、项目详情和项目 mappings 查询可由 PostgreSQL `bid_generator.projects` 直接返回 legacy-compatible 结构。
- `contract-review` history / status 虽为 GET，但源码会读取 `data/runs`、推断文件产物状态并修复运行状态，本阶段暂缓 direct。
- `competitor-analysis` 未发现新的明确低风险只读接口，继续保持 health/history direct，其它业务接口 proxy。
- `rag-web-search` 未发现新的 legacy 已暴露 PostgreSQL-only 查询接口，继续保持 health/sessions/conversations/sync direct，chat stream 和 knowledge proxy。

## 2. 本阶段 direct API

新增 direct：

| Platform path | Legacy path | direct 原因 |
| --- | --- | --- |
| `GET /api/v1/bid-generator/api/projects` | `GET /api/projects` | 只读查询 `bid_generator.projects`，不启动任务、不访问 Dify、不读写文件 |
| `GET /api/v1/bid-generator/api/projects/{project_id}` | `GET /api/projects/{project_id}` | 只读查询单条项目记录，返回 legacy `_to_response` 结构 |
| `GET /api/v1/bid-generator/api/projects/{project_id}/mappings` | `GET /api/projects/{project_id}/mappings` | 只从项目 `data.mappingTable` 读取映射表，不访问文件或 TaskManager |

这些 direct routes 定义在 `bid_generator` catch-all proxy 前，成功响应保持 legacy 原始 JSON 结构，不强行包装 `success/data`。未登录或无应用权限仍由 `get_current_user` 和 `portal_store.can_access_app` 返回平台统一 401 / 403 envelope。

## 3. 暂缓 direct 的候选 API

`contract-review`：

- `GET /api/v1/contract-review/api/reviews/history` 暂缓 direct。legacy `_list_history_items` 会对 `queued/running` run 调用 `_repair_run_state_if_outputs_ready`，并检查 `data/runs/<run_id>/` 下的结果文件。
- `GET /api/v1/contract-review/api/reviews/{run_id}` 暂缓 direct。legacy `_read_meta` 在数据库缺失或字段缺失时会调用 `_infer_meta_from_run`，读取上传文件、运行目录和结果产物；对运行中任务还会基于产物推断状态。

`competitor-analysis`：

- company validation / company profile cache 查询当前作为 workflow 执行链路内部优化存在，未暴露为独立 GET 查询接口；不在本阶段扩大 direct。

`rag-web-search`：

- 当前 legacy 对外只暴露 conversations 查询与 sync、chat stream、knowledge Dataset API。conversations 已 direct；chat turns 没有独立 legacy 查询 API，本阶段不新增新语义。

## 4. 仍 proxy 的 API

`bid-generator` 继续 proxy：

- Dify workflow 启动类接口。
- `POST /api/projects`、`PUT /api/projects/{project_id}`、`PATCH /api/projects/{project_id}`、`DELETE /api/projects/{project_id}`、`POST /api/projects/batch` 等会改变项目 CRUD 语义的接口。
- `POST /api/projects/extract`、`POST /api/projects/extract-stream`、`POST /api/projects/generate-outline-stream`、`POST /api/projects/generate-content-stream`。
- `/api/tasks/**`，包括 status、progress、cancel 和后台任务启动。
- `forge-document`、`export-report`、`export-scoring-table`、PDF / DOCX / 图片预览下载。
- `/api/knowledge/**`、`/api/kb/**`。

`contract-review` 继续 proxy：

- `POST /api/reviews`。
- `GET /api/reviews/{run_id}/result`、`document`、`download`。
- `PATCH /api/reviews/{run_id}/risks/{risk_id}`。
- AI 改写、接受、撤销、批量应用相关接口。
- `GET /api/diagnostics/converters`，该接口应反映 legacy 合同审查进程的真实运行环境。

`rag-web-search` 继续 proxy：

- `POST /api/v1/chat/stream`。
- `/api/v1/knowledge/**` 和 Dify Dataset 相关接口。

`competitor-analysis` 继续 proxy：

- `analysis`、`analysis/stream`。
- `workflows/*` 和所有外部搜索 / LLM / Dify 调用链路。

## 5. 兼容原则

- Direct 成功响应保持 legacy-compatible。
- 平台层错误继续使用统一 envelope。
- 401 / 403 不 fallback，不访问配置、数据库或 legacy 后端。
- direct routes 不依赖 legacy backend 进程。
- 未 direct 路径继续由 catch-all proxy 转发到 legacy backend。
- 不改变业务前端请求路径。

## 6. 风险边界

本阶段 direct API 不启动 workflow，不访问 Dify，不触发任务，不处理上传 / 下载 / 预览文件，不读取本地业务产物目录，不改配置，不泄露 workflow key / Dify key，不新增数据库表。

`bid-generator` 项目查询只读取 `bid_generator.projects` 表中已有项目 JSON；该表已在第 5-D / 0006 migration 建立，本阶段不改 schema。

## 7. 验收方式

必跑命令：

```bash
python -m compileall -q packages scripts alembic apps/api legacy/portal-launchpad/backend
python scripts/preflight.py --only platform-api
python scripts/dev.py --write-ports-only
npm --prefix legacy/portal-launchpad run build
```

手工接口检查：

```bash
GET /api/v1/bid-generator/api/projects
GET /api/v1/bid-generator/api/projects/{project_id}
GET /api/v1/bid-generator/api/projects/{project_id}/mappings
```

预期：

- 未登录访问返回平台 401 envelope。
- 无 `bid-generator` 权限用户访问返回平台 403 envelope。
- 有权限用户访问返回 legacy-compatible 结构。
- 不存在的 `project_id` 返回 legacy-compatible `{"detail":"项目不存在"}` 和 404。
- 禁止 direct 的复杂接口继续 proxy。

## 8. 第 8 阶段收口准备

第 8 阶段当前进展：

- 第 8-A：固化第 7-M 回归基线与开发启动稳定化。
- 第 8-B：明确本地文件系统产物边界和现有任务状态边界。
- 第 8-C：补充错误诊断、request_id、代理日志安全和本地文件系统版部署准备。
- 第 8-D：完成第一批低风险 direct API，覆盖 `bid-generator` health/config/entities 和 `contract-review` health/config。
- 第 8-E：完成第二批低风险查询类 direct API，覆盖 `bid-generator` 项目列表、项目详情和 mappings 查询。

下一阶段建议进入第 8-F：第 8 阶段收口与第 9 阶段路线，集中整理 direct/proxy 状态、部署边界、剩余复杂链路专项和后续统一文件存储 / 任务状态 / 去 iframe 的路线。
