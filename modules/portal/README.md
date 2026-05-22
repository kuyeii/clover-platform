# modules/portal

## 模块当前状态

Portal 是统一入口、登录、用户管理、应用权限、运行时应用列表、应用占用状态和 feedback 的平台核心模块。当前业务前端仍在 `legacy/portal-launchpad`，第 10-A 不迁移真实页面。

## 后端状态

Portal 核心后端能力已在 `apps/api` 的 `/api/v1/core` 中作为主路径运行，包括 auth、users、app-usage、runtime apps、feedback 和 `/ws/core/app-usage`。legacy Portal 后端保留为回滚 / 兼容路径。

## 前端状态

当前正式入口仍是 `legacy/portal-launchpad`。`apps/web` 只提供登录页和工作台占位，不替代 legacy Portal。

## 后续迁移目标

第 10-B 优先迁移 Portal 登录、工作台、用户管理、统一布局和 token 管理，再评估 iframe 容器与 runtime apps 的迁移节奏。

## 关键风险点

- Portal session token 生命周期和退出语义。
- 用户管理权限和管理员能力。
- app-usage WebSocket 协议兼容。
- runtime apps 与 iframe auth bridge 的衔接。
- feedback 提交上下文、验证码和邮件发送链路。

## 验收重点

- 登录、登出、`me`、改密和用户管理行为保持兼容。
- 普通用户与管理员权限边界不回退。
- iframe auth bridge 不通过 URL 泄露 token。
- `legacy/portal-launchpad` 在迁移期间仍可作为回滚入口。
