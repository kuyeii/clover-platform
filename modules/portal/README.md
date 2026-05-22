# modules/portal

## 模块当前状态

Portal 是统一入口、登录、用户管理、应用权限、运行时应用列表、应用占用状态和 feedback 的平台核心模块。第 10-B 后，Portal 前端能力已迁入 `apps/web`。

## 后端状态

Portal 核心后端能力已在 `apps/api` 的 `/api/v1/core` 中作为主路径运行，包括 auth、users、app-usage、runtime apps、feedback 和 `/ws/core/app-usage`。legacy Portal 后端保留为回滚 / 兼容路径。

## 前端状态

`apps/web` 已承载登录、会话恢复、工作台、模块入口、用户管理、runtime apps、app usage、feedback 和 iframe 容器。`legacy/portal-launchpad` 当前作为回滚入口继续保留，不删除。

## 后续迁移目标

后续待迁移项主要是进一步补齐生产级反向代理部署说明、视觉细节回归和 iframe 逐步替换后的 Portal 导航策略。RAG、合同审查和标书生成真实页面迁入前，Portal 仍需保留 iframe 容器。

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
