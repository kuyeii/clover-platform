# Stage 10-G: 统一主链路验收与发布准备 Spec

## 1. 背景

当前 10-F 已完成统一前端收口：默认主入口为 `apps/web`，默认主后端为 `apps/api`，legacy 前端和 legacy 后端均不默认启动。10-G 的目标不是继续迁新能力，而是确认当前主链路具备稳定发布和联调条件。

## 2. 目标

- 对 Portal、竞对分析、RAG、合同审查、标书生成五类页面做统一回归。
- 明确本地、联调、准生产部署所需的环境变量、端口、反向代理、CORS、SSE、WebSocket、上传下载和持久化目录。
- 固化默认启动、preflight、build、数据库检查和手工验收清单。
- 形成发布阻塞项、非阻塞 warning 和后续阶段 backlog。

## 3. 允许做

- 补充验收脚本、preflight 检查和发布文档。
- 修复阻塞统一主链路的 bug。
- 修复 `/api/v1/**`、SSE、WebSocket、上传、下载、权限、登录态恢复中的兼容问题。
- 补充必要的健康检查和诊断信息，但不得泄露 token、key、密码、Cookie 或文件内容。
- 补充本地文件系统部署说明和目录挂载检查。
- 调整开发启动器中与当前默认主链路不一致的端口写入或检查逻辑。

## 4. 禁止做

- 不新增业务功能。
- 不重构业务算法。
- 不删除 legacy 目录、iframe 代码或回滚配置。
- 不引入 MinIO、Celery、RQ、Redis 等新基础设施。
- 不改变认证体系，不切 JWT，不改变 Portal session token 语义。
- 不改变 Dify workflow 业务语义。
- 不做大规模 UI 重设计。

## 5. 技术约束

- 默认启动只应依赖 `apps/web`、`apps/api`、PostgreSQL 和必要外部 workflow 配置。
- legacy 前端和 legacy 后端只能通过显式回滚参数启动。
- 所有新增或修复 API 应继续使用 `/api/v1` 前缀。
- 平台自身错误应使用统一 envelope；兼容 legacy 业务响应的接口可保留原响应结构，但必须在文档中注明。
- 日志必须包含 request id，不能输出敏感信息。
- CORS 只允许明确可信 origin，不能使用无边界 `*` 作为发布配置。

## 6. 交付物

- 更新后的验收说明或阶段记录。
- 必要的 preflight/build/dev 检查补充。
- 生产或联调部署检查清单。
- 已知问题清单和后续阶段 backlog。

## 7. 自动验收标准

以下命令应能通过，或在阶段记录中明确失败原因：

```bash
.venv/bin/python -m compileall -q packages scripts alembic apps/api legacy/portal-launchpad/backend
.venv/bin/python scripts/preflight.py --only platform-api
.venv/bin/python scripts/preflight.py
.venv/bin/python scripts/dev.py --write-ports-only
.venv/bin/python scripts/dev.py --no-business --write-ports-only
.venv/bin/python scripts/dev.py --with-legacy-frontends --write-ports-only
.venv/bin/python scripts/dev.py --with-legacy-frontends --with-legacy-backends --write-ports-only
.venv/bin/python scripts/dev.py --legacy-portal --write-ports-only
npm --prefix apps/web run build
git diff --check
```

## 8. 手工验收标准

- 登录、登出、刷新恢复和改密正常。
- 工作台五个模块入口均进入 `apps/web` 原生路径。
- 用户管理、权限禁用、app usage、feedback 可用。
- 竞对分析 history、analysis、stream、workflow 调用可用。
- RAG sessions、conversations、chat stream、knowledge documents 可用。
- 合同审查上传、运行、结果、AI 改写、DOCX 下载可用。
- 标书生成项目 CRUD、上传解析、SSE 任务、预览、导出、knowledge/kb 可用。
- 上传、下载、SSE、WebSocket 在反向代理后仍可用。
- 未授权和无权限访问返回清晰错误。

## 9. 回退策略

- 若 `apps/web` 主页面异常，可启用 `python scripts/dev.py --with-legacy-frontends` 进入 legacy 前端回滚链路。
- 若 direct API 异常且存在未知路径兜底，可启用 `--with-legacy-backends` 验证 legacy 后端 fallback。
- 回退不得绕过 Portal 鉴权，不得向 legacy backend 透传 Portal token、Cookie 或 Set-Cookie。

## 10. 完成定义

- 自动验收和手工验收均有记录。
- 发布阻塞项全部关闭或明确降级方案。
- 部署所需环境变量、目录、端口、CORS、反代规则完整。
- 下一阶段可以安全进入 legacy 解耦或公共能力平台化。
