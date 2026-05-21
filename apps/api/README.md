# apps/api

`apps/api` 是 Clover Platform 统一后端基座。第 6-D 中 Portal 前端核心平台能力和 feedback 能力已切到这里，但仍不承载合同审查、RAG、竞对分析或标书生成的业务 API。

## 当前职责

- FastAPI 统一入口，应用标题为 `Clover Platform API`。
- API 主前缀为 `/api/v1/core`。
- 读取根目录 `.env`、`config/apps.yaml` 和 `runtime/ports.json`。
- 复用 `packages/py_common` 的配置、数据库健康检查、模块注册、运行时端口能力。
- 复用 Portal session token、`Authorization: Bearer <token>` 和 `X-Portal-Client-Id`。
- 提供统一响应 envelope、request id middleware、统一 404 / 422 / 500 错误响应和基础日志。
- 为 Portal 前端提供 auth、users、app-usage、runtime apps、feedback 和 `/ws/core/app-usage`。

## 当前接口

- `GET /api/v1/core/health`
- `GET /api/v1/core/health/db`
- `GET /api/v1/core/modules`
- `GET /api/v1/core/modules/health`
- `GET /api/v1/core/runtime/apps`
- `POST /api/v1/core/auth/login`
- `GET /api/v1/core/auth/me`
- `POST /api/v1/core/auth/logout`
- `PATCH /api/v1/core/auth/password`
- `GET /api/v1/core/users`
- `POST /api/v1/core/users`
- `PATCH /api/v1/core/users/{user_id}`
- `GET /api/v1/core/app-usage`
- `POST /api/v1/core/app-usage/{app_code}/enter`
- `POST /api/v1/core/app-usage/{app_code}/heartbeat`
- `DELETE /api/v1/core/app-usage/{app_code}/leave`
- `DELETE /api/v1/core/app-usage/leave-all`
- `POST /api/v1/core/app-usage/leave-all-beacon`
- `GET /api/v1/core/tickets/submission-context`
- `GET /api/v1/core/tickets/captcha`
- `POST /api/v1/core/tickets`
- `GET /api/v1/core/feature-requests/submission-context`
- `GET /api/v1/core/feature-requests/captcha`
- `POST /api/v1/core/feature-requests`
- `WS /ws/core/app-usage`

## 响应格式

成功响应：

```json
{
  "success": true,
  "data": {},
  "message": "ok",
  "request_id": "..."
}
```

失败响应：

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "错误说明",
    "details": {}
  },
  "request_id": "..."
}
```

如果请求头包含 `X-Request-ID`，服务会复用该值；否则自动生成新的 request id，并在响应头返回。

WebSocket 不使用统一 envelope。`/ws/core/app-usage` 保持 legacy `/ws/app-usage` 消息结构：连接后先发送 `auth` 消息，成功后收到 `snapshot`，`heartbeat` 返回 `heartbeat_ack`，`refresh` 返回 `snapshot`，占用状态广播为 `app_usage_changed`。

## 当前不做

- 不迁移业务模块 API。
- 不替换 legacy 后端。
- 不修改 Portal session。
- 不改 JWT。
- 不去掉 iframe。
- 不接 MinIO。
- 不引入 Celery / RQ。

## 本地启动

安装依赖：

```bash
python -m pip install -r apps/api/requirements.txt
```

只启动统一后端：

```bash
python scripts/dev.py --only platform-api
```

启动 Portal + 统一后端，不启动四个业务模块：

```bash
python scripts/dev.py --no-business
```

`--no-business` 会启动 Portal 前后端 + platform-api，并向 Portal 前端注入 `VITE_PLATFORM_API_BASE_URL` 和 `VITE_PLATFORM_WS_BASE_URL`。Portal 前端的 `/api/v1/core` 与 `/ws/core` 需要 platform-api；如果通过 `--skip platform-api` 跳过统一后端，登录、用户管理、应用占用、runtime apps 和 feedback 可能不可用。业务模块 API 仍走各 legacy 模块后端。

生成 platform-api 端口规划：

```bash
python scripts/dev.py --only platform-api --write-ports-only
```

开发默认端口为 `5220`，端口范围为 `5220-5229`。
