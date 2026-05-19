# Legacy 项目快照

`legacy/` 目录保存五个原始项目快照，用于第 1 阶段保留既有项目的原始结构和启动方式。`legacy/` 不是 Git submodule，本仓库不使用 `.gitmodules` 管理这些项目。

当前阶段不要在 legacy 项目中做大规模业务重构。后续迁移时，应从 `legacy/` 逐步迁移到 `modules/` 和 `apps/`，并在迁移过程中保持可回退。

敏感配置、运行数据、数据库文件、构建产物不应提交到 Git，包括真实 `.env` 文件、日志、SQLite 数据库、缓存目录、`node_modules/`、`dist/`、`build/` 等。
