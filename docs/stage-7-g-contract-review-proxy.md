# 第 7-G 阶段：合同审查代理接入 apps/api

## 1. 阶段目标

第 7-G 在 `apps/api` 中新增合同审查统一代理入口：

- `/api/v1/contract-review/{path:path}`

该入口会先复用 Portal session token 校验当前用户，再按 `contract-review` 应用权限校验访问资格。通过校验后，请求会代理到 legacy 合同审查后端，并保持 legacy 合同审查接口路径不变。

示例映射：

- `/api/v1/contract-review/api/health` -> legacy `/api/health`
- `/api/v1/contract-review/api/reviews` -> legacy `/api/reviews`
- `/api/v1/contract-review/api/reviews/{run_id}/download` -> legacy `/api/reviews/{run_id}/download`

## 2. 阶段边界

本阶段只接入合同审查 API 代理，不迁移合同审查业务逻辑。真实审查流程、文件上传保存、后台线程、子进程、DOCX 生成、AI 改写、接受、编辑、拒绝等能力仍由 `legacy/contract_review` 后端执行。

保留内容：

- legacy 合同审查后端继续保留。
- 合同审查 iframe 前端继续保留。
- 合同审查前端仍未切换到 `/api/v1/contract-review`。
- DOCX 导出逻辑、文件布局和 Dify workflow 配置不变。

## 3. 代理能力

合同审查代理复用 `apps/api/app/services/business_proxy.py`：

- 目标后端优先从 `runtime/ports.json` 解析，缺失时从 `config/apps.yaml` 的开发端口配置回退。
- 代理前不访问 legacy 后端即可完成未登录和无权限拦截。
- 不向 legacy 后端转发 `Authorization`、`Cookie` 等敏感 header。
- 可转发 `X-Portal-User-Id`、`X-Portal-User-Account`、`X-Portal-User-Role`、`X-Portal-Client-Id` 等非敏感上下文。
- 请求 body 使用流式透传，避免破坏 multipart/form-data boundary。
- 响应使用流式返回，支持 DOCX 下载透传。
- 透传 legacy 响应的 `Content-Type` 和 `Content-Disposition`。

代理层自身错误继续使用平台统一错误 envelope。被代理的 legacy 成功响应和业务错误响应尽量保持原样和原状态码。

## 4. 后续方向

下一阶段可选择：

- 将合同审查 iframe 前端 API base 切到 `/api/v1/contract-review`。
- 接入标书生成代理。
- 继续做 RAG 或 competitor-analysis 的低风险直接迁移。
