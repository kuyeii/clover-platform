# frontend-web — ProEngine 前端管理界面

> React 18 + TypeScript + Tailwind CSS · 以项目为中心的标书生成 UI

## 功能模块

```
侧边栏
  ├── 项目列表（含状态指示）
  ├── 新建项目
  ├── 隐私脱敏设置（招标文件/标准 方案切换）
  ├── Dify 工作流状态展示（读 /config/workflow-status）
  └── 知识库管理

主区域（随项目状态切换）
  ├── ProjectCreator   — 上传招标文件 · 调用 /projects/extract
  ├── RequirementsReview — 核对提取的 tech/biz/score 需求
  ├── OutlineGenerator — 调用 /projects/generate-outline · 一级+二级大纲预览
  ├── TemplateEditor   — 章节 YAML 模板编辑 + 提示词配置
  └── KnowledgeHub     — 知识库文档管理
```

## 项目状态机

| 状态 | 说明 | 对应组件 |
|------|------|----------|
| `uploading` | 用户选择文件 | ProjectCreator |
| `parsing` | 后端解析 + 脱敏 + Dify 提取 | ProjectCreator（loading） |
| `reviewing` | 用户核对需求列表 | RequirementsReview |
| `generating_outline` | Dify structure_generator 运行中 | OutlineGenerator（loading） |
| `editing` | 用户编辑大纲和提示词 | TemplateEditor |
| `generating_content` | Dify content_writer 运行中 | TemplateEditor |
| `done` | 内容生成完成 | ResultViewer |

## 关键 Service 层

```
src/services/
  ├── api.ts              — Axios 实例（baseURL: VITE_API_URL）
  └── projectService.ts   — LocalStorage CRUD + 两个后端 API 方法：
        extractRequirements(projectId, file)   → POST /projects/extract
        generateOutline(requirements, bidType) → POST /projects/generate-outline
```

### 脱敏设置持久化

脱敏开关和方案（`tender` / `default`）存储于 `localStorage['proengine_desen_settings']`，由 `Sidebar.tsx` 读写，`projectService.extractRequirements()` 上传时自动拼入 FormData 发给后端。

## 环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `VITE_API_URL` | pipt-flask API 地址 | `http://localhost:5000/api` |
| `VITE_API_BASE_URL` | pipt-flask 后端根地址；设置后自动拼接 `/api` | - |

在 `clover-platform` 统一启动器中会注入 `VITE_API_BASE_URL=http://127.0.0.1:<标书生成后端端口>`。单独启动本前端时不设置该变量，仍默认访问 `http://localhost:5000/api`。

项目列表与服务端映射数据由 pipt-lite 后端写入 PostgreSQL `bid_generator` schema；前端 API 路径和请求结构不变。脱敏设置和投标人信息仍按现有逻辑保存在浏览器本地。

## 快速启动

```bash
npm install
npm run dev    # http://localhost:5173
npm run build  # 生产构建
```

## 关键依赖

| 包 | 用途 |
|----|------|
| `react` / `react-dom` | UI 框架 |
| `axios` | HTTP 请求 |
| `lucide-react` | 图标库 |
| `tailwindcss` | 样式 |
| `@dnd-kit/*` | 大纲章节拖拽排序 |
| `js-yaml` | YAML 模板解析 |
| `clsx` | 条件 className |
