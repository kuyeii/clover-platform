# 第 9-B：RAG 问答模块完整迁移

## 1. 当前阶段结论

第 9 阶段按模块迁移业务实现。本阶段完成 `rag-web-search` 主要业务 API direct 迁移，`apps/api` 已直接承载 RAG health、sessions、conversations、chat stream 和 knowledge Dataset 能力。

本阶段保持边界：

- 不接 MinIO。
- 不接 Celery / RQ / Dramatiq。
- 不新增统一任务表。
- 不改数据库结构，不新增 Alembic migration。
- 不改前端请求路径，不改 RAG 前端业务逻辑。
- 不影响 `competitor-analysis`、`contract-review`、`bid-generator`。
- legacy RAG 后端暂时保留作为回滚参考。

## 2. 本阶段 direct API

以下接口已由 `apps/api` direct 处理：

- `GET /api/v1/rag/api/v1/health`
- `POST /api/v1/rag/api/v1/sessions`
- `GET /api/v1/rag/api/v1/conversations`
- `PUT /api/v1/rag/api/v1/conversations/sync`
- `POST /api/v1/rag/api/v1/chat/stream`
- `GET /api/v1/rag/api/v1/knowledge/documents`
- `POST /api/v1/rag/api/v1/knowledge/documents/create-by-text`
- `POST /api/v1/rag/api/v1/knowledge/documents/create-by-file`
- `GET /api/v1/rag/api/v1/knowledge/documents/{document_id}/detail`
- `GET /api/v1/rag/api/v1/knowledge/documents/{document_id}/download`
- `DELETE /api/v1/rag/api/v1/knowledge/documents/{document_id}`

## 3. 仍 proxy 的范围

`ANY /api/v1/rag/{path:path}` catch-all proxy 仍保留，主要用于：

- 未知路径兜底。
- 临时回滚。
- 避免前端未来新增路径立即 404。

当前 legacy 审计范围内的主要 RAG 业务 API 均已 direct；proxy 不再是 RAG 常规业务 API 的主路径。

## 4. legacy-compatible 响应说明

- 成功响应保持 legacy 原样，不强行包装为 `success/data`。
- sessions 返回 `{"session_id": "..."}`。
- conversations 返回 `{"conversations": [...], "activeConversationId": null}`。
- conversations sync 成功继续返回 204。
- chat stream 保持 `text/event-stream`，SSE 帧仍为 `data: {...}\n\n`。
- knowledge list/create/detail/download/delete 保持 legacy 字段与状态码语义。
- 业务错误尽量保持 `{"detail": "..."}` 和原状态码。
- 未登录、无权限、平台层数据库错误仍返回统一平台 envelope。

## 5. 权限与安全边界

- 所有 direct routes 和 proxy routes 均复用 Portal session token。
- 所有 direct routes 和 proxy routes 均校验 `rag-web-search` 权限。
- admin 默认允许，普通用户按 `core.user_app_permissions` 判断。
- 401 / 403 不 fallback。
- 无权限时不会访问 RAG 数据库、配置、legacy backend、Dify 或文件系统。
- proxy 不转发 `Authorization`、`Cookie` 或 legacy `Set-Cookie`。
- Dify key / Dataset key 不打印、不返回给前端。

## 6. Dify Chat 处理边界

`apps/api` 直接调用原有 Dify Chat / workflow SSE。配置读取沿用 `config/workflows.yaml` 中 `rag_qa.workflow` 的 env 名映射，并兼容根目录 `.env`、legacy RAG backend `.env` 和进程环境变量。

`UPSTREAM_URL` 或 `UPSTREAM_BEARER_TOKEN` 未配置时，chat stream 返回兼容 SSE error event。Dify 上游 HTTP 错误、超时和连接错误会转换为清晰业务错误，不让 `apps/api` traceback 暴露给前端。流式过程中仍只转发上游 `event=text_chunk` 的 `data.text`，并在完成后保存 `rag.chat_turns`，同时把 request id、allow_search、duration 和可识别的上游 conversation/message/task id 写入 `meta`。

## 7. Knowledge Dataset 处理边界

`apps/api` 直接调用 Dify Dataset API。配置读取沿用 `config/workflows.yaml` 中 `rag_qa.dataset` 的 env 名映射，并兼容 `DIFY_API_BASE_URL`、`DIFY_DATASET_API_KEY`、`DIFY_DEFAULT_DATASET_ID`。

上传仍使用本地临时文件，再通过 multipart 转发 Dify `create-by-file`；上传完成或失败后都会删除临时文件。不接 MinIO，不保存 Dataset key，不把文档内容同步到 PostgreSQL。Dify Dataset 404、502、timeout 或 key 缺失均返回清晰业务错误。

## 8. stream 迁移说明

`POST /api/v1/rag/api/v1/chat/stream` 已由 `apps/api` direct 承载：

- 使用 `StreamingResponse`。
- `Content-Type` 为 `text/event-stream`。
- 保持 legacy 事件类型：`session`、`delta`、`done`、`error`。
- 不缓冲完整回答后一次性返回。
- 前端无需修改。
- 客户端断开连接时停止生成器，避免断流 traceback。
- Dify 错误通过兼容 `error` event 返回。

## 9. 验收方式

必跑命令：

```bash
/Volumes/samsang/program-engineering/尖兵/clover-platform/.venv/bin/python -m compileall -q /Volumes/samsang/program-engineering/尖兵/clover-platform/packages /Volumes/samsang/program-engineering/尖兵/clover-platform/scripts /Volumes/samsang/program-engineering/尖兵/clover-platform/alembic /Volumes/samsang/program-engineering/尖兵/clover-platform/apps/api /Volumes/samsang/program-engineering/尖兵/clover-platform/legacy/portal-launchpad/backend
/Volumes/samsang/program-engineering/尖兵/clover-platform/.venv/bin/python /Volumes/samsang/program-engineering/尖兵/clover-platform/scripts/preflight.py --only platform-api
/Volumes/samsang/program-engineering/尖兵/clover-platform/.venv/bin/python /Volumes/samsang/program-engineering/尖兵/clover-platform/scripts/dev.py --write-ports-only
npm --prefix /Volumes/samsang/program-engineering/尖兵/clover-platform/legacy/portal-launchpad run build
```

接口 smoke test：

- 未登录访问 direct API 返回平台 401 envelope。
- 无 `rag-web-search` 权限访问 direct API 返回平台 403 envelope。
- 有权限访问本阶段 direct API 返回 legacy-compatible 结构。
- 关闭 legacy RAG backend 后，本阶段 direct API 仍可用。
- `chat/stream` 保持 SSE 流式输出，不缓冲完整结果。
- Dify Chat key 未配置时返回 SSE error event，不 traceback。
- knowledge list/upload/delete/detail/download 保持 legacy-compatible。
- Dataset key 未配置或 Dify Dataset 502 时返回清晰错误，不 traceback。

## 10. 后续阶段建议

第 9-C 建议进入合同审查模块迁移，重点评估审查任务、文件产物、DOCX 下载、AI 改写和本地 `data/runs` 边界。本阶段不展开合同审查迁移细节。
