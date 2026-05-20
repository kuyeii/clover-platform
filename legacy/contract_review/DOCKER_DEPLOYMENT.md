# Docker 说明

合同审查当前处于 monorepo 整合开发阶段。统一生产 Docker 部署尚未在本目录交付；本目录的 `Dockerfile` / `docker-compose.yml` 只作为 legacy 模块单独调试参考，不是最终平台部署入口。

当前有效开发运行方式是在 `clover-platform` 根目录配置 `.env` / `DATABASE_URL` 后执行：

```bash
python scripts/init_db.py
alembic upgrade head
python scripts/check_db.py
python scripts/preflight.py --only contract-review
python scripts/dev.py --only contract-review
```

## 存储

- PostgreSQL 18 保存合同审查运行元数据和结构化 artifact 索引。
- 使用 schema：`contract_review`。
- 表包括 `review_runs`、`review_json_artifacts`、`review_text_artifacts`、`review_file_assets`。
- `review_runs` 是运行元数据主表；JSON / 文本 artifact 默认同步到 `review_json_artifacts` / `review_text_artifacts`，可通过 `MIRROR_RUN_ARTIFACTS_TO_DB=0` 关闭。
- 上传文件、运行产物、日志和 DOCX 导出仍保存在 `data/` 目录或 Docker volume 中，其中 `data/runs` 是文件产物主存储。
- 旧 SQLite / JSON 历史数据不迁移、不删除。

## legacy Docker Compose 调试

如果确实需要单独用本目录 Compose 调试，先在仓库根目录准备 `.env`，其中包含 `DATABASE_URL` 或完整 `POSTGRES_*`，并完成数据库初始化。Compose 同时读取本目录 `.env` 和根目录 `.env`，同名变量以根目录 `.env` 为准。然后在 `legacy/contract_review` 目录执行：

```bash
docker compose up -d --build
```

服务：

- 前端：`http://localhost:5173`
- 后端健康检查：`http://localhost:8000/api/health`
- 转换组件诊断：`http://localhost:8000/api/diagnostics/converters`

该 Compose 配置不会启动 PostgreSQL，也不会执行 Alembic；数据库应由平台根目录脚本管理。

## 环境变量

必须提供：

- `DATABASE_URL`，或 `POSTGRES_HOST` / `POSTGRES_PORT` / `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD`
- `DIFY_BASE_URL`
- 合同审查 Dify workflow API key
- `REVIEW_SIDE`

不要在 Docker 配置、镜像或 Git 中写入真实数据库密码、Dify key、API key 或 token。

## 运维提示

查看日志：

```bash
docker compose logs -f backend
docker compose logs -f frontend
```

停止：

```bash
docker compose down
```

转换能力诊断：

```bash
curl http://localhost:8000/api/diagnostics/converters
```

如果 Dify 在宿主机，容器内的 `localhost` 不等于宿主机。macOS / Windows 可尝试 `host.docker.internal`，Linux 建议使用宿主机局域网 IP。
