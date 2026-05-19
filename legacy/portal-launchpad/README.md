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
```bash
cd 03-entry-portal/portal-launchpad
npm install
npm run dev
```

默认访问地址：
`http://localhost:5200`

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

当前模块 URL 会在浏览器运行时根据 Portal 访问域名自动生成：
- 本地访问 `http://localhost:5200` 时，模块地址为 `http://localhost:181xx`
- 服务器访问 `http://<server-ip>:5200` 时，模块地址为 `http://<server-ip>:181xx`

因此 NUC 部署时需要确保 `5200` 与 `18110/18120/18130/18140` 端口对访问端开放。

## 当前隔离集成方式
- 入口门户不嵌入四个业务模块代码。
- 不安装四个业务模块内部依赖。
- 点击模块入口后在门户内部路由 `/apps/:appId` 下以 `iframe` 方式加载目标 URL。
- 当前导航只保留：`工作台 / 知识库 / 设置`。
- Portal 保留顶部导航和统一外壳，不接管业务模块内部路由。
- 当前不做真实登录，不做统一网关代理，不做微前端源码级集成。
- 四个业务模块仍然隔离运行，通过配置地址打开。

## 后续扩展方向
- 用户中心
- 知识库中心
- 统一登录
- 健康检查轮询
- 微前端接入
- 统一平台服务联动

## 用户管理后端

本项目已内置 FastAPI + SQLite 后端，用户认证、用户管理、应用权限和应用占用状态都通过 `/api/*` 维护。

### 安装依赖

```bash
npm install
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 开发启动

```bash
npm run dev
```

默认启动：

- 前端地址：`http://localhost:5200`
- 后端地址：`http://localhost:5210`
- FastAPI 文档：`http://localhost:5210/docs`

### 单独启动后端

```bash
python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 5210 --reload
```

### 生产验证

```bash
npm run build
npm run server
```

首次启动后端时会自动生成 SQLite 数据库：`backend/data/portal.db`。默认测试账号：

- `admin / admin123`：管理员，拥有全部权限
- `zhangsan / 123456`：标书审查、RAG 问答
- `lisi / 123456`：合同审查、RAG 问答
- `wangwu / 123456`：RAG 问答

更多设计说明见 `docs/user-management-design.md`。

## Docker 部署

服务器上不建议用 `npm run dev` 跑生产门户。开发命令会同时启动 Vite 和 FastAPI，并依赖宿主机 Python 已安装 `uvicorn`。生产环境直接使用 Docker：

```bash
cd 03-entry-portal/portal-launchpad
docker compose up -d --build
```

默认访问地址：

```text
http://<server-ip>:5200
```

查看日志：

```bash
docker compose logs -f portal-launchpad
```

停止服务：

```bash
docker compose down
```

Docker 镜像会先构建前端 `dist`，再由 FastAPI 托管静态页面和 `/api/*` 接口。容器内部监听 `5210`，宿主机映射为 `5200`。SQLite 数据持久化在：

```text
backend/data/
```

如果服务器 `5200` 端口被占用，修改 `docker-compose.yml`：

```yaml
ports:
  - "5201:5210"
```

然后访问 `http://<server-ip>:5201`。
