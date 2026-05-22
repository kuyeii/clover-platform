# 第 9-A：竞对分析模块完整迁移

## 1. 当前阶段结论

第 9 阶段开始按模块迁移业务实现。本阶段完成 `competitor-analysis` 主要业务 API direct 迁移，`apps/api` 已直接承载竞对分析 health、history、analysis、analysis/stream 和 workflows 能力。

本阶段保持边界：

- 不接 MinIO。
- 不接 Celery / RQ / Dramatiq。
- 不新增统一任务表。
- 不改数据库结构，不新增 Alembic migration。
- 不改前端请求路径，不改竞对分析前端业务逻辑。
- 不影响 RAG、contract-review、bid-generator。
- legacy 竞对分析后端暂时保留作为回滚参考。

## 2. 本阶段 direct API

以下接口已由 `apps/api` direct 处理：

- `GET /api/v1/competitor-analysis/api/health`
- `GET /api/v1/competitor-analysis/api/history`
- `GET /api/v1/competitor-analysis/api/history/{id}`
- `POST /api/v1/competitor-analysis/api/history`
- `DELETE /api/v1/competitor-analysis/api/history`
- `DELETE /api/v1/competitor-analysis/api/history/{id}`
- `POST /api/v1/competitor-analysis/api/analysis`
- `POST /api/v1/competitor-analysis/api/analysis/stream`
- `POST /api/v1/competitor-analysis/api/workflows/validate`
- `POST /api/v1/competitor-analysis/api/workflows/company-name-validate`
- `POST /api/v1/competitor-analysis/api/workflows/company-detail`
- `POST /api/v1/competitor-analysis/api/workflows/compare-report`
- `POST /api/v1/competitor-analysis/api/workflows/score`

## 3. 仍 proxy 的范围

`ANY /api/v1/competitor-analysis/{path:path}` catch-all proxy 仍保留，主要用于：

- 未知路径兜底。
- 临时回滚。
- 避免前端未来新增路径立即 404。

当前 legacy 审计范围内的主要业务 API 均已 direct；proxy 不再是竞对分析常规业务 API 的主路径。

## 4. legacy-compatible 响应说明

- 成功响应保持 legacy 原样，不强行包装为 `success/data`。
- history 保持 `items`、`item`、`ok`、`message` 结构。
- `POST /api/analysis` 保持 `{"ok": true, "item": record, "warnings": [...]}`，状态码 201。
- `analysis/stream` 保持 NDJSON，每行格式为 `{"type": "...", "data": ...}`。
- workflow 响应保持 legacy workflow 结构。
- 业务错误尽量保持 `{"message": "...", "code": "..."}` 和原状态码。
- 未登录、无权限、平台层数据库错误仍返回统一平台 envelope。

## 5. 权限与安全边界

- 所有 direct routes 和 proxy routes 均复用 Portal session token。
- 所有 direct routes 和 proxy routes 均校验 `competitor-analysis` 权限。
- admin 默认允许，普通用户按 `core.user_app_permissions` 判断。
- 401 / 403 不 fallback。
- 无权限时不会访问竞对分析数据库、workflow 配置、legacy backend 或外部服务。
- proxy 不转发 `Authorization`、`Cookie` 或 legacy `Set-Cookie`。
- Dify key / workflow key 不打印、不返回给前端。

## 6. Dify / workflow 处理边界

`apps/api` 直接调用原有 Dify workflow，保留 legacy 的 env 变量语义，同时优先对照 `config/workflows.yaml` 中的非密钥 env 映射读取配置。真实 key 仍来自 `.env`、部署 secret 或本地 `.env.local`，不写入 `config/workflows.yaml`。

workflow 未配置或 placeholder key 时，保持 legacy demo fallback：完整分析链路返回演示数据并带 warnings；单独 workflow 接口返回 legacy-compatible 业务错误。Dify 上游 HTTP 错误、超时和无效响应会转换为清晰业务错误；stream 链路通过 `analysis_error` 事件返回错误，不让 `apps/api` traceback 暴露给前端。

## 7. stream 迁移说明

`POST /api/v1/competitor-analysis/api/analysis/stream` 已由 `apps/api` direct 承载：

- 使用 `StreamingResponse`。
- `Content-Type` 为 `application/x-ndjson; charset=utf-8`。
- 保持 legacy 事件类型：`analysis_started`、`competitors_ready`、`target_detail_ready`、`competitor_detail_ready`、`compare_report_ready`、`score_ready`、`analysis_finished`、`analysis_error`。
- 分析阶段完成后逐事件写出，不等待完整分析结束后一次性返回。
- 客户端断开时停止继续向响应队列写入，避免 BrokenPipe traceback。
- stream 过程中继续按 legacy 行为保存 running / final / error history record。

## 8. 验收方式

必跑命令：

```bash
/Volumes/samsang/program-engineering/尖兵/clover-platform/.venv/bin/python -m compileall -q /Volumes/samsang/program-engineering/尖兵/clover-platform/packages /Volumes/samsang/program-engineering/尖兵/clover-platform/scripts /Volumes/samsang/program-engineering/尖兵/clover-platform/alembic /Volumes/samsang/program-engineering/尖兵/clover-platform/apps/api /Volumes/samsang/program-engineering/尖兵/clover-platform/legacy/portal-launchpad/backend
/Volumes/samsang/program-engineering/尖兵/clover-platform/.venv/bin/python /Volumes/samsang/program-engineering/尖兵/clover-platform/scripts/preflight.py --only platform-api
/Volumes/samsang/program-engineering/尖兵/clover-platform/.venv/bin/python /Volumes/samsang/program-engineering/尖兵/clover-platform/scripts/dev.py --write-ports-only
npm --prefix /Volumes/samsang/program-engineering/尖兵/clover-platform/legacy/portal-launchpad run build
```

接口 smoke test：

- 未登录访问 direct API 返回平台 401 envelope。
- 无 `competitor-analysis` 权限访问 direct API 返回平台 403 envelope。
- 有权限访问本阶段 direct API 返回 legacy-compatible 结构。
- 关闭 legacy competitor-analysis backend 后，本阶段 direct API 仍可用。
- `analysis/stream` 保持 NDJSON 流式输出，不缓冲完整结果。
- workflow key 未配置时返回清晰业务错误或 legacy demo fallback，不 traceback。

## 9. 后续阶段建议

第 9-B 建议进入 RAG 问答模块迁移，重点评估 chat stream、knowledge Dataset 和 Dify Dataset 边界。本阶段不展开 RAG 迁移细节。
