# 基于 LLM 的聊天应用（前后端分离）

前端为仿 ChatGPT 主页风格的会话界面（Vite + React + Tailwind）；后端为 **FastAPI**，按你在 `.env` 中配置的上游 **工作流 / 编排 API**，以 `response_mode: streaming` 拉取 SSE，将其中 **`event: text_chunk`** 的增量文本转发给浏览器，并把前端会话列表和每一轮问答记录写入 clover-platform 的 PostgreSQL `rag` schema。

## 后续较为关键的TODO
- 增加单次对话中对先前对话内容的记忆功能
- 优化对话框里返回内容的格式。目前发现输出会吞掉一些换行，以及一些markdown内容的格式
- 优化底层LLM提示词

## 功能概要

| 模块 | 说明 |
|------|------|
| 流式回答 | 上游按行输出 `data: {...}`，解析 `text_chunk` 后通过 `POST /api/v1/chat/stream` 推送 `delta` 事件 |
| Markdown 展示 | `react-markdown` + `remark-gfm`；围栏外先做统一预处理：段落块之间仍用空行分段，块**内部**的单换行一律转为 Markdown 硬换行（行末两空格），与相邻 `1.`/`2.` 列表行除外以免破坏列表解析；另有 `**…**` 内 trim、行首 `1、`→`1.`、字面量 `\\n`→换行等，且不改动 fenced 代码块 |
| 联网检索开关 | 底部「联网」开关对应上游 `inputs.allow_search`：**开**=`"1"`，**关**=`"0"` |
| 等待提示 | 已发送且尚未收到首段流式正文时，在输入框上方展示「正在分析问题与检索资料」与转圈占位 |
| 输入法友好 | **Enter** 发送；**Shift+Enter**、**Ctrl+Enter / ⌘+Enter** 换行；输入法选词过程的回车不会误触发送 |
| 多会话与后端历史 | 侧边栏「新聊天」「搜索聊天」「最近」同上；**会话列表与消息**写入 PostgreSQL `rag.conversations`，最多同步 80 条 |
| 后端按轮归档 | 流式结束后每轮一问一答写入 PostgreSQL `rag.chat_turns`（与前端 `sessionId` 对齐） |
| 知识库（侧栏「知识库管理」） | 列表/删除、**文本创建**、**文件上传**：由后端代理 Dify Dataset API，`dataset` 密钥仅存服务端；文本与文件接口均会在索引完成后一并返回 |

## 目录结构

- `frontend/`：React + Vite + TypeScript + Tailwind
- `backend/`：FastAPI、HTTP 上游客户端、`environment.yml`（Conda）、`pyproject.toml`（Python ≥3.11）
- `data/`：保留 legacy 目录占位；当前对话列表和问答 turn 记录写入 PostgreSQL，不迁移旧本地历史数据

## 环境要求

- **后端**：Python **3.11+**（推荐 **3.12**）；`backend/pyproject.toml` 中 `requires-python >= 3.11`。可用 `backend/.python-version`（如配合 pyenv）。
- **前端**：建议 **Node.js LTS**，包管理默认使用 **npm**。

若仅有系统自带的旧版 Python（如 macOS CLI 自带的 3.9），建议使用 **Conda**（见下文 `environment.yml`）或单独安装 3.11+，并为项目**新建**虚拟环境。

## 配置说明（根目录 `.env` / `backend/.env`）

数据库连接优先从 `clover-platform/.env` 读取，也兼容 `backend/.env`。单独运行 RAG 后端前，应先在 monorepo 根目录完成数据库初始化：

```bash
python scripts/init_db.py
alembic upgrade head
python scripts/check_db.py
```

必须配置 `DATABASE_URL`，或配置 `POSTGRES_HOST` / `POSTGRES_PORT` / `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD`。RAG 当前使用：

- `rag.conversations`
- `rag.chat_turns`

从 `backend/.env.example` 复制为 `.env` 时，至少填写：

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | PostgreSQL 连接串；优先使用，也可放在 clover-platform 根目录 `.env` |
| `UPSTREAM_URL` | 工作流运行地址，例如 `http://localhost/v1/workflows/run`（端口、路径与实际服务一致） |
| `UPSTREAM_BEARER_TOKEN` | 仅填密钥本体，形如 **`app-XXX`**；**不要**写 `Bearer ` 前缀，服务端会拼装 `Authorization: Bearer …` |
| `DIFY_API_BASE_URL` | Dify OpenAPI 根路径（无末尾 `/`），如 `http://localhost/v1`，与 Dataset / 知识库 REST 前缀一致 |
| `DIFY_DATASET_API_KEY` | Dify **知识库 Dataset API** 密钥，形如 **`dataset-XXX`**；**不要**写 `Bearer ` 前缀。用于侧栏「知识库管理」相关接口的后端转发 |
| `DIFY_DEFAULT_DATASET_ID` | 当前应用默认操作的知识库 **UUID**（列表、删除、按文本/文件创建文档均使用该库） |

常用可选项：`UPSTREAM_TIMEOUT_SECONDS`、`WORKFLOW_REMOTE_USER`（请求体里的 `user`）、`WORKFLOW_QUESTION_INPUT_KEY` / `WORKFLOW_ALLOW_SEARCH_INPUT_KEY`（与上游 `inputs` 字段名一致）、`CORS_ORIGINS`、`DEFAULT_USER_ID`（问答 turn 记录里的默认用户，默认为 `user`）。

Dify 知识库文档仍通过 Dify Dataset API 管理，本模块只代理相关接口，不把文档、分段或 Dify 元数据同步到 PostgreSQL。旧 SQLite / JSON 历史数据不迁移；本地向量索引或文件缓存如存在也保持原状。

**依赖说明：** `python-multipart` 已写入 `backend/requirements.txt`。FastAPI 解析 **`multipart/form-data`**（如「上传文件至知识库」）时必须安装该包；与浏览器里「拖拽」还是「点击选文件」无关，二者都是 multipart 上传。

**修改 `.env` 后需重启后端进程**，配置才会生效（`get_settings()` 带有缓存）。

## 上游请求与响应约定（当前实现）

后端向上游发起的 JSON 形如：

```json
{
  "inputs": {
    "<WORKFLOW_QUESTION_INPUT_KEY>": "<用户本条消息>",
    "<WORKFLOW_ALLOW_SEARCH_INPUT_KEY>": "1"
  },
  "response_mode": "streaming",
  "user": "<WORKFLOW_REMOTE_USER>"
}
```

SSE 各行以 `data: ` 开头；当前仅将 **`event` 为 `text_chunk`** 且 `data.text` 为字符串的片段转发给前端。若上游返回 `event: error`，后端会以 502 形式体现在前端错误提示中。

若你的服务字段名或事件结构与上述不一致，需改 `backend/app/config.py` 中的键名_env，或调整 `backend/app/services/llm_client.py` 中的解析逻辑。

## 本地运行

### 1. 后端

**方式 A：Conda（本机无法用 brew 装新版 Python 时推荐）**

```bash
cd backend
conda env create -f environment.yml   # 首次；环境名为 chat-backend
conda activate chat-backend
pip install -U pip
pip install -r requirements.txt   # 含 python-multipart（文件上传接口依赖）
cp .env.example .env
# 编辑 .env（UPSTREAM_*、WORKFLOW_* 等）
python run.py
```

**方式 B：项目内 venv（本机已有 `python3.11`/`python3.12`）**

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -U pip
pip install -r requirements.txt   # 含 python-multipart，勿删
cp .env.example .env
python run.py
```

默认 **`http://127.0.0.1:8000`**；健康检查：`GET /api/v1/health`。若报错 *Form data requires "python-multipart"*，说明当前环境中未安装该依赖，在项目 venv / conda 内执行：`pip install python-multipart` 或重装 `requirements.txt`。

如果启动时报缺少 `rag.conversations` 或 `rag.chat_turns`，请回到 clover-platform 根目录执行 `python scripts/init_db.py` 和 `alembic upgrade head`。

### 2. 前端

```bash
cd frontend
npm install
npm run dev
```

浏览器访问 **`http://localhost:5175`**。开发时 API 会通过 Vite 代理到后端（见 `frontend/vite.config.ts`）。若在独立域名或端口部署前端并直连后端，在 `frontend/.env` 中设置 **`VITE_API_BASE_URL`**（如 `http://127.0.0.1:8000`）后需**重启** `npm run dev`。

在 `clover-platform` 根目录使用统一启动器时，RAG 前端和后端会分别使用 `config/apps.yaml` 中的动态端口范围启动；启动器会向前端注入 **`VITE_API_BASE_URL=http://127.0.0.1:<RAG 后端端口>`**，因此 iframe 会打开 RAG 前端端口，前端 API 请求会直连对应的 RAG 后端端口。单独启动本项目时仍可继续使用上面的 `python run.py` 与 `npm run dev` 流程。

Vite 开发代理的 target 也可通过 **`VITE_API_BASE_URL`** 或 **`VITE_API_TARGET`** 覆盖；未设置时默认仍为 **`http://127.0.0.1:8000`**。

生产构建：

```bash
cd frontend
npm run build       # 输出到 frontend/dist，需由静态资源服务器托管并配置同源或反向代理 API
npm run preview
```

## HTTP API（节选）

### `POST /api/v1/chat/stream`

**Content-Type:** `application/json`  
**响应:** `text/event-stream`（SSE）

请求体示例：

```json
{
  "message": "用户文本",
  "session_id": "可选，不传则服务端生成或由上游会话对齐",
  "allow_search": false,
  "user_id": null
}
```

- `allow_search`: `true` → 上游 `inputs` 中为 `"1"`，`false` → `"0"`。  
- SSE 帧：`type` 为 `session` | `delta` | `done` | `error`；文本增量在 `delta.text`。

### `POST /api/v1/sessions`

返回新的 `session_id`（可选用；当前前端将 `sessionId` 写在各会话对象中并通过下方接口同步）。

### 前端会话列表（侧边栏「最近」）

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/v1/conversations` | 读取全部会话对象；`activeConversationId` 字段恒为 `null`（历史兼容性保留） |
| `PUT` | `/api/v1/conversations/sync` | 请求体：`{ "conversations": [ ... ], "activeConversationId": "<uuid>" }`；写入 `rag.conversations`；**当前会话仅存在于浏览器实例**，整页刷新或新开标签都会在本地先插入一条空白会话；请求体中的 `activeConversationId` 仍会校验但不落盘为全局状态；最多保留 80 条，多余记录会删除 |

### 知识库代理（节选，均需配置 `DIFY_*`）

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/v1/knowledge/documents` | 列出默认知识库内文档 |
| `GET` | `/api/v1/knowledge/documents/{document_id}/detail` | 文档详情 + 全部分段（代理 Dify document + segments） |
| `DELETE` | `/api/v1/knowledge/documents/{document_id}` | 删除文档 |
| `POST` | `/api/v1/knowledge/documents/create-by-text` | JSON：`name`、`text`；服务端转发 Dify 并轮询至索引完成 |
| `POST` | `/api/v1/knowledge/documents/create-by-file` | **`multipart/form-data`**，字段 **`file`**；同上 |

## 常见问题

| 现象 | 可检查项 |
|------|----------|
| 前端报「Upstream request failed」类错误 | `UPSTREAM_URL` 是否能从运行后端的机器访问、上游是否已监听、防火墙；Token 是否与上游一致并已重启后端 |
| 修改 Token/URL 不生效 | 是否未重启后端 |
| 浏览器跨域 | `CORS_ORIGINS` 是否包含前端页面来源（默认含 `http://localhost:5173`） |
| 后端启动报错 `python-multipart` | 在**运行后端的同一个 Python 环境**内执行 `pip install -r backend/requirements.txt` |
| 后端启动报缺少 RAG 表 | 在 clover-platform 根目录执行 `python scripts/init_db.py && alembic upgrade head`，再运行 `python scripts/check_db.py` |

## 后续扩展（占位）

- 多上游编排：在 `backend/app/services/` 增加管道，路由层保持稳定。
- 登录与多用户：`user_id`、`DEFAULT_USER_ID` 已进入 `rag.chat_turns`，可接鉴权后再写入真实用户标识。
- Docker：可按部署环境另行补充 `Dockerfile` / Compose。
