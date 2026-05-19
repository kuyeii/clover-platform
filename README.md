# Clover Platform

四叶草平台整合主仓库。

当前阶段已完成 Portal 数据库访问层从 SQLite 到 PostgreSQL 的切换，其他四个业务项目仍保持 legacy 状态。

## 项目目标

`clover-platform` 用于逐步整合统一入口、合同审查、标书生成、RAG 问答和竞对分析五个既有项目。当前不是五个后端已经合并完成的状态，也没有去掉 iframe；业务迁移会继续分阶段推进。

## 当前阶段

当前处于第 3 阶段收尾：Portal PostgreSQL 切换已完成。

第 1 阶段 monorepo 骨架与 legacy 归档已完成。第 2 阶段 PostgreSQL 18 基础设施已完成。第 3 阶段已完成 Portal 登录、用户管理、应用权限、应用占用状态等核心数据写入 PostgreSQL。其他四个业务模块仍保持 legacy 状态，后续分阶段迁移。

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
- 不迁移合同审查、标书生成、RAG 问答、竞对分析的数据层。
- 不修改其他四个 legacy 项目的业务启动逻辑。

## 第 2 阶段：PostgreSQL 初始化

根级 Python 依赖只用于 `clover-platform` 基础设施脚本，不影响 legacy 项目自己的依赖文件。

1. 安装根级 Python 依赖：

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
```

2. 准备本地环境变量：

```bash
cp .env.example .env
```

编辑 `.env` 中的 `DATABASE_URL`，或使用 `POSTGRES_HOST`、`POSTGRES_PORT`、`POSTGRES_DB`、`POSTGRES_USER`、`POSTGRES_PASSWORD` 组合配置。`.env` 不应提交到 Git。

3. 检查数据库连接：

```bash
python scripts/check_db.py
```

如果数据库尚未初始化，脚本会提示缺少 schema 或 core 表。

4. 初始化数据库：

```bash
python scripts/init_db.py
```

`scripts/init_db.py` 用于开发阶段快速初始化、幂等检查和本地调试。该脚本会可重复地创建 `pgcrypto` 扩展、`core` / `portal` / `contract_review` / `bid_generator` / `rag` / `competitor_analysis` schema、core 基础表、常用索引和各业务 schema 的 `module_meta` 表。

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

## 下一阶段计划

第 4 阶段再处理统一启动器与动态端口。第 5 阶段之后再考虑其他业务模块数据库迁移与进一步去 iframe。

## 第 3 阶段：Portal PostgreSQL

Portal 后端位于 `legacy/portal-launchpad`。本阶段只把 Portal 数据库访问层切换到 PostgreSQL，前端页面、iframe 集成、认证 token 形态和其他四个 legacy 项目不变。

启动前先确认根目录 `.env` 配置了 `DATABASE_URL`，并可选配置默认管理员：

```bash
PORTAL_ADMIN_USERNAME=admin
PORTAL_ADMIN_PASSWORD=admin123456
PORTAL_ADMIN_DISPLAY_NAME=系统管理员
```

开发默认密码只用于本地初始化，上线前必须修改。第一次启动 Portal 后端时，如果 `core.users` 中没有管理员，会按上述环境变量创建默认管理员；不迁移旧 SQLite 数据。

启动方式保持原项目习惯：

```bash
cd legacy/portal-launchpad
uvicorn backend.main:app --reload --host 0.0.0.0 --port 5210
```

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
