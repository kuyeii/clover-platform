# 第 9-C：合同审查模块完整迁移

## 1. 当前阶段结论

第 9 阶段继续按模块迁移业务实现。本阶段完成 `contract-review` 合同审查主要业务 API direct 迁移，`apps/api` 已直接承载合同审查 health、config、converter diagnostics、review run、history/status/result、document/download、风险状态修改和 AI 改写相关能力。

本阶段保持边界：

- 不接 MinIO。
- 不接 Celery / RQ / Dramatiq。
- 不新增统一任务表。
- 不改数据库结构，不新增 Alembic migration。
- 不改前端请求路径，不改合同审查前端业务逻辑。
- 不改变 Portal session / JWT。
- 不改变现有 Dify / LLM 调用语义。
- 不影响 `competitor-analysis`、`rag-web-search`、`bid-generator`。
- legacy 合同审查后端暂时保留作为回滚参考。

## 2. 本阶段 direct API

以下接口已由 `apps/api` direct 处理：

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

## 3. 仍 proxy 的范围

`ANY /api/v1/contract-review/{path:path}` catch-all proxy 仍保留，主要用于：

- 未知路径兜底。
- 临时回滚。
- 避免前端未来新增路径立即 404。

当前 legacy 审计范围内的合同审查主要业务 API 均已 direct；proxy 不再是合同审查常规业务 API 的主路径。

## 4. legacy-compatible 响应说明

- 成功响应保持 legacy 原样，不强行包装为 `success/data`。
- `POST /api/reviews` 继续返回 `{"run_id": "...", "status": "queued"}`。
- history/status/result 保持 legacy 字段和状态值，继续使用 `queued`、`running`、`completed`、`failed` 等 run 状态。
- AI 改写相关接口保持 `{"ok": true, ...}` 结构和风险项字段。
- `document` / `download` 继续返回 DOCX 文件响应，并保留 `Content-Type` 与 `Content-Disposition`。
- 业务错误保持 legacy-compatible JSON，包括 `detail` 和 `error` 字段。
- 未登录、无权限、平台层校验失败和代理自身错误仍返回统一平台 envelope。

## 5. 权限与安全边界

- 所有 direct routes 和 proxy routes 均复用 Portal session token。
- 所有 direct routes 和 proxy routes 均校验 `contract-review` 权限。
- admin 默认允许，普通用户按 `core.user_app_permissions` 判断。
- 401 / 403 不 fallback。
- 无 token 或无权限时不会访问合同审查配置、legacy backend、LLM 或文件系统。
- proxy 不转发 `Authorization`、`Cookie` 或 legacy `Set-Cookie`。
- Dify key / workflow key / LLM key 不打印、不返回给前端。
- `run_id` 进入文件路径前做安全字符校验，只允许受控 run 目录内的文件产物。

## 6. 本地文件系统边界

- 继续使用 `legacy/contract_review/data/uploads/` 保存上传原文件。
- 继续使用 `legacy/contract_review/data/runs/<run_id>/` 保存单次审查产物。
- 不接 MinIO，不搬迁历史目录。
- `source.docx`、`merged_clauses.json`、`risk_result_validated.json`、`risk_result_reviewed.json`、`reviewed_comments.docx`、`ai_patched.docx` 和运行日志仍按 legacy 规则保存。
- JSON / 文本 artifact 仍按现有开关同步到 PostgreSQL，文件系统仍是 DOCX、PDF 转换物、日志和导出文件主存储。
- 部署时必须持久化挂载 `legacy/contract_review/data/uploads/` 与 `legacy/contract_review/data/runs/`。

## 7. 审查 pipeline 迁移说明

`apps/api` direct route 在鉴权后接收 multipart 上传，生成 legacy-compatible `run_id`，初始化 `contract_review.review_runs` 元数据，并启动 daemon thread 调用现有合同审查 pipeline。pipeline 继续把 `RUN_ROOT` 指向 `legacy/contract_review/data/runs`，调用原有 `app.py`、Dify 工作流、DOCX 转换和批注导出链路。

本阶段不引入任务队列。状态读取仍通过 `review_runs` 和 run 目录产物推断 / 修复 stale running 状态；失败状态、错误信息、progress 和 step 保持前端兼容。前端无需修改轮询逻辑。

## 8. AI 改写迁移说明

AI apply / apply all / accept / edit / reject 已由 `apps/api` direct 承载。实现继续复用合同审查纯业务模块，保持原有 Dify workflow key、输入字段、并发和落盘语义。

表格类风险过滤、段落风险定位、多段落聚合、accepted patch、`ai_rewrite_decision` 和 DOCX 导出应用前端修改的逻辑保持 legacy-compatible。上游 Dify / workflow 错误会转换为业务错误 JSON，不向前端暴露 traceback 或 secret。

## 9. 验收方式

必跑命令：

```bash
/Volumes/samsang/program-engineering/尖兵/clover-platform/.venv/bin/python -m compileall -q /Volumes/samsang/program-engineering/尖兵/clover-platform/packages /Volumes/samsang/program-engineering/尖兵/clover-platform/scripts /Volumes/samsang/program-engineering/尖兵/clover-platform/alembic /Volumes/samsang/program-engineering/尖兵/clover-platform/apps/api /Volumes/samsang/program-engineering/尖兵/clover-platform/legacy/portal-launchpad/backend
/Volumes/samsang/program-engineering/尖兵/clover-platform/.venv/bin/python /Volumes/samsang/program-engineering/尖兵/clover-platform/scripts/preflight.py --only platform-api
/Volumes/samsang/program-engineering/尖兵/clover-platform/.venv/bin/python /Volumes/samsang/program-engineering/尖兵/clover-platform/scripts/dev.py --write-ports-only
```

接口 smoke test：

- 未登录访问 direct API 返回平台 401 envelope。
- 无 `contract-review` 权限访问 direct API 返回平台 403 envelope。
- 有权限访问本阶段 direct API 返回 legacy-compatible 结构。
- 关闭 legacy contract-review backend 后，本阶段 direct API 仍可用。
- DOCX document/download 使用 authenticated fetch blob，并保留文件名。
- Dify key 未配置或上游错误时返回清晰业务错误，不 traceback。

## 10. 后续阶段建议

第 9-D 建议进入标书生成模块迁移，重点评估 `pipt-lite` 项目写入、Dify workflow、SSE task、文件预览下载、forge/export 和本地缓存目录边界。本阶段不展开标书生成迁移细节。
