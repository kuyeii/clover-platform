# 企业竞争对手分析平台

一个面向企业竞争分析场景的 Web 应用。用户输入我方企业后，系统可自动发现竞争对手，或按用户指定的企业进行精确对比；后端会调用多个 Dify Workflow 完成企业信息校验、企业详情补全、对比报告生成、评分汇总，并把完整分析结果保存到本地 SQLite，便于历史回看与分享。

## 目录

- [功能特性](#功能特性)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [运行环境](#运行环境)
- [本地开发](#本地开发)
- [环境变量](#环境变量)
- [分析流程](#分析流程)
- [路由说明](#路由说明)
- [后端 API](#后端-api)
- [数据存储](#数据存储)
- [Docker 部署](#docker-部署)
- [常见问题](#常见问题)
- [开发建议](#开发建议)

## 功能特性

### 竞争分析

- 支持输入我方企业名称、企业介绍、主营业务和省份。
- 支持两种竞争对手匹配模式：
  - **自动匹配**：通过输入校验工作流发现候选竞争对手。
  - **精确匹配**：手动指定 1 至 5 家竞争对手。
- 对我方企业和竞争对手进行名称校验、企业介绍补全和主营业务补全。
- 防止竞争对手名称与我方企业重复，防止竞争对手之间重复。

### 流式分析体验

- 前端通过 `POST /api/analysis/stream` 接收 NDJSON 流式事件。
- 分析过程会按阶段逐步更新页面：
  - 分析开始
  - 竞争对手列表就绪
  - 我方企业详情就绪
  - 竞争对手详情就绪
  - 对比报告就绪
  - 评分结果就绪
  - 完整记录保存完成
- 生成中返回首页后，侧边栏仍保留“分析中”入口，可继续回到当前结果页。
- 生成中状态会临时写入 `sessionStorage`，默认保留 24 小时。

### 结果展示

- 结果页包含我方企业概览、竞争对手列表和详细分析面板。
- 每个竞争对手支持三个详情标签页：
  - 总体信息
  - 公司近况
  - 对比分析报告
- 支持展示企业近期动态列表、产品/服务信息、技术能力分析、威胁分数和竞争分析小结。
- 支持将当前报告导出为 Markdown 文件。

### 历史记录

- 分析结果会自动保存到 SQLite。
- 侧边栏展示历史记录列表。
- 支持通过 `/results/{result_id}` 直接回看历史报告。
- 兼容旧版 `/{result_id}` 分享链接。
- 支持读取、保存、删除单条历史记录和清空全部历史记录。

### 部署能力

- 本地开发时，前端和后端分别运行：
  - 前端：`http://localhost:5174`
  - 后端：`http://localhost:8788`
- 生产或 Docker 环境中，Python 后端可同时提供 API 和前端静态文件服务。
- Docker 镜像采用多阶段构建：Node 构建前端，Python 运行后端。
- 后端健康检查地址：`GET /api/health`。

## 技术栈

| 模块 | 技术 |
| --- | --- |
| 前端 | React 18、Vite 5 |
| 后端 | Python 3 标准库，`http.server` + `ThreadingHTTPServer` |
| 数据库 | SQLite |
| 外部工作流 | Dify Workflow API |
| 开发脚本 | Node.js `child_process` 同时启动前后端 |
| 部署 | Docker、Docker Compose |

> 当前 Python 后端只使用标准库，`backend/requirements.txt` 仅用于说明，不需要额外安装 pip 依赖。

## 项目结构

```text
.
├── backend/
│   ├── data/                         # SQLite 数据与历史记录目录，运行时生成/更新
│   ├── schemas/
│   │   └── analysisRecord.schema.json # 历史记录结构说明
│   ├── README.md                     # 后端说明
│   ├── requirements.txt              # 当前仅说明使用 Python 标准库
│   └── server.py                     # Python API、Dify 编排、SQLite 存储、静态文件服务
├── docs/
│   └── project-structure.md          # 项目结构补充说明
├── public/
│   └── hero-analysis-icon.png        # 首页插图资源
├── scripts/
│   └── dev.js                        # 同时启动后端和前端
├── src/
│   ├── services/
│   │   ├── analysisApi.js            # 完整分析、流式分析、历史记录 API
│   │   ├── companyDetailApi.js       # 企业详情工作流 API 封装
│   │   ├── compareReportApi.js       # 对比报告工作流 API 封装
│   │   ├── scoreApi.js               # 评分工作流 API 封装
│   │   └── workflowApi.js            # 输入校验与企业名称校验 API 封装
│   ├── App.css                       # 页面样式
│   ├── App.jsx                       # 主页面、表单、结果页、历史恢复、流式状态管理
│   ├── index.css                     # 全局样式
│   ├── main.jsx                      # React 入口
│   └── routes.js                     # 首页与结果页路由解析/跳转
├── .dockerignore
├── .env.example                      # 环境变量模板
├── .gitignore
├── Dockerfile
├── docker-compose.yml
├── index.html
├── package.json
├── package-lock.json
└── vite.config.js
```

## 运行环境

建议版本：

- Node.js 18 或更高版本
- Python 3.9 或更高版本
- npm
- Docker / Docker Compose，可选，仅部署时需要

## 本地开发

### 1. 安装前端依赖

```bash
npm install
```

如果需要严格按照 `package-lock.json` 安装，可以使用：

```bash
npm ci
```

### 2. 准备环境变量

```bash
cp .env.example .env.local
```

然后编辑 `.env.local`，填入 Dify Workflow 地址和 API Key。

> 不要把真实 `.env.local`、`.env.production` 或任何包含 API Key 的文件提交到仓库。

### 3. 启动前后端

```bash
npm run dev
```

该命令会同时启动：

```text
前端：http://localhost:5174
后端：http://localhost:8788
```

也可以分两个终端单独启动：

```bash
npm run dev:backend
npm run dev:frontend
```

后端也支持通过命令行或环境变量指定监听地址：

```bash
python3 backend/server.py --host 0.0.0.0 --port 8788
BACKEND_HOST=0.0.0.0 BACKEND_PORT=8788 python3 backend/server.py
```

Windows 环境如果没有 `python3` 命令，可以使用：

```bash
py -3 backend/server.py
```

或者在启动前设置 `PYTHON` 环境变量：

```bash
PYTHON=python npm run dev
```

### 4. 构建前端

```bash
npm run build
```

构建产物输出到：

```text
dist/
```

### 5. 本地预览构建产物

```bash
npm run preview
```

> 生产部署时通常不需要 `vite preview`，因为 Python 后端会在 `STATIC_DIR` 指向 `dist/` 时托管静态文件。

## 环境变量

项目会优先读取 `.env` 与 `.env.local`。建议新项目使用非 `VITE_` 前缀的后端变量，避免密钥进入前端构建产物。当前后端仍兼容旧版 `VITE_*` 变量。

### 后端服务变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `BACKEND_HOST` | `0.0.0.0` | 后端监听地址 |
| `BACKEND_PORT` | `8788` | 后端监听端口 |
| `HISTORY_SERVER_HOST` | - | 兼容旧变量，优先级高于 `BACKEND_HOST` |
| `HISTORY_SERVER_PORT` | - | 兼容旧变量，优先级高于 `BACKEND_PORT` |
| `CORS_ORIGIN` | `http://localhost:5174` | 允许跨域访问的前端来源 |
| `STATIC_DIR` | `dist` | 静态文件目录。Docker 中默认为 `/app/dist` |
| `HISTORY_MAX_ITEMS` | `200` | 历史记录最大保留条数 |
| `HISTORY_DB_PATH` | `backend/data/history.sqlite3` | SQLite 数据库路径 |
| `SQLITE_DB_PATH` | - | SQLite 路径兼容变量 |
| `COMPANY_MEMORY_CACHE_SIZE` | `5000` | 企业名称校验内存缓存上限 |

在 `clover-platform` 根目录使用统一启动器时，竞对分析前端和后端会分别使用 `config/apps.yaml` 中的动态端口范围启动；启动器会向前端注入 `VITE_API_BASE_URL=http://127.0.0.1:<竞对分析后端端口>`，因此 iframe 会打开竞对分析前端端口，前端 API 请求会访问对应的竞对分析后端端口。单独启动本项目时仍可继续使用 `npm run dev` 或分开运行前后端。

### 通用 Dify 变量

| 变量 | 说明 |
| --- | --- |
| `WORKFLOW_URL` | 通用 Dify Workflow 地址，默认请求路径通常是 `/v1/workflows/run` |
| `WORKFLOW_API_KEY` | 输入校验 / 竞争对手发现工作流 API Key |
| `WORKFLOW_USER` | Dify user 字段，默认 `admin` |
| `DIFY_WORKFLOW_TIMEOUT_SECONDS` | Dify 请求超时时间，默认 600 秒 |
| `WORKFLOW_TIMEOUT_SECONDS` | Dify 请求超时时间兼容变量 |

### 企业名称校验工作流

| 变量 | 说明 |
| --- | --- |
| `COMPANY_NAME_VALIDATION_URL` | 企业名称候选校验工作流 URL |
| `COMPANY_NAME_VALIDATION_API_KEY` | 企业名称候选校验工作流 API Key |
| `COMPANY_NAME_VALIDATION_USER` | Dify user 字段 |

该工作流用于首页企业名称输入框的候选企业搜索、名称确认和企业介绍/主营业务补全。

### 企业详情工作流

| 变量 | 说明 |
| --- | --- |
| `COMPANY_DETAIL_URL` | 企业详情工作流 URL |
| `COMPANY_DETAIL_API_KEY` | 企业详情工作流 API Key |
| `COMPANY_DETAIL_USER` | Dify user 字段 |
| `COMPANY_DETAIL_TIMEOUT_SECONDS` | 企业详情工作流超时时间，默认 900 秒 |

该工作流输出会被解析为：

```text
lately      企业近期信息摘要
latelyItems 企业动态列表
product     产品/服务信息
tech        技术能力分析
```

### 对比报告工作流

对比报告当前拆成多个子工作流并行/串行编排：

| 子流程 | URL 变量 | API Key 变量 |
| --- | --- | --- |
| 产品/服务对比 | `COMPARE_REPORT_PRODUCT_URL` | `COMPARE_REPORT_PRODUCT_API_KEY` |
| 技术力对比 | `COMPARE_REPORT_TECH_URL` | `COMPARE_REPORT_TECH_API_KEY` |
| 近期动态对比 | `COMPARE_REPORT_LATELY_URL` | `COMPARE_REPORT_LATELY_API_KEY` |
| 汇总报告 | `COMPARE_REPORT_SUMMARY_URL` | `COMPARE_REPORT_SUMMARY_API_KEY` |

通用回退变量：

| 变量 | 说明 |
| --- | --- |
| `COMPARE_REPORT_URL` | 对比报告默认 URL |
| `COMPARE_REPORT_API_KEY` | 对比报告默认 API Key |
| `COMPARE_REPORT_USER` | Dify user 字段 |

当某个子流程没有配置专属 Key 时，后端会回退到 `COMPARE_REPORT_API_KEY`。

### 评分工作流

| 变量 | 说明 |
| --- | --- |
| `SCORE_URL` | 评分工作流 URL |
| `SCORE_API_KEY` | 评分工作流 API Key |
| `SCORE_USER` | Dify user 字段 |

后端优先读取 `SCORE_API_KEY`，同时兼容旧变量 `VITE_SCORE_API_KEY`。

## 分析流程

一次完整分析大致分为以下阶段：

```text
用户输入
  ↓
企业名称校验 / 信息补全
  ↓
根据模式确定竞争对手
  ├─ 自动匹配：调用输入校验工作流发现候选竞争对手
  └─ 精确匹配：使用用户手动输入的竞争对手
  ↓
调用企业详情工作流
  ├─ 我方企业详情
  └─ 每个竞争对手详情
  ↓
调用对比报告工作流
  ├─ 产品/服务对比
  ├─ 技术力对比
  ├─ 近期动态对比
  └─ 汇总报告
  ↓
调用评分工作流
  ↓
保存 SQLite 历史记录
  ↓
前端结果页展示 / 历史回看 / 导出 Markdown
```

自动匹配最多保留 5 家竞争对手。精确匹配模式也最多支持 5 家竞争对手。

如果未配置完整 API Key，代码中保留了演示数据回退逻辑，用于本地界面调试。

## 路由说明

### 首页

```text
/
```

首页支持通过查询参数指定匹配模式：

```text
/?mode=exact
```

### 结果页

```text
/results/{result_id}
```

结果页会读取 `result_id`，调用：

```text
GET /api/history/{result_id}
```

然后恢复对应的历史结果。

### 结果页查询参数

| 参数 | 说明 |
| --- | --- |
| `tab` | 结果详情标签页，可选 `overview`、`dynamics`、`report` |
| `competitor` | 当前选中的竞争对手 ID |

示例：

```text
/results/history-xxxx?tab=report&competitor=competitor-1
```

### 兼容旧链接

旧版形如 `/{result_id}` 的单段路径仍会被识别为结果页，并自动按历史记录读取。

## 后端 API

### 健康检查

```http
GET /api/health
```

返回示例：

```json
{
  "ok": true,
  "service": "competitor-analysis-backend"
}
```

### 完整分析

```http
POST /api/analysis
```

执行完整分析并在结束后返回完整记录。当前前端主要使用流式接口。

### 流式完整分析

```http
POST /api/analysis/stream
```

请求体示例：

```json
{
  "targetCompanyName": "杭州明实科技有限公司",
  "targetCompanyIntro": "企业介绍",
  "targetCompanyBusiness": "主营业务",
  "targetCompanyConfirmed": true,
  "province": "全国",
  "competitorCompanyName": "深圳市腾讯计算机系统有限公司",
  "matchMode": "exact",
  "resultId": "history-xxxxxx"
}
```

返回内容类型：

```text
application/x-ndjson; charset=utf-8
```

可能返回的事件类型：

| 事件 | 说明 |
| --- | --- |
| `analysis_started` | 分析开始，返回 `resultId` |
| `competitors_ready` | 竞争对手列表已生成 |
| `target_detail_ready` | 我方企业详情已生成 |
| `competitor_detail_ready` | 单个竞争对手详情已生成 |
| `compare_report_ready` | 单个竞争对手对比报告已生成 |
| `score_ready` | 评分结果已生成 |
| `analysis_finished` | 完整记录已保存 |
| `analysis_error` | 分析失败 |

### 工作流代理接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/workflows/validate` | 输入校验 / 自动发现竞争对手 |
| `POST` | `/api/workflows/company-name-validate` | 企业名称候选校验与缓存查询 |
| `POST` | `/api/workflows/company-detail` | 企业详情、近期动态、产品/服务、技术能力 |
| `POST` | `/api/workflows/compare-report` | 对比报告生成 |
| `POST` | `/api/workflows/score` | 评分报告生成 |

### 历史记录接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/history` | 获取历史记录列表 |
| `GET` | `/api/history/{id}` | 获取单条历史记录 |
| `POST` | `/api/history` | 保存一条历史记录 |
| `DELETE` | `/api/history/{id}` | 删除单条历史记录 |
| `DELETE` | `/api/history` | 清空历史记录 |

## 数据存储

默认数据库路径：

```text
backend/data/history.sqlite3
```

SQLite 中主要包含：

- `history_records`：历史分析记录
- `storage_meta`：存储迁移标记等元信息
- `company_profiles`：企业基础信息缓存
- `company_validation_queries`：企业名称校验查询缓存

后端启动时会自动创建表结构，并启用 WAL。服务首次启动时会尝试迁移旧版 JSON 数据，兼容来源包括：

```text
backend/data/index.json
backend/data/history/{result_id}.json
backend/data/history.json
```

如需自定义数据库路径：

```bash
HISTORY_DB_PATH=/path/to/history.sqlite3
```

## Docker 部署

### 1. 准备环境变量

```bash
cp .env.example .env.local
```

编辑 `.env.local`，填入生产环境 Dify Workflow 地址和 API Key。

如果 Dify 运行在宿主机，容器内不能使用 `localhost` 访问宿主机服务。Mac/Windows Docker Desktop 可使用：

```env
WORKFLOW_URL=http://host.docker.internal/v1/workflows/run
COMPANY_NAME_VALIDATION_URL=http://host.docker.internal/v1/workflows/run
COMPANY_DETAIL_URL=http://host.docker.internal/v1/workflows/run
COMPARE_REPORT_URL=http://host.docker.internal/v1/workflows/run
SCORE_URL=http://host.docker.internal/v1/workflows/run
```

如果 Dify 是远程服务，直接填写远程地址即可。

### 2. 构建并启动

```bash
docker compose up -d --build
```

访问：

```text
http://localhost:8788
```

### 3. 查看健康状态

```bash
curl http://localhost:8788/api/health
```

### 4. 查看日志

```bash
docker compose logs -f competitor-analysis
```

### 5. 停止服务

```bash
docker compose down
```

### Docker Compose 说明

当前 `docker-compose.yml` 会：

- 构建当前项目镜像。
- 暴露宿主机端口 `8788`。
- 读取 `.env.local`。
- 设置 `STATIC_DIR=/app/dist`。
- 设置 `HISTORY_DB_PATH=/app/backend/data/history.sqlite3`。
- 将本机 `./backend/data` 挂载到容器 `/app/backend/data`，保证 SQLite 数据持久化。

## 常见问题

### 1. 启动后提示 API Key 未配置

检查 `.env.local` 是否已填写对应工作流 Key。至少需要根据使用场景配置：

```env
WORKFLOW_API_KEY=...
COMPANY_NAME_VALIDATION_API_KEY=...
COMPANY_DETAIL_API_KEY=...
COMPARE_REPORT_API_KEY=...
SCORE_API_KEY=...
```

如果对比报告拆成 4 个子工作流，还需要配置对应的 `COMPARE_REPORT_PRODUCT_API_KEY`、`COMPARE_REPORT_TECH_API_KEY`、`COMPARE_REPORT_LATELY_API_KEY`、`COMPARE_REPORT_SUMMARY_API_KEY`。

### 2. Docker 容器里无法访问 Dify

如果 Dify 在宿主机运行，不要在容器中使用：

```env
WORKFLOW_URL=http://localhost/v1/workflows/run
```

应改为：

```env
WORKFLOW_URL=http://host.docker.internal/v1/workflows/run
```

Linux 环境可能还需要在运行容器时添加 host 映射，当前手动 `docker run` 可使用：

```bash
--add-host=host.docker.internal:host-gateway
```

### 3. `npm run build` 报 Rollup optional dependency 缺失

如果压缩包或跨平台拷贝时带了不完整的 `node_modules`，可能会出现类似错误：

```text
Cannot find module @rollup/rollup-linux-x64-gnu
```

删除本地依赖后重新安装即可：

```bash
rm -rf node_modules
npm ci
npm run build
```

### 4. 历史记录没有保存

检查：

- `backend/data` 是否可写。
- `HISTORY_DB_PATH` 指向的目录是否存在或可创建。
- Docker 是否正确挂载了 `./backend/data:/app/backend/data`。

### 5. 结果页刷新后找不到记录

结果页依赖后端历史接口：

```text
GET /api/history/{result_id}
```

请确认：

- 后端仍在运行。
- SQLite 数据库没有被删除。
- Docker 部署时已挂载 `backend/data`。
- URL 中的 `result_id` 与历史记录 ID 一致。

## 开发建议

- 不要提交 `.env.local`、`.env.production`、SQLite 数据库、`node_modules`、`dist` 等运行产物。
- API Key 应尽量使用无 `VITE_` 前缀的后端变量，例如 `SCORE_API_KEY`，避免被前端构建过程暴露。
- 修改 Dify 输出结构时，需要同步检查后端解析逻辑：
  - `run_input_validation_workflow`
  - `run_company_name_validation_workflow`
  - `run_company_detail_workflow`
  - `run_compare_report_workflow`
  - `run_score_workflow`
- 修改历史记录结构时，需要同步检查：
  - `backend/schemas/analysisRecord.schema.json`
  - `build_record`
  - `row_to_record`
  - 前端 `applyRecordSnapshot`
- 修改结果页路由时，需要同步检查：
  - `src/routes.js`
  - `pushResultRoute`
  - `replaceResultRoute`
  - 历史记录恢复逻辑
