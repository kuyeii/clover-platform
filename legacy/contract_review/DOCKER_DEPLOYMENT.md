# Docker 安装、部署与启动说明

本项目已补齐 Docker 化部署配置，推荐使用 `docker compose` 一次性启动：

- `backend`：FastAPI 服务，端口 `8000`，负责文件上传、任务调度、Dify 工作流调用、SQLite 存储、DOC/PDF 转 DOCX、DOCX 批注导出。
- `frontend`：Nginx 托管的 Vite/React 静态前端，端口 `5173`，并将 `/api/*` 反向代理到后端。
- `data/`：宿主机持久化目录，挂载到容器 `/app/data`，保存 SQLite、上传文件、运行产物和导出文件。

## 1. 前置条件

请先在服务器或本机安装：

- Docker Engine / Docker Desktop
- Docker Compose v2（命令通常是 `docker compose`）

检查：

```bash
docker --version
docker compose version
```

## 2. 准备配置文件

在项目根目录执行：

```bash
cp .env.example .env
```

然后编辑 `.env`，至少确认以下变量：

```env
DIFY_BASE_URL=http://your-dify-host/v1
DIFY_CLAUSE_WORKFLOW_API_KEY=app-xxxxxx
DIFY_ANCHORED_RISK_WORKFLOW_API_KEY=app-anchored
DIFY_MISSING_MULTI_RISK_WORKFLOW_API_KEY=app-missing-multi
DIFY_FAST_SCREEN_WORKFLOW_API_KEY=app-fast-screen
DIFY_REWRITE_WORKFLOW_API_KEY=app-rewrite
REVIEW_SIDE=supplier
CONTRACT_TYPE_HINT=service_agreement
ANALYSIS_SCOPE=full_detail
FAST_SCREEN_ENABLED=1
```

### Dify 地址填写建议

如果 Dify 也在同一台服务器上：

- macOS / Windows Docker Desktop：可尝试 `http://host.docker.internal:端口/v1`
- Linux：建议填写宿主机局域网 IP，例如 `http://192.168.1.10:端口/v1`
- 如果 Dify 在公网或内网独立服务器：直接填写对应访问地址

> 注意：容器内部的 `localhost` 指的是容器自身，不是宿主机。除非 Dify 也运行在同一个容器里，否则不要把 `DIFY_BASE_URL` 写成 `http://localhost:...`。

## 3. 构建并启动

首次启动或依赖更新后执行：

```bash
docker compose up -d --build
```

查看容器状态：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs -f backend
docker compose logs -f frontend
```

## 4. 访问服务

启动完成后访问：

- 前端页面：`http://localhost:5173`
- 后端健康检查：`http://localhost:8000/api/health`
- 转换组件诊断：`http://localhost:8000/api/diagnostics/converters`

如果部署在服务器上，请将 `localhost` 替换为服务器 IP 或域名。

## 5. 上传与审查流程

1. 打开前端页面。
2. 上传 `.docx`、`.doc` 或 `.pdf` 合同文件。
3. 选择审查视角和审查范围。
4. 发起审查。
5. 等待任务完成后查看风险点、定位原文、应用或拒绝 AI 修改建议。
6. 下载带批注或已处理的 DOCX 文件。

## 6. 数据持久化

`docker-compose.yml` 已配置：

```yaml
volumes:
  - ./data:/app/data
```

因此以下数据会保存在宿主机项目目录的 `data/` 下：

- `data/contract_review.sqlite3`：任务元数据与结构化中间结果
- `data/uploads/`：上传原文件
- `data/runs/`：每次审查的运行产物、转换文件、导出 DOCX、日志
- `data/web_meta/`：旧版本兼容元数据目录

备份时建议至少备份整个 `data/` 目录。

## 7. 常用运维命令

重启：

```bash
docker compose restart
```

停止：

```bash
docker compose down
```

停止并清理镜像重新构建：

```bash
docker compose down
docker compose build --no-cache
docker compose up -d
```

进入后端容器：

```bash
docker compose exec backend bash
```

执行 SQLite 历史迁移脚本：

```bash
docker compose exec backend python tools/migrate_json_to_sqlite.py \
  --db /app/data/contract_review.sqlite3 \
  --web-meta-root /app/data/web_meta \
  --run-root /app/data/runs
```

## 8. 转换能力说明

Docker 后端镜像已安装：

- LibreOffice / Writer：用于 `.doc` 转 `.docx`
- fonts-noto-cjk：改善中文字体兼容
- PyMuPDF 与 pdf2docx：用于 PDF 文档转换

可通过以下接口确认容器内转换组件状态：

```bash
curl http://localhost:8000/api/diagnostics/converters
```

## 9. 生产部署建议

- 将 `.env` 放在服务器本地，不要提交到 Git。
- 使用 HTTPS 反向代理，例如 Nginx、Traefik 或云厂商负载均衡。
- 对 `data/` 目录做定期备份。
- 根据 Dify 服务容量调整：
  - `DIFY_MAX_CONCURRENCY`
  - `CLAUSE_SPLIT_MAX_CONCURRENCY`
  - `REQUEST_TIMEOUT_SECONDS`
- 若上传文件较大，可同步调整 `frontend/nginx.conf` 中的 `client_max_body_size`。

## 10. 常见问题

### 前端打开了，但上传后接口失败

查看后端日志：

```bash
docker compose logs -f backend
```

重点检查 `.env` 中的 Dify 地址和 API Key。

### 容器内无法访问 Dify

进入后端容器测试：

```bash
docker compose exec backend bash
curl -v "$DIFY_BASE_URL"
```

如果 `DIFY_BASE_URL` 使用了 `localhost`，通常需要改成宿主机 IP 或 `host.docker.internal`。

### `.doc` 转换失败

查看转换诊断：

```bash
curl http://localhost:8000/api/diagnostics/converters
```

Docker 镜像已内置 LibreOffice。如果仍失败，通常是源文件损坏、加密、扫描件或格式兼容问题，建议另存为 `.docx` 后重试。

### 审查一直在运行中

检查：

- Dify 服务是否可用
- 工作流 API Key 是否填错
- `REQUEST_TIMEOUT_SECONDS` 是否过短
- 后端日志中是否有 workflow timeout 或 API error

```bash
docker compose logs -f backend
```
