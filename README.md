# Clover Platform

四叶草平台整合主仓库。

当前阶段已进入第 10-F：统一前端收口与 legacy 前端冻结评估。`apps/web` 是默认前端主入口，`apps/api` 仍是当前主业务后端；Portal、竞对分析、RAG、合同审查和标书生成均已在 `apps/web` 承载真实页面。legacy Portal 与四个 legacy 业务前端默认不启动，继续保留为回滚入口，iframe 代码和 `config/apps.yaml` iframe 配置暂时保留。阶段说明见 `docs/stage-10-f-frontend-rollup-and-legacy-freeze.md`。

## 项目目标

`clover-platform` 用于逐步整合统一入口、合同审查、标书生成、RAG 问答和竞对分析五个既有项目。当前不是五个后端已经合并完成的状态，也没有去掉 iframe；业务迁移会继续分阶段推进。

## 当前阶段

当前处于第 10-F 阶段：在第 10-A 到第 10-E 已完成统一前端骨架、Portal、竞对分析、RAG、合同审查和标书生成真实页面迁入后，本阶段完成统一前端收口和 legacy 前端默认启动策略调整。`apps/web` 已具备 Portal 登录、会话恢复、工作台、四个模块入口、用户管理、runtime apps、app usage、feedback、竞对分析真实页面、RAG 会话 / 聊天流 / knowledge 文档能力、合同审查上传 / 审查 / AI 改写能力，以及标书生成项目 CRUD、文件上传解析、SSE 任务、大纲 / 正文生成、实体映射、脱敏还原、PDF / 图片预览、DOCX / PDF / Excel 导出和 knowledge/kb 能力。默认 `python scripts/dev.py` 只启动 `apps/web` 和 `apps/api`，不默认启动 legacy Portal、四个 legacy 业务前端或 legacy 业务后端；legacy 前端和 iframe 配置继续保留回滚，不删除 legacy，不修改业务 API，`apps/api` 仍是统一后端主应用。阶段边界见 `docs/stage-10-f-frontend-rollup-and-legacy-freeze.md`。

第 1 阶段 monorepo 骨架与 legacy 归档已完成。第 2 阶段 PostgreSQL 18 基础设施已完成。第 3 阶段已完成 Portal 登录、用户管理、应用权限、应用占用状态等核心数据写入 PostgreSQL。第 4 阶段已完成统一开发启动器、端口发现和 runtime iframe URL。第 5-A 阶段已完成竞对分析运行时历史记录和企业校验缓存迁移。第 5-B 阶段已完成 RAG 问答本地对话列表和问答 turn 记录迁移。第 5-C 阶段已完成合同审查运行元数据和结构化 artifact 索引迁移。第 5-D 阶段已完成标书生成 `pipt-lite` 当前 ORM 数据迁移。第 6-A 阶段新增统一 FastAPI 后端基座。第 6-B 阶段在 `apps/api` 中并行新增 Portal 核心 API。第 6-C 阶段已将 Portal 前端 auth、users、app-usage、runtime apps 和 app-usage WebSocket 切到统一后端。第 6-D 阶段已将 Portal feedback 的工单、功能建议、验证码、附件校验和邮件发送迁入 `apps/api`。第 6-E 阶段确认 Portal 前端核心平台 API 不再依赖 legacy Portal 后端，并将 `scripts/dev.py --no-business` 调整为默认只启动 Portal 前端和 platform-api。第 7-A 完成业务模块 API 迁入评估。第 7-B 在 `apps/api` 新增业务代理基座，并接入 `competitor-analysis` 代理试点。第 7-C 将 `competitor-analysis` 的 health/history 直接迁入 `apps/api`；analysis、workflows 和 stream 仍走 legacy proxy fallback。第 7-D 将 RAG 接入 `/api/v1/rag/{path:path}` 鉴权代理。第 7-E 将 RAG health/sessions/conversations/conversations sync 直接迁入 `apps/api`。第 7-F 将 Portal knowledgeService 优先切到 `/api/v1/rag/api/v1/knowledge/...`，knowledge 业务仍由 legacy RAG 后端执行并保留 backendUrl fallback。第 7-G 新增合同审查代理入口 `/api/v1/contract-review/{path:path}`，合同审查业务逻辑仍由 legacy 后端执行。第 7-H 新增标书生成代理入口 `/api/v1/bid-generator/{path:path}`，标书生成业务逻辑仍由 legacy 后端执行。第 7-I 新增 Portal -> iframe auth bridge，并仅将竞对分析 iframe 前端优先切到 `/api/v1/competitor-analysis/**`。第 7-J 将 RAG iframe 前端接入同一 auth bridge，并优先切到 `/api/v1/rag/api/v1/**`；RAG chat stream 和 knowledge 业务逻辑仍由 legacy RAG 后端通过 proxy 执行。第 7-K 将合同审查 iframe 前端接入同一 auth bridge，并优先切到 `/api/v1/contract-review/api/**`；合同审查业务逻辑仍由 legacy 合同审查后端通过 proxy 执行。第 7-L 将标书生成 iframe 前端接入同一 auth bridge，并优先切到 `/api/v1/bid-generator/api/**`；标书生成业务逻辑仍由 legacy `pipt-lite` 后端通过 proxy 执行。第 7-M 对四个业务代理入口、四个 iframe auth bridge 接入、fallback 安全边界和文档状态做总体验收，并收紧非幂等请求的自动 fallback。第 8-A 将第 7-M 验收结果固化为回归与开发启动基线，详见 `docs/stage-8-a-regression-and-dev-baseline.md`。第 8-B 梳理本地文件系统与任务状态边界，详见 `docs/stage-8-b-local-files-and-task-boundary.md`。第 8-C 完善错误诊断与本地文件系统版部署准备，详见 `docs/stage-8-c-diagnostics-and-local-fs-deployment.md`。第 8-D 完成第一批低风险 direct API，详见 `docs/stage-8-d-low-risk-direct-api-batch-1.md`。第 8-E 完成第二批低风险查询类 direct API，详见 `docs/stage-8-e-low-risk-query-direct-batch-2.md`。第 8-F 对第 8 阶段 direct/proxy 混合状态、复杂链路暂缓原因、部署边界、安全边界和验收清单做整体收口，详见 `docs/stage-8-f-stage-8-rollup.md`。第 9-A 完成竞对分析模块主要业务 API direct 迁移，详见 `docs/stage-9-a-competitor-analysis-full-migration.md`。第 9-B 完成 RAG 问答模块主要业务 API direct 迁移，详见 `docs/stage-9-b-rag-full-migration.md`。第 9-C 完成合同审查模块主要业务 API direct 迁移，详见 `docs/stage-9-c-contract-review-full-migration.md`。第 9-D 完成标书生成模块后端业务 API direct 迁移，详见 `docs/stage-9-d-bid-generator-full-migration.md`。第 9-E 完成四模块迁移收口并调整 legacy 默认启动策略，详见 `docs/stage-9-e-post-migration-startup-rollup.md`。第 10-A 初始化统一前端与模块边界骨架，详见 `docs/stage-10-a-frontend-modules-foundation.md`。第 10-B 迁移 Portal 能力和竞对分析真实前端到 `apps/web`，详见 `docs/stage-10-b-portal-and-competitor-frontend-migration.md`。第 10-C 迁移 RAG 真实前端到 `apps/web`，详见 `docs/stage-10-c-rag-frontend-migration.md`。第 10-D 迁移合同审查真实前端到 `apps/web`，详见 `docs/stage-10-d-contract-review-frontend-migration.md`。第 10-E 迁移标书生成真实前端到 `apps/web`，详见 `docs/stage-10-e-bid-generator-frontend-migration.md`。第 10-F 完成统一前端收口与 legacy 前端冻结评估，详见 `docs/stage-10-f-frontend-rollup-and-legacy-freeze.md`。

## Legacy 项目

五个项目以原样复制方式保留在 `legacy/` 下，原始项目目录不移动。

| 模块 | Legacy 路径 | 来源说明 |
| --- | --- | --- |
| 统一入口 | `legacy/portal-launchpad` | 本地既有项目已复制到 `legacy/` |
| 合同审查 | `legacy/contract_review` | 本地既有项目已复制到 `legacy/` |
| 标书生成 | `legacy/bid-generator` | 本地既有项目已复制到 `legacy/` |
| RAG 问答 | `legacy/chat_with_rag_and_websearch` | 本地既有项目已复制到 `legacy/` |
| 竞对分析 | `legacy/company-competitors-analysis` | 本地既有项目已复制到 `legacy/` |

## 目录结构

```text
clover-platform/
  apps/
    web/
    api/
  modules/
    portal/
    contract_review/
    bid_generator/
    rag_qa/
    competitor_analysis/
  packages/
    py_common/
    ui/
    api_client/
    shared_types/
  config/
    default.yaml
    apps.yaml
    workflows.yaml
    config.local.yaml.example
  scripts/
    dev.py
    preflight.py
    check_ports.py
    init_db.py
    check_db.py
  docker/
    docker-compose.yml
    docker-compose.external-postgres.yml
  legacy/
  docs/
  runtime/
```

## Docker 部署

当前保留两种 Docker 部署方式：

- 内置 PostgreSQL：`docker/docker-compose.yml`，同一套 Compose 内启动 `web`、`api`
  和 PostgreSQL 18。
- 外部 PostgreSQL：`docker/docker-compose.external-postgres.yml`，只启动 `web` 和
  `api`，数据库连接到外部服务器。

`web`
使用 Nginx 托管 `apps/web` 构建产物，并把 `/api/v1/*` 和 `/ws/core/*`
反向代理到 `api:5220`。`api` 直接承载当前统一后端和已迁入的业务能力，不默认启动
legacy 前端或 legacy 后端进程。

### 方式一：内置 PostgreSQL

1. 准备环境变量：

```bash
cp .env.example .env
```

上线前必须修改 `.env` 中的 `POSTGRES_PASSWORD`、`PORTAL_ADMIN_PASSWORD`，并
配置 `PIPT_DB_KEY`。`PIPT_ENV=prod` 时未配置 `PIPT_DB_KEY` 会导致标书生成的
脱敏 / 还原等接口无法运行；Compose 会在启动前拦截这种配置。如果本机没有 Python cryptography，可先执行
`python3 -m pip install cryptography`。`PIPT_DB_KEY` 可用下面命令生成：

```bash
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

2. 构建镜像：

```bash
docker compose -f docker/docker-compose.yml build
```

3. 首次初始化数据库：

```bash
docker compose -f docker/docker-compose.yml run --rm api python scripts/init_db.py
docker compose -f docker/docker-compose.yml run --rm api alembic upgrade head
docker compose -f docker/docker-compose.yml run --rm api python scripts/check_db.py
```

`scripts/init_db.py` 会初始化 schema、表、索引、模块元数据，并在缺少管理员时使用
`PORTAL_ADMIN_USERNAME`、`PORTAL_ADMIN_PASSWORD` 和 `PORTAL_ADMIN_DISPLAY_NAME`
创建默认 Portal 管理员。

4. 启动平台：

```bash
docker compose -f docker/docker-compose.yml up -d
```

默认访问地址为 `http://<服务器IP>:5200`。健康检查：

```bash
curl http://127.0.0.1:5200/api/v1/core/health
curl http://127.0.0.1:5200/api/v1/core/health/db
```

Compose 会创建 `postgres18_data`、合同审查上传 / 运行产物、标书生成文档缓存 /
图片缓存 / 知识库 / 模板等持久化 volume。首次创建模板 volume 时，Docker 会把镜像内
默认模板复制进 volume；后续更新镜像不会自动覆盖已存在的模板 volume。不要用
`docker compose down -v` 清理生产环境，除非已经完成数据库和业务文件备份。

### 方式二：外部 PostgreSQL

外部数据库可按下面配置在数据库服务器上单独部署：

```yaml
services:
  postgres:
    image: postgres:18
    container_name: postgres18
    restart: always
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres123456
      POSTGRES_DB: app_db
    ports:
      - "5432:5432"
    volumes:
      - postgres18_data:/var/lib/postgresql

volumes:
  postgres18_data:
```

平台服务器只启动 `web` 和 `api`：

```bash
cp .env.external-postgres.example .env.external-postgres
```

把 `.env.external-postgres` 中的 `EXTERNAL_POSTGRES_HOST` 改成外部 PostgreSQL
服务器 IP 或域名。如果外部数据库使用上面的配置，端口、库名、用户名和密码可保持为
`5432`、`app_db`、`postgres`、`postgres123456`。生产环境必须修改数据库密码、
`PORTAL_ADMIN_PASSWORD`，并配置 `PIPT_DB_KEY`；`PIPT_ENV=prod` 时缺少
`PIPT_DB_KEY` 会导致标书生成脱敏 / 还原等接口在运行时失败，Compose 会在启动前拦截这种配置。

构建镜像：

```bash
docker compose --env-file .env.external-postgres -f docker/docker-compose.external-postgres.yml build
```

首次初始化外部数据库：

```bash
docker compose --env-file .env.external-postgres -f docker/docker-compose.external-postgres.yml run --rm api python scripts/init_db.py
docker compose --env-file .env.external-postgres -f docker/docker-compose.external-postgres.yml run --rm api alembic upgrade head
docker compose --env-file .env.external-postgres -f docker/docker-compose.external-postgres.yml run --rm api python scripts/check_db.py
```

启动平台：

```bash
docker compose --env-file .env.external-postgres -f docker/docker-compose.external-postgres.yml up -d
```

默认访问地址仍为 `http://<平台服务器IP>:5200`。这种方式不会创建
`postgres18_data` volume；数据库备份、恢复和生命周期由外部 PostgreSQL 服务器负责。

## 当前不做的事情

- 不合并五个后端。
- 不删除 iframe 回滚代码和配置。
- 不修改认证逻辑。
- 不改成 JWT。
- 不引入 Celery / RQ。
- 不接 MinIO。
- 不新增统一任务表。
- 不搬迁各业务模块本地文件目录。
- 不升级 legacy React / Vite / Tailwind。
- 不重构业务代码。
- 不删除四个 legacy 业务前端页面。
- 不替换 `legacy/portal-launchpad`。
- 不迁移标书生成的文件缓存、Dify workflow、gateway-out、prompt-forge 或旧 LinCMS 数据层。
- 不迁移 RAG 的 Dify 知识库数据、本地向量索引或文件缓存。
- 不修改其他四个 legacy 项目的业务逻辑。

## 第 6-A 阶段：统一后端基座

第 6-A 新增 `apps/api`，作为统一 FastAPI 后端基座。当前它只提供 platform core 能力，为后续 Portal 后端能力迁入或 Portal 前端切换到统一后端做准备。

当前提供接口：

- `GET /api/v1/core/health`
- `GET /api/v1/core/health/db`
- `GET /api/v1/core/modules`
- `GET /api/v1/core/modules/health`
- `GET /api/v1/core/runtime/apps`

所有新增接口主前缀为 `/api/v1/core`。接口默认返回统一响应结构：`success`、`data`、`message`、`request_id`；错误响应返回 `success: false`、`error.code`、`error.message`、`error.details`、`request_id`。`X-Request-ID` 请求头会被复用，否则由服务生成。

第 6-A 完成时的历史边界：

- 业务模块 API 尚未迁入 `apps/api`。
- Portal 前端尚未切换到 `apps/api`。
- iframe 仍保留。
- Portal session 仍保留。
- JWT 未修改。
- legacy 后端仍继续运行。

安装统一后端依赖：

```bash
python -m pip install -r apps/api/requirements.txt
```

启动统一后端：

```bash
python scripts/dev.py --only platform-api
```

启动 Portal + 统一后端，不启动四个业务模块：

```bash
python scripts/dev.py --no-business
```

启动全部默认开发服务：

```bash
python scripts/dev.py
```

`config/apps.yaml` 中新增 `platform_api`，应用编码为 `platform-api`，`dev.kind` 为 `backend`，默认后端端口为 `5220`，端口范围为 `5220-5229`，健康检查路径为 `/api/v1/core/health`。`runtime/ports.json` 会记录 `platform-api.backend_url` 和 `platform-api.health_url`，但不会生成 `iframe_url`，`/api/v1/core/runtime/apps` 也不会把 `platform-api` 返回为 Portal 菜单应用。

下一步再逐步迁移 Portal 后端能力或业务模块 API 到 `apps/api`。

## 第 6-B 阶段：Portal 核心 API 并行迁入 apps/api

第 6-B 在 `apps/api` 中新增 Portal 核心 API，统一使用 `/api/v1/core` REST 前缀，并新增独立 WebSocket 路径 `/ws/core/app-usage`。本阶段接口与 legacy Portal 后端行为保持兼容，REST 响应继续使用统一 envelope；WebSocket 保持 legacy 消息结构，方便后续 Portal 前端平滑切换。

新增接口：

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
- `WS /ws/core/app-usage`

第 6-B 边界：

以下为该阶段完成时的历史边界说明。

- Portal 前端在第 6-B 时仍继续调用 legacy `/api/auth`、`/api/users`、`/api/app-usage` 和 `/ws/app-usage`。
- legacy Portal 后端仍保留并可独立运行。
- feedback 暂未迁入 `apps/api`。
- JWT / session 机制未修改，继续复用 Portal session token 和 `Authorization: Bearer <token>`。
- 业务模块 API 未迁入 `apps/api`，数据库表结构未变更。

## 第 6-C 阶段：Portal 前端核心 API 切换到 apps/api

第 6-C 将 Portal 前端核心平台能力切到统一后端：

- auth 使用 `/api/v1/core/auth/*`。
- users 使用 `/api/v1/core/users` 和 `/api/v1/core/users/{user_id}`。
- app-usage HTTP 使用 `/api/v1/core/app-usage/*`。
- runtime apps 使用 `/api/v1/core/runtime/apps`。
- app-usage WebSocket 使用 `/ws/core/app-usage`，消息结构继续保持 legacy 兼容，不使用统一 envelope。

Portal 前端的 platform API client 默认使用相对路径 `/api/v1/core`，可用 `VITE_PLATFORM_API_BASE_URL` 覆盖为完整地址，例如 `http://127.0.0.1:5220/api/v1/core`。WebSocket 默认使用 `/ws/core`，可用 `VITE_PLATFORM_WS_BASE_URL` 覆盖。Vite 开发代理中 `/api/v1/core` 和 `/ws/core` 指向 platform-api，legacy `/api` 和 `/ws` 仍指向 Portal legacy 后端，避免 feedback 被误切。

第 6-C 边界：

以下为该阶段完成时的历史边界说明。

- feedback 暂时仍走 legacy Portal 后端。
- knowledgeService 仍通过 runtime apps 获取 RAG 的 `backendUrl`，知识库 API 不发送到 platform-api。
- 四个业务模块 API 未迁入 `apps/api`。
- iframe 仍保留。
- legacy Portal 后端仍保留。
- JWT / session 机制未修改，继续复用 Portal session token 和 `Authorization: Bearer <token>`。

## 第 6-D 阶段：Portal feedback 迁入 apps/api

第 6-D 将 Portal feedback 能力迁入统一后端：

- `GET /api/v1/core/tickets/submission-context`
- `GET /api/v1/core/tickets/captcha`
- `POST /api/v1/core/tickets`
- `GET /api/v1/core/feature-requests/submission-context`
- `GET /api/v1/core/feature-requests/captcha`
- `POST /api/v1/core/feature-requests`

本阶段保持 legacy 行为：feedback 只提供提交上下文、验证码和邮件提交，不新增列表、状态更新或管理员查看接口。频控继续写入 `portal.feedback_submissions`，邮件发送继续使用 `PORTAL_SMTP_*`、`PORTAL_TICKET_EMAIL_TO` 和 `PORTAL_FEATURE_REQUEST_EMAIL_TO`。Portal 前端 feedback service 已切到 platform API client，并继续发送 `Authorization: Bearer <token>` 和 `X-Portal-Client-Id`。

第 6-D 边界：

- legacy Portal 后端仍保留。
- 四个业务模块 API 未迁入 `apps/api`。
- iframe 仍保留。
- JWT / session 机制未修改。

## 第 6-E 阶段：Portal legacy 后端依赖审计与瘦身

第 6-E 完成 Portal 前端对 legacy Portal 后端的核心 API 依赖审计。当前 Portal 前端核心平台能力默认走 `apps/api`：

- auth 使用 `/api/v1/core/auth/*`。
- users 使用 `/api/v1/core/users`。
- app-usage HTTP 使用 `/api/v1/core/app-usage/*`。
- runtime apps 使用 `/api/v1/core/runtime/apps`。
- feedback 使用 `/api/v1/core/tickets/*` 和 `/api/v1/core/feature-requests/*`。
- app-usage WebSocket 使用 `/ws/core/app-usage`。

Vite 开发代理中 `/api/v1/core` 和 `/ws/core` 指向 platform-api。legacy `/api` 和 `/ws` proxy 仍保留，但只作为过渡兼容和回滚 fallback，不再是当前 Portal 前端核心平台 API 的主路径。

`scripts/dev.py --no-business` 当前默认启动：

- Portal 前端。
- platform-api。

该模式不再默认启动 legacy Portal 后端，不启动四个业务模块。`python scripts/dev.py --only portal` 仍保留 legacy Portal 前后端启动链路，用于回滚和兼容排查；第 9-E 后，默认全量 `python scripts/dev.py` 也不再启动 legacy Portal 后端或四个 legacy 业务后端。

第 6-E 边界：

- 不删除 `legacy/portal-launchpad/backend`。
- 不删除 legacy Portal 后端旧 API。
- 不迁移合同审查、RAG、竞对分析、标书生成业务 API。
- 不去掉 iframe。
- 不修改 JWT，继续复用 Portal session token。
- 不修改数据库结构。

下一阶段可进入业务模块 API 迁入 `apps/api` 的调研和分步迁移，或继续对 legacy Portal 后端做进一步瘦身。

## 第 7-C 阶段：竞对分析 health/history 并行迁入 apps/api

第 7-C 在第 7-B `competitor-analysis` 代理基座上，将低风险 API 直接迁入 `apps/api`：

- `GET /api/v1/competitor-analysis/api/health`
- `GET /api/v1/competitor-analysis/api/history`
- `GET /api/v1/competitor-analysis/api/history/{id}`
- `POST /api/v1/competitor-analysis/api/history`
- `DELETE /api/v1/competitor-analysis/api/history`
- `DELETE /api/v1/competitor-analysis/api/history/{id}`

history direct routes 直接读写 `competitor_analysis.history_records`，保持 legacy 的 `items`、`item`、`ok`、`message` 响应结构，不包装为平台统一 `success/data` envelope。未登录、无应用权限和数据库异常仍由平台层返回统一错误 envelope。

`analysis`、`analysis/stream` 和 `workflows/*` 仍走 legacy proxy fallback；分析业务逻辑、Dify workflow、NDJSON stream 协议、竞对分析前端和 iframe 均未重写或切换。legacy `competitor-analysis` 后端仍保留：direct health/history 不依赖它，proxy fallback 仍依赖它。

RAG 已完成第 7-D 鉴权代理接入，并在第 7-E 直接实现 health/sessions/conversations/conversations sync。RAG chat stream 与 knowledge API 仍走 legacy proxy fallback；合同审查、标书生成业务 API 当前仍未迁入 `apps/api`。

## 第 7-E 阶段：RAG health/sessions/conversations 并行迁入 apps/api

第 7-E 在第 7-D `rag-web-search` 代理基座上，将低风险 API 直接迁入 `apps/api`：

- `GET /api/v1/rag/api/v1/health`
- `POST /api/v1/rag/api/v1/sessions`
- `GET /api/v1/rag/api/v1/conversations`
- `PUT /api/v1/rag/api/v1/conversations/sync`

direct routes 直接读写 `rag.conversations`，保持 legacy 的 `status`、`session_id`、`conversations`、`activeConversationId` 和 204 响应结构，不包装为平台统一 `success/data` envelope。未登录、无应用权限和数据库异常仍由平台层返回统一错误 envelope。

`chat/stream` 和 `knowledge/*` 仍由 RAG 代理 fallback 到 legacy RAG 后端；SSE 事件格式、Dify Dataset API、RAG 前端和 iframe 均未重写或切换。legacy `rag-web-search` 后端仍保留：direct health/sessions/conversations 不依赖它，proxy fallback 仍依赖它。

## 第 7-F 阶段：Portal knowledgeService 切到 RAG 统一代理

第 7-F 只切换 Portal 前端知识库 service。`legacy/portal-launchpad/src/services/knowledgeService.ts` 现在优先请求：

- `GET /api/v1/rag/api/v1/knowledge/documents`
- `POST /api/v1/rag/api/v1/knowledge/documents/create-by-text`
- `POST /api/v1/rag/api/v1/knowledge/documents/create-by-file`
- `GET /api/v1/rag/api/v1/knowledge/documents/{document_id}/detail`
- `GET /api/v1/rag/api/v1/knowledge/documents/{document_id}/download`
- `DELETE /api/v1/rag/api/v1/knowledge/documents/{document_id}`

这些请求继续携带 Portal session token 和 `X-Portal-Client-Id`，由 `apps/api` 做 `rag-web-search` 应用权限校验后代理到 legacy RAG 后端。RAG knowledge 业务逻辑、Dify Dataset API、Dify key / dataset id 均未迁移或修改。

RAG iframe 前端在第 7-J 已单独接入 auth bridge；本阶段只说明 Portal knowledgeService 的第 7-F 行为。Portal knowledgeService 保留 runtime apps 中 `rag-web-search` 的 `backendUrl` fallback：401 / 403 不 fallback，502 / 503 / network error 可 fallback，作为本阶段回滚路径。

## 第 7-G 阶段：合同审查代理接入 apps/api

第 7-G 在 `apps/api` 新增合同审查代理入口：

- `/api/v1/contract-review/**`

所有合同审查代理请求先由 `apps/api` 校验 Portal session token 和 `contract-review` 应用权限，再转发到 legacy 合同审查后端。合同审查业务逻辑仍由 legacy 后端执行，包括合同上传、审查 pipeline、运行状态、风险状态更新、AI 改写和 DOCX 下载。第 7-K 后合同审查 iframe 前端已优先调用该代理入口，legacy 合同审查后端继续保留。

当前已有业务代理入口：

- `/api/v1/competitor-analysis/**`
- `/api/v1/rag/**`
- `/api/v1/contract-review/**`
- `/api/v1/bid-generator/**`

标书生成已接入 `apps/api` 业务代理；第 7-L 后标书生成 iframe 前端已优先调用该代理入口，真实业务仍由 legacy 标书生成后端通过 proxy 执行。

## 第 7-I 阶段：iframe auth bridge 与竞对分析前端试点

第 7-I 新增 Portal 到业务 iframe 的安全鉴权桥接。业务 iframe 通过 `window.postMessage` 请求 auth context，Portal 父页面只在请求来源等于当前 iframe origin、`appCode` 与当前应用一致、用户已登录且拥有应用权限时返回上下文。Portal token 不进入 iframe URL，不写入日志，也不持久化到业务子应用本地存储。

本阶段 auth context 包含：

- Portal session token
- `X-Portal-Client-Id`
- 当前 `appCode`
- 业务模块在 `apps/api` 下的 proxy API base

竞对分析前端是唯一试点模块。它会优先请求 `/api/v1/competitor-analysis/**` 或对应 platform-api 完整 URL，并在请求中携带 `Authorization: Bearer <portal token>` 和 `X-Portal-Client-Id`。如果 bridge 不可用，继续回退到 legacy `VITE_API_BASE_URL`；如果 `apps/api` 返回 401 / 403，不回退，避免绕过平台权限；如果返回 502 或 network error，可回退一次 legacy backend 以保留开发回滚能力。

RAG、合同审查和标书生成 iframe 前端本阶段未切换，仍保持原有 API 链路。竞对分析业务逻辑、响应结构和 NDJSON 流式解析保持不变。

## 第 7-J 阶段：RAG iframe auth bridge 接入

第 7-J 将 RAG iframe 前端接入第 7-I 的 Portal auth bridge。RAG iframe 通过 `clover:auth-request` 请求鉴权上下文，Portal 父页面校验 iframe origin、`appCode=rag-web-search`、登录态和应用权限后，通过 `clover:auth-context` 返回 Portal token、`X-Portal-Client-Id` 和 RAG proxy API base。Portal token 只通过 `postMessage` 传递，不进入 iframe URL，也不写入 RAG 子应用长期存储。

RAG iframe 前端现在优先请求 `/api/v1/rag/api/v1/...` 或对应 platform-api 完整 URL，并携带 `Authorization: Bearer <portal token>` 与 `X-Portal-Client-Id`。bridge 不可用时保留 legacy `VITE_API_BASE_URL` fallback；401 / 403 不 fallback，502 / 503 / network error 可 fallback 到 legacy RAG backend 一次。

RAG chat stream 仍保持 legacy `text/event-stream` 事件格式和读取逻辑，knowledge `create-by-file` 仍使用 `FormData`，RAG chat stream 与 knowledge Dataset 业务逻辑仍由 legacy RAG 后端通过 proxy 执行。Portal knowledgeService 未修改，竞对分析试点不受影响，合同审查和标书生成 iframe 前端仍保持原链路。

## 第 7-K 阶段：合同审查 iframe auth bridge 接入

第 7-K 将合同审查 iframe 前端接入第 7-I 的 Portal auth bridge。合同审查 iframe 通过 `clover:auth-request` 请求鉴权上下文，Portal 父页面校验 iframe origin、`appCode=contract-review`、登录态和应用权限后，通过 `clover:auth-context` 返回 Portal token、`X-Portal-Client-Id` 和合同审查 proxy API base。Portal token 只通过 `postMessage` 传递，不进入 iframe URL，也不写入合同审查子应用长期存储。

合同审查 iframe 前端现在优先请求 `/api/v1/contract-review/api/...` 或对应 platform-api 完整 URL，并携带 `Authorization: Bearer <portal token>` 与 `X-Portal-Client-Id`。bridge 不可用时保留 legacy `VITE_API_BASE_URL` fallback；401 / 403 不 fallback，502 / 503 / network error 可 fallback 到 legacy 合同审查 backend 一次。

合同审查业务逻辑仍由 legacy 合同审查后端通过 proxy 执行，包括文件上传、审查 pipeline、AI 改写、接受、撤销和导出。文件上传仍使用 `FormData` 透传，DOCX 下载改为 authenticated fetch blob。竞对分析和 RAG iframe 前端不受影响。

## 第 7-L 阶段：标书生成 iframe auth bridge 接入

第 7-L 将标书生成 iframe 前端接入第 7-I 的 Portal auth bridge。标书生成 iframe 通过 `clover:auth-request` 请求鉴权上下文，Portal 父页面校验 iframe origin、`appCode=bid-generator`、登录态和应用权限后，通过 `clover:auth-context` 返回 Portal token、`X-Portal-Client-Id` 和标书生成 proxy API base。Portal token 只通过 `postMessage` 传递，不进入 iframe URL，也不写入标书生成子应用长期存储。

标书生成 iframe 前端优先请求 `/api/v1/bid-generator/api/**`。对走 `apps/api` 的请求添加 `Authorization` 和 `X-Portal-Client-Id`；bridge 不可用时保留 legacy backend fallback。401 / 403 不 fallback，502 / 503 / network error 可 fallback 一次，fallback 不携带 Portal token。

标书生成业务逻辑仍由 legacy `pipt-lite` 后端通过 proxy 执行，包括脱敏、还原、映射、实体注册、项目 CRUD、任务状态、SSE、DocumentForge、知识库同步和图片预览。文件上传仍使用 `FormData`，SSE 仍保持 legacy 流式读取，DOCX / PDF / Excel / 图片等文件响应仍保留 blob / `Content-Disposition` 语义。竞对分析、RAG 和合同审查 iframe 前端不受影响。

## 第 7-M 阶段：业务代理与 iframe auth bridge 收口

第 7-M 对第 7 阶段统一业务入口和四个 iframe 前端切换做总体验收。当前四个统一入口均已注册：

- `/api/v1/competitor-analysis/**`
- `/api/v1/rag/**`
- `/api/v1/contract-review/**`
- `/api/v1/bid-generator/**`

Portal -> iframe auth bridge 是通用实现，`appCode` 到 `apiBaseUrl` 的映射为：`competitor-analysis` -> `/api/v1/competitor-analysis`，`rag-web-search` -> `/api/v1/rag`，`contract-review` -> `/api/v1/contract-review`，`bid-generator` -> `/api/v1/bid-generator`。父页面校验 iframe origin、消息来源、`appCode` 和用户应用权限后才返回 token；token 不进入 iframe URL，不写 console，不写业务子应用长期 `localStorage`。

第 7-M 保持 legacy 后端作为真实业务执行方或 fallback：竞对分析 analysis/workflows/stream、RAG chat stream/knowledge、合同审查全部业务 API、标书生成全部业务 API 仍由各自 legacy 后端执行。fallback 只用于 bridge 不可用、502/503 或网络错误等回滚场景；401/403 不 fallback，非幂等 POST/PUT/PATCH/DELETE 不自动重复提交到 legacy。文件上传继续让浏览器生成 multipart boundary；受保护下载使用 authenticated fetch blob 或保留已说明的 legacy 预览路径。

第 8 阶段建议从业务模块 direct API 分批迁移评估开始，同时拆出文件存储、任务队列、去 iframe、生产部署和 observability/e2e 测试专项。

## 第 2 阶段：PostgreSQL 初始化

根级 Python 依赖只用于 `clover-platform` 基础设施脚本，不影响 legacy 项目自己的依赖文件。

首次本地运行推荐直接使用首跑脚本。脚本会创建 `.venv`、在缺少 `.env` 时从 `.env.example` 复制、安装当前自动启动模块的 Python / npm 依赖、初始化 PostgreSQL schema、执行 Alembic，并在最后跑 preflight：

```bash
cd clover-platform
python3 scripts/bootstrap_dev.py
```

脚本不会覆盖已有 `.env`。如果需要先跳过较重的安装或数据库初始化，可使用：

```bash
python3 scripts/bootstrap_dev.py --skip-frontend
python3 scripts/bootstrap_dev.py --skip-db
python3 scripts/bootstrap_dev.py --no-business
python3 scripts/bootstrap_dev.py --start
python3 scripts/bootstrap_dev.py --npm-install
```

脚本完成后，后续日常启动只需要：

```bash
source .venv/bin/activate
python scripts/dev.py
```

手动初始化步骤如下，主要用于排错或只处理某一段环境：

1. 安装根级 Python 依赖：

```bash
cd clover-platform
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
python -m pip install -r legacy/portal-launchpad/requirements.txt
python -m pip install -r legacy/contract_review/requirements.txt
```

2. 准备本地环境变量：

```bash
cp .env.example .env
```

`.env` 放在 `clover-platform` 根目录，不应提交到 Git。当前开发环境 PostgreSQL 示例配置：

```bash
POSTGRES_HOST=10.88.20.14
POSTGRES_PORT=5432
POSTGRES_DB=app_db
POSTGRES_USER=postgres
POSTGRES_PASSWORD=change-me
DATABASE_URL=postgresql+psycopg://postgres:change-me@10.88.20.14:5432/app_db
```

Python 代码优先从根目录 `.env` 或环境变量读取连接信息，不硬编码数据库连接串。标书生成 pipt-lite 单独运行时也可兼容读取 `legacy/bid-generator/pipt-flask/.env`。

3. 检查数据库连接：

```bash
python scripts/check_db.py
```

如果数据库尚未初始化，脚本会提示缺少 schema、core 表、Portal 表、业务模块表或索引。

4. 初始化数据库：

```bash
python scripts/init_db.py
```

`scripts/init_db.py` 用于开发阶段快速初始化、幂等检查和本地调试。该脚本会可重复地创建 `pgcrypto` 扩展、`core` / `portal` / `contract_review` / `bid_generator` / `rag` / `competitor_analysis` schema、core 基础表、Portal 专属表、已迁移业务表、常用索引和各业务 schema 的 `module_meta` 表。

5. 再次检查：

```bash
python scripts/check_db.py
```

6. 执行 Alembic：

```bash
alembic upgrade head
```

Alembic 用于正式数据库版本管理。开发阶段可以先执行 `python scripts/init_db.py`，再执行 `alembic upgrade head`；两者都应保持幂等，不应互相冲突。后续正式模块迁移和表结构演进，应优先通过 Alembic migration 管理。

7. 再次检查：

```bash
python scripts/check_db.py
```

Portal、竞对分析、RAG 问答、合同审查和标书生成 pipt-lite 的指定运行时数据访问层已经切换到 PostgreSQL。

## 第 3 阶段：Portal PostgreSQL

Portal 后端位于 `legacy/portal-launchpad`。本阶段只把 Portal 数据库访问层切换到 PostgreSQL，前端页面、iframe 集成、认证 token 形态和其他四个 legacy 项目不变。

启动前先确认根目录 `.env` 配置了 PostgreSQL 连接信息，并可选配置默认管理员：

```bash
PORTAL_ADMIN_USERNAME=admin
PORTAL_ADMIN_PASSWORD=admin123456
PORTAL_ADMIN_DISPLAY_NAME=系统管理员
```

开发默认密码只用于本地初始化，上线前必须修改。第一次启动 Portal 后端时，如果 `core.users` 中没有管理员，会按上述环境变量创建默认管理员；不迁移旧 SQLite 数据。

推荐启动步骤：

1. 初始化数据库：

```bash
cd clover-platform
source .venv/bin/activate
python scripts/check_db.py
python scripts/init_db.py
alembic upgrade head
python scripts/check_db.py
```

2. 前后端一起启动：

```bash
cd legacy/portal-launchpad
npm install
PORTAL_PYTHON_BIN=../../.venv/bin/python npm run dev
```

3. 或前后端分开启动：

```bash
cd clover-platform
source .venv/bin/activate
cd legacy/portal-launchpad
uvicorn backend.main:app --reload --host 0.0.0.0 --port 5210
```

另一个终端启动前端：

```bash
cd clover-platform/legacy/portal-launchpad
npm run dev:frontend
```

访问地址：

- 前端：`http://localhost:5200`
- 后端：`http://localhost:5210`
- 接口文档：`http://localhost:5210/docs`

默认开发管理员：`admin / admin123456`。如果管理员已经初始化过，后续修改 `.env` 中 `PORTAL_ADMIN_PASSWORD` 不会自动重置已有管理员密码。

Portal 当前使用 PostgreSQL 表：

- `core.users`
- `core.sessions`
- `core.user_app_permissions`
- `core.app_usage_sessions`
- `core.audit_logs`
- `portal.user_profiles`
- `portal.feedback_submissions`

应用权限继续使用 Portal 既有短横线 app id：`bid-generator`、`contract-review`、`competitor-analysis`、`rag-web-search`。没有权限记录时默认允许访问；有记录时以 `core.user_app_permissions.can_access` 为准。

反馈 / 工单 / 功能建议相关接口当前写入 `portal.feedback_submissions`。邮件发送仍按 Portal SMTP 环境变量配置执行。

第 3 阶段主要验证 monorepo 本地方式启动。`legacy/portal-launchpad` 下旧 Dockerfile / docker-compose 尚未更新为最终 monorepo PostgreSQL 部署形态，只能视为历史遗留或待改造文件。统一 Docker 部署会在后续 Docker 阶段处理。

## 第 4 阶段：统一开发启动器与动态端口

动态端口只用于开发环境。生产或准生产部署不建议使用动态端口，应按 Docker 部署规范使用固定容器端口和网络。

`scripts/dev.py` 是本地开发启动器，不是 Docker 生产部署入口；生产阶段不建议用它管理多个长期进程，Docker / Docker Compose 会在后续部署阶段单独设计。

端口规划和 legacy 模块启动配置集中在 `config/apps.yaml`。端口检测逻辑在 `packages/py_common/ports.py`，进程管理在 `packages/py_common/process_manager.py`，runtime 文件读写在 `packages/py_common/runtime.py`。

开发检查端口：

```bash
python scripts/check_ports.py
```

只生成 runtime 端口文件：

```bash
python scripts/dev.py --write-ports-only
```

`--write-ports-only` 默认生成当前主路径端口规划，也就是 `apps-web` 和 `platform-api`。如果传入 `--with-legacy-frontends`、`--with-legacy-backends`、`--legacy-portal`、`--only` 或 `--skip`，会按筛选后的范围生成对应回滚端口。

只启动统一前端 + platform-api，不启动 legacy 回滚服务：

```bash
python scripts/dev.py --no-business
```

默认命令会启动配置中 `dev.enabled: true` 的主路径服务。第 10-F 后，默认 `python scripts/dev.py` 会启动：

- apps/web
- platform-api

默认不启动 legacy Portal、四个 legacy 业务前端或四个 legacy 业务后端。五个前端能力通过 `apps/web` 原生页面进入；iframe 和 legacy 前端仅作为回滚 / 兼容路径保留。

需要 legacy Portal 回滚入口时使用：

```bash
python scripts/dev.py --legacy-portal
```

需要完整 legacy 前端回滚入口时使用：

```bash
python scripts/dev.py --with-legacy-frontends
```

该模式会额外启动 legacy Portal 和四个 legacy 业务前端，并在 `runtime/ports.json` 中写入 `portal.frontend_url` 以及四个业务模块的 `iframe_url`。

需要 legacy 业务前端和后端完整回滚 / 调试时使用：

```bash
python scripts/dev.py --with-legacy-frontends --with-legacy-backends
```

该模式会额外启动 legacy Portal、四个 legacy 业务前端和四个 legacy 业务后端，并在 `runtime/ports.json` 中写入对应 `iframe_url` 与 `backend_url`。单模块业务前端回滚可使用 `python scripts/dev.py --only <app-code> --with-legacy-frontends`，需要 legacy 后端时再追加 `--with-legacy-backends`。

第 4.1 阶段的业务模块开发自动启动接入已完成。标书生成的 `gateway-out` 是被 `pipt-flask` 导入调用的 Python 库/CLI，不是常驻 HTTP 服务，本阶段不单独自动启动。

合同审查在 `config/apps.yaml` 中使用 `dev.kind: frontend_backend`。legacy 前端端口优先使用 `18120`，可在 `18120-18124` 内自动切换；legacy 后端端口优先使用 `18125`，可在 `18125-18129` 内自动切换。默认 `runtime/ports.json` 不写 `contract-review.iframe_url` 或 legacy `backend_url`；`--with-legacy-frontends` 才写入 `contract-review.iframe_url`，`--with-legacy-backends` 才写入 `contract-review.backend_url`。

标书生成在 `config/apps.yaml` 中使用 `dev.kind: frontend_backend`。legacy 前端端口优先使用 `18110`，可在 `18110-18114` 内自动切换；legacy 后端端口优先使用 `18115`，可在 `18115-18119` 内自动切换。默认 `runtime/ports.json` 不写 `bid-generator.iframe_url` 或 legacy `backend_url`；`--with-legacy-frontends` 才写入 `bid-generator.iframe_url`，`--with-legacy-backends` 才写入 `bid-generator.backend_url`。

RAG 问答在 `config/apps.yaml` 中使用 `dev.kind: frontend_backend`。legacy 前端端口优先使用 `18140`，可在 `18140-18144` 内自动切换；legacy 后端端口优先使用 `18145`，可在 `18145-18149` 内自动切换。默认 `runtime/ports.json` 不写 `rag-web-search.iframe_url` 或 legacy `backend_url`；`--with-legacy-frontends` 才写入 `rag-web-search.iframe_url`，`--with-legacy-backends` 才写入 `rag-web-search.backend_url`。

竞对分析在 `config/apps.yaml` 中使用 `dev.kind: frontend_backend`。legacy 前端端口优先使用 `18130`，可在 `18130-18134` 内自动切换；legacy 后端端口优先使用 `18135`，可在 `18135-18139` 内自动切换。默认 `runtime/ports.json` 不写 `competitor-analysis.iframe_url` 或 legacy `backend_url`；`--with-legacy-frontends` 才写入 `competitor-analysis.iframe_url`，`--with-legacy-backends` 才写入 `competitor-analysis.backend_url`。

统一启动器默认使用当前 Python 解释器启动后端。合同审查可通过 `CONTRACT_REVIEW_PYTHON_BIN` 指定解释器，RAG 问答可通过 `RAG_QA_PYTHON_BIN` 指定解释器；如果未设置且对应后端目录或 legacy 目录下存在 `.venv/bin/python`，会优先使用本地解释器，否则回退到当前 Python。

`runtime/ports.json` 由启动器生成，不提交 Git。默认全量启动时它只记录 `apps-web.frontend_url`、`platform-api.backend_url` 和 `platform-api.health_url`。`--with-legacy-frontends` 下才写入 legacy Portal `frontend_url` 和 legacy 业务前端 `iframe_url`，`--with-legacy-backends` 下才写入对应 legacy `backend_url`，供 catch-all proxy 回滚使用。runtime apps 接口只返回前端需要的 `code`、`name`、`iframeUrl`、`enabled` 等字段，不返回 dev command、env 或任何密钥。

`runtime/ports.json` 仅用于本地开发动态端口发现，部署环境不依赖该文件，也不应提交到 Git。

`apps/web` 会请求 `/api/v1/core/runtime/apps` 获取回滚配置，但五个主业务入口当前均为原生页面。`scripts/dev.py --no-business` 会启动 `apps/web` + platform-api，并向 `apps/web` 注入 `VITE_API_BASE_URL` 和 `VITE_WS_BASE_URL`；如果跳过 platform-api，登录、用户管理、feedback、app usage、runtime apps 和业务页面可能不可用。第 10-F 后，platform-api 在统一启动器中默认不启用 `uvicorn --reload`，避免 legacy 标书生成 `gateway-out` 扩展 Python 搜索路径后 reload 子进程误解析同名 `main.py`；需要调试后端热重载时应在单独终端确认 Python 搜索路径后启动。

当前 `apps/web` 已完成五个前端能力收口，但仍未删除 iframe 或 legacy 前端。legacy 源码目录暂时保留，尤其是合同审查和标书生成仍被 `apps/api` 作为库导入的部分。

### 第 4.2 阶段：统一开发环境依赖与启动前检查

第 4.2 阶段新增统一 preflight 检查能力，用于在开发启动前确认本机依赖、关键配置、数据库、端口规划和 legacy 模块入口是否就绪。preflight 只做检查与提示，不会自动安装依赖，不会启动服务，也不会打印数据库密码、Dify key、token、secret 等敏感值。

第 4.2-A 收尾后，`portal.user_profiles` 和 `portal.feedback_submissions` 已纳入统一数据库初始化与 Alembic。新环境中 Portal 表缺失时，应通过 `python scripts/init_db.py` 和 `alembic upgrade head` 修复，不再依赖 Portal 后端首次启动自动建表；Portal 后端保留的建表逻辑只是兼容性兜底。

新环境推荐使用首跑脚本：

```bash
python3 scripts/bootstrap_dev.py
```

它会依次处理 `.env`、`.venv`、Python 依赖、前端依赖、数据库初始化、Alembic 和最终 preflight。常用参数：

```bash
python3 scripts/bootstrap_dev.py --skip-python
python3 scripts/bootstrap_dev.py --skip-frontend
python3 scripts/bootstrap_dev.py --skip-db
python3 scripts/bootstrap_dev.py --skip-preflight
python3 scripts/bootstrap_dev.py --only bid-generator
python3 scripts/bootstrap_dev.py --no-business
python3 scripts/bootstrap_dev.py --start
python3 scripts/bootstrap_dev.py --npm-install
```

如果需要手动排查，等价初始化顺序为：

```bash
python scripts/check_db.py
python scripts/init_db.py
alembic upgrade head
python scripts/check_db.py
python scripts/preflight.py
```

常用命令：

```bash
python scripts/preflight.py
python scripts/preflight.py --no-business
python scripts/preflight.py --only bid-generator
python scripts/preflight.py --with-legacy-frontends
python scripts/preflight.py --with-legacy-backends
python scripts/preflight.py --json
```

默认 preflight 检查 `apps/web`、platform-api、数据库、端口和本地文件系统 warning，不会因为 legacy 前端或 legacy 后端依赖缺失而失败。需要验证 legacy Portal 和业务 frontend 回滚链路时使用 `--with-legacy-frontends`，需要验证 legacy backend 回滚链路时使用 `--with-legacy-backends`。Dify / workflow / Dataset key 继续按 warning 或业务运行时错误处理，不作为默认启动阻塞。

`scripts/dev.py` 默认会先执行 preflight；如果检查出现 error，会阻止启动并打印修复建议。warning 只提示，不阻止启动。如需临时跳过：

```bash
python scripts/dev.py --skip-preflight
```

`python scripts/dev.py --write-ports-only` 仍只负责生成端口规划和 `runtime/ports.json`，不会强制完整 preflight；端口范围不可用时仍会报错。

如果 `preflight` 提示缺少 root infrastructure dependency，先安装根级开发工具链依赖：

```bash
python -m pip install -r requirements-dev.txt
```

缺少前端 `node_modules` 时，按对应模块安装：

```bash
cd legacy/portal-launchpad && npm install
cd legacy/contract_review/frontend && npm install
cd legacy/chat_with_rag_and_websearch/frontend && npm install
cd legacy/company-competitors-analysis && npm install
cd legacy/bid-generator/frontend-web && npm ci
```

如果标书生成前端无法使用 `npm ci`，可改用 `npm install`。RAG 问答当前 `package.json` 位于 `legacy/chat_with_rag_and_websearch/frontend` 子目录，因此安装命令需要进入该子目录。

Python 依赖安装方式：

```bash
python -m pip install -r requirements-dev.txt
python -m pip install -r legacy/portal-launchpad/requirements.txt
python -m pip install -r legacy/contract_review/requirements.txt
python -m pip install -r legacy/chat_with_rag_and_websearch/backend/requirements.txt
python -m pip install -r legacy/company-competitors-analysis/backend/requirements.txt
```

其他 legacy 后端按各自 `requirements.txt`、`requirements-lite.txt` 或 `pyproject.toml` 安装。Dify / workflow / API key 相关配置只检查存在性或给 warning，实际密钥继续放在 `.env`、本地配置或部署平台密钥中，不提交 Git。Docker 正式部署不是第 4.2 阶段内容，生产环境不依赖动态端口或 preflight。

`scripts/dev.py` 当前支持：

```bash
python scripts/dev.py
python scripts/dev.py --no-business
python scripts/dev.py --with-legacy-frontends
python scripts/dev.py --with-legacy-backends
python scripts/dev.py --with-legacy-frontends --with-legacy-backends
python scripts/dev.py --legacy-portal
python scripts/dev.py --write-ports-only
python scripts/dev.py --skip-preflight
python scripts/dev.py --only contract-review
python scripts/dev.py --only rag-web-search
python scripts/dev.py --only rag_qa
python scripts/dev.py --only competitor-analysis
python scripts/dev.py --only competitor_analysis
python scripts/dev.py --only bid-generator
python scripts/dev.py --only bid_generator
python scripts/dev.py --only portal
python scripts/dev.py --only platform-api
python scripts/dev.py --skip bid-generator
```

`python scripts/dev.py --no-business` 启动 `apps/web` + platform-api，不启动 legacy 回滚服务。`python scripts/dev.py --legacy-portal` 会额外启动 legacy Portal 前后端，用于回滚和兼容排查。`python scripts/dev.py --with-legacy-frontends` 会额外启动 legacy Portal 和四个 legacy 业务前端。`python scripts/dev.py --only platform-api` 只启动统一后端。`python scripts/dev.py --only contract-review --with-legacy-frontends`、`python scripts/dev.py --only rag-web-search --with-legacy-frontends`、`python scripts/dev.py --only competitor-analysis --with-legacy-frontends` 和 `python scripts/dev.py --only bid-generator --with-legacy-frontends` 会启动 platform-api 和对应 legacy 业务前端；如需单模块 legacy backend 回滚，追加 `--with-legacy-backends`。动态端口只用于开发环境；Docker 正式部署会在后续部署阶段单独处理。

## 第 5-A 阶段：竞对分析 PostgreSQL 持久化

第 5-A 阶段只迁移竞对分析 `competitor-analysis` 的运行时历史记录和企业校验缓存。竞对分析后端现在使用 PostgreSQL 18，数据写入 `competitor_analysis` schema，不再向旧 SQLite 历史库写入。旧 SQLite 历史数据不迁移、不删除。

新增表：

- `competitor_analysis.history_records`
- `competitor_analysis.storage_meta`
- `competitor_analysis.company_profiles`
- `competitor_analysis.company_validation_queries`

新环境初始化：

```bash
python scripts/init_db.py
alembic upgrade head
python scripts/check_db.py
python scripts/preflight.py --only competitor-analysis
```

运行方式不变：

```bash
python scripts/dev.py --only competitor-analysis
python scripts/dev.py
```

Portal iframe 集成不变。合同审查数据库在第 5-C 阶段迁移，标书生成 pipt-lite 数据库在第 5-D 阶段迁移。

## 第 5-B 阶段：RAG 问答 PostgreSQL 持久化

第 5-B 阶段只迁移 RAG 问答 `rag-web-search` 的本地运行时持久化。RAG 后端现在使用 PostgreSQL 18 的 `rag` schema 保存前端对话列表和每轮问答 turn 记录，不再在运行时创建 `conversations.sqlite`，也不再把问答 turn 写入 `DATA_DIR/users/.../*.json`。

新增表：

- `rag.conversations`
- `rag.chat_turns`

旧 SQLite / JSON 历史数据不迁移、不删除。Dify 知识库数据仍由 Dify Dataset API 管理，本阶段不迁移；本地向量索引和文件缓存如存在也保持原状。

新环境初始化：

```bash
python scripts/init_db.py
alembic upgrade head
python scripts/check_db.py
python scripts/preflight.py --only rag-web-search
```

运行方式不变：

```bash
python scripts/dev.py --only rag-web-search
python scripts/dev.py
```

Portal iframe 集成不变。合同审查数据库在第 5-C 阶段迁移，标书生成 pipt-lite 数据库在第 5-D 阶段迁移。

## 第 5-C 阶段：合同审查 PostgreSQL 持久化

第 5-C 阶段只迁移合同审查 `contract-review` 的运行元数据和结构化 artifact 索引。合同审查后端现在使用 PostgreSQL 18 的 `contract_review` schema，不再使用本地嵌入式数据库作为主存储。

新增表：

- `contract_review.review_runs`
- `contract_review.review_json_artifacts`
- `contract_review.review_text_artifacts`
- `contract_review.review_file_assets`

旧 SQLite / JSON 历史数据不迁移、不删除。`contract_review.review_runs` 是运行元数据主表；JSON / 文本 artifact 默认同步到 PostgreSQL，`data/runs` 仍是 DOCX、JSON、日志等运行产物的文件系统主存储。上传文件、DOCX 导出文件和日志仍保留在文件系统，本阶段不接 MinIO。

新环境初始化：

```bash
python scripts/init_db.py
alembic upgrade head
python scripts/check_db.py
python scripts/preflight.py --only contract-review
```

运行方式不变：

```bash
python scripts/dev.py --only contract-review
python scripts/dev.py
```

Portal iframe 集成不变。标书生成 pipt-lite 数据库在第 5-D 阶段迁移。

## 第 5-D 阶段：标书生成 pipt-lite PostgreSQL 持久化

第 5-D 阶段只迁移标书生成 `bid-generator` 的 `pipt-lite` SQLite ORM 数据。`pipt-flask/app/api_lite/database.py` 现在使用 PostgreSQL 18 的 `bid_generator` schema，不再创建本地映射数据库，也不再依赖本地数据库路径配置。

新增表：

- `bid_generator.mapping_records`
- `bid_generator.entity_registry`
- `bid_generator.image_registry`
- `bid_generator.projects`

旧映射库历史数据不迁移、不删除。PDF / DOCX / 图片 / raw_doc / kb_sync_status 等文件缓存仍保留在文件系统；Dify workflow、gateway-out 和 prompt-forge 不属于本阶段数据库迁移对象。`PIPT_DB_KEY` 仍用于加密 `bid_generator.entity_registry.original_text_enc`，`PIPT_ENV=production` 时必须配置。

新环境初始化：

```bash
python scripts/init_db.py
alembic upgrade head
python scripts/check_db.py
python scripts/preflight.py --only bid-generator
```

运行方式不变：

```bash
python scripts/dev.py --only bid-generator
python scripts/dev.py
```

Portal iframe 集成不变。

## 第 8-B 阶段：本地文件系统与任务状态边界

第 8-B 阶段只规范边界，不迁移文件目录、不引入统一文件存储、不接 MinIO、不引入 Celery / RQ / Dramatiq、不新增统一任务表。详细边界见 `docs/stage-8-b-local-files-and-task-boundary.md`。

当前本地文件和任务状态边界：

| 模块 | 文件系统边界 | 任务状态边界 |
| --- | --- | --- |
| 合同审查 | `legacy/contract_review/data/uploads/` 和 `data/runs/` 是上传、审查产物、DOCX 导出和日志主存储，部署时需要持久化挂载 | 继续使用 `run_id`、`contract_review.review_runs`、后台 pipeline 和 `risk_result_reviewed.json` |
| 标书生成 | `legacy/bid-generator/data/pdf_cache/`、`docx_cache/`、`raw_doc_cache/`、`extracted_images/`、`projects/`、`kb_sync_status/` 是运行缓存或项目产物；`data/templates/`、`data/knowledge_base/` 是配置和业务资料，不按临时缓存清理 | 继续使用 legacy `TaskManager`、`task_id`、SSE progress、status 轮询和 cancel 协议 |
| RAG 问答 | 知识库文件由 Dify Dataset 管理，会话和 turn 写入 PostgreSQL；本地 `data/` 只保留 legacy 占位或旧缓存 | 继续使用 legacy chat stream 和上游 Dify SSE；sessions / conversations 已部分 direct 到 `apps/api` |
| 竞对分析 | 历史记录、企业画像和企业校验缓存写入 PostgreSQL；未发现当前后端报告文件缓存 | 继续使用 legacy NDJSON stream 和 workflow 编排状态，不新增后台任务表 |

## 第 8-C 阶段：错误诊断与本地文件系统版部署准备

第 8-C 阶段只完善诊断和部署准备，不迁移业务逻辑、不改数据库结构、不去 iframe、不接 MinIO、不引入 Celery / RQ。当前仍以 `apps/api` 鉴权代理、四个 legacy 后端和本地文件系统持久化目录为主，重点明确 401 / 403、502 / 503、Dify upstream、PostgreSQL、`runtime/ports.json`、CORS、文件下载和 SSE / NDJSON 中断的排查边界。

详细诊断、request_id / `X-Request-ID` 传递、`business_proxy` 日志边界、本地文件系统版部署和健康检查路径见 `docs/stage-8-c-diagnostics-and-local-fs-deployment.md`。

## 第 8-D 阶段：低风险 direct API 批次 1

第 8-D 阶段只迁移低风险、只读、无副作用且不依赖 legacy 进程内任务状态、不访问 Dify、不读写业务文件的 API。详细审计和验证清单见 `docs/stage-8-d-low-risk-direct-api-batch-1.md`。

本阶段新增 direct：

- 标书生成：`GET /api/v1/bid-generator/health`、`GET /api/v1/bid-generator/api/config/workflow-status`、`GET /api/v1/bid-generator/api/config/analysis-framework`、`GET /api/v1/bid-generator/api/entities`。
- 合同审查：`GET /api/v1/contract-review/api/health`、`GET /api/v1/contract-review/api/config`。

本阶段暂缓 direct：

- `GET /api/v1/contract-review/api/diagnostics/converters` 继续 proxy，因为它应反映 legacy 合同审查后端的真实 Python / LibreOffice / PDF 转换环境。
- RAG `chat/stream`、RAG `knowledge/**`、合同审查 `reviews/**`、标书生成 Dify workflow / SSE task / forge / export / 文件预览下载、bid-generator `knowledge/**` 和 `kb/**` 继续 proxy。

## 第 8-E 阶段：低风险查询类 direct API 批次 2

第 8-E 阶段继续只迁移低风险、查询类、只读、无副作用且不依赖 legacy 进程内任务状态、不访问 Dify、不读写业务文件的 API。详细审计、暂缓原因和第 8 阶段收口准备见 `docs/stage-8-e-low-risk-query-direct-batch-2.md`。

本阶段新增 direct：

- 标书生成：`GET /api/v1/bid-generator/api/projects`、`GET /api/v1/bid-generator/api/projects/{project_id}`、`GET /api/v1/bid-generator/api/projects/{project_id}/mappings`。

本阶段暂缓 direct：

- 合同审查：`GET /api/v1/contract-review/api/reviews/history` 和 `GET /api/v1/contract-review/api/reviews/{run_id}` 继续 proxy，因为 legacy 实现会读取 `data/runs` 产物并推断 / 修复运行状态。
- RAG chat stream、RAG knowledge Dataset、竞对分析 analysis / workflows / stream、标书生成 Dify workflow / SSE task / forge / export / 文件预览下载继续 proxy。

## 第 8-F 阶段：第 8 阶段收口

第 8-F 阶段不迁移新 API，不接 MinIO，不引入 Celery / RQ，不规划任务队列预留口，不规划对象存储预留口，不改业务前端、legacy 后端、业务 router 行为、`business_proxy` 行为或数据库结构。详细收口结论、direct/proxy 清单、复杂链路暂缓原因、部署边界、安全边界和验收清单见 `docs/stage-8-f-stage-8-rollup.md`。

当前第 8 阶段可以按 direct/proxy 混合状态收口：

- 已 direct 的低风险接口继续由 `apps/api` 执行，并保持 legacy-compatible 成功响应。
- 未 direct 的复杂链路继续 proxy 到 legacy backend，尤其是 RAG chat stream / knowledge Dataset、合同审查 reviews / document / download / AI 改写、标书生成 Dify workflow / SSE task / forge / export / 文件预览下载；竞对分析 analysis / workflows / stream 已在第 9-A direct。
- 继续保留 iframe、本地文件系统和各业务模块原有任务状态机制。
- 第 9 阶段将在第 8 阶段收口后单独规划，本阶段不展开第 9 阶段详细路线。

## 第 9-A 阶段：竞对分析模块完整迁移

第 9-A 阶段开始按模块迁移业务实现，已将竞对分析模块主要业务 API 迁入 `apps/api` direct 实现，覆盖 health/history、analysis、analysis/stream 和 workflows。成功响应保持 legacy-compatible，stream 保持 `application/x-ndjson` 逐行事件，前端请求路径不变。legacy 竞对分析后端暂时保留作为回滚参考，catch-all proxy 仅用于未知路径或临时回滚兜底。本阶段不接 MinIO，不引入 Celery / RQ，不新增统一任务表，不修改数据库结构，不影响 RAG、contract-review、bid-generator。详细边界见 `docs/stage-9-a-competitor-analysis-full-migration.md`。

## 第 9-B 阶段：RAG 问答模块完整迁移

第 9-B 阶段继续按模块迁移业务实现，已将 RAG 问答模块主要业务 API 迁入 `apps/api` direct 实现，覆盖 health、sessions、conversations、chat/stream 和 knowledge Dataset。成功响应保持 legacy-compatible，chat stream 保持 `text/event-stream` SSE 事件，knowledge 上传仍使用本地临时文件后转发 Dify Dataset，前端请求路径不变。legacy RAG 后端暂时保留作为回滚参考，catch-all proxy 仅用于未知路径或临时回滚兜底。本阶段不接 MinIO，不引入 Celery / RQ，不新增统一任务表，不修改数据库结构，不影响 competitor-analysis、contract-review、bid-generator。详细边界见 `docs/stage-9-b-rag-full-migration.md`。

## 第 9-C 阶段：合同审查模块完整迁移

第 9-C 阶段继续按模块迁移业务实现，已将合同审查模块主要业务 API 迁入 `apps/api` direct 实现，覆盖 health/config/diagnostics、文件上传、review run 创建、history/status/result、DOCX document/download、风险状态修改和 AI 改写。成功响应保持 legacy-compatible，审查任务继续使用现有 `run_id` / run 状态机制，文件产物继续使用 `legacy/contract_review/data/uploads` 与 `legacy/contract_review/data/runs`，前端请求路径不变。legacy 合同审查后端暂时保留作为回滚参考，catch-all proxy 仅用于未知路径或临时回滚兜底。本阶段不接 MinIO，不引入 Celery / RQ，不新增统一任务表，不修改数据库结构，不影响 competitor-analysis、rag-web-search、bid-generator。详细边界见 `docs/stage-9-c-contract-review-full-migration.md`。

## 第 9-D 阶段：标书生成模块完整迁移

第 9-D 阶段继续按模块迁移业务实现，已将标书生成模块后端业务 API 迁入 `apps/api` direct 实现，覆盖 health/config、脱敏/还原、项目 CRUD、需求提取、Dify workflow、TaskManager/SSE、项目文件、图片/PDF/DOCX 预览下载、附件切片、评分表、蓝图、DocumentForge、knowledge/kb 和解析报告。成功响应保持 legacy-compatible，任务状态继续使用现有 `task_id` / `TaskManager` / progress / SSE / cancel 机制，文件产物继续使用 `legacy/bid-generator/data/*`，前端请求路径不变。legacy 标书生成后端暂时保留作为回滚参考，catch-all proxy 仅用于未知路径或临时回滚兜底。本阶段不接 MinIO，不引入 Celery / RQ，不新增统一任务表，不修改数据库结构，不影响 competitor-analysis、rag-web-search、contract-review。详细边界见 `docs/stage-9-d-bid-generator-full-migration.md`。

## 第 9-E 阶段：四模块迁移收口与 legacy 默认启动策略调整

第 9-E 阶段完成四个业务模块后端迁移收口。`apps/api` 是当前主业务后端，竞对分析、RAG、合同审查和标书生成的常规业务 API 优先由 `apps/api` direct 承载；四个 legacy 业务后端进程默认不再启动，仅通过 `python scripts/dev.py --with-legacy-backends` 作为回滚 / 调试路径启动。legacy 源码目录仍保留，合同审查继续复用 `legacy/contract_review/src`，标书生成继续复用 `legacy/bid-generator/pipt-flask/app/api_lite`、`gateway-out`、`dify-bridge` 等代码。catch-all proxy 继续保留，用于未知路径和回滚兜底；默认无 `backend_url` 时未知路径返回清晰 502。本阶段不删除 legacy，不去 iframe，不接 MinIO，不接 Celery / RQ，不改数据库结构，不新增 Alembic migration，不做前端整合。详细边界见 `docs/stage-9-e-post-migration-startup-rollup.md`。

## 第 10-F 阶段：统一前端收口与 legacy 前端冻结评估

第 10-F 阶段完成统一前端收口。`apps/web` 是默认前端主入口，Portal、竞对分析、RAG、合同审查和标书生成均已由 `apps/web` 原生页面承载；默认 `python scripts/dev.py` 启动 `apps/web` 和 `apps/api`，默认不启动 `legacy/portal-launchpad` 或四个 legacy 业务前端。legacy Portal 可通过 `--legacy-portal` 单独回滚，legacy Portal 加四个 legacy 业务前端可通过 `--with-legacy-frontends` 完整回滚，legacy 业务后端仍通过 `--with-legacy-backends` 回滚。iframe 代码和 `config/apps.yaml` 的 `iframeUrl` 配置暂时保留为兼容路径。本阶段不删除 legacy，不删除 iframe，不修改 `apps/api` 业务 API，不改数据库结构，不新增 Alembic migration，不接 MinIO，不接 Celery / RQ。详细边界见 `docs/stage-10-f-frontend-rollup-and-legacy-freeze.md`。
