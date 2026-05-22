# 第 9-D：标书生成模块完整迁移

## 1. 当前阶段结论

第 9 阶段继续按模块迁移业务实现。本阶段完成 `bid-generator` 标书生成后端业务 API direct 迁移，`apps/api` 已直接承载 pipt-lite 的 health/config、脱敏/还原、项目 CRUD、需求提取、Dify workflow、进程内 TaskManager/SSE、文件预览下载、forge/export、knowledge/kb 和解析报告相关能力。

本阶段保持边界：

- 不接 MinIO。
- 不接 Celery / RQ / Dramatiq。
- 不新增统一任务表。
- 不改数据库结构，不新增 Alembic migration。
- 不改前端请求路径，不改标书生成前端业务逻辑。
- 不改变 Portal session / JWT。
- 不改变现有 Dify workflow 调用语义。
- 不改变 DocumentForge / forge-document 业务语义。
- 不影响 `competitor-analysis`、`rag-web-search`、`contract-review`。
- legacy 标书生成后端暂时保留作为回滚参考。

## 2. legacy API 审计范围

本阶段按源码审计了：

- `legacy/bid-generator/pipt-flask/main_lite.py`
- `legacy/bid-generator/pipt-flask/app/api_lite/project_routes.py`
- `legacy/bid-generator/pipt-flask/app/api_lite/routes.py`
- `legacy/bid-generator/pipt-flask/app/api_lite/task_routes.py`

legacy 入口为：

- `GET /health`
- `GET /`
- `app.include_router(api_router, prefix="/api")`
- `app.include_router(project_router, prefix="/api")`
- `app.include_router(task_router, prefix="/api")`

除根路径说明页外，标书生成业务 API 均已映射到 `/api/v1/bid-generator/...`。

## 3. 本阶段 direct API

以下接口已由 `apps/api` direct 处理：

- `GET /api/v1/bid-generator/health`
- `GET /api/v1/bid-generator/api/health`
- `GET /api/v1/bid-generator/api/config/workflow-status`
- `GET /api/v1/bid-generator/api/config/analysis-framework`
- `POST /api/v1/bid-generator/api/recognize`
- `POST /api/v1/bid-generator/api/desensitize`
- `POST /api/v1/bid-generator/api/desensitize/batch`
- `GET /api/v1/bid-generator/api/entities`
- `POST /api/v1/bid-generator/api/restore`
- `GET /api/v1/bid-generator/api/config/template`
- `DELETE /api/v1/bid-generator/api/config/template`
- `PUT /api/v1/bid-generator/api/config/template`
- `PUT /api/v1/bid-generator/api/config/global`
- `POST /api/v1/bid-generator/api/config/template/generate`
- `GET /api/v1/bid-generator/api/projects`
- `POST /api/v1/bid-generator/api/projects`
- `GET /api/v1/bid-generator/api/projects/{project_id}`
- `PUT /api/v1/bid-generator/api/projects/{project_id}`
- `PATCH /api/v1/bid-generator/api/projects/{project_id}`
- `DELETE /api/v1/bid-generator/api/projects/{project_id}`
- `GET /api/v1/bid-generator/api/projects/{project_id}/mappings`
- `POST /api/v1/bid-generator/api/projects/batch`
- `POST /api/v1/bid-generator/api/projects/extract`
- `POST /api/v1/bid-generator/api/projects/extract-stream`
- `GET /api/v1/bid-generator/api/projects/pdf/{project_id}`
- `GET /api/v1/bid-generator/api/extracted-images/by-hash/{image_hash}`
- `GET /api/v1/bid-generator/api/extracted-images/{filename}`
- `POST /api/v1/bid-generator/api/projects/upload-pdf`
- `POST /api/v1/bid-generator/api/bid-attachment/extract`
- `GET /api/v1/bid-generator/api/bid-attachment/test-locators`
- `GET /api/v1/bid-generator/api/projects/{project_id}/doc-blocks`
- `POST /api/v1/bid-generator/api/projects/{project_id}/rebuild-locator`
- `GET /api/v1/bid-generator/api/projects/{project_id}/source-docx`
- `POST /api/v1/bid-generator/api/bid-attachment/extract-by-block`
- `POST /api/v1/bid-generator/api/bid-attachment/extract-by-block-docx`
- `DELETE /api/v1/bid-generator/api/projects/{project_id}/caches`
- `POST /api/v1/bid-generator/api/projects/re-extract`
- `POST /api/v1/bid-generator/api/projects/generate-outline`
- `POST /api/v1/bid-generator/api/projects/generate-content`
- `POST /api/v1/bid-generator/api/projects/generate-outline-stream`
- `POST /api/v1/bid-generator/api/projects/generate-content-stream`
- `POST /api/v1/bid-generator/api/projects/generate-attachment`
- `POST /api/v1/bid-generator/api/projects/build-scoring-table`
- `POST /api/v1/bid-generator/api/projects/fill-scoring-row`
- `POST /api/v1/bid-generator/api/projects/export-scoring-table`
- `POST /api/v1/bid-generator/api/projects/generate-blueprint`
- `POST /api/v1/bid-generator/api/projects/forge-document`
- `GET /api/v1/bid-generator/api/knowledge/documents`
- `POST /api/v1/bid-generator/api/knowledge/sync`
- `POST /api/v1/bid-generator/api/knowledge/sync/{doc_name}`
- `POST /api/v1/bid-generator/api/projects/analyze`
- `POST /api/v1/bid-generator/api/projects/{project_id}/analyze-node`
- `POST /api/v1/bid-generator/api/projects/{project_id}/analysis-report`
- `GET /api/v1/bid-generator/api/projects/{project_id}/analysis-report`
- `POST /api/v1/bid-generator/api/kb/sync`
- `GET /api/v1/bid-generator/api/kb/sync-status/{job_id}`
- `GET /api/v1/bid-generator/api/kb/sync-jobs`
- `POST /api/v1/bid-generator/api/projects/export-report`
- `POST /api/v1/bid-generator/api/tasks/start-outline`
- `POST /api/v1/bid-generator/api/tasks/start-extract`
- `POST /api/v1/bid-generator/api/tasks/start-content`
- `POST /api/v1/bid-generator/api/tasks/start-content-rewrite`
- `POST /api/v1/bid-generator/api/tasks/start-content-group`
- `POST /api/v1/bid-generator/api/tasks/start-group-review`
- `POST /api/v1/bid-generator/api/tasks/start-diagram`
- `POST /api/v1/bid-generator/api/tasks/{task_id}/cancel`
- `GET /api/v1/bid-generator/api/tasks/{task_id}/status`
- `GET /api/v1/bid-generator/api/tasks/{task_id}/progress`
- `POST /api/v1/bid-generator/api/tasks/start-analyze`

## 4. 仍 proxy 的范围

`ANY /api/v1/bid-generator/{path:path}` catch-all proxy 仍保留，主要用于：

- 未知路径兜底。
- 临时回滚。
- 避免前端未来新增路径立即 404。

当前 legacy `api_lite` 审计范围内的标书生成后端业务 API 均已 direct；proxy 不再是标书生成常规业务 API 的主路径。legacy `GET /` 只是服务说明页，不属于业务 API，本阶段不 direct。

## 5. legacy-compatible 响应说明

- 成功响应保持 legacy 原样，不强行包装为 `success/data`。
- 项目 CRUD 保持 legacy 字段、状态码和 204 删除语义。
- 业务错误继续使用 FastAPI legacy-compatible JSON，如 `{"detail": ...}`。
- `extract-stream`、`generate-outline-stream`、`generate-content-stream`、`projects/analyze`、`analyze-node` 和 `tasks/{task_id}/progress` 保持 `text/event-stream`。
- `tasks/start-*` 继续返回 `task_id`，`tasks/{task_id}/status` 和 progress SSE 继续按 legacy TaskManager 协议读取。
- PDF / DOCX / Excel / 图片下载继续保留 `Content-Type` 与 `Content-Disposition`。
- 未登录、无权限、平台层校验失败和代理自身错误仍返回统一平台 envelope。

## 6. 权限与安全边界

- 所有 direct routes 和 proxy routes 均复用 Portal session token。
- 所有 direct routes 和 proxy routes 均校验 `bid-generator` 权限。
- admin 默认允许，普通用户按 `core.user_app_permissions` 判断。
- 401 / 403 不 fallback。
- 无 token 或无权限时不会访问标书生成数据库、Dify、legacy backend 或文件系统。
- proxy 不转发 `Authorization`、`Cookie` 或 legacy `Set-Cookie`。
- Dify key / workflow key / Dataset key / `PIPT_DB_KEY` 不打印、不返回给前端。
- legacy 返回的 `/api/...` 资源路径保持原样，标书生成前端的 authenticated fetch / blob 层会按平台 `apiBaseUrl` 归一化访问，不把 Portal token 发给 legacy backend。

## 7. 实现方式

`apps/api` 在鉴权后 direct 加载 legacy `pipt-lite` 的 `app.api_lite` 子路由，并挂载到 `/api/v1/bid-generator/api`。这样前端路径保持不变，业务实现仍复用 legacy 的纯业务模块、Pydantic schema、PostgreSQL ORM、Dify 调用、DocumentForge 和 TaskManager。

由于 `apps/api` 自身包名和 legacy pipt-flask 包名都叫 `app`，实现没有把 `legacy/bid-generator/pipt-flask` 整体插入 `sys.path`，而是扩展当前 `app` 包的 `__path__` 来解析 `app.api_lite` 与 `app.extension` 子包，避免覆盖统一后端自身模块。

合同审查和标书生成都存在顶层 `src` 包名。实现仅在标书生成运行期扩展已加载 `src` 包的搜索路径，使 `src.forge`、`src.config`、`src.workflow`、`src.knowledge` 能解析到标书生成的 `gateway-out` / `dify-bridge`，不替换合同审查已加载的 `src` 模块。

## 8. 本地文件系统边界

- 继续使用 `legacy/bid-generator/data/pdf_cache/` 保存 PDF 预览缓存。
- 继续使用 `legacy/bid-generator/data/docx_cache/` 保存原始 DOCX 和定位恢复缓存。
- 继续使用 `legacy/bid-generator/data/raw_doc_cache/` 保存原文文本缓存。
- 继续使用 `legacy/bid-generator/data/extracted_images/` 保存图片预览和 forge 图片还原依赖。
- 继续使用 `legacy/bid-generator/data/projects/` 保存解析报告 JSON 镜像。
- 继续使用 `legacy/bid-generator/data/kb_sync_status/` 保存知识库同步状态 JSON。
- `legacy/bid-generator/data/templates/` 和 `legacy/bid-generator/data/knowledge_base/` 仍作为配置资产和业务资料保留。
- 不接 MinIO，不搬迁历史目录，不新增文件元数据表。

## 9. 任务与 Dify 边界

- 继续使用 legacy `TaskManager` memory 后端。
- 继续沿用 `task_id`、`status`、`progress` SSE、`partial_events` 和 cancel 协议。
- 不引入 Celery / RQ / Dramatiq，不新增统一任务表。
- Dify workflow API key、`DIFY_API_URL`、Dataset 配置和 Stop API 调用语义保持 legacy-compatible。
- Knowledge sync 仍按 legacy 方式启动本地 `sync_kb.py` 子进程并写 `kb_sync_status`。
- DocumentForge / forge-document 继续复用 `gateway-out` 的 DOCX 组装逻辑。

## 10. 验收方式

必跑命令：

```bash
/Volumes/samsang/program-engineering/尖兵/clover-platform/.venv/bin/python -m compileall -q /Volumes/samsang/program-engineering/尖兵/clover-platform/packages /Volumes/samsang/program-engineering/尖兵/clover-platform/scripts /Volumes/samsang/program-engineering/尖兵/clover-platform/alembic /Volumes/samsang/program-engineering/尖兵/clover-platform/apps/api /Volumes/samsang/program-engineering/尖兵/clover-platform/legacy/portal-launchpad/backend
/Volumes/samsang/program-engineering/尖兵/clover-platform/.venv/bin/python /Volumes/samsang/program-engineering/尖兵/clover-platform/scripts/preflight.py --only platform-api
/Volumes/samsang/program-engineering/尖兵/clover-platform/.venv/bin/python /Volumes/samsang/program-engineering/尖兵/clover-platform/scripts/dev.py --write-ports-only
```

接口 smoke test：

- 未登录访问 direct API 返回平台 401 envelope。
- 无 `bid-generator` 权限访问 direct API 返回平台 403 envelope。
- 有权限访问本阶段 direct API 返回 legacy-compatible 结构。
- 关闭 legacy bid-generator backend 后，本阶段 direct API 仍可用。
- `tasks/{task_id}/progress` 与各 stream 接口保持 SSE，不缓冲完整结果。
- PDF / DOCX / Excel / 图片资源通过 authenticated fetch / blob 或平台路径访问，并保留文件名。
- Dify key 未配置或上游错误时返回清晰业务错误，不 traceback。

## 11. 后续阶段建议

第 9-D 后可进入阶段收口或去 iframe / 统一前端路线评估。标书生成若未来需要多实例部署，必须专项评审 memory `TaskManager`、本地文件系统、Dify stop、SSE 重连和 `kb_sync_status` 文件状态。
