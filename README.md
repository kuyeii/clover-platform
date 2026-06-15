# Clover Platform

四叶草平台是一个业务应用整合仓库，统一承载 Portal、竞对分析、RAG 问答、合同审查、标书生成和专利交底生成能力。当前主入口是 `apps/web`，统一后端是 `apps/api`；`legacy/` 中保留原始项目作为回滚、对照和部分兼容适配来源。

当前主线状态以 `docs/stage-10-f-frontend-rollup-and-legacy-freeze.md` 和后续 stage 文档为准。README 只作为开发、部署和仓库规范入口，不再记录完整阶段流水账。

## 当前架构

| 层级 | 路径 | 职责 |
| --- | --- | --- |
| 统一前端 | `apps/web` | React + Vite 主应用，承载 Portal 和各业务模块真实页面 |
| 统一后端 | `apps/api` | FastAPI 主后端，承载平台核心 API、业务 direct API、兼容代理和专利交底模块 |
| 业务模块说明 | `modules/` | 各模块边界、契约和迁移说明 |
| 共享包 | `packages/` | Python 公共能力、API client、共享类型、UI 包和专利交底 skill |
| 配置 | `config/` | 应用、端口、工作流和本地配置样例 |
| 部署 | `docker/` | Web/API 镜像、Nginx 和 Compose 配置 |
| 历史项目 | `legacy/` | 原项目快照，默认不作为主入口启动 |
| 阶段文档 | `docs/` | 迁移阶段、部署边界、诊断和规范文档 |
| 本地运行产物 | `runtime/`, `data/`, `outputs/` | 运行时端口、业务数据和导出文件，默认不提交 |

## 功能范围

当前 `apps/web` 默认承载以下页面和工作流：

- Portal 登录、会话恢复、工作台、用户管理、应用权限、应用占用、feedback。
- 竞对分析、RAG 问答、合同审查和标书生成的统一前端页面。
- 标书生成项目、文件解析、任务流、大纲/正文生成、脱敏还原、预览和导出。
- 专利交底生成模块的案件、素材、生成任务和交付物管理。

当前边界：

- 默认开发启动只启动 `apps/web` 和 `apps/api`。
- legacy Portal、legacy 业务前端和 legacy 业务后端默认不启动，仅作为回滚和排查入口。
- iframe 配置和 legacy 代码暂保留，不在本阶段删除。
- 运行时文件、导出文件、缓存、数据库文件和密钥文件不得提交。

## 快速开始

推荐使用根目录脚本完成本地初始化。首次运行前需要本机具备 Python、Node.js/npm，并能访问 PostgreSQL。

```bash
python3 scripts/bootstrap_dev.py --npm-install
python scripts/dev.py
```

`bootstrap_dev.py` 会创建本地 Python 环境、复制 `.env`、安装依赖、初始化数据库、执行 Alembic，并运行 preflight。之后日常开发使用：

```bash
python scripts/dev.py
```

常用启动模式：

```bash
# 只写 runtime/ports.json，不启动服务
python scripts/dev.py --write-ports-only

# 只启动统一后端
python scripts/dev.py --only platform-api

# 只启动统一前端和统一后端
python scripts/dev.py --no-business

# 需要回滚排查时追加 legacy 前端或后端
python scripts/dev.py --with-legacy-frontends
python scripts/dev.py --with-legacy-backends
```

`runtime/ports.json` 由启动器生成，只用于本地端口发现，不提交 Git。

## 本地配置

根目录 `.env` 从 `.env.example` 复制生成，不提交 Git。开发和部署时重点确认：

| 变量 | 说明 |
| --- | --- |
| `DATABASE_URL` / `POSTGRES_*` | PostgreSQL 连接配置 |
| `PORTAL_ADMIN_USERNAME` / `PORTAL_ADMIN_PASSWORD` | 首次初始化管理员账号 |
| `PIPT_DB_KEY` | 标书生成生产模式脱敏/还原加密 key，`PIPT_ENV=prod` 时必填 |
| `ENABLE_DIAGRAM_GENERATION` | 标书生成图表生成功能开关 |
| `PATENT_DISCLOSURE_*` | 专利交底模块数据目录、LLM、CNIPA 和工具超时配置 |

生成 `PIPT_DB_KEY`：

```bash
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

数据库初始化和检查命令：

```bash
python scripts/init_db.py
alembic upgrade head
python scripts/check_db.py
python scripts/preflight.py
```

## 前端开发

统一前端位于 `apps/web`：

```bash
npm --prefix apps/web install
npm --prefix apps/web run dev
npm --prefix apps/web run build
npm --prefix apps/web run test:api-paths
```

前端默认通过启动器注入 `VITE_API_BASE_URL` 和 `VITE_WS_BASE_URL`。单独启动前端时，可显式指定统一后端地址：

```bash
VITE_API_BASE_URL=http://127.0.0.1:5220/api/v1 npm --prefix apps/web run dev
```

UI 修改要求：

- 优先复用现有页面结构、组件和视觉 token。
- 新增样式需符合现有 Figma/设计系统原则，避免引入新的布局、响应式或可访问性问题。
- 修改后应至少完成桌面和窄屏视口检查，确保文本不溢出、控件不重叠、状态清晰。

## 后端开发

统一后端位于 `apps/api`，入口为 `apps/api/main.py`。主要能力分布：

- `apps/api/app/api/`：HTTP/WebSocket 路由。
- `apps/api/app/services/`：平台和业务服务。
- `apps/api/tests/`：后端单元与契约测试。
- `alembic/`：数据库迁移。

常用检查：

```bash
python -m pytest apps/api/tests
python scripts/check_ports.py
python scripts/preflight.py
```

业务迁移原则：

- 新 API 优先放在 `apps/api`，保持鉴权、权限和错误响应一致。
- legacy 适配只能作为兼容层或回滚路径，不应让新页面新增对 legacy 后端的直接依赖。
- 文件上传、SSE、下载、脱敏还原等兼容协议改动需要补充对应测试。

## Docker 部署

### 内置 PostgreSQL

```bash
cp .env.example .env
# 修改 POSTGRES_PASSWORD、PORTAL_ADMIN_PASSWORD、PIPT_DB_KEY 等生产配置

docker compose -f docker/docker-compose.yml build
docker compose -f docker/docker-compose.yml run --rm api python scripts/init_db.py
docker compose -f docker/docker-compose.yml run --rm api alembic upgrade head
docker compose -f docker/docker-compose.yml run --rm api python scripts/check_db.py
docker compose -f docker/docker-compose.yml up -d
```

默认访问地址：`http://<服务器IP>:5200`。

健康检查：

```bash
curl http://127.0.0.1:5200/api/v1/core/health
curl http://127.0.0.1:5200/api/v1/core/health/db
```

### 外部 PostgreSQL

```bash
cp .env.external-postgres.example .env.external-postgres
# 修改 EXTERNAL_POSTGRES_HOST、数据库账号、PORTAL_ADMIN_PASSWORD、PIPT_DB_KEY 等配置

docker compose --env-file .env.external-postgres -f docker/docker-compose.external-postgres.yml build
docker compose --env-file .env.external-postgres -f docker/docker-compose.external-postgres.yml run --rm api python scripts/init_db.py
docker compose --env-file .env.external-postgres -f docker/docker-compose.external-postgres.yml run --rm api alembic upgrade head
docker compose --env-file .env.external-postgres -f docker/docker-compose.external-postgres.yml run --rm api python scripts/check_db.py
docker compose --env-file .env.external-postgres -f docker/docker-compose.external-postgres.yml up -d
```

外部 PostgreSQL 的备份、恢复和生命周期由数据库服务器负责。生产环境不要使用 `docker compose down -v` 清理 volume，除非已经完成数据库和业务文件备份。

## 参考文档

- 当前前端收口：`docs/stage-10-f-frontend-rollup-and-legacy-freeze.md`
- 迁移后启动基线：`docs/stage-9-e-post-migration-startup-rollup.md`
- 本地文件和任务边界：`docs/stage-8-b-local-files-and-task-boundary.md`
- 诊断与部署准备：`docs/stage-8-c-diagnostics-and-local-fs-deployment.md`
- 专利交底模块：`modules/patent_disclosure/README.md`
- API 后端说明：`apps/api/README.md`
- 前端说明：`apps/web/README.md`

历史阶段记录继续保留在 `docs/stage-*.md` 中，README 不再重复维护阶段明细。
