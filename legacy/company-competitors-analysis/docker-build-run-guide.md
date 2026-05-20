# 项目 Docker 打包与运行指南

适用项目：`company-competitors-analysis`

本指南用于在本地 Mac 环境下测试项目是否可以正常 Docker 打包、运行和访问页面。

竞对分析历史记录写入 PostgreSQL 的 `competitor_analysis` schema。本地开发运行以 clover-platform 根目录 `.env` / `DATABASE_URL` 或 `POSTGRES_*` 为准。Docker 统一部署将在后续阶段处理。

---

## 1. 前置条件

请先确认 Docker Desktop 已经启动。

```bash
open -a Docker
```

等待 Docker Desktop 完全启动后，执行：

```bash
docker info
```

如果能正常输出 Docker 信息，说明 Docker 后台服务已经运行。

也可以测试：

```bash
docker run --rm hello-world
```

如果能看到 `Hello from Docker!`，说明 Docker 基础环境正常。

---

## 2. 确认项目目录

进入项目根目录：

```bash
cd "company-competitors-analysis"
```

确认当前目录下有这些文件：

```bash
ls
```

应至少包含：

```text
Dockerfile
package.json
vite.config.js
src
backend
.env.example
```

---

## 3. 推荐 Dockerfile

如果你当前网络无法直接拉取 Docker Hub 镜像，可以使用下面这个 Dockerfile。

把项目根目录的 `Dockerfile` 替换为：

```dockerfile
FROM m.daocloud.io/docker.io/library/node:20-slim AS frontend

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY index.html ./
COPY vite.config.js ./
COPY public ./public
COPY src ./src

RUN npm run build


FROM m.daocloud.io/docker.io/library/python:3.12-slim AS runtime

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    BACKEND_HOST=0.0.0.0 \
    BACKEND_PORT=8788 \
    CORS_ORIGIN=http://localhost:8788 \
    STATIC_DIR=/app/dist

COPY backend ./backend
COPY --from=frontend /app/dist ./dist

# Docker unified deployment will be handled in a later phase.

EXPOSE 8788

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import os, urllib.request; port=os.environ.get('BACKEND_PORT', '8788'); urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health', timeout=3).read()"

CMD ["python", "backend/server.py"]
```

说明：

- 没有使用 `# syntax=docker/dockerfile:1`，避免额外拉取 `docker/dockerfile:1`。
- 使用 `m.daocloud.io/docker.io/library/...` 镜像前缀，适合 Docker Hub 访问不稳定的环境。
- 前端使用 Node 构建，后端使用 Python 运行。
- 后端端口是 `8788`。
- 历史记录写入 PostgreSQL `competitor_analysis.history_records`。

---

## 4. 准备生产环境变量文件

项目运行需要环境变量。建议新建 `.env.production`。

如果你已经有 `.env.local`，可以复制一份：

```bash
cp .env.local .env.production
```

如果没有 `.env.local`，可以从模板复制：

```bash
cp .env.example .env.production
```

然后打开编辑：

```bash
open -e .env.production
```

### 重要：容器里不要用 localhost 访问宿主机服务

如果你的 Dify 服务运行在你的 Mac 本机，容器里不能写：

```env
WORKFLOW_URL=http://localhost/v1/workflows/run
```

应改成：

```env
WORKFLOW_URL=http://host.docker.internal/v1/workflows/run
```

类似这些 URL 都建议检查：

```env
WORKFLOW_URL=http://host.docker.internal/v1/workflows/run
COMPANY_NAME_VALIDATION_URL=http://host.docker.internal/v1/workflows/run
COMPANY_DETAIL_URL=http://host.docker.internal/v1/workflows/run
COMPARE_REPORT_PRODUCT_URL=http://host.docker.internal/v1/workflows/run
COMPARE_REPORT_TECH_URL=http://host.docker.internal/v1/workflows/run
COMPARE_REPORT_LATELY_URL=http://host.docker.internal/v1/workflows/run
COMPARE_REPORT_SUMMARY_URL=http://host.docker.internal/v1/workflows/run
SCORE_URL=http://host.docker.internal/v1/workflows/run
```

如果 Dify 是远程服务器，则改成真实远程地址，例如：

```env
WORKFLOW_URL=https://your-dify-domain.com/v1/workflows/run
```

---

## 5. 本地非 Docker 方式预检查，可选但推荐

先确认前端能正常打包：

```bash
npm ci
npm run build
```

再确认后端能启动：

```bash
python backend/server.py
```

新开一个终端测试：

```bash
curl http://127.0.0.1:8788/api/health
```

如果返回正常，说明项目本身没有明显启动问题。

---

## 6. Docker 打包镜像

在项目根目录执行：

```bash
docker build -t competitor-analysis:test .
```

构建成功后可以查看镜像：

```bash
docker images | grep competitor-analysis
```

如果看到类似：

```text
competitor-analysis   test   xxxxxxxx   ...
```

说明镜像已经打包成功。

---

## 7. 前台运行容器

前台运行适合调试，因为日志会直接显示在当前终端。

```bash
docker run --rm \
  --name competitor-analysis-test \
  -p 8788:8788 \
  --env-file .env.production \
  --add-host=host.docker.internal:host-gateway \
  competitor-analysis:test
```

说明：

- `--rm`：容器停止后自动删除容器记录。
- `--name competitor-analysis-test`：容器名称。
- `-p 8788:8788`：把容器的 8788 端口映射到本机 8788。
- `--env-file .env.production`：读取生产环境变量。
- `--add-host=host.docker.internal:host-gateway`：让容器可以访问宿主机服务。
- Docker 统一部署将在后续阶段处理。

---

## 8. 访问项目

容器启动后，浏览器打开：

```text
http://localhost:8788
```

测试健康检查：

```bash
curl http://localhost:8788/api/health
```

如果页面能打开，并且 `/api/health` 正常返回，说明容器已经正常运行。

---

## 9. 如何退出前台运行的容器

如果你是用下面这种方式启动的：

```bash
docker run --rm ...
```

当前终端是在前台运行容器。

退出并停止容器：

```text
Ctrl + C
```

因为使用了 `--rm`，容器停止后会自动删除。

---

## 10. 后台运行容器

如果不想让终端一直被占用，可以加 `-d` 后台运行。

```bash
docker run -d \
  --name competitor-analysis-test \
  -p 8788:8788 \
  --env-file .env.production \
  --add-host=host.docker.internal:host-gateway \
  competitor-analysis:test
```

查看正在运行的容器：

```bash
docker ps
```

查看日志：

```bash
docker logs -f competitor-analysis-test
```

进入容器：

```bash
docker exec -it competitor-analysis-test sh
```

退出容器 shell：

```bash
exit
```

停止容器：

```bash
docker stop competitor-analysis-test
```

---

## 11. 数据库说明

第 5-A 后，运行时历史记录和企业缓存写入 PostgreSQL：

```text
competitor_analysis.history_records
competitor_analysis.storage_meta
competitor_analysis.company_profiles
competitor_analysis.company_validation_queries
```

运行前请在 clover-platform 根目录完成初始化和检查：

```bash
python scripts/init_db.py
alembic upgrade head
python scripts/check_db.py
```

竞对分析后端通过 `DATABASE_URL` 或 `POSTGRES_*` 连接 PostgreSQL，不要提交 `.env` 或写入真实数据库密码。

---

## 12. 常见问题

### 问题 1：`.env.production: no such file or directory`

说明项目根目录没有 `.env.production`。

解决：

```bash
cp .env.local .env.production
```

或者：

```bash
cp .env.example .env.production
```

然后重新运行容器。

---

### 问题 2：Docker 拉取 `node:20-slim` 或 `python:3.12-slim` 失败

如果报错类似：

```text
failed to fetch anonymous token
connect: connection refused
```

说明 Docker Hub 访问不稳定。

解决方式：使用本指南提供的 Dockerfile，把基础镜像改成：

```dockerfile
FROM m.daocloud.io/docker.io/library/node:20-slim AS frontend
FROM m.daocloud.io/docker.io/library/python:3.12-slim AS runtime
```

---

### 问题 3：页面能打开，但调用工作流失败

重点检查 `.env.production`。

如果 Dify 在你本机，不能用：

```env
WORKFLOW_URL=http://localhost/v1/workflows/run
```

应改成：

```env
WORKFLOW_URL=http://host.docker.internal/v1/workflows/run
```

然后重启容器。

---

### 问题 4：端口被占用

如果 8788 被占用，可以换本机端口，例如：

```bash
docker run --rm \
  --name competitor-analysis-test \
  -p 8899:8788 \
  --env-file .env.production \
  --add-host=host.docker.internal:host-gateway \
  competitor-analysis:test
```

然后访问：

```text
http://localhost:8899
```

---

## 13. 一套完整命令汇总

```bash
cd "company-competitors-analysis"

cp .env.local .env.production
open -e .env.production

docker build -t competitor-analysis:test .

docker run --rm \
  --name competitor-analysis-test \
  -p 8788:8788 \
  --env-file .env.production \
  --add-host=host.docker.internal:host-gateway \
  competitor-analysis:test
```

启动后访问：

```text
http://localhost:8788
```

停止前台容器：

```text
Ctrl + C
```

---

## 14. 后续正式部署建议

本地测试通过后，正式部署时建议：

1. 不要把 `.env.local`、`.env.production`、`.env`、DB 文件提交到代码仓库。
2. 生产环境使用单独的 `.env.production`。
3. 如果部署到 Linux 服务器，保留：

```bash
--add-host=host.docker.internal:host-gateway
```

4. PostgreSQL 正式 Docker 部署会在后续 Docker 阶段统一改造；当前 Docker 配置不是最终数据库部署方案。
5. 如果服务器能正常访问 Docker Hub，可以把基础镜像改回官方镜像：

```dockerfile
FROM node:20-slim AS frontend
FROM python:3.12-slim AS runtime
```
