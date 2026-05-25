# modules/competitor_analysis

## 模块当前状态

竞对分析模块当前后端主路径已迁入 `apps/api`，真实前端页面已迁入 `apps/web/src/modules/competitor-analysis`。第 10-F 后，`apps/web` 是默认前端主入口，legacy 竞对分析前端默认不启动。

## 后端状态

`apps/api` direct 已承载竞对分析 health、history、analysis、analysis stream 和 workflows 主要业务 API。`ANY /api/v1/competitor-analysis/{path:path}` catch-all proxy 仅保留为未知路径和回滚兜底。

## 前端状态

真实业务页面已在 `apps/web` 原生运行，直接调用 `/api/v1/competitor-analysis/**`。`legacy/company-competitors-analysis` 继续保留为 iframe 回滚入口，不删除；需要时使用 `python scripts/dev.py --only competitor-analysis --with-legacy-frontends` 启动。

## 后续迁移目标

后续重点是继续补齐更细粒度的 UI 回归和导出体验；当前 API 路径和响应结构保持 legacy-compatible。

## 关键风险点

- NDJSON stream 事件格式和中断处理。
- workflow key、Dify 上游错误和 demo fallback。
- 历史记录状态与 PostgreSQL 数据兼容。
- Portal 权限校验与业务错误结构。
- legacy 前端中纯 JS service 与新 TypeScript API client 的契约差异。
- legacy iframe 回滚时 runtime `iframe_url` 与 auth bridge origin 需要匹配。

## 验收重点

- history、analysis、analysis stream 和 workflow 调用行为不变。
- history 列表、详情和删除可用。
- analysis/stream 保持 NDJSON 流式展示。
- workflow validate、company detail、compare report 和 score 调用保持兼容。
- 无权限时返回平台 403，不访问业务链路。
- stream 不缓冲完整结果，不暴露 secret 或 traceback。
- 默认启动不依赖 legacy 前端。
- legacy 回滚路径在回滚参数启用时仍可使用。
