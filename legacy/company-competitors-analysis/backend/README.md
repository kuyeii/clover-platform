# Backend

本目录是 Python 后端服务，负责：

- 读取 `.env` / `.env.local` 中的工作流地址与 API Key
- 调用 Dify 工作流并做结果解析、重试与错误归一化
- 编排一次完整竞争分析任务：输入校验 → 企业详情 → 对比报告 → 评分
- 将分析结果保存到本地 SQLite 历史记录数据库
- 提供 `GET /api/history/:id`，支持前端通过 `/results/{result_id}` 回看历史结果
- 在 Docker / 生产环境中托管 `dist/` 静态文件，并对前端路由做 SPA fallback

## 启动

在项目根目录执行：

```bash
npm install
cp .env.example .env.local
npm run dev
```

`npm run dev` 会同时启动：

- 前端：`http://localhost:5174`
- 后端：`http://localhost:8788`

也可以只启动后端：

```bash
python3 backend/server.py
```

Python 后端只使用标准库，不需要额外依赖。`backend/requirements.txt` 仅作说明。

## API

- `POST /api/analysis`：执行完整分析并自动保存历史记录
- `POST /api/analysis/stream`：流式执行完整分析
- `GET /api/health`：健康检查
- `POST /api/workflows/validate`：输入校验工作流
- `POST /api/workflows/company-name-validate`：企业名称输入校验工作流
- `POST /api/workflows/company-detail`：企业详情工作流
- `POST /api/workflows/compare-report`：对比报告工作流
- `POST /api/workflows/score`：评分工作流
- `GET /api/history`：历史记录列表
- `GET /api/history/:id`：读取单条历史记录
- `POST /api/history`：保存单条历史记录
- `DELETE /api/history/:id`：删除单条历史记录
- `DELETE /api/history`：清空历史记录

## 数据存储

当前使用本地 SQLite 存储：

```text
backend/data/history.sqlite3
```

可以通过 `HISTORY_DB_PATH` 或 `SQLITE_DB_PATH` 覆盖数据库路径。服务首次启动时会自动迁移旧版 JSON 数据：

```text
backend/data/index.json
backend/data/history/{result_id}.json
backend/data/history.json
```

## 静态文件托管

当 `dist/` 存在时，后端会托管前端构建产物。可通过环境变量覆盖目录：

```bash
STATIC_DIR=/app/dist
```
