# Clover Platform

四叶草平台整合主仓库。

当前阶段已进入合同审查 PostgreSQL 持久化迁移阶段。Portal、竞对分析、RAG 问答和合同审查的指定运行时数据已切换到 PostgreSQL，标书生成仍保持 legacy 数据层状态。

## 项目目标

`clover-platform` 用于逐步整合统一入口、合同审查、标书生成、RAG 问答和竞对分析五个既有项目。当前不是五个后端已经合并完成的状态，也没有去掉 iframe；业务迁移会继续分阶段推进。

## 当前阶段

当前处于第 5-C 阶段：合同审查 PostgreSQL 持久化。

第 1 阶段 monorepo 骨架与 legacy 归档已完成。第 2 阶段 PostgreSQL 18 基础设施已完成。第 3 阶段已完成 Portal 登录、用户管理、应用权限、应用占用状态等核心数据写入 PostgreSQL。第 4 阶段已完成统一开发启动器、端口发现和 runtime iframe URL。第 5-A 阶段已完成竞对分析运行时历史记录和企业校验缓存迁移。第 5-B 阶段已完成 RAG 问答本地对话列表和问答 turn 记录迁移。第 5-C 阶段只迁移合同审查运行元数据和结构化 artifact 索引，不合并后端，不去掉 iframe，不迁移 DOCX / 上传文件 / data/runs 运行产物。

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
  legacy/
  docs/
  runtime/
```

## 当前不做的事情

- 不合并五个后端。
- 不去掉 iframe。
- 不修改认证逻辑。
- 不改成 JWT。
- 不引入 Celery / RQ。
- 不接 MinIO。
- 不升级 React / Vite / Tailwind。
- 不重构业务代码。
- 不迁移标书生成的数据层。
- 不迁移 RAG 的 Dify 知识库数据、本地向量索引或文件缓存。
- 不修改其他四个 legacy 项目的业务启动逻辑。

## 第 2 阶段：PostgreSQL 初始化

根级 Python 依赖只用于 `clover-platform` 基础设施脚本，不影响 legacy 项目自己的依赖文件。

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
POSTGRES_PASSWORD=postgres123456
DATABASE_URL=postgresql+psycopg://postgres:postgres123456@10.88.20.14:5432/app_db
```

Python 代码只从根目录 `.env` 或环境变量读取连接信息，不硬编码数据库连接串。

3. 检查数据库连接：

```bash
python scripts/check_db.py
```

如果数据库尚未初始化，脚本会提示缺少 schema、core 表、Portal 表或索引。

4. 初始化数据库：

```bash
python scripts/init_db.py
```

`scripts/init_db.py` 用于开发阶段快速初始化、幂等检查和本地调试。该脚本会可重复地创建 `pgcrypto` 扩展、`core` / `portal` / `contract_review` / `bid_generator` / `rag` / `competitor_analysis` schema、core 基础表、Portal 专属表、常用索引和各业务 schema 的 `module_meta` 表。

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

本阶段不会修改其他四个 legacy 业务代码。Portal 数据库访问层已经切换到 PostgreSQL。

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

`--write-ports-only` 默认生成全部模块的端口规划；如果同时传入 `--only` 或 `--skip`，会按筛选后的模块范围生成，Portal runtime 接口会对缺失的模块继续使用静态配置兜底。

只启动 Portal 前后端：

```bash
python scripts/dev.py --no-business
```

默认命令会启动配置中 `dev.enabled: true` 的模块。第 4.1-D 已支持自动启动：

- Portal 前端
- Portal 后端
- 标书生成前端
- 标书生成后端
- 合同审查前端
- 合同审查后端
- RAG 问答前端
- RAG 问答后端
- 竞对分析前端
- 竞对分析后端

第 4.1 阶段的业务模块开发自动启动接入已完成。标书生成的 `gateway-out` 是被 `pipt-flask` 导入调用的 Python 库/CLI，不是常驻 HTTP 服务，本阶段不单独自动启动。

合同审查在 `config/apps.yaml` 中使用 `dev.kind: frontend_backend`。前端端口优先使用 `18120`，可在 `18120-18124` 内自动切换；后端端口优先使用 `18125`，可在 `18125-18129` 内自动切换。`runtime/ports.json` 中的 `contract-review.iframe_url` 指向合同审查前端，`contract-review.backend_url` 指向合同审查后端，统一启动器会把后端地址注入合同审查前端的 `VITE_API_BASE_URL`。

标书生成在 `config/apps.yaml` 中使用 `dev.kind: frontend_backend`。前端端口优先使用 `18110`，可在 `18110-18114` 内自动切换；后端端口优先使用 `18115`，可在 `18115-18119` 内自动切换。`runtime/ports.json` 中的 `bid-generator.iframe_url` 指向标书生成前端，`bid-generator.backend_url` 指向标书生成后端，统一启动器会把后端地址注入标书生成前端的 `VITE_API_BASE_URL`。

RAG 问答在 `config/apps.yaml` 中使用 `dev.kind: frontend_backend`。前端端口优先使用 `18140`，可在 `18140-18144` 内自动切换；后端端口优先使用 `18145`，可在 `18145-18149` 内自动切换。`runtime/ports.json` 中的 `rag-web-search.iframe_url` 指向 RAG 前端，`rag-web-search.backend_url` 指向 RAG 后端，统一启动器会把后端地址注入 RAG 前端的 `VITE_API_BASE_URL`。

竞对分析在 `config/apps.yaml` 中使用 `dev.kind: frontend_backend`。前端端口优先使用 `18130`，可在 `18130-18134` 内自动切换；后端端口优先使用 `18135`，可在 `18135-18139` 内自动切换。`runtime/ports.json` 中的 `competitor-analysis.iframe_url` 指向竞对分析前端，`competitor-analysis.backend_url` 指向竞对分析后端，统一启动器会把后端地址注入竞对分析前端的 `VITE_API_BASE_URL`。

统一启动器默认使用当前 Python 解释器启动后端。合同审查可通过 `CONTRACT_REVIEW_PYTHON_BIN` 指定解释器，RAG 问答可通过 `RAG_QA_PYTHON_BIN` 指定解释器；如果未设置且对应后端目录或 legacy 目录下存在 `.venv/bin/python`，会优先使用本地解释器，否则回退到当前 Python。

`runtime/ports.json` 由启动器生成，不提交 Git。它记录 Portal 前后端端口，以及四个 iframe 模块的开发 URL。Portal 后端通过 `GET /api/runtime/apps` 读取该文件并只返回前端需要的 `code`、`name`、`iframeUrl`、`enabled` 等字段，不返回 dev command、env 或任何密钥。

Portal 前端启动后会请求 `/api/runtime/apps`。接口可用时，用返回的 `iframeUrl` 覆盖 `src/config/apps.config.ts` 中的静态 URL；接口失败或 `runtime/ports.json` 不存在时，继续使用静态配置兜底。

当前仍未去 iframe，仍未合并五个后端，标书生成的数据层仍未迁移。如果某个业务模块未自动启动，需要手动启动并确保端口与 `runtime/ports.json` 一致。

### 第 4.2 阶段：统一开发环境依赖与启动前检查

第 4.2 阶段新增统一 preflight 检查能力，用于在开发启动前确认本机依赖、关键配置、数据库、端口规划和 legacy 模块入口是否就绪。preflight 只做检查与提示，不会自动安装依赖，不会启动服务，也不会打印数据库密码、Dify key、token、secret 等敏感值。

第 4.2-A 收尾后，`portal.user_profiles` 和 `portal.feedback_submissions` 已纳入统一数据库初始化与 Alembic。新环境中 Portal 表缺失时，应通过 `python scripts/init_db.py` 和 `alembic upgrade head` 修复，不再依赖 Portal 后端首次启动自动建表；Portal 后端保留的建表逻辑只是兼容性兜底。

新环境推荐初始化顺序：

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
python scripts/preflight.py --json
```

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
python scripts/dev.py --skip bid-generator
```

`python scripts/dev.py --no-business` 只启动 Portal 前后端。`python scripts/dev.py --only contract-review` 只启动合同审查前后端。`python scripts/dev.py --only rag-web-search` 和 `python scripts/dev.py --only rag_qa` 只启动 RAG 前后端。`python scripts/dev.py --only competitor-analysis` 和 `python scripts/dev.py --only competitor_analysis` 只启动竞对分析前后端。`python scripts/dev.py --only bid-generator` 和 `python scripts/dev.py --only bid_generator` 只启动标书生成前后端。动态端口只用于开发环境；Docker 正式部署会在后续部署阶段单独处理。

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

Portal iframe 集成不变。合同审查数据库在第 5-C 阶段迁移，标书生成数据库尚未迁移，仍保持 legacy 状态。

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

Portal iframe 集成不变。合同审查数据库在第 5-C 阶段迁移，标书生成数据库尚未迁移，仍保持 legacy 状态。

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

Portal iframe 集成不变。标书生成数据库尚未迁移，仍保持 legacy 状态。

## 下一阶段计划

第 5-C 阶段完成后，后续再进入其他业务模块数据库迁移、统一后端接入与进一步去 iframe。当前仍不在本阶段合并后端或迁移标书生成数据库。
