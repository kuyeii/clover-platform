# apps/web

`apps/web` 是 Clover Platform 未来统一前端入口。

当前处于第 10-A 骨架状态，只承载最小 React / TypeScript / Vite 工程、统一布局占位、路由占位、模块占位页和统一 API client 骨架。它现在不替代 `legacy/portal-launchpad`，也不迁移四个业务前端页面。

## 当前定位

- 未来承载 Portal 登录、工作台、用户管理、模块页面、统一布局和统一 API client。
- 当前只提供 `/login`、`/workspace` 和四个模块占位路由。
- 当前不接入真实登录逻辑，不保存长期 token。
- 当前不复制 legacy 前端 service，不调用真实业务 API。
- 当前不删除 iframe，不替换 legacy Portal。

## 安装依赖

```bash
npm --prefix apps/web install
```

当前仓库没有根级 npm workspace，`apps/web` 作为独立 Vite 应用安装和构建。

## 本地开发

```bash
npm --prefix apps/web run dev
```

默认 Vite dev server 端口为 `5300`。当前 `scripts/dev.py` 仍按第 9-E 策略启动 `legacy/portal-launchpad` 和四个业务 iframe 前端，不会默认启动 `apps/web`。

## 构建

```bash
npm --prefix apps/web run build
```

构建产物位于 `apps/web/dist`，该目录是本地产物，不提交 Git。

## 后续迁移顺序

- 10-B：Portal 登录、工作台、用户管理迁入 `apps/web`。
- 10-C：竞对分析前端迁入。
- 10-D：RAG 问答前端迁入。
- 10-E：合同审查前端迁入。
- 10-F：标书生成前端迁入。
- 10-G：iframe 与 legacy 前端冻结评估。
