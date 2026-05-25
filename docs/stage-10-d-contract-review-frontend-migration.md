# 第 10-D：合同审查前端迁入 apps/web

## 1. 当前阶段结论

合同审查真实前端页面已迁入 `apps/web`。第 10-D 后：

- Portal、竞对分析、RAG、合同审查已在 `apps/web` 承载真实前端能力。
- 标书生成仍通过 iframe 接入。
- `legacy/contract_review/frontend` 继续保留为回滚入口。
- 本阶段不修改 `apps/api` 业务 API 行为。
- 本阶段不修改数据库结构，不新增 Alembic migration。

## 2. 本阶段迁移范围

已迁入 `apps/web/src/modules/contract-review`：

- 合同审查主页面。
- DOCX / DOC / PDF 上传。
- 审查创建，字段保持 `file`、`review_side`、`contract_type_hint`、`analysis_scope`。
- 状态查询与轮询。
- 历史记录列表与历史记录打开。
- result 摘要展示。
- 风险卡片、风险等级、风险位置、问题、依据和建议展示。
- 风险状态修改。
- `accept_all`。
- AI apply。
- AI apply all。
- AI accept。
- AI edit。
- AI reject。
- DOCX document / download 鉴权 blob 下载。
- loading、empty、error 和权限状态。

## 3. 未迁移范围

本阶段不迁移：

- 标书生成真实页面。
- 去 iframe。
- 删除 legacy 合同审查前端。
- 删除 legacy 合同审查后端源码。
- `apps/api` API 改造。
- 数据库改造。
- MinIO、Celery/RQ 或统一任务表。

## 4. apps/web 合同审查结构

关键结构：

```text
apps/web/src/modules/contract-review/
  ContractReviewPage.tsx
  types.ts
  services/
    contractReviewApi.ts
  components/
    ReviewUploader.tsx
    ReviewStatus.tsx
    ReviewHistory.tsx
    RiskList.tsx
    RiskCard.tsx
    DownloadActions.tsx
```

`ContractReviewPage.tsx` 负责编排配置加载、health/diagnostics、上传创建、轮询、历史记录、结果刷新、风险状态和 AI 改写操作。`contractReviewApi.ts` 使用统一 `apiClient` 调用 `apps/api`，不再依赖 iframe auth bridge。

## 5. 合同审查 API 说明

合同审查原生页面直接调用：

- `GET /api/v1/contract-review/api/health`
- `GET /api/v1/contract-review/api/config`
- `GET /api/v1/contract-review/api/diagnostics/converters`
- `POST /api/v1/contract-review/api/reviews`
- `GET /api/v1/contract-review/api/reviews/history`
- `GET /api/v1/contract-review/api/reviews/{run_id}`
- `GET /api/v1/contract-review/api/reviews/{run_id}/result`
- `GET /api/v1/contract-review/api/reviews/{run_id}/document`
- `GET /api/v1/contract-review/api/reviews/{run_id}/download`
- `PATCH /api/v1/contract-review/api/reviews/{run_id}/risks/{risk_id}`
- `POST /api/v1/contract-review/api/reviews/{run_id}/risks/accept_all`
- `POST /api/v1/contract-review/api/reviews/{run_id}/risks/{risk_id}/ai_apply`
- `POST /api/v1/contract-review/api/reviews/{run_id}/ai_apply_all`
- `POST /api/v1/contract-review/api/reviews/{run_id}/risks/{risk_id}/ai_accept`
- `PATCH /api/v1/contract-review/api/reviews/{run_id}/risks/{risk_id}/ai_edit`
- `POST /api/v1/contract-review/api/reviews/{run_id}/risks/{risk_id}/ai_reject`

成功响应保持第 9-C 的 legacy-compatible 结构解析；401 由统一 API client 清理会话，403 在页面显示无权限或权限不足提示。

## 6. 上传与下载说明

上传使用 `FormData`，前端不手动设置 multipart `Content-Type`，避免破坏 boundary。上传字段名保持 legacy 行为：`file`、`review_side`、`contract_type_hint`、`analysis_scope`。

下载使用统一 API client 的 authenticated raw fetch，自动携带 `Authorization` 和 `X-Portal-Client-Id`，按 blob 保存。文件名优先解析 `Content-Disposition`，无文件名时回退为 `{run_id}.docx` 或当前审查文件名。

## 7. AI 改写说明

风险卡片显示 AI 改写状态。单条 `ai_apply`、`ai_accept`、`ai_edit`、`ai_reject` 均有局部 loading；`ai_apply_all` 和 `accept_all` 有整体 loading 和结果提示。Dify / LLM key 未配置或上游失败时按后端业务错误展示，不把 key、prompt 或文件内容写入 UI 或 console。

## 8. 安全边界

- token 不进入 URL query/hash。
- 不 `console.log` token。
- token 继续使用 `apps/web` 统一内存 + `sessionStorage` 刷新恢复策略，不写长期 `localStorage`。
- 合同审查原生页面不再依赖 legacy `portalBridge`。
- document / download 不暴露服务器真实路径，不用 iframe 直接下载带 token URL。
- 标书生成 iframe auth bridge 保持 origin 和 targetOrigin 控制。

## 9. 回滚策略

`legacy/contract_review/frontend` 未删除，仍可独立 build，并可作为合同审查回滚入口。`config/apps.yaml` 中合同审查 iframe 配置继续保留，便于后续对照验收或回滚。

## 10. 验收方式

命令验收：

```bash
python -m compileall -q packages scripts alembic apps/api legacy/portal-launchpad/backend
python scripts/preflight.py --only platform-api
python scripts/dev.py --write-ports-only
npm --prefix legacy/portal-launchpad run build
npm --prefix legacy/contract_review/frontend run build
npm --prefix apps/web run build
```

手工验收重点：

- `/login` 可显示，登录后进入 `/workspace`。
- 刷新后可恢复用户状态。
- 工作台显示四个模块入口。
- 点击合同审查进入 `apps/web` 原生页面，不是 iframe。
- 点击标书生成仍进入 iframe。
- 合同审查 health/config/diagnostics 可加载。
- 合同上传后可创建 run_id 并轮询状态。
- completed 后可加载 result 和风险卡片。
- 单条风险状态、AI apply / accept / edit / reject 可用。
- apply all / accept all 有清晰 loading 和结果提示。
- document / download 通过鉴权 blob 下载并保留文件名。

## 11. 后续阶段建议

第 10-E 建议迁入标书生成前端真实页面，重点处理项目 CRUD、SSE 任务、文件预览下载、DocumentForge 导出和编辑器依赖。本阶段不展开标书生成迁移细节。
