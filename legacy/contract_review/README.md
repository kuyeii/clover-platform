# 合同审查系统

这是一个面向合同文件的 Web 审查项目。项目由 **FastAPI 后端**、**React/Vite 前端**、**SQLite 本地持久化** 和 **Dify 工作流调用链** 组成，支持上传合同、自动拆分条款、识别风险、在页面中对照原文查看风险点，并导出带 Word/WPS 批注的 DOCX 文件。

当前项目已补齐 Docker 部署文件，推荐优先使用 Docker Compose 启动。

## 功能概览

- 上传 `.docx`、`.doc`、`.pdf` 合同文件
- 将 `.doc` / `.pdf` 规范化转换为可处理的 DOCX
- 调用 Dify 工作流进行条款切分、风险识别、Fast Screen、AI 改写建议
- 后端异步执行审查任务，前端轮询进度
- 支持查看历史审查记录
- 支持风险点筛选、定位原文、采纳 / 拒绝 / 编辑 AI 修改建议
- 支持下载审查后的 DOCX 文件
- 使用 SQLite 保存任务元数据和结构化审查结果
- 运行产物、上传文件和导出文件保存在 `data/` 目录

## 技术栈

| 模块 | 技术 |
| --- | --- |
| 后端 API | FastAPI、Uvicorn、Pydantic |
| 文档处理 | python-docx、lxml、LibreOffice、PyMuPDF、pdf2docx |
| AI 工作流 | Dify Workflow API |
| 数据存储 | SQLite |
| 前端 | React 18、TypeScript、Vite、Tailwind CSS、docx-preview |
| 部署 | Docker、Docker Compose、Nginx |

## 目录结构

```text
contract_review_sqlite_project/
  app.py                         # 命令行审查入口
  web_api.py                     # FastAPI Web API 入口
  config.py                      # 环境变量配置
  requirements.txt               # Python 依赖
  Dockerfile                     # 后端镜像
  docker-compose.yml             # 前后端一键编排
  .dockerignore
  .env.example                   # 环境变量模板
  DOCKER_DEPLOYMENT.md           # Docker 安装、部署与启动说明
  frontend/
    Dockerfile                   # 前端构建 + Nginx 镜像
    nginx.conf                   # 前端静态服务与 API 反向代理
    package.json
    src/
  src/
    document_ingest.py           # DOC/PDF/DOCX 统一接入
    workflow_runner.py           # Dify 工作流编排
    sqlite_store.py              # SQLite 存储
    docx_comments.py             # DOCX 批注导出
    docx_apply_patches.py        # DOCX 修改应用
    ...
  tools/
    migrate_json_to_sqlite.py    # 旧 JSON 产物迁移到 SQLite
  tests/
  data/                          # 运行时数据目录，Docker 挂载持久化
```

## 快速启动：Docker Compose

### 1. 准备环境变量

```bash
cp .env.example .env
```

编辑 `.env`，至少配置：

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
```

`REVIEW_SIDE` 常用值：

- `supplier`：供应商 / 乙方视角
- `customer`：采购方 / 甲方视角

如果 Dify 运行在宿主机，不建议在容器中使用 `localhost` 访问 Dify。macOS / Windows 可尝试 `host.docker.internal`，Linux 建议使用宿主机局域网 IP。

### 2. 构建并启动

```bash
docker compose up -d --build
```

### 3. 访问

- 前端：`http://localhost:5173`
- 后端健康检查：`http://localhost:8000/api/health`
- 文档转换诊断：`http://localhost:8000/api/diagnostics/converters`

### 4. 查看日志

```bash
docker compose logs -f backend
docker compose logs -f frontend
```

更详细的 Docker 部署、运维和排错说明见：[`DOCKER_DEPLOYMENT.md`](./DOCKER_DEPLOYMENT.md)。

## 本地开发启动

### 后端

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
cp .env.example .env
uvicorn web_api:app --reload --host 0.0.0.0 --port 8000
```

后端默认地址：`http://localhost:8000`

### 前端

另开一个终端：

```bash
cd frontend
npm install
npm run dev
```

前端默认地址：`http://localhost:5173`

开发环境下，`frontend/vite.config.ts` 会把 `/api/*` 代理到 `http://127.0.0.1:8000`。如需改后端地址：

```bash
VITE_API_TARGET=http://127.0.0.1:8000 npm run dev
```

## 命令行模式

除 Web UI 外，也可以直接使用命令行入口处理 DOCX：

```bash
python app.py /path/to/contract.docx --run-id live_test_001
```

只做本地预处理、不调用 Dify：

```bash
python app.py /path/to/contract.docx --dry-run
```

断点续跑：

```bash
python app.py /path/to/contract.docx --run-id live_test_001 --resume
```

## 环境变量说明

| 变量 | 说明 |
| --- | --- |
| `DIFY_BASE_URL` | Dify API 基础地址，例如 `http://your-dify-host/v1` |
| `DIFY_CLAUSE_WORKFLOW_API_KEY` | 条款切分工作流 API Key |
| `DIFY_RISK_WORKFLOW_API_KEY` | 旧版风险工作流兼容 Key，可作为回退 |
| `DIFY_ANCHORED_RISK_WORKFLOW_API_KEY` | Anchored 风险识别工作流 API Key |
| `DIFY_MISSING_MULTI_RISK_WORKFLOW_API_KEY` | 缺失条款 / 多条款风险识别工作流 API Key |
| `DIFY_FAST_SCREEN_WORKFLOW_API_KEY` | Fast Screen 工作流 API Key |
| `DIFY_REWRITE_WORKFLOW_API_KEY` | 单风险 AI 改写工作流 API Key |
| `DIFY_AGGREGATE_REWRITE_WORKFLOW_API_KEY` | 聚合改写工作流 API Key；缺失时回退到 `DIFY_REWRITE_WORKFLOW_API_KEY` |
| `REVIEW_SIDE` | 审查视角，常用 `supplier` 或 `customer` |
| `CONTRACT_TYPE_HINT` | 合同类型提示，例如 `service_agreement` |
| `ANALYSIS_SCOPE` | 审查范围，默认 `full_detail` |
| `REQUEST_TIMEOUT_SECONDS` | Dify 请求超时时间 |
| `DIFY_MAX_CONCURRENCY` | 风险识别并发数 |
| `CLAUSE_SPLIT_MAX_CONCURRENCY` | 条款切分并发数 |
| `RUN_ROOT` | 运行产物目录，本地默认 `data/runs` |
| `SQLITE_DB_PATH` | SQLite 数据库路径，本地默认 `data/contract_review.sqlite3` |
| `DEBUG_SAVE_INTERMEDIATE` | 是否保留中间产物 |
| `FAST_SCREEN_ENABLED` | 是否启用 Fast Screen |
| `FAST_SCREEN_MAX_CANDIDATES` | Fast Screen 最大候选数 |

## 数据与产物

默认数据目录：`data/`

```text
data/
  contract_review.sqlite3        # SQLite 主数据文件
  uploads/                       # Web 上传原文件
  runs/<run_id>/                 # 单次审查运行产物、转换文件、导出文件、日志
  web_meta/                      # 旧版元数据兼容目录
```

SQLite 中主要保存：

- 审查任务元数据
- 任务状态、进度、错误信息
- 结构化 JSON 产物
- 文本型中间产物

DOCX、PDF、日志和导出文件仍保存在文件系统中，避免数据库过大。

## 主要 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/config` | 获取默认审查配置 |
| `GET` | `/api/diagnostics/converters` | 查看 LibreOffice / PDF 转换组件状态 |
| `POST` | `/api/reviews` | 上传合同并创建审查任务 |
| `GET` | `/api/reviews/history` | 查看历史任务 |
| `GET` | `/api/reviews/{run_id}` | 查询任务状态 |
| `GET` | `/api/reviews/{run_id}/result` | 获取审查结果 |
| `GET` | `/api/reviews/{run_id}/document` | 获取可预览 DOCX |
| `GET` | `/api/reviews/{run_id}/download` | 下载审查后 DOCX |
| `PATCH` | `/api/reviews/{run_id}/risks/{risk_id}` | 更新风险项状态或内容 |
| `POST` | `/api/reviews/{run_id}/risks/{risk_id}/ai_apply` | 应用单条 AI 修改建议 |
| `POST` | `/api/reviews/{run_id}/ai_apply_all` | 批量应用 AI 修改建议 |

## 旧数据迁移

如果已有旧版 `data/web_meta/*.json` 或 `data/runs` 下的 JSON 产物，可执行：

```bash
python tools/migrate_json_to_sqlite.py \
  --db data/contract_review.sqlite3 \
  --web-meta-root data/web_meta \
  --run-root data/runs
```

Docker 环境：

```bash
docker compose exec backend python tools/migrate_json_to_sqlite.py \
  --db /app/data/contract_review.sqlite3 \
  --web-meta-root /app/data/web_meta \
  --run-root /app/data/runs
```

## 测试

```bash
python -m pytest
```

若本地未安装测试依赖，可先安装：

```bash
python -m pip install pytest
```

## 常见问题

### 容器中无法访问 Dify

容器内的 `localhost` 不是宿主机。请将 `DIFY_BASE_URL` 改为可从容器访问的地址，例如：

- `http://host.docker.internal:端口/v1`
- `http://宿主机局域网IP:端口/v1`
- Dify 独立服务器地址

### PDF 或 DOC 转换失败

Docker 镜像已安装 LibreOffice、中文字体和 PDF 转换依赖。可先检查：

```bash
curl http://localhost:8000/api/diagnostics/converters
```

如果源文件是扫描件、加密文档或损坏文件，建议先另存为标准 `.docx` 后重试。

### 任务长时间不结束

查看后端日志：

```bash
docker compose logs -f backend
```

通常需要检查 Dify API Key、Dify 服务连通性、请求超时和并发配置。

## 安全与部署建议

- 不要提交 `.env`，只提交 `.env.example`。
- 生产环境建议使用 HTTPS 反向代理。
- 定期备份 `data/` 目录。
- 根据服务器性能和 Dify 容量调整并发参数。
- 如上传文件较大，可调整 `frontend/nginx.conf` 的 `client_max_body_size`。
