# 第 7-H 阶段：标书生成代理接入 apps/api

## 1. 阶段目标

第 7-H 在 `apps/api` 中新增标书生成统一代理入口：

- `/api/v1/bid-generator/{path:path}`

该入口会先复用 Portal session token 校验当前用户，再按 `bid-generator` 应用权限校验访问资格。通过校验后，请求会代理到 legacy 标书生成 pipt-lite 后端，并保持 legacy 标书生成接口路径不变。

示例映射：

- `/api/v1/bid-generator/health` -> legacy `/health`
- `/api/v1/bid-generator/api/projects` -> legacy `/api/projects`
- `/api/v1/bid-generator/api/projects/extract-stream` -> legacy `/api/projects/extract-stream`
- `/api/v1/bid-generator/api/tasks/{task_id}/progress` -> legacy `/api/tasks/{task_id}/progress`
- `/api/v1/bid-generator/api/projects/forge-document` -> legacy `/api/projects/forge-document`

## 2. 阶段边界

本阶段只接入标书生成 API 代理，不迁移标书生成业务逻辑。项目 CRUD、脱敏、还原、映射、实体注册、任务状态、SSE、知识库同步、DocumentForge、文件上传下载和 Dify workflow 调用仍由 `legacy/bid-generator/pipt-flask` 后端执行。

保留内容：

- legacy 标书生成后端继续保留。
- 标书生成 iframe 前端继续保留。
- 标书生成前端仍未切换到 `/api/v1/bid-generator`。
- pipt-lite service、`app/api_lite`、Dify key、workflow key、dataset id、数据库结构和文件缓存布局不变。

## 3. 代理能力

标书生成代理复用 `apps/api/app/services/business_proxy.py`：

- 目标后端优先从 `runtime/ports.json` 解析，缺失时从 `config/apps.yaml` 的开发端口配置回退。
- 代理前不访问 legacy 后端即可完成未登录和无权限拦截。
- 不向 legacy 后端转发 `Authorization`、`Cookie` 等敏感 header。
- 可转发 `X-Portal-User-Id`、`X-Portal-User-Account`、`X-Portal-User-Role`、`X-Portal-Client-Id`、`X-Request-ID` 等非敏感上下文。
- 请求 body 使用流式透传，避免破坏 multipart/form-data boundary。
- 响应使用流式返回，支持 `text/event-stream`、DOCX、PDF、Excel 和图片下载透传。
- 透传 legacy 响应的 `Content-Type` 和 `Content-Disposition`。

代理层自身错误继续使用平台统一错误 envelope。被代理的 legacy 成功响应和业务错误响应尽量保持原样和原状态码。

## 4. 验证建议

启动 Portal、platform-api 和标书生成：

```bash
python scripts/dev.py --only portal --only platform-api --only bid-generator
```

登录 Portal 获取 session token 后验证健康检查：

```bash
curl -i \
  -H "Authorization: Bearer ${PORTAL_TOKEN}" \
  -H "X-Portal-Client-Id: manual-check" \
  "http://127.0.0.1:5220/api/v1/bid-generator/health"
```

验证项目列表代理：

```bash
curl -i \
  -H "Authorization: Bearer ${PORTAL_TOKEN}" \
  -H "X-Portal-Client-Id: manual-check" \
  "http://127.0.0.1:5220/api/v1/bid-generator/api/projects"
```

验证 SSE 进度透传：

```bash
curl -N \
  -H "Authorization: Bearer ${PORTAL_TOKEN}" \
  -H "X-Portal-Client-Id: manual-check" \
  "http://127.0.0.1:5220/api/v1/bid-generator/api/tasks/${TASK_ID}/progress"
```

权限验证：

- 不带 `Authorization`：应返回 401，错误码 `UNAUTHORIZED`
- 用户无 `bid-generator` 权限：应返回 403，错误码 `PERMISSION_DENIED`
- 无权限时不会访问 legacy 标书生成后端

## 5. 回滚

本阶段未修改标书生成 legacy 前端和后端，iframe 仍可继续直连 legacy 标书生成后端。需要回滚时移除 `apps/api/app/api/bid_generator_proxy.py` 及其在 `apps/api/app/api/router.py` 的聚合注册即可。
