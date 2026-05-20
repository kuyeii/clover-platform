# Portal Launchpad

## 项目定位
`portal-launchpad` 是 Toolkit-All-In-One 的统一入口门户前端。当前首页定位为“工作台”，以四叶草模块导航为核心，负责统一展示、模块跳转、基础页面占位和平台化扩展预留，不合并四个业务模块代码。

## 技术栈
- React
- Vite
- TypeScript
- Framer Motion
- Tailwind CSS
- PostCSS
- lucide-react

## 本地启动

推荐通过 monorepo 统一启动器启动 Portal：

```bash
cd clover-platform
source .venv/bin/activate
python scripts/check_ports.py
python scripts/dev.py --no-business
```

启动器会生成 `runtime/ports.json`，并把 Portal 前后端端口写入该文件。动态端口只用于开发环境。

`scripts/dev.py` 不是 Docker 生产部署入口，正式 Docker / Docker Compose 进程生命周期会在后续部署阶段单独处理。

也可以单独启动 Portal：

```bash
cd clover-platform
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
python -m pip install -r legacy/portal-launchpad/requirements.txt
cp .env.example .env

python scripts/check_db.py
python scripts/init_db.py
alembic upgrade head
python scripts/check_db.py
python scripts/preflight.py --no-business

cd legacy/portal-launchpad
npm install
PORTAL_PYTHON_BIN=../../.venv/bin/python npm run dev
```

默认访问地址：

- 前端：`http://localhost:5200`
- 后端：`http://localhost:5210`
- 接口文档：`http://localhost:5210/docs`

## 构建
```bash
npm run build
```

## 目录结构
```text
portal-launchpad/
├── README.md
├── package.json
├── vite.config.ts
├── postcss.config.js
├── tailwind.config.js
├── index.html
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── routes/
│   ├── config/
│   ├── layouts/
│   ├── pages/
│   ├── components/
│   ├── types/
│   ├── styles/
│   └── utils/
└── docs/
```

## 如何配置四个应用入口
模块入口统一维护在：`src/config/apps.config.ts`

每个模块包含：
- `id`
- `name`
- `shortName`
- `description`
- `url`
- `healthUrl`
- `status`
- `healthStatus`
- `theme`
- `icon`
- `moduleRepo`
- `group`

修改模块地址、状态或描述时，只调整该配置文件，不在组件中硬编码模块信息。

当前模块 URL 会优先来自 Portal 后端 runtime 接口：

- `GET /api/runtime/apps`
- 后端读取 `clover-platform/runtime/ports.json`
- 前端用返回的 `iframeUrl` 覆盖静态配置
- 如果接口失败或 `runtime/ports.json` 不存在，继续使用 `src/config/apps.config.ts` 兜底

静态兜底 URL 会在浏览器运行时根据 Portal 访问域名自动生成：
- 本地访问 `http://localhost:5200` 时，模块地址为 `http://localhost:181xx`
- 服务器访问 `http://<server-ip>:5200` 时，模块地址为 `http://<server-ip>:181xx`

因此 NUC 部署时需要确保 `5200` 与 `18110/18120/18130/18140` 端口对访问端开放。

## 当前隔离集成方式
- 入口门户不嵌入四个业务模块代码。
- 不安装四个业务模块内部依赖。
- 点击模块入口后在门户内部路由 `/apps/:appId` 下以 `iframe` 方式加载目标 URL。
- 当前导航只保留：`工作台 / 知识库 / 设置`。
- Portal 保留顶部导航和统一外壳，不接管业务模块内部路由。
- 当前已启用 Portal session 登录，但不做统一网关代理，不做微前端源码级集成。
- 四个业务模块仍然隔离运行，通过配置地址打开。

## 后续扩展方向
- 用户中心
- 知识库中心
- 统一登录
- 健康检查轮询
- 微前端接入
- 统一平台服务联动

## Portal PostgreSQL 后端

Portal 后端当前使用 PostgreSQL，数据库配置来自 `clover-platform` 根目录 `.env` 或环境变量。用户认证、用户管理、应用权限、应用占用状态和反馈提交都通过 `/api/*` 维护。

当前开发环境 PostgreSQL 示例配置：

```bash
POSTGRES_HOST=10.88.20.14
POSTGRES_PORT=5432
POSTGRES_DB=app_db
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres123456
DATABASE_URL=postgresql+psycopg://postgres:postgres123456@10.88.20.14:5432/app_db
```

`.env` 放在 `clover-platform` 根目录，不应提交到 Git。Python 代码只从根目录 `.env` 或环境变量读取连接信息，不硬编码数据库连接串。

Portal 后端会优先读取 `clover-platform/.env`。如果存在 `legacy/portal-launchpad/.env`，仅作为兼容补充读取，不优先于根目录 `.env`。

### 安装依赖

```bash
cd clover-platform
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
python -m pip install -r legacy/portal-launchpad/requirements.txt

cd legacy/portal-launchpad
npm install
```

### 数据库初始化

在 `clover-platform` 根目录执行：

```bash
python scripts/check_db.py
python scripts/init_db.py
alembic upgrade head
python scripts/check_db.py
python scripts/preflight.py --no-business
```

`portal.user_profiles` 和 `portal.feedback_submissions` 已纳入 monorepo 统一数据库初始化和 Alembic。Portal 表缺失时，应通过 `python scripts/init_db.py` 和 `alembic upgrade head` 修复；Portal 后端启动时的建表逻辑只是兼容性兜底。

Portal 使用以下 PostgreSQL 表：

- `core.users`
- `core.sessions`
- `core.user_app_permissions`
- `core.app_usage_sessions`
- `core.audit_logs`
- `portal.user_profiles`
- `portal.feedback_submissions`

当前不迁移旧 SQLite 数据。

### 默认管理员

首次启动 Portal 后端时，如果 `core.users` 中没有管理员，会根据环境变量创建默认管理员：

```bash
PORTAL_ADMIN_USERNAME=admin
PORTAL_ADMIN_PASSWORD=admin123456
PORTAL_ADMIN_DISPLAY_NAME=系统管理员
```

开发默认值是 `admin / admin123456`。上线前必须通过环境变量修改默认密码。

### 开发启动

```bash
cd clover-platform/legacy/portal-launchpad
PORTAL_PYTHON_BIN=../../.venv/bin/python npm run dev
```

默认启动：

- 前端地址：`http://localhost:5200`
- 后端地址：`http://localhost:5210`
- FastAPI 文档：`http://localhost:5210/docs`

### 单独启动后端

```bash
cd clover-platform
source .venv/bin/activate
cd legacy/portal-launchpad
uvicorn backend.main:app --host 0.0.0.0 --port 5210 --reload
```

单独启动前端：

```bash
cd clover-platform/legacy/portal-launchpad
npm run dev:frontend
```

如果管理员已经初始化过，后续修改根目录 `.env` 中 `PORTAL_ADMIN_PASSWORD` 不会自动重置已有管理员密码。

### 统一启动器

从 `clover-platform` 根目录执行：

```bash
python scripts/dev.py --write-ports-only
python scripts/dev.py --no-business
```

`--write-ports-only` 只生成 `runtime/ports.json`，不启动进程。`--no-business` 启动 Portal 前后端，不启动四个业务模块。

`scripts/dev.py` 默认会先执行 preflight。如新环境提示缺少 root infrastructure dependency，请在 `clover-platform` 根目录执行：

```bash
python -m pip install -r requirements-dev.txt
```

preflight 不会自动安装依赖，也不会打印数据库密码或其他密钥。

Portal runtime apps 接口：

```text
GET /api/runtime/apps
```

该接口只返回前端需要的模块 `code`、`name`、`iframeUrl`、`enabled` 等信息，不返回启动命令、环境变量或密钥。

### 生产验证

```bash
npm run build
npm run server
```

### 手动验证

1. 使用默认开发管理员登录：`admin / admin123456`。
2. 验证 `POST /api/auth/login` 成功，`GET /api/auth/me` 成功，`core.sessions` 有 session 记录。
3. 创建普通用户，修改显示名，修改密码，启用 / 禁用用户。
4. 验证应用权限：
   - 未传 `appPermissions`：默认允许全部业务模块。
   - 传 `appPermissions: []`：不允许任何业务模块。
   - 传 `appPermissions: ["contract-review"]`：只允许合同审查。
5. 验证应用占用：
   - 进入应用后 `core.app_usage_sessions` 有记录。
   - heartbeat 更新 `last_seen_at`。
   - leave 清理占用。
   - `/ws/app-usage` WebSocket 仍能推送状态。
6. 反馈 / 工单 / 功能建议相关接口当前写入 `portal.feedback_submissions`，邮件发送仍按 SMTP 配置执行。

更多设计说明见 `docs/user-management-design.md`。

## Docker 当前状态

第 3 阶段主要验证 monorepo 本地方式启动。Portal 后端现在依赖 `clover-platform` 根目录的 `packages/py_common`，因此 `legacy/portal-launchpad` 下旧 Dockerfile / docker-compose 只能视为历史遗留或待改造文件，不代表最终部署方案。

Portal 单独 Docker 镜像不是当前阶段交付目标。统一 Docker 部署会在后续 Docker 阶段处理；届时会统一处理 monorepo 依赖、PostgreSQL 环境变量、静态资源构建和容器网络。
