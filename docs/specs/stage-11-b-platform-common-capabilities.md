# Stage 11-B: 平台公共能力补齐 Spec

## 1. 背景

规范要求用户、权限、文件、任务、审计、配置、Dify 调用属于平台公共能力。当前已有 `core.files`、`core.jobs` 和部分公共配置/数据库能力，但业务代码仍大量沿用模块内文件目录、模块内任务状态和模块内 Dify 调用。

## 2. 目标

- 建立并落地 `py_common.dify`、`py_common.storage`、`py_common.jobs` 的最小可用实现。
- 让核心业务文件写入 `core.files` 元数据。
- 让长任务或流式任务写入 `core.jobs` 或清晰的模块任务表，并提供统一查询入口。
- 增加 workflow 运行记录，用于排查 Dify 调用、超时和失败。
- 统一错误分类、超时、重试、request id、日志和敏感信息过滤。

## 3. 允许做

- 新增 `packages/py_common/dify`、`packages/py_common/storage`、`packages/py_common/jobs`。
- 新增 Alembic migration，例如 `core.workflow_runs` 或补充 `core.jobs` 字段。
- 为业务模块逐步接入公共 Dify client 和 storage adapter。
- 增加统一 job 查询 API，例如 `/api/v1/core/jobs/{id}`。
- 增加统一 file metadata API，例如 `/api/v1/core/files/{id}`。
- 为本地文件系统实现 storage backend，并保留未来 MinIO 接口抽象。

## 4. 禁止做

- 不在本阶段强制接入 MinIO、S3、Celery、RQ。
- 不一次性改完所有业务文件路径。
- 不把 Dify key 写入数据库或日志。
- 不改变现有业务接口的用户可见语义。
- 不删除模块原有任务机制，除非已有兼容层和迁移验证。

## 5. 技术约束

- 配置读取必须遵守优先级：环境变量 > `config.local.yaml` > 环境配置 > `config/default.yaml`。
- 敏感字段只允许来自环境变量或部署密钥。
- Dify 调用日志只记录 workflow 标识、状态、耗时、request id、错误类型，不记录完整密钥和敏感 payload。
- 文件 metadata 必须包含 module_code、owner_user_id、storage_backend、storage_path、mime_type、size_bytes、metadata。
- job 状态至少包含 pending/running/succeeded/failed/cancelled，并记录 progress、error、created_by、timestamps。

## 6. 推荐迁移顺序

1. RAG knowledge 文件上传和 Dify Dataset 调用。
2. 竞对分析 workflow 调用。
3. 合同审查 Dify rewrite 和 review workflow 调用。
4. 标书生成 Dify workflow、SSE task 和导出文件。
5. 统一 job/file 查询入口和审计日志补齐。

## 7. 交付物

- 公共 Dify/storage/jobs 包。
- 必要的 Alembic migration。
- 接入公共能力的模块清单。
- 新增或更新的 core API 文档。
- 敏感信息过滤和日志规范说明。

## 8. 验收标准

- 新增公共包有最小单元测试。
- 接入模块的 Dify 调用可通过 request id 和 workflow run 记录追踪。
- 上传或导出产生的关键文件可在 `core.files` 中查到 metadata。
- 长任务或流式任务可在统一 job 入口查状态，或明确记录为何暂缓接入。
- 业务回归不退化。
- 缺失 Dify key、超时、上游错误返回清晰错误，不暴露敏感信息。

## 9. 回退策略

- 公共 client 必须支持按模块回退到原实现。
- 每个模块接入公共能力时应保留 feature flag 或 adapter 切换点。
- 数据库 migration 只能前进，回退以关闭接入路径为主，不依赖 destructive downgrade。

## 10. 完成定义

- 至少两个业务模块完成公共 Dify/storage/jobs 接入并通过回归。
- 新增公共能力的接口、日志和数据库记录稳定。
- 后续模块接入只需复制成熟 adapter 模式。
