# modules/bid_generator

## 模块当前状态

标书生成模块当前后端主路径已迁入 `apps/api`，第 10-E 后真实业务前端已迁入 `apps/web/src/modules/bid-generator`。`legacy/bid-generator/frontend-web` 与 iframe 配置继续保留为回滚入口。

## 后端状态

`apps/api` direct 已承载 pipt-lite 的 health/config、脱敏/还原、项目 CRUD、需求提取、Dify workflow、进程内 TaskManager/SSE、文件预览下载、forge/export、knowledge/kb 和解析报告相关能力。`ANY /api/v1/bid-generator/{path:path}` catch-all proxy 仅保留为未知路径和回滚兜底。

## 前端状态

`apps/web` 原生页面已覆盖项目列表 / 创建 / 删除、项目 mappings、招标文件上传与需求提取、extract-stream、后台 task progress / cancel、大纲 / 正文生成 stream、解析报告任务、实体映射、脱敏 / 还原、PDF / 图片预览、source DOCX、forge-document、export-report、export-scoring-table 以及 knowledge/kb 同步入口。页面使用统一 `apiClient` 与鉴权 fetch，不再依赖 iframe auth bridge。

## 回滚边界

legacy 标书生成前端不删除，仍可独立 build，也可作为复杂编辑器能力的回滚 / 对照入口。`config/apps.yaml` 中 iframe 配置不删除；当前工作台入口进入 `apps/web` 原生页面。

## 关键风险点

- legacy 前端当前使用较新的 React / Vite / Tiptap 依赖。
- TaskManager 仍为进程内状态，SSE progress 和 cancel 语义必须保持。
- PDF / DOCX / Excel / 图片下载和鉴权 blob 处理。
- DocumentForge、knowledge sync、kb sync 和本地 `data/*` 目录持久化。
- Dify workflow stop、timeout 和上游错误兼容。

## 验收重点

- 项目 CRUD、需求提取、内容生成、任务进度和 cancel 行为兼容。
- 文件预览、下载、forge/export 保持文件名和 Content-Disposition。
- SSE 不缓冲完整结果，不改变事件格式。
- iframe 回滚路径在迁移期间仍可使用。
