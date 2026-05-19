# Clover Platform

四叶草平台整合主仓库。

当前阶段只建立整合仓库骨架，不修改五个业务项目逻辑。

## 项目目标

`clover-platform` 用于逐步整合统一入口、合同审查、标书生成、RAG 问答和竞对分析五个既有项目。第一阶段目标是建立 monorepo 基础结构和安全备份线，让五个 legacy 项目继续保持原有启动方式。

## 当前阶段

当前处于第 1 阶段：整合主仓库骨架与 legacy 归档。

本阶段只做目录、配置和脚本占位，不迁移业务代码，不调整端口，不修改数据库和认证逻辑。

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

- 不接 PostgreSQL。
- 不迁移 SQLite。
- 不合并五个后端。
- 不去掉 iframe。
- 不修改认证逻辑。
- 不改成 JWT。
- 不引入 Celery / RQ。
- 不接 MinIO。
- 不升级 React / Vite / Tailwind。
- 不重构业务代码。
- 不删除 legacy 项目中的任何文件。
- 不修改五个项目的业务启动逻辑。

## 下一阶段计划

下一阶段再实现统一启动、端口检测、PostgreSQL 初始化方案、数据库健康检查和运行时配置加载。业务迁移应按模块逐步推进，并保留 iframe fallback。
