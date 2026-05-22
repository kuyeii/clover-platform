# modules/contract_review

## 模块当前状态

合同审查模块当前后端主路径已迁入 `apps/api`，前端仍在 `legacy/contract_review/frontend` 并通过 iframe 接入 Portal。

## 后端状态

`apps/api` direct 已承载合同审查 health、config、converter diagnostics、review run、history/status/result、document/download、风险状态修改和 AI 改写相关能力。`ANY /api/v1/contract-review/{path:path}` catch-all proxy 仅保留为未知路径和回滚兜底。

## 前端状态

真实业务前端仍在 legacy 合同审查前端。第 10-A 只在 `apps/web` 新增 `/modules/contract-review` 占位页，不迁移上传、审查、批注或 DOCX 下载 UI。

## 后续迁移目标

第 10-E 迁移合同审查前端到 `apps/web/src/modules/contract-review`，先稳定上传、轮询、风险面板、AI 改写和 DOCX 下载契约。

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
