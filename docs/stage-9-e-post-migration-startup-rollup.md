# 第 9-E：四模块迁移收口与 legacy 默认启动策略调整

## 1. 当前阶段结论

第 9 阶段四个业务模块后端迁移已经进入收口。第 9-A 完成竞对分析，第 9-B 完成 RAG 问答，第 9-C 完成合同审查，第 9-D 完成标书生成；当前 `apps/api` 是主业务后端。

- 四个 legacy 业务后端进程不再默认启动。
- legacy 后端进程保留为回滚 / 调试路径。
- legacy 源码目录仍保留，尤其是仍被 `apps/api` import 的部分。
- catch-all proxy 继续保留作为未知路径和回滚兜底。
- 不接 MinIO。
- 不接 Celery / RQ。
- 不改数据库结构，不新增 Alembic migration。
- 不去 iframe。
- 不做前端整合。
- 第 10 阶段后续再处理 `apps/web` 和 `modules`。

## 2. 四模块迁移状态总览

### A. competitor-analysis

已 direct 的 API：

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

仍 proxy 的 API：`ANY /api/v1/competitor-analysis/{path:path}` catch-all 仅用于未知路径和回滚兜底。当前常规竞对分析业务 API 不再以 legacy 后端进程为主路径。

legacy 源码依赖：`apps/api` 会读取 `legacy/company-competitors-analysis/.env` 和 `.env.local` 作为 workflow 配置兼容来源，目录暂时保留。legacy 竞对分析后端进程默认不启动。

### B. RAG

已 direct 的 API：

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

仍 proxy 的 API：`ANY /api/v1/rag/{path:path}` catch-all 仅用于未知路径和回滚兜底。当前常规 RAG 业务 API 不再以 legacy 后端进程为主路径。

legacy 源码依赖：`apps/api` 会读取 `legacy/chat_with_rag_and_websearch/backend/.env` 和 `.env.local` 作为 RAG Dify 配置兼容来源，目录暂时保留。legacy RAG 后端进程默认不启动。

### C. contract-review

已 direct 的 API：

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

仍 proxy 的 API：`ANY /api/v1/contract-review/{path:path}` catch-all 仅用于未知路径和回滚兜底。当前常规合同审查业务 API 不再以 legacy 后端进程为主路径。

legacy 源码依赖：`apps/api/app/services/contract_review_service.py` 将 `legacy/contract_review` 加入 `sys.path`，直接复用 `legacy/contract_review/src`、`config`、Dify client、DOCX locator、review store 和文件产物目录。该源码目录不能删除。legacy 合同审查后端进程默认不启动。

### D. bid-generator

已 direct 的 API：

- `GET /api/v1/bid-generator/health`
- `GET /api/v1/bid-generator/api/health`
- health/config、脱敏/还原、项目 CRUD、需求提取、Dify workflow、SSE task、文件预览下载、forge/export、knowledge/kb 和解析报告相关 API。

第 9-D 文档已列出完整 direct 清单，当前 legacy `api_lite` 审计范围内的标书生成后端业务 API 均已 direct。

仍 proxy 的 API：`ANY /api/v1/bid-generator/{path:path}` catch-all 仅用于未知路径和回滚兜底。当前常规标书生成业务 API 不再以 legacy 后端进程为主路径。

legacy 源码依赖：`apps/api/app/services/bid_generator_service.py` 直接扩展包路径并 import `legacy/bid-generator/pipt-flask/app/api_lite`，同时复用 `gateway-out` 和 `dify-bridge` 的 `src` 包、DocumentForge、TaskManager、本地 `data/*` 目录和配置资产。该源码目录不能删除。legacy 标书生成后端进程默认不启动。

## 3. 默认启动策略

```bash
python scripts/dev.py
```

当前默认启动：

- Portal frontend。
- `apps/api` / platform-api。
- 四个业务 iframe frontend。

当前默认不启动：

- legacy Portal backend。
- 四个 legacy 业务 backend。

默认 `runtime/ports.json` 会写入 Portal frontend、platform-api 和四个业务 iframe frontend，不写未启动 legacy 业务后端的 `backend_url`。四个业务 iframe 前端通过 Portal auth bridge 优先调用 `apps/api` direct API。

## 4. legacy 回滚启动策略

启动所有 legacy 业务后端：

```bash
python scripts/dev.py --with-legacy-backends
```

启动单个 legacy 业务后端：

```bash
python scripts/dev.py --only competitor-analysis --with-legacy-backends
python scripts/dev.py --only rag-web-search --with-legacy-backends
python scripts/dev.py --only contract-review --with-legacy-backends
python scripts/dev.py --only bid-generator --with-legacy-backends
```

回滚模式会启动 platform-api、对应业务 iframe frontend 和对应 legacy backend。`runtime/ports.json` 会写入对应 `backend_url` 与 `health_url`，catch-all proxy 可使用该 `backend_url` fallback 到 legacy backend。

## 5. no-business 模式

```bash
python scripts/dev.py --no-business
```

该模式只启动：

- Portal frontend。
- platform-api。

该模式不启动四个业务 iframe frontend，不启动四个 legacy 业务 backend，也不启动 legacy Portal backend。

## 6. 单模块启动策略

默认单模块启动：

```bash
python scripts/dev.py --only competitor-analysis
python scripts/dev.py --only rag-web-search
python scripts/dev.py --only contract-review
python scripts/dev.py --only bid-generator
```

当前行为：

- 自动包含 platform-api。
- 启动对应业务 iframe frontend。
- 默认不启动对应 legacy backend。
- 默认 `runtime/ports.json` 不写对应 legacy `backend_url`。
- 该模块 direct API 仍可用。
- 未知 proxy 路径如果无 `backend_url`，返回清晰 502，而不是 traceback。

单模块 legacy 回滚启动见第 4 节。

## 7. preflight 策略

- `python scripts/preflight.py --only platform-api` 不依赖 legacy 业务后端进程。
- 默认 `python scripts/preflight.py` 检查 platform-api、Portal frontend 和业务 iframe frontend，不因 legacy 业务后端依赖缺失失败。
- `python scripts/preflight.py --with-legacy-backends` 才检查 legacy 业务后端入口与依赖。
- Dify / workflow / Dataset key 缺失继续按已有策略 warning 或业务运行时错误处理，不变成默认启动阻塞。
- 本地文件系统目录缺失继续 warning 或提示持久化挂载，不默认阻塞启动。
- preflight 不自动安装依赖。

## 8. runtime/ports.json 策略

默认模式写入：

- Portal frontend。
- platform-api。
- 四个业务 iframe frontend。

默认模式不写未启动 legacy 业务后端的 `backend_url`，避免误导 `apps/api` 或开发者认为 legacy 后端已经启动。

回滚模式写入：

- platform-api。
- 对应业务 iframe frontend。
- 对应 legacy backend 的 `backend_url` 和 `health_url`。

`runtime/ports.json` 是运行时产物，不提交 Git。

## 9. catch-all proxy 策略

- direct API 是主路径。
- catch-all proxy 继续保留。
- backend_url 缺失时，未知路径返回 `BUSINESS_BACKEND_UNAVAILABLE` 的 502 envelope。
- 401 / 403 不 fallback。
- `Authorization`、`Cookie` 和 `Set-Cookie` 不转发给 legacy backend。
- `X-Request-ID`、`X-Portal-User-Id`、`X-Portal-User-Account`、`X-Portal-User-Role`、`X-Portal-Client-Id` 等非敏感上下文保持现有转发行为。

## 10. legacy 冻结评估

### legacy 后端进程

四个 legacy 业务后端进程进入非默认启动状态。它们仅作为回滚 / 调试路径，不作为主业务路径。需要时使用 `--with-legacy-backends` 启动。

### legacy 源码目录

legacy 源码目录暂不删除。删除前必须确认无 import、无回滚需求、无前端依赖。

- `legacy/contract_review/src` 仍被 `apps/api` 合同审查 direct API 复用。
- `legacy/bid-generator/pipt-flask/app/api_lite`、`legacy/bid-generator/gateway-out`、`legacy/bid-generator/dify-bridge` 仍被 `apps/api` 标书生成 direct API 复用。
- `legacy/chat_with_rag_and_websearch/backend` 仍作为 RAG 配置兼容来源保留。
- `legacy/company-competitors-analysis` 仍作为竞对分析配置兼容来源保留。
- legacy 前端仍作为四个业务 iframe frontend 存在。

### catch-all proxy

catch-all proxy 继续保留，用于未知路径和回滚。它不作为主业务路径；默认无 `backend_url` 时返回清晰 502。

## 11. 验收清单

本阶段验证命令：

```bash
python -m compileall -q packages scripts alembic apps/api legacy/portal-launchpad/backend
python scripts/preflight.py --only platform-api
python scripts/dev.py --write-ports-only
python scripts/dev.py --no-business --write-ports-only
python scripts/dev.py --with-legacy-backends --write-ports-only
python scripts/dev.py --only competitor-analysis --write-ports-only
python scripts/dev.py --only rag-web-search --write-ports-only
python scripts/dev.py --only contract-review --write-ports-only
python scripts/dev.py --only bid-generator --write-ports-only
python scripts/dev.py --only competitor-analysis --with-legacy-backends --write-ports-only
python scripts/dev.py --only rag-web-search --with-legacy-backends --write-ports-only
python scripts/dev.py --only contract-review --with-legacy-backends --write-ports-only
python scripts/dev.py --only bid-generator --with-legacy-backends --write-ports-only
npm --prefix legacy/portal-launchpad run build
```

必须确认的路由仍存在：

- `/api/v1/core/health`
- `/api/v1/competitor-analysis/{path:path}`
- `/api/v1/rag/{path:path}`
- `/api/v1/contract-review/{path:path}`
- `/api/v1/bid-generator/{path:path}`

必须确认：

- 默认 `runtime/ports.json` 不写未启动 legacy 业务后端的 `backend_url`。
- 回滚模式 `runtime/ports.json` 写入对应 legacy `backend_url`。
- `legacy/portal-launchpad/vite.config.d.ts` 无改动。
- `runtime/ports.json` 不提交。

## 12. 后续阶段说明

第 9 阶段后端迁移可以按当前边界收口。第 10 阶段再进入统一前端 `apps/web` 与 `modules` 落位。本阶段不处理前端整合，不迁移 `modules`，不删除 legacy。
