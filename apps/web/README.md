# apps/web

`apps/web` 是 Clover Platform 当前默认统一前端主入口。默认 `python scripts/dev.py` 会启动 `apps/web` 和 `apps/api`。

## 当前能力

`apps/web` 已具备：

- 登录、会话恢复、工作台、用户管理、runtime apps、app usage、feedback。
- 竞对分析 history、analysis stream 和 workflow 调用。
- RAG sessions、conversations、chat stream 和 knowledge documents。
- 合同审查 DOCX 上传、run 状态、结果、风险卡片、AI 改写和 DOCX 下载。
- 标书生成项目 CRUD、文件上传解析、SSE 任务、大纲 / 正文生成、实体映射、脱敏还原、PDF / 图片预览、DOCX / PDF / Excel 导出和 knowledge/kb。

## 本地开发

通过仓库统一启动器启动主前端和统一后端：

```bash
python scripts/dev.py
```

单独启动前端：

```bash
npm --prefix apps/web install
npm --prefix apps/web run dev
```

默认 Vite dev server 端口为 `5300`。如需直接连接 `apps/api`：

```bash
VITE_API_BASE_URL=http://127.0.0.1:5220/api/v1 npm --prefix apps/web run dev
```

## 构建

```bash
npm --prefix apps/web run build
```

构建产物位于 `apps/web/dist`，不提交 Git。

## 当前外层框架

当前外层框架包含一个登录框、横向顶栏、工作台 2x2 业务卡片和日夜间模式入口。工作台卡片背景图位于 `public/app-backgrounds`。
