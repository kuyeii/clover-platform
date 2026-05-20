# Docker 说明

适用项目：`company-competitors-analysis`

当前第 5-A 阶段只完成竞对分析运行时数据到 PostgreSQL 的迁移收尾。竞对分析后端依赖 clover-platform monorepo 根目录的 `packages/py_common`、`config/apps.yaml` 和根级 Python 依赖；本目录下的 Docker 配置不是当前阶段交付的运行入口。

Docker 统一部署将在后续阶段处理。

## 当前有效运行方式

在 clover-platform 根目录配置 `.env` / `DATABASE_URL` 后执行：

```bash
python scripts/init_db.py
alembic upgrade head
python scripts/check_db.py
python scripts/preflight.py --only competitor-analysis
python scripts/dev.py --only competitor-analysis
```

运行时历史记录写入 PostgreSQL：

```text
competitor_analysis.history_records
competitor_analysis.storage_meta
competitor_analysis.company_profiles
competitor_analysis.company_validation_queries
```
