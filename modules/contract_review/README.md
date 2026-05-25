# modules/contract_review

## 模块当前状态

合同审查模块当前后端主路径已迁入 `apps/api`，真实前端页面已在第 10-D 迁入 `apps/web/src/modules/contract-review`。`legacy/contract_review/frontend` 继续保留为回滚入口。

## 后端状态

`apps/api` direct 已承载合同审查 health、config、converter diagnostics、review run、history/status/result、document/download、风险状态修改和 AI 改写相关能力。`ANY /api/v1/contract-review/{path:path}` catch-all proxy 仅保留为未知路径和回滚兜底。

## 前端状态

`apps/web` 已承载合同审查主页面、DOCX 上传、审查创建、状态轮询、历史记录、结果展示、风险卡片、风险状态修改、AI 改写和 DOCX 鉴权下载。当前 API 统一走 `/api/v1/contract-review/api/**`，不再依赖 iframe auth bridge。

## 后续迁移目标

后续阶段可继续细化 DOCX 在线预览、定位和本地编辑体验；legacy 合同审查前端在冻结评估前不删除。

## 关键风险点

- multipart 上传和 run_id 安全边界。
- 审查状态轮询、stale running 修复和失败语义。
- DOCX document/download 的 Content-Type、Content-Disposition 和文件名。
- 风险状态修改、AI 改写、accept/edit/reject 的落盘语义。
- `legacy/contract_review/data/uploads` 和 `data/runs` 本地文件系统持久化。

## 验收重点

- 上传、history、status、result、document/download 行为兼容。
- AI 改写链路不改变 Dify / LLM 语义。
- 文件下载通过鉴权 fetch/blob，不能暴露非授权路径。
- iframe 回滚路径在迁移期间仍可使用。
- 上传 / 状态 / AI 改写 / DOCX 下载均需确认 401、403 和业务错误能给出清晰提示。
