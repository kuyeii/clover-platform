# 第 8-A：回归基线与开发启动稳定化

## 1. 当前阶段结论

第 7-M 已完成业务代理与 iframe auth bridge 总体验收。第 8-A 不重复迁移和验收业务功能，而是把第 7-M 的结果固化为可重复执行的回归基线，并稳定本地开发启动链路。

本阶段不新增业务功能，不迁移新的 direct API，不引入 MinIO，不引入 Celery / RQ，不修改数据库结构，不去 iframe，不修改 JWT 或 Portal session。

## 2. 第 7 阶段稳定边界

四个统一业务入口必须持续存在：

- `/api/v1/competitor-analysis/**`
- `/api/v1/rag/**`
- `/api/v1/contract-review/**`
- `/api/v1/bid-generator/**`

已 direct 的 API：

- `competitor-analysis`：`GET /api/health`、`GET/POST/DELETE /api/history`、`GET/DELETE /api/history/{history_id}`。
- `rag-web-search`：`GET /api/v1/health`、`POST /api/v1/sessions`、`GET /api/v1/conversations`、`PUT /api/v1/conversations/sync`。

仍 proxy 的 API：

- `competitor-analysis`：`analysis`、`analysis/stream`、`workflows/*`。
- `rag-web-search`：`chat/stream`、`knowledge/*`。
- `contract-review`：当前全部业务 API。
- `bid-generator`：当前全部业务 API。

iframe auth bridge 映射必须保持：

- `competitor-analysis` -> `/api/v1/competitor-analysis`
- `rag-web-search` -> `/api/v1/rag`
- `contract-review` -> `/api/v1/contract-review`
- `bid-generator` -> `/api/v1/bid-generator`

持续回归约束：

- token 不进入 iframe URL query/hash、console 或业务子应用长期 `localStorage`。
- `Authorization` 和 `X-Portal-Client-Id` 只发给 `apps/api`。
- fallback 到 legacy backend 时不携带 Portal token。
- 401 / 403 不 fallback，避免绕过 Portal 登录和应用权限。
- 502 / 503 / network error 只允许受控 fallback。
- 非幂等 POST / PUT / PATCH / DELETE 不自动重复提交到 legacy。
- `FormData` 不手动设置 multipart `Content-Type`。
- 下载使用 authenticated fetch blob；如保留 legacy URL，必须说明原因。
- stream 保持流式读取，不被 `apps/api` 或前端缓冲成完整响应。

## 3. 必跑回归命令

```bash
python -m compileall -q packages scripts alembic apps/api legacy/portal-launchpad/backend

npm --prefix legacy/portal-launchpad run build

npm --prefix legacy/company-competitors-analysis run build
npm --prefix legacy/chat_with_rag_and_websearch/frontend run build
npm --prefix legacy/contract_review/frontend run build
npm --prefix legacy/bid-generator/frontend-web run build

python scripts/preflight.py --only platform-api
python scripts/dev.py --write-ports-only
```

`runtime/ports.json` 由启动器生成，本地使用但不提交。

## 4. 手工 smoke checklist

### Portal

- 登录成功。
- 刷新后登录态保持。
- 用户管理可读写。
- app usage enter / heartbeat / leave 正常。
- runtime apps 返回四个业务 iframe URL 和 backend URL。
- feedback 工单、建议、验证码、附件校验链路正常。

### competitor-analysis

- iframe URL 无 token。
- 请求优先走 `/api/v1/competitor-analysis`。
- health/history direct API 正常。
- analysis stream 保持 NDJSON 逐行读取。
- 401 / 403 不 fallback。

### RAG

- iframe URL 无 token。
- 请求优先走 `/api/v1/rag`。
- sessions/conversations direct API 正常。
- chat stream 保持 SSE。
- knowledge list/upload/download 通过代理可用。
- Dify 502 错误文案清晰，不误判为 `apps/api` 崩溃。

### contract-review

- iframe URL 无 token。
- 请求优先走 `/api/v1/contract-review`。
- 小 DOCX 上传可创建审查任务。
- history/status/result 可读取。
- DOCX download 使用 authenticated fetch blob。
- AI smoke test 可触发。
- 401 / 403 不 fallback。

### bid-generator

- iframe URL 无 token。
- 请求优先走 `/api/v1/bid-generator`。
- workflow-status/entities/projects 正常。
- desensitize/restore 正常。
- upload 正常。
- 至少一个 SSE 接口保持流式读取。
- 至少一个下载接口返回 blob / `Content-Disposition` 语义。
- 非幂等 POST 不自动重复提交。

## 5. 安全自查命令

```bash
grep -RIn "token\\|Authorization\\|postMessage\\|clover:auth" \
  legacy/portal-launchpad/src \
  legacy/company-competitors-analysis/src \
  legacy/chat_with_rag_and_websearch/frontend/src \
  legacy/contract_review/frontend/src \
  legacy/bid-generator/frontend-web/src \
  apps/api | head -500
```

需要确认：

- 没有 `console.log` token。
- 没有 token query/hash。
- 没有业务子应用长期 `localStorage` token。
- Portal 父页面校验 `event.source` 和 `event.origin`。
- iframe 子应用校验 requestId / appCode / origin。
- 401 / 403 不 fallback。

调用点自查：

```bash
grep -RIn "window.open\\|location.href\\|href=.*download\\|Content-Type.*multipart\\|localStorage.*token\\|console\\.log.*token" \
  legacy/company-competitors-analysis/src \
  legacy/chat_with_rag_and_websearch/frontend/src \
  legacy/contract_review/frontend/src \
  legacy/bid-generator/frontend-web/src || true
```

## 6. dev.py / preflight 基线

`scripts/dev.py --no-business` 预期：

- Portal frontend。
- platform-api。
- 不启动 legacy Portal backend。
- 不启动四个业务模块。

`scripts/dev.py --only portal` 预期：

- Portal frontend。
- legacy Portal backend。
- 作为 legacy Portal 回滚和兼容排查路径保留。

四个业务单模块写端口预期：

- `python scripts/dev.py --only competitor-analysis --write-ports-only` 写入 `competitor-analysis.frontend_url` 和 `backend_url`。
- `python scripts/dev.py --only rag-web-search --write-ports-only` 写入 `rag-web-search.frontend_url` 和 `backend_url`。
- `python scripts/dev.py --only contract-review --write-ports-only` 写入 `contract-review.frontend_url` 和 `backend_url`。
- `python scripts/dev.py --only bid-generator --write-ports-only` 写入 `bid-generator.frontend_url` 和 `backend_url`。

默认 `python scripts/dev.py` 预期启动：

- Portal frontend + legacy Portal backend。
- platform-api。
- `competitor-analysis` frontend/backend。
- `rag-web-search` frontend/backend。
- `contract-review` frontend/backend。
- `bid-generator` frontend/backend。

`python scripts/dev.py --write-ports-only` 只生成 `runtime/ports.json`，不启动服务。该文件不应提交。

`preflight` 必须给出清晰提示：

- 缺 Python 依赖。
- 缺 node_modules。
- 缺 apps/api requirements。
- 缺 `python-multipart` / `httpx`。
- 端口冲突。
- `runtime/ports.json` 写入前的端口规划。
- 本地业务模块前后端路径不存在。
- Dify / workflow key 缺失是 warning，不应误判为代码错误。
- 本地文件目录缺失给出清晰提示，本阶段不搬迁文件目录。

## 7. 常见问题

- 端口冲突：关闭占用进程，或调整 `config/apps.yaml` 对应端口范围。
- `node_modules` 缺失：进入对应前端目录执行 `npm install`。
- Python requirements 缺失：按 `preflight` 的 fix hint 安装根、`apps/api` 或 legacy 模块依赖。
- `python-multipart` / `httpx` 缺失：执行 `python -m pip install -r apps/api/requirements.txt`。
- Dify / workflow key 缺失：本阶段应作为 warning；真实业务调用失败时再检查 `.env` 或部署密钥。
- PostgreSQL 连接失败：检查 `DATABASE_URL` 或 `POSTGRES_*`，并确认 PostgreSQL 18 可连接。
- legacy backend 未启动导致 proxy 502：这表示业务后端不可达，不等于 `apps/api` 崩溃。
- 401 / 403：这是登录或权限问题，不应 fallback。
- 业务 Dify 上游 502：这是 legacy 业务或 Dify 上游问题，不等于 Portal 或 `apps/api` 崩溃。

## 8. 第 8-B 建议

下一阶段建议进入第 8-B：本地文件系统 + 任务状态边界规范。

第 8-B 仍不接 MinIO，不接 Celery / RQ。继续沿用各应用原有文件和任务状态，只做边界规范和未来扩展口，为后续统一文件存储、任务状态和恢复能力做准备。
