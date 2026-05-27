# Stage 12-A: 前端公共包沉淀 Spec

## 1. 背景

当前 `apps/web` 已统一承载 Portal 和四个业务页面，但 `packages/ui`、`packages/api_client`、`packages/shared_types` 仍是占位。业务页面中还存在 legacy 组件、legacy 样式和模块内 API client。此阶段目标是沉淀稳定公共能力，而不是重做全部页面。

## 2. 目标

- 将稳定的 API client、错误处理、鉴权 token 注入、SSE/NDJSON 工具沉淀到 `packages/api_client`。
- 将可复用 UI 元素沉淀到 `packages/ui`。
- 将跨模块共享类型沉淀到 `packages/shared_types`。
- 保持 `apps/web` 视觉和交互一致，不引入新设计问题。

## 3. 允许做

- 抽取已经在 `apps/web` 中验证稳定的代码。
- 为公共包增加 build/typecheck/test 脚本。
- 在 `apps/web` 中逐步替换公共 API client 和共享类型。
- 抽取通用组件，例如按钮、输入、弹窗、Toast、Loading、错误页、权限占位、文件上传、任务进度。
- 保留模块内部复杂业务组件，避免过早抽象。

## 4. 禁止做

- 不为了抽公共包而重写业务页面。
- 不把业务专属 UI 强行抽成通用组件。
- 不引入新的大型 UI 框架，除非已有明确设计系统和迁移计划。
- 不改变路由、权限、认证或业务 API。
- 不做大面积视觉重设计。
- 不破坏已有 Figma/设计原则和现有视觉语言。

## 5. UI 设计约束

- 优先复用当前 `apps/web` 视觉语言和布局密度。
- 工具按钮优先使用图标和 tooltip。
- 表单、上传、任务进度、错误状态必须清晰可恢复。
- 文本不得溢出容器，移动端和桌面端都要检查。
- 页面不能引入卡片套卡片、装饰性渐变球或无业务意义的大 hero。
- 业务工具界面应保持高信息密度、可扫描、可重复操作。

## 6. 技术约束

- 公共包必须有明确导出边界，不能从 `apps/web/src` 反向 import。
- 公共 API client 不应硬编码业务模块路径，应支持 baseUrl、token provider、错误处理、stream parser。
- 共享类型必须避免与后端实际响应漂移，必要时增加类型测试或样例。
- 迁移应按模块小步替换，每次替换后跑 build。

## 7. 推荐抽取顺序

1. `packages/api_client`：基础 request、error、token header、SSE/NDJSON parser。
2. `packages/shared_types`：Portal user、runtime app、module、job、file、common envelope。
3. `packages/ui`：基础按钮、输入、弹窗、Loading、Empty、Error、上传、进度。
4. 逐步替换 `apps/web` 中重复实现。

## 8. 验收标准

- `npm --prefix apps/web run build` 通过。
- 公共包自身 typecheck/build 通过。
- `apps/web` 不再重复维护多个相似 API client。
- 至少一个业务模块使用公共 API client。
- 至少一组通用 UI 组件被 Portal 和一个业务模块复用。
- UI 回归确认无布局错位、文字溢出、交互阻塞。

## 9. 回退策略

- 抽取前保留原模块内实现，先通过 adapter 使用公共包。
- 如公共包引入问题，可单模块切回本地实现。
- 不允许为回退复制更多重复代码，回退后应记录修复项。

## 10. 完成定义

- 三个公共前端包不再是占位。
- 公共 API client、基础 UI、共享类型形成稳定使用样例。
- 后续页面改造有明确组件和类型基座。
