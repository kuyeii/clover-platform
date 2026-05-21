# 第 7-B 阶段：竞对分析业务代理验证说明

## 范围

本阶段在 `apps/api` 中新增业务模块通用代理能力，并先接入 `competitor-analysis`：

- 统一入口：`/api/v1/competitor-analysis/{path:path}`
- 代理目标：legacy `competitor-analysis` 后端
- 权限：继续复用 Portal session token 和用户应用权限
- 流式：透传 `/api/analysis/stream` 的 `application/x-ndjson`

本阶段不迁移业务逻辑、不修改竞对分析前端、不去 iframe、不修改数据库结构。

## 后端地址解析

代理目标按以下顺序解析：

1. 优先读取 `runtime/ports.json` 中 `apps["competitor-analysis"].backend_url`
2. fallback 到 `config/apps.yaml` 中 `competitor_analysis.dev.env` 的后端 URL 配置
3. fallback 到 `config/apps.yaml` 中 `competitor_analysis.dev.backend_preferred_port`

解析失败时，统一后端返回平台错误：

```json
{
  "success": false,
  "error": {
    "code": "BUSINESS_BACKEND_UNAVAILABLE",
    "message": "业务模块后端不可用。",
    "details": {
      "app_code": "competitor-analysis"
    }
  },
  "request_id": "..."
}
```

## 手动验证

启动 Portal、platform-api 和竞对分析：

```bash
python scripts/dev.py --only portal --only platform-api --only competitor-analysis
```

或使用已有启动方式，只要 `runtime/ports.json` 包含 `competitor-analysis.backend_url` 即可。

登录 Portal 获取 session token 后验证健康检查：

```bash
curl -i \
  -H "Authorization: Bearer ${PORTAL_TOKEN}" \
  -H "X-Portal-Client-Id: manual-check" \
  "http://127.0.0.1:5220/api/v1/competitor-analysis/api/health"
```

预期返回 legacy 原始成功响应：

```json
{"ok":true,"service":"competitor-analysis-backend"}
```

验证 query string 透传：

```bash
curl -i \
  -H "Authorization: Bearer ${PORTAL_TOKEN}" \
  -H "X-Portal-Client-Id: manual-check" \
  "http://127.0.0.1:5220/api/v1/competitor-analysis/api/history?limit=10"
```

验证 NDJSON 流式透传：

```bash
curl -N \
  -H "Authorization: Bearer ${PORTAL_TOKEN}" \
  -H "X-Portal-Client-Id: manual-check" \
  -H "Content-Type: application/json" \
  -X POST \
  -d '{"targetCompanyName":"示例公司","competitorCompanyNames":["示例竞品"]}' \
  "http://127.0.0.1:5220/api/v1/competitor-analysis/api/analysis/stream"
```

预期响应头保留 `application/x-ndjson`，响应体按行持续输出 JSON 事件。

## 权限验证

- 不带 `Authorization`：应返回 401，错误码 `UNAUTHORIZED`
- 用户无 `competitor-analysis` 权限：应返回 403，错误码 `PERMISSION_DENIED`
- 无权限时不会访问 legacy 竞对分析后端

## 回滚

本阶段未修改竞对分析 legacy 前端和后端，iframe 仍可继续按 `VITE_API_BASE_URL` 直连 legacy 后端。需要回滚时继续使用当前 legacy 启动链路即可。
