# 平台统一API接口规范

> 来源文件：`05_平台统一API接口规范.pdf`

平台统一 API 接口规范

| 项目 | 内容 |
| --- | --- |
| 版本 | v1.1（基于确认版约束） |
| 日期 | 2026-05-18 |
| 适用范围 | Portal、合同审查、标书生成、RAG 问答、企业竞对分析 |
| 关键约束 | PostgreSQL 18；第一阶段保留 iframe；暂用现有认证；数据短期共享；配置多环境化 |

## 0. 已确认约束

| 确认项 | 结论 |
| --- | --- |
| PostgreSQL 版本 | 开发、测试、生产均统一使用 PostgreSQL 18。 |
| 认证体系 | 第一阶段复用现有 Portal 登录与 session 机制，平台稳定后再升级认证体系。 |
| 多租户 | 当前不做复杂多租户，但表结构预留 tenant_id / organization_id 等扩展口子。 |
| 标书生成服务边界 | 短期保留标书生成现有独立逻辑，中期合并为 bid_generator 模块。 |
| 任务队列 | 第一阶段不引入 Celery/RQ，后续按长任务压力再评估。 |
| iframe 策略 | 第一阶段保留 iframe，第二阶段统一后端和数据库，第三阶段逐步去 iframe。 |
| 文件存储 | 暂时使用本地目录或 Docker volume，后续可平滑切换 MinIO。 |
| 权限策略 | 默认普通用户可使用五个模块，管理员可配置某用户不能使用某模块；所有数据短期共享。 |
| 数据隔离 | 暂时不做隔离，但业务表和查询接口预留 user_id、tenant_id、visibility、scope 等口子。 |
| 多环境配置 | 配置体系支持 dev/test/prod 多环境，Dify workflow key 按环境隔离。 |

## 1. API 分层原则

统一 API 采用 /api/v1 前缀，并按 core 与业务模块分组。第一阶段为兼容旧项目前端，可以保留旧路径代理；第二阶段逐步迁移到统一路径。/api/v1/core/.../api/v1/portal/.../api/v1/contract-review/.../api/v1/bid-generator/.../api/v1/rag/.../api/v1/competitor-analysis/...

## 2. 响应格式规范

成功：{

```
"success": true,
"data": {},
"message": "ok",
```

"request_id": "..."}失败：{

```
"success": false,
```

"error": {

```
"code": "PERMISSION_DENIED",
"message": "当前用户无权访问该模块",
```

"details": {}

```
},
```

"request_id": "..."}

| 确认项 | 结论 |
| --- | --- |
| 错误码 | 含义 |
| UNAUTHORIZED | 未登录或 session 失效。 |
| PERMISSION_DENIED | 无应用或资源权限。 |
| VALIDATION_ERROR | 请求参数校验失败。 |
| RESOURCE_NOT_FOUND | 资源不存在。 |
| WORKFLOW_ERROR | Dify workflow 调用失败。 |
| FILE_ERROR | 文件上传、下载、解析或导出失败。 |
| JOB_FAILED | 后台任务执行失败。 |

## 3. Core API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | /api/v1/core/auth/login | 登录，第一阶段复用现有 Portal session。 |
| GET | /api/v1/core/auth/me | 获取当前用户。 |
| POST | /api/v1/core/auth/password | 修改密码。 |
| GET | /api/v1/core/apps | 应用列表，含权限和运行时地址。 |
| PUT | /api/v1/core/apps/{code}/ permission | 管理员配置用户应用权限。 |
| GET | /api/v1/core/files/{id} | 文件元数据。 |
| GET | /api/v1/core/jobs/{id} | 任务状态。 |
| GET | /api/v1/core/runtime/ports | 开发环境运行时端口映射。 |

## 4. 业务 API 路径建议

| 模块 | 路径示例 | 说明 |
| --- | --- | --- |
| 合同审查 | POST /api/v1/contract-review/reviews | 创建审查任务。 |
| 合同审查 | POST /api/v1/contract-review/reviews/{id}/risks/{risk_id}/accept | 接受 AI 修改。 |
| 标书生成 | POST /api/v1/bid-generator/projects | 创建标书项目。 |
| 标书生成 | POST /api/v1/bid-generator/projects/{id}/ generate | 生成大纲或正文。 |
| RAG | POST /api/v1/rag/chat/stream | 流式问答。 |
| RAG | POST /api/v1/rag/knowledge/documents | 上传知识库文档。 |
| 竞对分析 | POST /api/v1/competitor-analysis/analysis /stream | 流式竞对分析。 |
| 竞对分析 | GET /api/v1/competitor-analysis/history | 分析历史。 |

## 5. 流式接口规范

RAG 问答和竞对分析保留流式体验。统一后端后，推荐使用 SSE；旧 NDJSON 可以作为兼容层保留。所有流式事件必须包含 event、data、request_id、job_id。event: progress data: {"job_id":"...","stage":"calling_workflow","progress":30}event: chunk data: {"content":"..."}event: done data: {"job_id":"...","status":"completed"}

## 6. 鉴权与权限

第一阶段所有统一 API 从 session 中识别 current_user。普通用户默认可访问五模块；管理员可配置 app_code 粒度禁用。业务数据短期共享，但 API 需保留 current_user、app_permission、future_scope检查入口。
