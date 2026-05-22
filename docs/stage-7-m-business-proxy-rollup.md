# 第 7-M 阶段：业务代理与 iframe auth bridge 总体验收

## 1. 总体结论

第 7-M 对第 7 阶段的四个业务代理入口、Portal -> iframe auth bridge、四个业务前端切换和 fallback 安全边界做收口验收。当前可以按“统一业务代理入口 + iframe auth bridge + 受控 legacy fallback”收口。

本阶段没有迁移新的业务 API direct 到 `apps/api`，没有重写业务逻辑，没有去 iframe，没有修改 JWT/session，没有修改数据库结构，也没有新增 Alembic migration。

## 2. 第 7 阶段已完成内容

- `apps/api` 业务代理基座：统一解析 runtime/config 后端地址，先做 Portal session 与应用权限校验，再流式代理到 legacy 业务后端。
- `competitor-analysis` proxy/direct：`/api/v1/competitor-analysis/**` 已注册；health/history 已 direct，其它业务 API 仍 proxy。
- RAG proxy/direct：`/api/v1/rag/**` 已注册；health/sessions/conversations/sync 已 direct，chat stream 和 knowledge 仍 proxy。
- `contract-review` proxy：`/api/v1/contract-review/**` 已注册，当前全部业务 API 仍 proxy。
- `bid-generator` proxy：`/api/v1/bid-generator/**` 已注册，当前全部业务 API 仍 proxy。
- Portal `knowledgeService` 已优先切到 `/api/v1/rag/api/v1/knowledge/**`，并保留 legacy RAG backend fallback。
- Portal -> iframe auth bridge 已接入四个业务 iframe 前端：`competitor-analysis`、`rag-web-search`、`contract-review`、`bid-generator`。
- 四个业务 iframe 前端均优先调用对应 `apps/api` 代理入口，并在 fallback 到 legacy backend 时不携带 Portal token。

## 3. 四个统一业务入口

- `/api/v1/competitor-analysis/**`
- `/api/v1/rag/**`
- `/api/v1/contract-review/**`
- `/api/v1/bid-generator/**`

`config/apps.yaml` 的 `target_api_prefix` 已与实际入口保持一致，RAG 使用 `/api/v1/rag`。

## 4. 已 direct 的 API

`competitor-analysis` 已 direct：

- `GET /api/v1/competitor-analysis/api/health`
- `GET /api/v1/competitor-analysis/api/history`
- `GET /api/v1/competitor-analysis/api/history/{history_id}`
- `POST /api/v1/competitor-analysis/api/history`
- `DELETE /api/v1/competitor-analysis/api/history`
- `DELETE /api/v1/competitor-analysis/api/history/{history_id}`

RAG 已 direct：

- `GET /api/v1/rag/api/v1/health`
- `POST /api/v1/rag/api/v1/sessions`
- `GET /api/v1/rag/api/v1/conversations`
- `PUT /api/v1/rag/api/v1/conversations/sync`

## 5. 仍 proxy 的 API

- `competitor-analysis`：`analysis`、`analysis/stream`、`workflows/*`。
- RAG：`chat/stream`、`knowledge/*`。
- `contract-review`：当前全部业务 API。
- `bid-generator`：当前全部业务 API。

这些 API 的真实业务执行方仍是各自 legacy 后端；`apps/api` 只负责鉴权、权限、请求转发和响应透传。

## 6. Auth Bridge 安全约束

Portal 父页面返回 auth context 前会校验：

- `event.source` 必须是当前 iframe window。
- `event.origin` 必须等于当前 iframe URL origin。
- 请求中的 `appCode` 必须等于当前嵌入应用编码。
- 当前用户必须已登录。
- 当前用户必须拥有对应应用权限。

当前 appCode 到 `apiBaseUrl` 映射：

- `competitor-analysis` -> `/api/v1/competitor-analysis`
- `rag-web-search` -> `/api/v1/rag`
- `contract-review` -> `/api/v1/contract-review`
- `bid-generator` -> `/api/v1/bid-generator`

安全边界：

- token 只通过 `postMessage` 传递。
- token 不进入 iframe URL query/hash。
- token 不写 console。
- token 不写业务子应用长期 `localStorage`。
- Portal 父页面 `postMessage` 使用具体 iframe origin，不使用 `*`。
- 子应用只接受来自父页面 origin 且 requestId/appCode 匹配的 auth context。
- 401/403 不 fallback，不能通过 legacy fallback 绕过 Portal 权限。

残余边界：iframe URL 的可信性依赖 runtime app 配置和本地静态配置，当前前端会按当前嵌入 app URL 计算允许 origin。后续生产部署应在配置发布和服务端 runtime apps 层补充更强的 origin allowlist。

## 7. Fallback 约束

允许：

- bridge 不可用或超时，在没有 Portal auth context 时使用 legacy backend。
- `apps/api` 返回 502/503 或 network error 时，对安全方法请求 fallback legacy backend 一次。
- fallback 请求不携带 Portal `Authorization`，不携带 `X-Portal-Client-Id`。

不允许：

- 401 fallback。
- 403 fallback。
- 非幂等 POST/PUT/PATCH/DELETE 自动重复提交到 legacy。
- stream 已开始后中途 fallback 重发。
- 通过 fallback 绕过 Portal 应用权限。

第 7-M 已收紧四个业务前端的通用请求封装，只有 GET/HEAD/OPTIONS 这类安全方法会在 platform 502/503/network error 时自动 fallback。

## 8. 上传、下载和 Stream 约束

上传：

- `FormData` 请求不手动设置 multipart `Content-Type`，由浏览器生成 boundary。
- `business_proxy` 使用请求流透传 body，避免重组 multipart。

下载：

- `business_proxy` 保留 `Content-Type` 和 `Content-Disposition`。
- 合同审查 DOCX 下载通过 authenticated fetch 获取 blob，再用 object URL 触发下载。
- 标书生成 DOCX/PDF/Excel/图片等受保护资源通过 authenticated fetch/blob 或内存态 object URL 处理。
- PDF/图片预览如必须使用 URL 且无法附带 Authorization，可暂保留 legacy 或已转 object URL 的路径，后续去 iframe/统一文件存储阶段再收敛。

Stream：

- `competitor-analysis` 的 `analysis/stream` 保持 NDJSON 逐行读取。
- RAG `chat/stream` 保持 `text/event-stream` 事件格式。
- `bid-generator` 任务进度等流式接口保持 legacy SSE/ReadableStream 读取。
- `business_proxy` 使用 `StreamingResponse` 透传响应，不主动缓冲完整响应体。

## 9. 当前未完成事项

- 未去 iframe。
- 未完整迁移业务逻辑。
- 未接 MinIO。
- 未引入 Celery / RQ。
- 未统一文件存储。
- 未做生产部署方案。
- 未统一业务模块 observability 和 e2e 测试。
- 未将 RAG chat stream / knowledge、合同审查、标书生成等复杂 API direct 到 `apps/api`。

## 10. 第 8 阶段建议

- 业务模块 direct API 分批迁移评估：优先选低风险、无长任务、无复杂文件副作用的 API。
- 文件存储与任务队列专项设计：统一文件元数据、对象存储、长任务状态和失败恢复。
- 去 iframe 专项设计：先确定统一前端路由、权限边界、资源加载和回滚策略。
- 生产部署 / observability / e2e 测试：明确反向代理、CORS、日志、指标、追踪、健康检查和端到端验收链路。
