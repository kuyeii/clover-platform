# 第 8-D：低风险 direct API 批次 1

## 1. 阶段结论

第 8-D 在第 7-M 业务代理总体验收、第 8-A 回归基线、第 8-B 本地文件系统边界和第 8-C 诊断边界基础上，完成第一批低风险、只读、无副作用业务 API direct 迁移。

本阶段继续保持以下边界：

- 不接 MinIO / S3。
- 不引入 Celery / RQ / Dramatiq。
- 不改数据库结构。
- 不改业务前端。
- 不改 legacy 后端核心逻辑。
- 不迁移文件上传、下载、stream、Dify workflow、任务状态、DOCX 导出、AI 改写和 RAG Dataset。
- Direct 业务成功响应保持 legacy-compatible，不强行包 `success/data`。
- 未 direct 的路径继续由 catch-all proxy 转发到 legacy backend。

## 2. 源码审计结论

### bid-generator

审计文件：

- `legacy/bid-generator/pipt-flask/main_lite.py`
- `legacy/bid-generator/pipt-flask/app/api_lite/routes.py`
- `legacy/bid-generator/pipt-flask/app/api_lite/project_routes.py`
- `legacy/bid-generator/pipt-flask/app/api_lite/task_routes.py`
- `legacy/bid-generator/pipt-flask/README.md`
- `legacy/bid-generator/README.md`

本批 direct：

| Platform path | Legacy path | direct 原因 |
| --- | --- | --- |
| `GET /api/v1/bid-generator/health` | `GET /health` | 常量健康检查，不访问 Dify、任务、数据库或文件 |
| `GET /api/v1/bid-generator/api/config/workflow-status` | `GET /api/config/workflow-status` | 只返回工作流配置布尔状态和 env var 名，不返回真实 key，不调用 Dify |
| `GET /api/v1/bid-generator/api/config/analysis-framework` | `GET /api/config/analysis-framework` | 读取静态 `analysis_framework.json`，无写入和任务依赖 |
| `GET /api/v1/bid-generator/api/entities` | `GET /api/entities` | 返回静态实体类型映射，无写入和任务依赖 |

暂不 direct：

- `/api/projects/**`：包含项目数据库写入、文件缓存、Dify 调用或导出。
- `/api/tasks/**`：依赖 legacy `TaskManager` 进程内任务状态和 SSE progress。
- `/api/knowledge/**`、`/api/kb/**`：涉及 Dify Dataset 或知识库同步状态。
- `/api/projects/pdf/**`、`/api/extracted-images/**`、`/api/projects/*/source-docx`：涉及本地文件读取或下载。
- `forge-document`、`export-report`、`export-scoring-table`：涉及文件生成或下载。

### contract-review

审计文件：

- `legacy/contract_review/web_api.py`
- `legacy/contract_review/src`
- `legacy/contract_review/README.md`

本批 direct：

| Platform path | Legacy path | direct 原因 |
| --- | --- | --- |
| `GET /api/v1/contract-review/api/health` | `GET /api/health` | 常量健康检查，不访问 pipeline、Dify、任务或文件 |
| `GET /api/v1/contract-review/api/config` | `GET /api/config` | 返回环境变量派生的默认审查配置，无写入和任务依赖 |

暂不 direct：

- `GET /api/v1/contract-review/api/diagnostics/converters`：源码只做轻量组件探测，但结果依赖 legacy 合同审查后端的 Python 环境和系统可执行文件；若由 `apps/api` 环境直接探测，可能与真实合同审查进程不一致，因此本批继续 proxy。
- `/api/reviews/**`：涉及上传、pipeline、任务状态、本地 `data/runs`、DOCX 预览 / 下载、风险状态更新、AI 改写和接受 / 撤销状态。

### competitor-analysis

当前已有 health/history direct。本阶段只做源码边界复核，不扩大 direct 范围。`analysis`、`analysis/stream` 和 `workflows/*` 继续 proxy 到 legacy 后端。

### RAG

当前已有 health/sessions/conversations/sync direct。本阶段只做源码边界复核，不扩大 direct 范围。`chat/stream` 和 `knowledge/**` 继续 proxy 到 legacy 后端。

## 3. 实现边界

新增或调整位置：

- `apps/api/app/services/bid_generator_service.py`
- `apps/api/app/services/contract_review_service.py`
- `apps/api/app/api/bid_generator_proxy.py`
- `apps/api/app/api/contract_review_proxy.py`

路由注册仍保持：

- `apps/api/app/api/router.py` 统一 include 业务 router。
- `apps/api/app/__init__.py` 不直接注册业务 router。
- direct routes 定义在各模块 catch-all proxy 之前，优先匹配。

鉴权边界保持：

- direct routes 和 proxy routes 共用 Portal session 校验。
- direct routes 和 proxy routes 共用应用权限校验。
- 401 / 403 仍返回平台统一错误 envelope。
- 成功响应保持 legacy 原始 JSON 结构。
- 未 direct 路径继续 proxy fallback，不改变前端请求路径。

## 4. 当前 direct / proxy 状态

`competitor-analysis` direct：

- `GET /api/v1/competitor-analysis/api/health`
- `/api/v1/competitor-analysis/api/history*`

`rag-web-search` direct：

- `GET /api/v1/rag/api/v1/health`
- `POST /api/v1/rag/api/v1/sessions`
- `GET /api/v1/rag/api/v1/conversations`
- `PUT /api/v1/rag/api/v1/conversations/sync`

`contract-review` direct：

- `GET /api/v1/contract-review/api/health`
- `GET /api/v1/contract-review/api/config`

`bid-generator` direct：

- `GET /api/v1/bid-generator/health`
- `GET /api/v1/bid-generator/api/config/workflow-status`
- `GET /api/v1/bid-generator/api/config/analysis-framework`
- `GET /api/v1/bid-generator/api/entities`

仍 proxy：

- RAG `chat/stream`、`knowledge/**`
- competitor-analysis `analysis`、`analysis/stream`、`workflows/*`
- contract-review `diagnostics/converters`、`reviews/**`、download/document/AI 相关接口
- bid-generator Dify workflow、SSE task、项目文件、knowledge/kb、forge/export/download/preview 相关接口

## 5. 验证建议

必跑：

```bash
python -m compileall -q apps/api
```

建议在已初始化 Portal session 的浏览器或 API client 中验证：

```bash
GET /api/v1/bid-generator/health
GET /api/v1/bid-generator/api/config/workflow-status
GET /api/v1/bid-generator/api/config/analysis-framework
GET /api/v1/bid-generator/api/entities
GET /api/v1/contract-review/api/health
GET /api/v1/contract-review/api/config
GET /api/v1/contract-review/api/diagnostics/converters
```

预期：

- 前 6 个接口由 `apps/api` direct 返回 legacy-compatible JSON。
- `contract-review/api/diagnostics/converters` 继续走 proxy，返回真实 legacy 合同审查后端环境诊断。
- 禁止 direct 的复杂接口仍由 proxy fallback 处理。
- 未登录或无应用权限时仍返回平台 401 / 403 envelope。
