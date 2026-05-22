# modules/bid_generator

## 模块当前状态

标书生成模块当前后端主路径已迁入 `apps/api`，前端仍在 `legacy/bid-generator/frontend-web` 并通过 iframe 接入 Portal。

## 后端状态

`apps/api` direct 已承载 pipt-lite 的 health/config、脱敏/还原、项目 CRUD、需求提取、Dify workflow、进程内 TaskManager/SSE、文件预览下载、forge/export、knowledge/kb 和解析报告相关能力。`ANY /api/v1/bid-generator/{path:path}` catch-all proxy 仅保留为未知路径和回滚兜底。

## 前端状态

真实业务前端仍在 legacy 标书生成前端。第 10-A 只在 `apps/web` 新增 `/modules/bid-generator` 占位页，不迁移项目管理、编辑器、SSE 任务、DocumentForge 或导出 UI。

## 后续迁移目标

第 10-F 迁移标书生成前端到 `apps/web/src/modules/bid-generator`，先梳理 React 版本差异、编辑器依赖、项目状态、SSE 任务和文件预览下载契约。

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
