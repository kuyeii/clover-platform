# 用户管理与应用占用状态设计（FastAPI + SQLite）

## 目标

四叶草启动台统一管理四个应用入口：标书审查、合同审查、RAG 问答、竞对分析。用户登录后，启动台需要根据后端权限展示可访问应用，并展示每个应用是否正在被其他用户使用。

本版后端由 FastAPI 提供，SQLite 作为轻量持久化数据库，避免把用户、权限、会话和应用占用状态放在浏览器本地存储中。

## 技术选型

- 前端：React + Vite + TypeScript
- 后端：FastAPI
- 数据库：SQLite
- 认证方式：服务端生成 Bearer Token，前端通过 `Authorization: Bearer <token>` 调用接口
- 应用占用状态：后端保存 `app_usage_sessions`，前端轮询 + 心跳续期

## 数据模型

### users

保存用户、角色、启停状态和应用权限。

关键字段：

- `id`
- `name`
- `account`
- `password_salt`
- `password_hash`
- `role`: `admin | operator | viewer`
- `enabled`
- `app_permissions`: JSON 数组
- `created_at`
- `updated_at`
- `last_login_at`

### auth_sessions

保存登录 token。

关键字段：

- `token`
- `user_id`
- `client_id`
- `created_at`
- `last_active_at`
- `expires_at`

### app_usage_sessions

保存“某用户正在使用某应用”的运行态状态。

关键字段：

- `id`: `clientId:userId:appId`
- `app_id`
- `client_id`
- `user_id`
- `user_name`
- `started_at`
- `last_active_at`
- `confirmed_conflict`

后端会根据 `PORTAL_USAGE_TTL_SECONDS` 自动清理过期应用占用会话，默认 60 秒。

### audit_logs

保存登录、创建用户、修改用户、进入应用、离开应用等操作审计。

## API 设计

### 认证

- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`

### 用户管理

- `GET /api/users`
- `POST /api/users`
- `PATCH /api/users/{user_id}`

以上用户管理接口均需要管理员权限。

### 应用占用状态

- `GET /api/app-usage`
- `POST /api/app-usage/{app_id}/enter`
- `POST /api/app-usage/{app_id}/heartbeat`
- `DELETE /api/app-usage/{app_id}/leave`
- `DELETE /api/app-usage/leave-all`

进入应用时，后端会校验用户是否拥有应用权限。无权限用户即使绕过前端直接请求接口，也会被拒绝。

## 前端交互

1. 用户进入启动台，未登录则跳转 `/login`。
2. 登录成功后，前端从 `/api/auth/me` 获取当前用户。
3. 启动台轮询 `/api/app-usage`，展示四个应用是否有人使用。
4. 如果某应用已被其他用户使用，点击进入时弹出确认框。
5. 用户确认后进入应用，前端调用 `/api/app-usage/{app_id}/enter`。
6. 进入应用后，前端定时调用 heartbeat 刷新占用状态。
7. 用户离开应用、退出登录或关闭页面时，前端尽量调用 leave；即使异常关闭，后端也会通过 TTL 自动清理。

## 后续可扩展方向

当前结构已经为复杂鉴权和多用户功能预留边界，后续可以逐步扩展：

- 把 Bearer Token 替换为 JWT 或服务端 Session + Cookie。
- 引入 RBAC，拆分角色、权限点、菜单权限、接口权限。
- 引入组织/租户表，实现多部门、多项目隔离。
- 把 SQLite 替换为 PostgreSQL/MySQL。
- 使用 WebSocket 或 SSE 推送应用占用状态，减少前端轮询。
- 增加密码策略、登录失败锁定、审计检索、管理员操作审批。
- 接入统一身份认证，例如 OAuth2、OIDC、LDAP、企业微信/钉钉登录。
