# ProEngine 服务器部署

这套部署面向当前仓库实际结构：

- `frontend-web` 部署到服务器
- `pipt-flask` 部署到服务器
- SQLite 与 `data/` 跟随后端容器一起持久化
- Dify / VLM / 校验模型继续留在本机，但必须通过固定地址让服务器可访问

## 目录说明

- `docker-compose.yml`: 服务器编排入口
- `backend.Dockerfile`: `pipt-flask` 生产镜像
- `frontend.Dockerfile`: 前端静态构建镜像
- `nginx.conf`: 前端静态托管 + `/api` 反向代理
- `.env.example`: 服务器环境变量模板

## 使用方式

1. 在服务器拉取仓库。
2. 进入 `deploy/server/`。
3. 复制环境变量模板：

```bash
cp .env.example .env
```

4. 修改 `.env`，至少填这些值：

- `PIPT_DB_KEY`
- `PIPT_CORS_ORIGINS`
- `DIFY_API_URL`
- 当前 `dify/manifest.yml` 纳管的 `DIFY_WORKFLOW_*`
  - `DIFY_WORKFLOW_STRUCTURE_GENERATOR`
  - `DIFY_WORKFLOW_CONTENT_WRITER`
  - `DIFY_WORKFLOW_CONTENT_GROUP_WRITER`
  - `DIFY_WORKFLOW_CONTENT_REWRITE`
  - `DIFY_WORKFLOW_RESPONSE_CONTENT_WRITER`
  - `DIFY_WORKFLOW_DIAGRAM_GENERATOR`
  - `DIFY_WORKFLOW_DOC_ANALYSIS`

可选增强项：

- `VLM_API_URL`：只有启用图片/VLM 打标链路时需要
- `PIPT_LLM_VERIFY_*`：只有启用 PIPT 二次校验链路时需要

历史兼容链路若仍启用，再额外配置：

- `DIFY_WORKFLOW_REQUIREMENT_EXTRACTOR`
- `DIFY_WORKFLOW_BLUEPRINT_GENERATOR`
- `DIFY_WORKFLOW_GROUP_REVIEW_WRITER`
- `DIFY_WORKFLOW_ATTACHMENT_GENERATOR`
- `DIFY_WORKFLOW_SCORING_ASSISTANT`

5. 确认服务器能访问你本机的 Dify / 模型 HTTP 地址：

```bash
curl http://your-home-dify-endpoint:3000/v1
```

6. 启动：

```bash
docker compose up -d --build
docker-compose up -d --build
```

7. 访问：

- 前端：`http://<server-ip>:8080`
- 健康检查：`http://<server-ip>:8080/health`
- Swagger：`http://<server-ip>:8080/apidoc`

## 持久化

Compose 已经持久化两类数据：

- `backend_db`: SQLite 数据库文件
- `backend_data`: `data/` 下的缓存、导出、图片、项目文件

## 本机服务暴露建议

不要把 SQLite 或本机数据库暴露给服务器。只暴露 HTTP API 层：

- Dify: `http://<reachable-host>:3000/v1`
- VLM: `http://<reachable-host>:8000/v1/chat/completions`
- 校验模型: `http://<reachable-host>:8000/v1/chat/completions`

更稳妥的做法：

- Tailscale / WireGuard
- FRP
- Cloudflare Tunnel

不建议直接裸公网开放且不做访问控制。

## 说明

- 当前仓库里的 `pipt-flask/docker-compose.yml` 是旧项目模板，不适用于 ProEngine。
- 当前部署默认继续使用 SQLite，适合单机部署。后续如果要多实例或更强并发，再迁移到服务器上的 MySQL / Postgres。
- 如果你依赖某些 DOCX/PDF 转换链路里的系统级能力，例如 LibreOffice，再额外补进镜像或宿主机。
