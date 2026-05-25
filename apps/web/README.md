# apps/web

`apps/web` 是 Clover Platform 新的统一前端入口候选。

第 10-D 后，`apps/web` 已具备：

- Portal 登录、会话恢复和退出登录。
- 工作台与四个模块入口。
- 用户管理、权限配置、启用停用、重置密码和当前用户改密。
- runtime apps、app usage HTTP 和 `/ws/core/app-usage`。
- ticket / feature request feedback、captcha 和 multipart 附件提交。
- 竞对分析原生页面、history、analysis stream 和 workflow 调用。
- RAG 原生页面、sessions、conversations、chat stream 和 knowledge documents。
- 合同审查原生页面、DOCX 上传、审查状态、历史记录、风险卡片、AI 改写和 DOCX 下载。
- 标书生成仍通过 iframe 接入。

`legacy/portal-launchpad`、`legacy/company-competitors-analysis`、`legacy/chat_with_rag_and_websearch/frontend` 和 `legacy/contract_review/frontend` 继续保留为回滚入口。

## 本地开发

安装依赖：

```bash
npm --prefix apps/web install
```

启动前端：

```bash
npm --prefix apps/web run dev
```

默认 Vite dev server 端口为 `5300`。如需直接连接 `apps/api`，可设置：

```bash
VITE_API_BASE_URL=http://127.0.0.1:5220/api/v1 npm --prefix apps/web run dev
```

## 构建

```bash
npm --prefix apps/web run build
```

构建产物位于 `apps/web/dist`，不提交 Git。

## 下一阶段

第 10-E 建议迁入标书生成真实前端页面。标书生成 iframe 在迁移完成前保留。
