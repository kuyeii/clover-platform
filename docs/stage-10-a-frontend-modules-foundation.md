# 第 10-A：统一前端与 modules 落位骨架初始化

## 1. 当前阶段结论

第 9 阶段已经完成四个业务模块后端迁移收口，`apps/api` 是当前主业务后端。第 10 阶段开始处理统一前端和业务模块边界，本阶段只完成基础落位：

- 建立 `apps/web` 最小 React / TypeScript / Vite 骨架。
- 明确 `modules` 目录作为业务模块边界说明目录。
- 新增统一路由占位、页面占位和 API client 骨架。
- 不迁移业务页面。
- 不去 iframe。
- 不删除 legacy 前端或 legacy 源码目录。
- 不修改 `apps/api` 业务逻辑。
- 不修改数据库结构，不新增 Alembic migration。

## 2. apps/web 定位

`apps/web` 是未来统一前端入口，后续会逐步承载：

- Portal 登录。
- 工作台。
- 用户管理。
- 模块页面。
- 统一布局。
- 统一 API client。

当前第 10-A 只提供骨架和占位页面，不替换 `legacy/portal-launchpad`。在 Portal 前端能力完成迁移前，`legacy/portal-launchpad` 仍是当前正式入口和回滚入口。

## 3. modules 定位

`modules` 是业务模块边界目录，当前不作为独立后端服务启动目录。统一后端主应用仍在 `apps/api`，不在本阶段强行把后端 router、service 或 legacy 业务实现搬入 `modules`。

当前 `modules` 优先沉淀：

- 模块说明。
- API 契约。
- 迁移清单。
- 前端迁移计划。
- 测试清单。
- 特殊资源说明。

后续每个模块迁移时，再按模块补充更细的契约、测试和资源说明。不建议现在把 `apps/api` 业务 service 强行搬到 `modules`，也不建议把 legacy 前端一次性搬入 `modules`。

推荐前端落位方案：

- 统一运行入口、路由和全局布局放在 `apps/web`。
- 可运行的统一前端页面优先放在 `apps/web/src/modules/<module>`。
- `modules/*/frontend` 仅在确有独立模块包、独立构建或资源隔离需求时再启用，并需要先补充模块级 README 约定。

## 4. 当前新增结构

`apps/web` 新增最小结构：

```text
apps/web/
  package.json
  index.html
  vite.config.ts
  tsconfig.json
  src/
    main.tsx
    App.tsx
    routes/
      index.tsx
    layouts/
      AppLayout.tsx
    pages/
      LoginPage.tsx
      WorkspacePage.tsx
      NotFoundPage.tsx
    modules/
      competitor-analysis/
        CompetitorAnalysisPage.tsx
      rag/
        RagPage.tsx
      contract-review/
        ContractReviewPage.tsx
      bid-generator/
        BidGeneratorPage.tsx
    shared/
      api/
        client.ts
      auth/
        token.ts
      components/
        PlaceholderCard.tsx
      config/
        modules.ts
    styles/
      global.css
```

`modules` 新增或更新说明：

```text
modules/
  README.md
  portal/README.md
  competitor_analysis/README.md
  rag_qa/README.md
  contract_review/README.md
  bid_generator/README.md
```

## 5. 路由规划

当前 `apps/web` 只提供占位路由：

- `/`
- `/login`
- `/workspace`
- `/modules/competitor-analysis`
- `/modules/rag`
- `/modules/contract-review`
- `/modules/bid-generator`

`/` 当前指向统一工作台占位。正式登录、权限、用户管理和模块业务 UI 从后续阶段开始迁移。

## 6. API client 规划

`apps/web/src/shared/api/client.ts` 提供统一 API client 骨架：

- 默认 `baseURL` 为 `/api/v1`。
- 支持通过 `VITE_API_BASE_URL` 或构造参数覆盖。
- 支持 Bearer token 注入。
- 支持 JSON `GET`、`POST`、`PATCH`、`DELETE`。
- 提供统一错误对象占位，包含 status、code、message、details、requestId。
- 当前不保存长期 token。
- 当前不接入真实登录逻辑。
- 当前不迁移 legacy 业务 service。

`apps/web/src/shared/auth/token.ts` 只提供内存 token 占位方法。真实 token 生命周期、刷新、退出和跨页面恢复将在第 10-B 迁移 Portal 登录时统一设计。

## 7. 后续迁移顺序

建议后续阶段：

- 10-B：Portal 登录、工作台、用户管理迁入 `apps/web`。
- 10-C：竞对分析前端迁入。
- 10-D：RAG 问答前端迁入。
- 10-E：合同审查前端迁入。
- 10-F：标书生成前端迁入。
- 10-G：iframe 与 legacy 前端冻结评估。

每个迁移阶段都应先确认 legacy 前端依赖、API 契约、文件下载 / 上传、stream 协议、权限和回滚路径，再迁业务页面。

## 8. 本阶段禁止事项

本阶段不做：

- 不迁移 Portal 登录真实逻辑。
- 不迁移用户管理真实逻辑。
- 不迁移四个业务前端页面。
- 不删除 iframe。
- 不删除 legacy 前端。
- 不删除 legacy 后端。
- 不修改 `apps/api` 业务 API 行为。
- 不接 MinIO。
- 不引入 Celery / RQ。
- 不修改数据库结构。
- 不新增 Alembic migration。
- 不修改 `scripts/dev.py` 默认启动策略。

## 9. 验收方式

本阶段验证命令：

```bash
python -m compileall -q packages scripts alembic apps/api legacy/portal-launchpad/backend
python scripts/preflight.py --only platform-api
python scripts/dev.py --write-ports-only
npm --prefix legacy/portal-launchpad run build
npm --prefix apps/web install
npm --prefix apps/web run build
git diff -- legacy/portal-launchpad/vite.config.d.ts
git add -n . | grep -E "node_modules|dist|build|__pycache__|\\.DS_Store|\\.tsbuildinfo|\\.sqlite|\\.sqlite3|\\.db|\\.env$|\\.log|\\.codex|error\\.txt|runtime/ports.json" || echo "OK: clean dry-run"
```

`legacy/portal-launchpad/vite.config.d.ts` 必须无输出，`runtime/ports.json`、`node_modules`、`dist`、`build` 和 lockfile 策略外产物不得提交。
