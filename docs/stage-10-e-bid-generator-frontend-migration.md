# 第 10-E：标书生成前端迁入 apps/web

## 1. 当前阶段结论

标书生成真实前端页面已迁入 `apps/web`。第 10-E 后：

- Portal、竞对分析、RAG、合同审查、标书生成已在 `apps/web` 承载真实前端能力。
- 标书生成工作台入口进入 `apps/web/src/modules/bid-generator` 原生页面，不再以 iframe 作为主体验。
- `legacy/bid-generator/frontend-web`、iframe 容器和 `config/apps.yaml` iframe 配置继续保留为回滚入口。
- 本阶段不修改 `apps/api` 业务 API 行为。
- 本阶段不修改数据库结构，不新增 Alembic migration。

## 2. 根因与修复

第 9-D 已完成标书生成后端 direct API 迁移，`apps/api` 已承载 health/config、项目 CRUD、文件解析、SSE task、forge/export、knowledge/kb 等能力。但第 10-D 后 `apps/web/src/modules/bid-generator/BidGeneratorPage.tsx` 仍只渲染 `ModuleFramePage`，工作台和侧栏也将标书生成标记为 iframe。

本阶段修复方式：

- 新增 `apps/web/src/modules/bid-generator/services/bidGeneratorApi.ts`，使用统一 `apiClient` 和鉴权 fetch 调用 `/api/v1/bid-generator/**`。
- 新增 `apps/web/src/modules/bid-generator/types.ts`，沉淀项目、解析、任务、知识库和下载类型。
- 将 `BidGeneratorPage` 替换为原生工作台，覆盖项目、解析、生成、预览导出、knowledge/kb 和脱敏还原入口。
- 将 `WorkspacePage` 与 `AppLayout` 中的标书生成状态切换为原生页面。

## 3. 本阶段迁移范围

已迁入 `apps/web/src/modules/bid-generator`：

- 标书生成主页面。
- 项目列表、创建、删除。
- 项目详情概览、状态、需求、解析节点、生成内容缓存展示。
- 项目 mappings 读取。
- 招标文件上传和 `extract-stream` 解析。
- 解析报告后台任务 `tasks/start-analyze`、`tasks/{task_id}/progress` 和 cancel。
- 大纲后台任务 `tasks/start-outline` 与流式 `generate-outline-stream`。
- 正文流式 `generate-content-stream`。
- 实体映射、脱敏和还原。
- PDF 鉴权 blob 预览。
- extracted images 鉴权 blob 预览。
- `source-docx`、`forge-document`、`export-report`、`export-scoring-table` 下载。
- `knowledge/documents`、`knowledge/sync`、`kb/sync`、`kb/sync-jobs`。
- loading、empty、error、notice 和权限状态。

## 4. 未迁移范围

本阶段不做：

- 不删除 legacy 标书生成前端。
- 不删除 iframe 代码或配置。
- 不把 legacy Tiptap / DnD / docx-preview 依赖整体引入 `apps/web`。
- 不修改 `apps/api` 标书生成业务 API。
- 不修改 legacy 后端或 legacy 标书生成前端源码。
- 不改数据库结构。
- 不接 MinIO。
- 不接 Celery/RQ。

## 5. API 与鉴权说明

标书生成原生页面直接调用：

- `GET /api/v1/bid-generator/health`
- `GET /api/v1/bid-generator/api/config/workflow-status`
- `GET /api/v1/bid-generator/api/config/analysis-framework`
- `GET /api/v1/bid-generator/api/entities`
- `GET/POST/PUT/PATCH/DELETE /api/v1/bid-generator/api/projects`
- `GET /api/v1/bid-generator/api/projects/{project_id}/mappings`
- `POST /api/v1/bid-generator/api/projects/extract-stream`
- `POST /api/v1/bid-generator/api/tasks/start-analyze`
- `POST /api/v1/bid-generator/api/tasks/start-outline`
- `GET /api/v1/bid-generator/api/tasks/{task_id}/progress`
- `POST /api/v1/bid-generator/api/tasks/{task_id}/cancel`
- `POST /api/v1/bid-generator/api/projects/generate-outline-stream`
- `POST /api/v1/bid-generator/api/projects/generate-content-stream`
- `POST /api/v1/bid-generator/api/desensitize`
- `POST /api/v1/bid-generator/api/restore`
- `GET /api/v1/bid-generator/api/projects/pdf/{project_id}`
- `GET /api/v1/bid-generator/api/projects/{project_id}/source-docx`
- `GET /api/v1/bid-generator/api/extracted-images/**`
- `POST /api/v1/bid-generator/api/projects/forge-document`
- `POST /api/v1/bid-generator/api/projects/export-report`
- `POST /api/v1/bid-generator/api/projects/export-scoring-table`
- `GET/POST /api/v1/bid-generator/api/knowledge/**`
- `GET/POST /api/v1/bid-generator/api/kb/**`

普通 JSON 请求使用统一 `apiClient`。SSE 和 blob 下载使用同一 token 来源和 `X-Portal-Client-Id`，不把 token 放入 URL，不依赖 iframe auth bridge，不手动破坏 multipart boundary。

## 6. 回滚策略

`legacy/bid-generator/frontend-web` 未删除、未修改业务源码，仍可独立 build。`config/apps.yaml` 中标书生成 iframe 配置继续保留。若需要临时回滚，可按 legacy iframe 入口对照或恢复工作台跳转策略；`apps/api` direct API 不受影响。

## 7. 验收方式

命令验收：

```bash
.venv/bin/python -m compileall -q packages scripts alembic apps/api legacy/portal-launchpad/backend
.venv/bin/python scripts/preflight.py --only platform-api
.venv/bin/python scripts/dev.py --write-ports-only
npm --prefix legacy/portal-launchpad run build
npm --prefix legacy/bid-generator/frontend-web run build
npm --prefix apps/web run build
git diff --check
```

手工验收重点：

- `/login` 可显示，登录后进入 `/workspace`。
- 工作台显示标书生成是原生页面。
- 点击标书生成进入 `/modules/bid-generator`，不是 iframe。
- 无权限时显示无权限提示。
- 项目列表 / 新建 / 删除可用。
- 文件上传解析可收到 stream 进度，结果写回项目。
- 解析报告任务、大纲任务、正文流式生成可显示进度，任务可取消。
- PDF / 图片预览通过鉴权 blob 加载。
- source DOCX、解析报告 PDF、评分表 Excel、forge DOCX 通过鉴权 blob 下载。
- knowledge/kb 列表和同步任务入口可用。
- token 不进入 URL，退出登录后 token 清理。
