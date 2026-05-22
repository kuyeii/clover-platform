# modules/competitor_analysis

## 模块当前状态

竞对分析模块当前后端主路径已迁入 `apps/api`，前端仍在 `legacy/company-competitors-analysis` 并通过 iframe 接入 Portal。

## 后端状态

`apps/api` direct 已承载竞对分析 health、history、analysis、analysis stream 和 workflows 主要业务 API。`ANY /api/v1/competitor-analysis/{path:path}` catch-all proxy 仅保留为未知路径和回滚兜底。

## 前端状态

真实业务前端仍在 `legacy/company-competitors-analysis`。第 10-A 只在 `apps/web` 新增 `/modules/competitor-analysis` 占位页，不迁移业务页面。

## 后续迁移目标

第 10-C 迁移竞对分析前端到 `apps/web/src/modules/competitor-analysis`，逐步替换 iframe 页面，同时保持 API 路径和响应结构兼容。

## 关键风险点

- NDJSON stream 事件格式和中断处理。
- workflow key、Dify 上游错误和 demo fallback。
- 历史记录状态与 PostgreSQL 数据兼容。
- Portal 权限校验与业务错误结构。
- legacy 前端中纯 JS service 与新 TypeScript API client 的契约差异。

## 验收重点

- history、analysis、analysis stream 和 workflow 调用行为不变。
- 无权限时返回平台 403，不访问业务链路。
- stream 不缓冲完整结果，不暴露 secret 或 traceback。
- iframe 回滚路径在迁移期间仍可使用。
