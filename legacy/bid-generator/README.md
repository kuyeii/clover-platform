# ProEngine — 企业级自动化标书生成系统

> Agentic RAG 架构 · 以项目为中心的招投标文件智能生成平台

---

## 系统架构总览

```
用户上传招标文件（PDF / DOCX / TXT）
         │
         ▼
 ┌──────────────────┐
 │   frontend-web   │  React 18 + TypeScript + Vite + Tailwind CSS
 │   localhost:5173 │  项目管理 · 需求核对 · 大纲/蓝图 · 模板编辑 · 一键导出
 └────────┬─────────┘
          │  HTTP/JSON    baseURL = http://localhost:5000/api
          ▼
 ┌──────────────────┐
 │   pipt-flask     │  FastAPI · uvicorn · 端口 5000
 │  main_lite.py    │  router 挂载于 /api 前缀
 │                  │
 │  /api/...        │  ← 所有业务接口均以 /api 开头
 └────────┬─────────┘
          │
          ├──── NER + 脱敏引擎（DesensitizeEngine，基于 HanLP）
          │         /api/desensitize · /api/recognize · /api/restore
          │
          ├──── 项目工作流接口（routes.py）
          │         /api/projects/extract            ← 上传招标文件，脱敏 + 需求提取
          │         /api/projects/generate-outline   ← AI 生成大纲（Dify: structure_generator）
          │         /api/projects/generate-blueprint ← 历史蓝图链路（当前不在 dify/manifest 管理范围）
          │         /api/projects/generate-content   ← AI 生成章节内容（Dify: content_writer）
          │         /api/projects/generate-attachment← Jinja2 渲染附件模板
          │         /api/projects/build-scoring-table← 初始化自评评分表
          │         /api/projects/fill-scoring-row   ← AI 填写单行评分（历史兼容链路）
          │         /api/projects/export-scoring-table← 导出 Excel 评分表
          │         /api/projects/forge-document     ← 组装并导出最终 .docx
          │
          ├──── 模板配置接口
          │         /api/config/template             ← CRUD 章节大纲 YAML 模板
          │         /api/config/global               ← 读写 config.yaml
          │
          ▼ Dify Workflow API (Bearer Token)
 ┌──────────────────────────────────────────┐
 │        Dify 工作流平台（当前纳管）         │
 │  structure_generator        → 大纲生成     │
 │  content_writer             → 单章节正文   │
 │  content_group_writer       → H2 分组正文  │
 │  content_rewrite            → 单章节改写   │
 │  response_content_writer    → 响应类正文   │
 │  diagram_generator          → 图表示意     │
 │  doc_analysis               → 文档分析     │
 └──────────────────────────────────────────┘
          │（全部调用完成后，内容回到后端）
          ▼
 ┌──────────────────┐
 │   gateway-out    │  python-docx · python 库（非独立服务）
 │  (被 pipt-flask  │  DocumentForge.build()：
 │   动态 import)   │    1. {{__BIDDER_*__}} 投标人信息还原
 │                  │    2. {{__PIPT_*__}} 脱敏占位符还原
 │                  │    3. Markdown → Word 正文
 │                  │    4. 自评评分表嵌入（Word 内嵌表格）
 │                  │    5. 附件追加（分页独页）
 └──────────────────┘
```

---

> 📄 **Dify 工作流接口详细说明**（当前 `dify/manifest.yml` 管理的 7 条工作流）：[docs/dify-workflows.md](docs/dify-workflows.md)

## 当前 Dify 治理口径

- 当前由 `dify/manifest.yml + dify/workflows/` 纳入统一治理的 DSL 只有 7 条：
  `structure_generator`、`content_writer`、`content_group_writer`、`content_rewrite`、`response_content_writer`、`diagram_generator`、`doc_analysis`。
- `requirement_extractor`、`blueprint_generator`、`scoring_assistant`、`attachment_generator`、`group_review_writer` 仍可能在业务代码或历史文档中出现，但**不属于当前清理后的 DSL 规范入口**。
- 模型版本统一改写与节点漂移检测只针对 `dify/manifest.yml` 已登记的工作流生效。





## 关于 router 与路由前缀

- `pipt-flask/app/api_lite/routes.py` 中定义 `router = APIRouter(tags=["脱敏服务"])`
- `main_lite.py` 以 `app.include_router(api_router, prefix="/api")` 挂载
- **因此所有业务接口的真实 URL 均带 `/api` 前缀**，例如：
  - 调用需求提取：`POST http://localhost:5000/api/projects/extract`
  - 前端 `api.ts` 的 `baseURL = http://localhost:5000/api`，然后写 `/projects/extract`，完全对齐

---

## 用户工作流（前端视角）

```
① 新建项目 → 上传招标文件（PDF/DOCX/TXT）
         ↓
② pipt-flask：文件解析 + NER 脱敏
   → 历史实现中会调用 requirement_extractor；该链路当前未纳入清理后的 dify/manifest 管理
         ↓
③ 用户核对需求列表（可增删改），点击「确认需求」
         ↓
④ pipt-flask：调用 Dify structure_generator → 一级+二级大纲 + writingHint
         ↓
⑤ 用户确认大纲，点击「确认大纲」
         ↓
⑥ pipt-flask：历史实现中可能调用 blueprint_generator 生成蓝图
   → 该链路当前未纳入清理后的 dify/manifest 管理
         ↓
⑦ 用户轻量编辑蓝图后确认（进入 editing 状态）
         ↓
⑧ TemplateEditor：逐章节 AI 生成内容
   （附件 → AttachmentFiller，评分表 → ScoringTable）
         ↓
⑨ 点击「生成最终文档」→ gateway-out 组装 → 浏览器下载 .docx
```

---

## 数据安全策略

| 数据类型 | 处理方式 |
|----------|----------|
| 招标文件原文 | NER 脱敏，占位符替换后传给 Dify |
| 脱敏映射表 `mapping_table` | **仅存 localStorage**，绝不上传任何外部服务 |
| 投标人信息 `bidderInfo` | **仅存 localStorage**，以 `{{__BIDDER_*__}}` 占位符形式注入提示词，最终在本地还原 |
| Dify 工作流 API Key | 仅存 `.env`，不进入版本库 |

---

## 子工作区

| 目录 | 角色 | 主要技术 |
|------|------|----------|
| `frontend-web/` | React 管理前端 | React 18 · TypeScript · Vite · Tailwind CSS |
| `pipt-flask/` | 后端 API 服务（主力） | FastAPI · uvicorn · HanLP · httpx · pdfplumber |
| `gateway-out/` | Docx 组装库（被 pipt-flask import） | python-docx · Jinja2 |
| `dify-bridge/` | 历史 Dify 桥接目录 | Python · Dify API |
| `prompt-forge/` | 提示词构建工具 | Python · Jinja2 |
| `gateway-in/` | 早期入口网关（已归档） | Python |

---

## 全局配置文件

| 文件 | 用途 |
|------|------|
| `config.yaml` | 脱敏 profile、工作流 enabled 开关、Dify 基础配置 |
| `.env` | **Dify API 密钥**（`DIFY_WORKFLOW_*`），不得提交版本库 |

`.env` 中当前纳管的核心密钥如下：

```bash
DIFY_WORKFLOW_STRUCTURE_GENERATOR=app-xxxx
DIFY_WORKFLOW_CONTENT_WRITER=app-xxxx
DIFY_WORKFLOW_CONTENT_GROUP_WRITER=app-xxxx
DIFY_WORKFLOW_CONTENT_REWRITE=app-xxxx
DIFY_WORKFLOW_RESPONSE_CONTENT_WRITER=app-xxxx
DIFY_WORKFLOW_DIAGRAM_GENERATOR=app-xxxx
DIFY_WORKFLOW_DOC_ANALYSIS=app-xxxx
```

若仍启用历史链路，再按需补充：
`DIFY_WORKFLOW_REQUIREMENT_EXTRACTOR`、`DIFY_WORKFLOW_BLUEPRINT_GENERATOR`、`DIFY_WORKFLOW_GROUP_REVIEW_WRITER`、`DIFY_WORKFLOW_ATTACHMENT_GENERATOR`、`DIFY_WORKFLOW_SCORING_ASSISTANT`。

---

## 快速启动

### 1. 后端（pipt-flask）

```bash
cd pipt-flask

# 安装依赖
pip install -r requirements-lite.txt
pip install pdfplumber python-docx python-dotenv openpyxl

# 配置密钥
cp ../.env.example ../.env
# 编辑 .env，填入 DIFY_WORKFLOW_* 密钥

# 启动（开发模式，支持热重载）
python main_lite.py
# → 监听 http://localhost:5000
# → API 文档：http://localhost:5000/apidoc
```

### 2. 前端（frontend-web）

```bash
cd frontend-web
npm install
npm run dev
# → 监听 http://localhost:5173
```

### 3. gateway-out 依赖（首次使用）

gateway-out 以 Python 库形式被 pipt-flask 动态 import，需提前安装：

```bash
cd gateway-out
pip install -e .
```

### 4. 一键启动（后台模式）

```bash
bash run_all.sh   # 启动 pipt-flask + 执行全链路编排（CLI 模式）
```

---

## API 接口速查

> 完整交互文档：`http://localhost:5000/apidoc`（Swagger UI）

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/projects/extract` | POST | 上传招标文件，脱敏 + 需求提取 |
| `/api/projects/generate-outline` | POST | 生成一级+二级大纲 |
| `/api/projects/generate-blueprint` | POST | 生成全局投标蓝图 |
| `/api/projects/generate-content` | POST | 生成单章节内容 |
| `/api/projects/generate-attachment` | POST | 渲染附件模板（申请书/委托书等） |
| `/api/projects/build-scoring-table` | POST | 初始化自评评分表 |
| `/api/projects/fill-scoring-row` | POST | AI 自动填写评分行 |
| `/api/projects/export-scoring-table` | POST | 导出 Excel 评分表 |
| `/api/projects/forge-document` | POST | 组装并导出最终 `.docx` |
| `/api/config/template` | GET/PUT/DELETE | CRUD 章节大纲 YAML 模板 |
| `/api/config/global` | PUT | 更新 config.yaml |
| `/api/desensitize` | POST | 单文本脱敏 |
| `/api/restore` | POST | 按 session 还原脱敏文本 |
| `/api/health` | GET | 服务健康检查 |

---

## 技术栈

- **后端**: Python 3.11 · FastAPI · uvicorn · HanLP NER · httpx · pdfplumber · python-docx · openpyxl
- **前端**: React 18 · TypeScript · Vite · Tailwind CSS · Lucide Icons · @dnd-kit
- **AI 中枢**: Dify（自托管）· RAG 知识库 · SearXNG 联网搜索（可选）
- **文档输出**: python-docx · openpyxl · Jinja2
