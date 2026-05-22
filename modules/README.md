# modules

`modules` 是 Clover Platform 的业务模块边界目录。

当前第 10-A 阶段，`modules` 不作为独立后端服务启动目录，也不承载必须运行的业务代码。统一后端主应用仍在 `apps/api`，统一前端入口逐步落位到 `apps/web`。

## 当前职责

当前 `modules` 用于沉淀：

- 模块说明。
- API 契约。
- 迁移清单。
- 前端迁移计划。
- 测试清单。
- 特殊资源说明。

## 当前不建议做

- 不建议现在把 `apps/api` 业务 service 强行搬到 `modules`。
- 不建议现在把 legacy 前端一次性搬入 `modules`。
- 不建议把 `modules/*` 设计成独立后端启动入口。
- 不建议在没有专项阶段计划时调整数据库、任务队列或对象存储边界。

## 推荐迁移方式

- 后端主路径继续由 `apps/api` 承载。
- 可运行的统一前端页面优先放在 `apps/web/src/modules/<module>`。
- `modules/*` 先维护模块边界、契约和迁移记录。
- 如果后续确实需要 `modules/*/frontend` 或 `modules/*/backend`，应在对应阶段先补充模块 README 约定，再迁移代码。

当前模块：

- `portal`
- `competitor_analysis`
- `rag_qa`
- `contract_review`
- `bid_generator`
