# 第 10-F：统一前端收口与 legacy 前端冻结评估

## 1. 当前阶段结论

第 10-F 完成统一前端收口。`apps/web` 已成为当前默认前端主入口，`apps/api` 仍是当前主业务后端。

- `apps/web` 已承载 Portal、竞对分析、RAG、合同审查、标书生成五类真实前端能力。
- `legacy/portal-launchpad` 不再默认启动，保留为旧 Portal 回滚入口。
- 四个 legacy 业务前端不再默认启动，保留为 iframe 回滚和迁移对照入口。
- iframe 代码暂时保留，但不作为 `apps/web` 主业务入口。
- `config/apps.yaml` 的 `iframeUrl` 相关配置保留为回滚配置，不作为 `apps/web` 原生页面依赖。
- 本阶段不删除 legacy，不修改 `apps/api` 业务 API，不修改数据库结构，不新增 Alembic migration。
- 本阶段不接 MinIO，不接 Celery / RQ，不迁新业务页面。

## 2. 当前主前端入口

默认启动命令：

```bash
python scripts/dev.py
```

当前默认启动：

- `apps/web`，默认端口 `5300`。
- `apps/api` / `platform-api`，默认端口 `5220`。

platform-api 在统一启动器中默认使用稳定 uvicorn 进程，不启用 `--reload`。这是为了避免 legacy 标书生成 `gateway-out` 兼容导入扩展 Python 搜索路径后，reload 子进程误解析同名 `main.py`；不涉及 `apps/api` 业务 API 行为变更。

当前默认不启动：

- `legacy/portal-launchpad`。
- `legacy/company-competitors-analysis`。
- `legacy/chat_with_rag_and_websearch/frontend`。
- `legacy/contract_review/frontend`。
- `legacy/bid-generator/frontend-web`。
- 四个 legacy 业务后端。

默认 `runtime/ports.json` 只写入 `apps-web.frontend_url` 和 `platform-api.backend_url` / `health_url`，不写入 legacy 前端的 `frontend_url` / `iframe_url`，避免误导当前主入口。

`apps/web` 当前承载：

- Portal 登录、会话恢复、工作台、用户管理、feedback、runtime apps 和 app usage。
- 竞对分析 history、analysis、analysis stream 和 workflow 调用。
- RAG sessions、conversations、chat stream 和 knowledge documents。
- 合同审查上传、run 状态、result、风险卡片、AI 改写和 DOCX 下载。
- 标书生成 projects、upload、extract、stream、task progress、Dify workflow、export、preview、knowledge/kb。

## 3. legacy 前端回滚策略

启动 legacy Portal 回滚入口：

```bash
python scripts/dev.py --legacy-portal
```

该模式会在默认 `apps/web + platform-api` 之外启动 `legacy/portal-launchpad` 前后端，并在 `runtime/ports.json` 写入 `portal.frontend_url` 和 `portal.backend_url`。

启动 legacy Portal 和四个 legacy 业务前端完整回滚入口：

```bash
python scripts/dev.py --with-legacy-frontends
```

该模式会在默认 `apps/web + platform-api` 之外启动 `legacy/portal-launchpad` 和四个 legacy 业务前端，并在 `runtime/ports.json` 写入 `portal.frontend_url` 以及四个业务模块对应 `iframe_url`。

启动 legacy 前端和 legacy 后端完整回滚链路：

```bash
python scripts/dev.py --with-legacy-frontends --with-legacy-backends
```

该模式会写入 legacy Portal `frontend_url`、legacy 业务前端 `iframe_url`，并写入 legacy 后端 `backend_url` / `health_url`，供 catch-all proxy 和 iframe 回滚链路使用。

单模块 legacy frontend 回滚仍支持：

```bash
python scripts/dev.py --only rag-web-search --with-legacy-frontends
python scripts/dev.py --only contract-review --with-legacy-frontends
python scripts/dev.py --only bid-generator --with-legacy-frontends
python scripts/dev.py --only competitor-analysis --with-legacy-frontends
```

如需单模块 legacy backend 同时回滚，追加 `--with-legacy-backends`。

## 4. 五个前端能力总览

### A. Portal

- 登录、登出和会话恢复。
- 工作台与模块入口。
- 用户管理、权限配置、启用停用、重置密码和当前用户改密。
- feedback ticket / feature request、captcha 和附件提交。
- runtime apps、app usage HTTP 和 `/ws/core/app-usage`。

### B. 竞对分析

- history 列表、详情、删除。
- analysis 普通请求和 NDJSON stream。
- workflow validate、company detail、compare report、score。
- 当前主页面为 `apps/web/src/modules/competitor-analysis`。

### C. RAG

- sessions、conversations 和 conversations sync。
- chat stream SSE、取消、错误和完成状态。
- knowledge documents 列表、文本创建、文件上传、详情和删除。
- 当前主页面为 `apps/web/src/modules/rag`。

### D. 合同审查

- DOCX / DOC / PDF 上传。
- run 创建、状态轮询、history、result。
- 风险卡片、风险状态修改、AI apply / accept / edit / reject。
- 原始 DOCX 与修订 DOCX 鉴权下载。
- 当前主页面为 `apps/web/src/modules/contract-review`。

### E. 标书生成

- projects 列表、创建、详情、更新和删除。
- 上传、extract-stream、task progress 和 cancel。
- Dify workflow、大纲 / 正文 stream、解析报告任务。
- PDF / 图片 preview，DOCX / PDF / Excel export。
- knowledge documents、knowledge sync 和 kb sync。
- 当前主页面为 `apps/web/src/modules/bid-generator`。

## 5. iframe 状态

`apps/web` 主业务路径不再依赖 iframe。`apps/web/src/modules/iframe` 与 `iframeBridge` 暂时保留，用于 legacy 前端回滚和兼容排查。

`config/apps.yaml` 中四个业务模块的 `iframe_url_env` 和 `iframe_enabled` 暂不删除。它们是回滚配置，不是 `apps/web` 原生页面的主依赖。

后续阶段删除 iframe 前，必须确认：

- `apps/web` 五个原生页面完成统一验收。
- 无生产回滚需求。
- 无 legacy 前端静态资源依赖。
- 无 runtime apps / iframe auth bridge 兼容需求。

## 6. preflight 策略

默认检查：

```bash
python scripts/preflight.py
```

默认检查 `apps/web`、`apps/api`、根依赖、数据库、端口和本地文件系统 warning，不因 legacy 前端依赖缺失失败。

只检查统一后端：

```bash
python scripts/preflight.py --only platform-api
```

该模式不检查前端。

检查 legacy 前端回滚依赖：

```bash
python scripts/preflight.py --with-legacy-frontends
```

检查 legacy 后端回滚依赖：

```bash
python scripts/preflight.py --with-legacy-backends
```

Dify / workflow / Dataset key 仍按已有策略 warning 或运行时错误处理，不作为默认启动阻塞项。本地文件系统目录缺失仍以 warning 提醒持久化挂载，不自动安装依赖。

## 7. runtime/ports.json 策略

默认模式写入：

- `apps-web.frontend_url`。
- `platform-api.backend_url`。
- `platform-api.health_url`。

默认模式不写入 legacy Portal、legacy 业务前端或 legacy backend URL。

legacy 回滚模式写入：

- `--legacy-portal` 写入 `portal.frontend_url` / `portal.backend_url`。
- `--with-legacy-frontends` 写入 legacy Portal `frontend_url` 和四个 legacy 业务前端 `iframe_url`。
- `--with-legacy-backends` 写入四个 legacy 业务后端 `backend_url` / `health_url`。

`runtime/ports.json` 是运行时产物，不提交 Git。

## 8. legacy 前端冻结评估

legacy 前端已经进入非默认启动状态：

- `legacy/portal-launchpad`：保留为旧 Portal 回滚入口，暂不删除。
- `legacy/company-competitors-analysis`：保留为竞对分析 iframe 回滚入口，暂不删除。
- `legacy/chat_with_rag_and_websearch/frontend`：保留为 RAG iframe 回滚入口，暂不删除。
- `legacy/contract_review/frontend`：保留为合同审查 iframe 回滚入口，暂不删除。
- `legacy/bid-generator/frontend-web`：保留为标书生成复杂编辑器和 iframe 回滚入口，暂不删除。

删除前必须确认无回滚需求、无 iframe 依赖、无静态资源依赖，并单独形成删除评估和验收清单。

## 9. 验收清单

命令验收：

```bash
.venv/bin/python -m compileall -q packages scripts alembic apps/api legacy/portal-launchpad/backend
.venv/bin/python scripts/preflight.py --only platform-api
.venv/bin/python scripts/preflight.py
.venv/bin/python scripts/dev.py --write-ports-only
.venv/bin/python scripts/dev.py --no-business --write-ports-only
.venv/bin/python scripts/dev.py --with-legacy-frontends --write-ports-only
.venv/bin/python scripts/dev.py --with-legacy-frontends --with-legacy-backends --write-ports-only
.venv/bin/python scripts/dev.py --legacy-portal --write-ports-only
npm --prefix apps/web run build
git diff --check
```

手工验收重点：

- 默认 `python scripts/dev.py` 启动 `apps/web` 和 `apps/api`。
- 默认 `runtime/ports.json` 不写 legacy 前端 `iframe_url`。
- 登录后进入 `/workspace`，五个模块入口均进入 `apps/web` 原生页面。
- 用户管理、feedback、app usage、runtime apps 可用。
- 四个业务模块原生页面能调用 `/api/v1/**` 统一业务 API。
- legacy 回滚参数能写入对应 legacy 前端和后端端口。
- `runtime/ports.json` 不提交。

## 10. 后续阶段建议

第 10-G 建议做统一前端总体验收与发布准备，重点覆盖：

- 五个原生页面的端到端回归。
- 生产反向代理与静态资源部署策略。
- CORS、WebSocket、SSE、下载和上传链路验收。
- iframe / legacy 删除前置条件清单。

不建议在第 10-F 删除 legacy 前端或 iframe 代码。
