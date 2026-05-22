# 第 10-B：Portal 能力与竞对分析前端迁入 apps/web

## 1. 当前阶段结论

`apps/web` 开始成为新的统一前端入口候选。本阶段已将 Portal 平台能力迁入 `apps/web`，并将竞对分析真实前端页面迁入 `apps/web/src/modules/competitor-analysis`。

本阶段结论：

- Portal 登录、会话恢复、工作台、用户管理、runtime apps、app usage、feedback 和 iframe 容器已迁入 `apps/web`。
- 竞对分析真实页面已迁入 `apps/web`，不再依赖 legacy iframe 页面作为主体验。
- RAG 问答、合同审查、标书生成仍通过 iframe 接入。
- `legacy/portal-launchpad` 和 `legacy/company-competitors-analysis` 继续保留为回滚入口。
- 不修改 `apps/api` 业务 API 行为。
- 不修改数据库结构，不新增 Alembic migration。

## 2. 本阶段迁移范围

已迁入 Portal 能力：

- 登录和登录失败提示。
- 基于 `/api/v1/core/auth/me` 的会话恢复。
- 退出登录和前端 token 清理。
- 统一工作台和四个模块入口。
- 基于 `appPermissions` 的模块权限控制，admin 默认可访问全部模块。
- 用户列表、新建用户、编辑用户、启用停用、权限配置、重置密码和当前用户改密。
- `/api/v1/core/runtime/apps` 运行时应用读取，失败后延迟重试一次。
- `/api/v1/core/app-usage` 与 `/ws/core/app-usage` 应用占用状态。
- ticket / feature request 的 submission context、captcha 和 multipart submit。
- RAG / 合同审查 / 标书生成 iframe 容器和 auth bridge。

已迁入竞对分析能力：

- 主页面、企业输入和企业名称校验。
- 自动匹配和精确匹配模式。
- `analysis/stream` NDJSON 流式分析展示。
- 竞品列表、企业详情、对比报告和评分结果展示。
- 历史记录列表、详情打开和删除。
- workflow validate/company-name/company-detail/compare-report/score service 封装。

## 3. 未迁移范围

本阶段不迁移：

- RAG 真实页面。
- 合同审查真实页面。
- 标书生成真实页面。
- 去 iframe。
- legacy 前端删除。
- `apps/api` API 改造。
- 数据库改造。
- MinIO、Celery/RQ 或统一任务表。

## 4. apps/web 结构

当前关键结构：

```text
apps/web/src/
  App.tsx
  routes/
  layouts/
  pages/
    LoginPage.tsx
    WorkspacePage.tsx
    UserManagementPage.tsx
    FeedbackPage.tsx
  modules/
    competitor-analysis/
      CompetitorAnalysisPage.tsx
      components/
      services/
    iframe/
      ModuleFramePage.tsx
      iframeBridge.ts
    rag/
    contract-review/
    bid-generator/
  shared/
    api/
    auth/
    runtime/
    components/
    config/
    types/
```

`shared/api/client.ts` 默认 base URL 是 `/api/v1`，支持 `VITE_API_BASE_URL` 覆盖。Portal core API 使用 `/api/v1/core/**`，竞对分析使用 `/api/v1/competitor-analysis/**`。

## 5. Portal 能力说明

登录调用 `POST /api/v1/core/auth/login`，成功后进入 `/workspace`。刷新页面时从 sessionStorage 恢复 token，并通过 `GET /api/v1/core/auth/me` 获取当前用户；401 会清理会话并回登录。

工作台展示四个模块：

- 竞对分析：进入 `apps/web` 原生页面。
- RAG 问答：iframe。
- 合同审查：iframe。
- 标书生成：iframe。

用户管理调用 `/api/v1/core/users` 和 `/api/v1/core/auth/password`。管理员可管理全部用户，普通用户仅维护自身账号信息和密码，权限边界沿用 `apps/api` 现有实现。

app usage 调用 `/api/v1/core/app-usage`，WebSocket 使用 `/ws/core/app-usage`。WebSocket 断开会延迟重连，页面也保留 HTTP heartbeat fallback。

feedback 调用 `/api/v1/core/tickets/**` 和 `/api/v1/core/feature-requests/**`，保留 captcha cookie credentials 和 multipart 附件提交。

## 6. 竞对分析迁移说明

竞对分析前端现在直接调用：

- `/api/v1/competitor-analysis/api/health`
- `/api/v1/competitor-analysis/api/history`
- `/api/v1/competitor-analysis/api/history/{id}`
- `/api/v1/competitor-analysis/api/analysis`
- `/api/v1/competitor-analysis/api/analysis/stream`
- `/api/v1/competitor-analysis/api/workflows/validate`
- `/api/v1/competitor-analysis/api/workflows/company-name-validate`
- `/api/v1/competitor-analysis/api/workflows/company-detail`
- `/api/v1/competitor-analysis/api/workflows/compare-report`
- `/api/v1/competitor-analysis/api/workflows/score`

`analysis/stream` 保持 NDJSON 逐行解析，支持 `analysis_started`、`competitors_ready`、`target_detail_ready`、`competitor_detail_ready`、`compare_report_ready`、`score_ready`、`analysis_finished` 和 `analysis_error`。前端不会等待完整结果后一次性渲染。

历史记录保持 legacy-compatible 响应解析：列表读取 `items`，详情读取 `item`，删除后刷新列表。

## 7. iframe 保留说明

RAG、合同审查和标书生成仍通过 iframe 接入，原因是本阶段只迁 Portal 能力和竞对分析真实页面，避免一次性改变三个复杂业务前端的上传、下载、SSE、编辑器和本地文件语义。

iframe URL 来自 runtime apps。auth bridge 通过 postMessage 传递 `{ token, clientId, apiBaseUrl }`，不把 token 放到 URL。父页面只响应可信 iframe origin，发送消息时 targetOrigin 使用 iframe origin。

## 8. 安全边界

- token 不进入 URL query/hash。
- 不 `console.log` token。
- token 只保存在内存和 sessionStorage，用于刷新恢复；不写长期 localStorage。
- API client 自动携带 `Authorization: Bearer <token>`。
- 401 会统一清理前端会话。
- iframe postMessage 校验 `event.origin` 和 `event.source`。
- iframe targetOrigin 使用可信 iframe origin，不使用 `"*"`。

## 9. 回滚策略

- `legacy/portal-launchpad` 仍保留，可继续作为 Portal 回滚入口。
- `legacy/company-competitors-analysis` 仍保留，可继续作为竞对分析回滚页面。
- 本阶段不删除 legacy 目录，不删除 iframe，不修改 legacy 后端。

## 10. 验收方式

命令验收：

```bash
python -m compileall -q packages scripts alembic apps/api legacy/portal-launchpad/backend
python scripts/preflight.py --only platform-api
python scripts/dev.py --write-ports-only
npm --prefix legacy/portal-launchpad run build
npm --prefix legacy/company-competitors-analysis run build
npm --prefix apps/web run build
```

手工验收重点：

- `/login` 可显示，登录后进入 `/workspace`。
- 刷新后可恢复用户状态，token 失效后回到 `/login`。
- 工作台显示四个模块入口，权限控制正确。
- 竞对分析进入 apps/web 原生页面。
- RAG / 合同审查 / 标书生成进入 iframe。
- 用户管理、runtime apps、app usage 和 feedback 可加载。
- 竞对分析 history、detail、delete、workflow validate、analysis 和 stream 可用。
- iframe auth bridge 不泄露 token。

安全自查：

```bash
grep -RIn "console\\.log.*token\\|localStorage.*token\\|token=.*\\|Authorization\\|postMessage\\|targetOrigin\\|clover:auth" apps/web/src legacy/portal-launchpad/src legacy/company-competitors-analysis/src | head -500
git diff -- legacy/portal-launchpad/vite.config.d.ts
git add -n . | grep -E "node_modules|dist|build|__pycache__|\\.DS_Store|\\.tsbuildinfo|\\.sqlite|\\.sqlite3|\\.db|\\.env$|\\.log|\\.codex|error\\.txt|runtime/ports.json" || echo "OK: clean dry-run"
```

## 11. 后续阶段建议

第 10-C 建议迁入 RAG 前端真实页面，重点处理 chat SSE、knowledge 上传下载、会话列表同步和 Markdown 渲染。本阶段不展开 RAG 迁移细节。
