# apps/web

`apps/web` 是 Clover Platform 当前默认统一前端主入口。第 10-F 后，默认 `python scripts/dev.py` 会启动 `apps/web` 和 `apps/api`，不再默认启动 `legacy/portal-launchpad` 或四个 legacy 业务前端。

## 当前能力

`apps/web` 已具备：

- Portal 登录、会话恢复、工作台、用户管理、runtime apps、app usage、feedback。
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

## legacy 回滚

legacy 前端默认不启动。需要旧 Portal 回滚入口时：

```bash
python scripts/dev.py --legacy-portal
```

需要 legacy Portal 和四个 legacy 业务 iframe 前端完整回滚入口时：

```bash
python scripts/dev.py --with-legacy-frontends
```

需要 legacy 前端和 legacy 后端完整回滚链路时：

```bash
python scripts/dev.py --with-legacy-frontends --with-legacy-backends
```

`config/apps.yaml` 中 iframe 配置和 `apps/web/src/modules/iframe` 暂时保留为回滚 / 兼容路径，不作为当前主业务入口。

## 后续发布准备

后续第 10-G 建议做统一前端总体验收与发布准备，重点覆盖生产静态资源部署、反向代理、CORS、WebSocket、SSE、上传下载和 legacy 删除前置条件。
