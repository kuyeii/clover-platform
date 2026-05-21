# 第 7-C 阶段：竞对分析 health/history 直接迁入 apps/api

## 范围

本阶段在第 7-B 业务代理基础上，将 `competitor-analysis` 的低风险 health/history API 并行迁入 `apps/api`：

- `GET /api/v1/competitor-analysis/api/health`
- `GET /api/v1/competitor-analysis/api/history`
- `GET /api/v1/competitor-analysis/api/history/{id}`
- `POST /api/v1/competitor-analysis/api/history`
- `DELETE /api/v1/competitor-analysis/api/history`
- `DELETE /api/v1/competitor-analysis/api/history/{id}`

这些 direct routes 继续复用 Portal session token 和用户应用权限校验。未登录返回平台统一 401 envelope，无 `competitor-analysis` 权限返回平台统一 403 envelope。

## Legacy 兼容

这些接口虽然由 `apps/api` 直接实现，但路径仍保持 legacy-compatible 形式：`/api/v1/competitor-analysis/api/...`。

成功响应保持 legacy 结构，不包装为平台 `success/data` envelope：

- history 列表返回 `{ "items": [...] }`
- history 详情返回 `{ "item": ... }`
- POST history 返回 `{ "ok": true, "item": ... }`，状态码 201
- DELETE history 返回 `{ "ok": true }`
- 不存在的 history id 返回 `{ "message": "未找到历史记录" }`，状态码 404

history 读写保持 legacy repository 的 PostgreSQL 语义：

- 只读写 `competitor_analysis.history_records`
- 使用 `record_json` 保存完整历史记录
- `input_json` 来自记录里的 `input`
- 排序为 `sort_order DESC, created_at DESC, id DESC`
- 默认最多保留 `HISTORY_MAX_ITEMS`，未设置时为 200
- 不按 Portal 用户隔离，保持 legacy 全局共享历史行为

## Proxy fallback

除 health/history 外，其它 `competitor-analysis` API 仍走第 7-B proxy fallback 到 legacy 后端，包括：

- `POST /api/v1/competitor-analysis/api/analysis`
- `POST /api/v1/competitor-analysis/api/analysis/stream`
- `POST /api/v1/competitor-analysis/api/workflows/validate`
- `POST /api/v1/competitor-analysis/api/workflows/company-name-validate`
- `POST /api/v1/competitor-analysis/api/workflows/company-detail`
- `POST /api/v1/competitor-analysis/api/workflows/compare-report`
- `POST /api/v1/competitor-analysis/api/workflows/score`

本阶段未重写分析业务逻辑、Dify workflow 调用或 NDJSON stream 协议。`analysis/stream` 继续通过 proxy 透传 `application/x-ndjson`。

## 依赖边界

- direct health/history routes 不依赖 legacy `competitor-analysis` 后端。
- proxy fallback 仍依赖 legacy `competitor-analysis` 后端。
- legacy `competitor-analysis` 后端关闭时，health/history 仍应可用；analysis/workflows/stream 应返回明确的 502 后端连接失败错误，不应 traceback。
- legacy `competitor-analysis` 前端未切换，iframe 未移除。
- legacy `competitor-analysis` 后端仍保留。
- RAG、合同审查、标书生成 API 未迁入。
- 数据库结构未修改，未新增 Alembic migration。

## Router 注册

`apps/api/app/__init__.py` 只 include 统一 `api_router`。`apps/api/app/api/router.py` 统一聚合：

- `/api/v1/core/*` 平台 API
- `/api/v1/competitor-analysis/*` 竞对分析 direct routes 和 proxy fallback

路径保持：

- `/api/v1/core/health`
- `/api/v1/core/auth/login`
- `/api/v1/competitor-analysis/api/health`
- `/api/v1/competitor-analysis/{path:path}`

不会注册为 `/api/v1/core/competitor-analysis/...`。
