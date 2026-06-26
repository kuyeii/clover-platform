# 合同审查系统

合同审查是 `clover-platform` 中仍以独立 FastAPI 后端和 React/Vite 前端运行的 legacy 模块。当前阶段只把审查运行元数据和结构化 artifact 索引切换到 PostgreSQL 18；合同审查核心流程、Dify 调用、DOCX 导出和 Portal iframe 集成保持不变。

## 存储边界

PostgreSQL 使用 `contract_review` schema：

- `contract_review.review_runs`
- `contract_review.review_json_artifacts`
- `contract_review.review_text_artifacts`
- `contract_review.review_file_assets`

`contract_review.review_runs` 是运行元数据主表；`review_json_artifacts` / `review_text_artifacts` 是 PostgreSQL 中的结构化 artifact 索引增强，默认开启。旧 SQLite / JSON 历史数据不迁移、不删除。上传文件、转换文件、DOCX 导出文件、日志和 `data/runs` 运行产物仍保留在文件系统中，本阶段不接 MinIO。

## 技术栈

| 模块 | 技术 |
| --- | --- |
| 后端 API | FastAPI、Uvicorn、Pydantic |
| 文档处理 | python-docx、lxml、LibreOffice、PyMuPDF、pdf2docx |
| AI 工作流 | Dify Workflow API |
| 数据存储 | PostgreSQL 18、SQLAlchemy、psycopg |
| 前端 | React 18、TypeScript、Vite、Tailwind CSS、docx-preview |

## 目录结构

```text
legacy/contract_review/
  app.py                         # 命令行审查入口
  web_api.py                     # FastAPI Web API 入口
  config.py                      # 环境变量配置
  requirements.txt               # Python 依赖
  Dockerfile                     # legacy 容器构建文件，非最终统一部署入口
  docker-compose.yml             # legacy 编排示例，依赖 monorepo PostgreSQL 配置
  frontend/
    Dockerfile
    nginx.conf
    package.json
    src/
  src/
    review_store.py              # PostgreSQL 存储
    document_ingest.py
    workflow_runner.py
    docx_comments.py
    docx_apply_patches.py
    ...
  tests/
  data/                          # 上传文件与运行产物目录，不提交 Git
```

## 统一开发启动

在 `clover-platform` 根目录准备 `.env`，配置 `DATABASE_URL`，或配置 `POSTGRES_HOST` / `POSTGRES_PORT` / `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD`。根目录 `.env` 优先，`legacy/contract_review/.env` 仅用于单独调试时补充非敏感本地配置。

新环境初始化：

```bash
python scripts/init_db.py
alembic upgrade head
python scripts/check_db.py
python scripts/preflight.py --only contract-review
```

启动合同审查：

```bash
python scripts/dev.py --only contract-review
```

启动全部已接入模块：

```bash
python scripts/dev.py
```

统一启动器会为合同审查后端分配动态端口，并向前端注入 `VITE_API_BASE_URL=http://127.0.0.1:<backend_port>`。单独启动本项目时仍可使用默认 `8000/5173`，旧的 `VITE_API_TARGET` 也继续兼容。

## 单独本地调试

后端：

```bash
cd legacy/contract_review
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r ../../requirements-dev.txt
python -m pip install -r requirements.txt
uvicorn web_api:app --reload --host 0.0.0.0 --port 8000
```

前端：

```bash
cd legacy/contract_review/frontend
npm install
npm run dev
```

前端默认地址：`http://localhost:5173`。后端默认地址：`http://localhost:8000`。

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
| `DATABASE_URL` | PostgreSQL 连接串，优先从 `clover-platform/.env` 读取 |
| `POSTGRES_HOST` / `POSTGRES_PORT` / `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | 未配置 `DATABASE_URL` 时使用 |
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
| `REQUEST_TIMEOUT_SECONDS` | Dify 请求超时时间，默认 900 秒 |
| `DIFY_MAX_CONCURRENCY` | 风险识别并发数 |
| `CLAUSE_SPLIT_MAX_CONCURRENCY` | 条款切分并发数 |
| `RUN_ROOT` | 运行产物目录，本地默认 `data/runs` |
| `MIRROR_RUN_ARTIFACTS_TO_DB` | JSON / 文本 artifact 的 PostgreSQL 同步开关，默认 `1`；设为 `0` 可关闭同步，`data/runs` 仍是文件产物主存储 |
| `DEBUG_SAVE_INTERMEDIATE` | 是否保留中间产物 |
| `FAST_SCREEN_ENABLED` | 是否启用 Fast Screen |
| `FAST_SCREEN_MAX_CANDIDATES` | Fast Screen 最大候选数 |

## 数据与产物

默认数据目录：`data/`

```text
data/
  uploads/                       # Web 上传原文件
  runs/<run_id>/                 # 单次审查运行产物、转换文件、导出文件、日志
```

PostgreSQL 中 `contract_review.review_runs` 保存审查任务元数据、任务状态、进度和错误信息。`review_json_artifacts` / `review_text_artifacts` 默认同步 JSON / 文本 artifact，作为结构化查询和排查增强；同步失败不会影响文件落盘。DOCX、PDF、上传文件、日志和导出文件仍保存在文件系统中，避免数据库过大。

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
| `POST` | `/api/reviews/{run_id}/risks/accept_all` | 批量接受风险项 |
| `POST` | `/api/reviews/{run_id}/risks/{risk_id}/ai_apply` | 应用单条 AI 修改建议 |
| `POST` | `/api/reviews/{run_id}/ai_apply_all` | 批量应用 AI 修改建议 |
| `POST` | `/api/reviews/{run_id}/risks/{risk_id}/ai_accept` | 接受单条 AI 修改建议 |
| `PATCH` | `/api/reviews/{run_id}/risks/{risk_id}/ai_edit` | 编辑 AI 修改建议 |
| `POST` | `/api/reviews/{run_id}/risks/{risk_id}/ai_reject` | 拒绝 AI 修改建议 |

## 测试

```bash
python -m pytest
```

若本地未安装测试依赖，可先安装：

```bash
python -m pip install pytest
```

## 常见问题

### 无法连接 PostgreSQL

确认已在 `clover-platform/.env` 配置 `DATABASE_URL` 或完整 `POSTGRES_*`，并已执行：

```bash
python scripts/init_db.py
alembic upgrade head
python scripts/check_db.py
```

### 容器或本地进程中无法访问 Dify

`localhost` 指当前进程所在环境，不一定是宿主机。请将 `DIFY_BASE_URL` 改为可访问地址，例如：

- `http://host.docker.internal:端口/v1`
- `http://宿主机局域网IP:端口/v1`
- Dify 独立服务器地址

### PDF 或 DOC 转换失败

可先检查：

```bash
curl http://localhost:8000/api/diagnostics/converters
```

如果源文件是扫描件、加密文档或损坏文件，建议先另存为标准 `.docx` 后重试。

## 安全与部署建议

- 不要提交 `.env`，只提交 `.env.example`。
- 不要把数据库密码、Dify key 或 token 写入代码和文档。
- 生产环境建议使用 HTTPS 反向代理。
- 定期备份 PostgreSQL 和 `data/` 目录。
- 根据服务器性能和 Dify 容量调整并发参数。
