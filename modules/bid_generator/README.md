# modules/bid_generator

## 模块当前状态

标书生成模块当前已接入统一入口，但业务实现仍处在兼容迁移状态。第 10-F 后，`apps/web` 是默认前端主入口，`legacy/bid-generator/frontend-web` 默认不启动并继续保留为回滚入口。

## 后端状态

`apps/api` 已提供统一鉴权入口和部分 direct 能力。health/config/entities（含 workflow status、analysis framework、template/config 查询和写入）、PIPT 公开兼容路由（recognize/desensitize/batch/restore/bidder normalize）、PIPT 审计日志只读查询、项目 CRUD/mappings、持久化 doc-blocks 快照查询、定位符重建/预览、附件 HTML 切片、解析报告读写、PDF 缓存读取/上传、source DOCX 读取、项目缓存清理、extracted-images 读取、diagram artifacts 读取、DOCX 二进制附件切片、评分表 Excel 导出、解析/重解析、任务启动、任务状态轮询、任务进度 SSE、任务取消、生成/分析/评分/蓝图、forge/export 文件产物、knowledge images 资产读写、knowledge documents 查询、kb sync jobs/status 端点由 `apps/api/app/api/bid_generator_proxy.py` 和 `apps/api/app/services/bid_generator_service.py` / `bid_workflow_execution_adapter.py` / `bid_pipt_compat_service.py` / `bid_bidder_pipt_service.py` 接管路由；统一后端默认不再挂载 legacy `api_lite` router，且已移除 legacy router/init/preload 暴露入口，避免双实现。其中 PIPT 公开兼容路由保持 legacy 响应字段，restore/vault 已通过 native SQL 读取 `bid_generator.entity_registry` / `mapping_records`，bidder normalize 已通过 native SQL 写入 `bid_generator.entity_registry` 并保留 legacy strong token、manifest 和 placeholder hint 契约，但识别引擎仍通过 legacy adapter 保留，不能视为 PIPT 引擎已完全迁出 legacy；health/config/entity 读取、template/global config 写入、定位符重建/预览、附件 HTML 切片、DOCX 二进制附件切片、评分表 Excel 导出和项目缓存清理已基于 apps/api 的文件/YAML/DOCX/Excel 生成、缓存源 DOCX、持久化 `__doc_blocks_cache` 和统一文件缓存路径原生实现；其中 `build-scoring-table` 已迁到 `apps/api/app/services/bid_generator_service.py` 原生做评分行初始拼装，`generate-blueprint` 也已迁到同一 service 直接调用统一后端的 Dify blocking workflow，`fill-scoring-row` 也已迁到同一 service 直接走 `DIFY_WORKFLOW_SCORING_ASSISTANT -> DIFY_WORKFLOW_REQUIREMENT_EXTRACTOR fallback` 的统一后端调用路径，`generate-attachment` 也已迁到同一 service：内置四类附件本地模板渲染，动态附件走 `DIFY_WORKFLOW_ATTACHMENT_GENERATOR`，`analyze-node` 也已迁到 `apps/api` 原生 docanalysis 协议链路，直接读取 `analysis_framework.json`、项目 raw document cache、统一 Dify streaming 响应并输出原有 SSE `bid_attachments/done/error` 协议，`projects/analyze` 直连 SSE 也已迁到 `apps/api` 原生 docanalysis 分组链路，保留 legacy `progress/node_complete/complete` 事件协议；`generate-outline` 的同步 blocking 版本和 `generate-outline-stream` 的 SSE 版本也已迁到 `apps/api` 原生 outline 协议链路，直接执行统一 Dify workflow、结构归一化和质量校验，并保留 legacy `stage/done/error` SSE 契约、`workflow_run_id` fallback GET 和字数预算归一化；`tasks/start-analyze` 也已迁到 `apps/api` 原生后台任务编排，统一后端负责分组 Dify 调度、附件目录锚点补齐、`analysisReport`/`analysisV2` 持久化，以及 legacy `bid_attachments` / `analysis_v2` / `structure_stage` 事件兼容。template generation、解析、其余任务启动、forge/export PDF/DOCX 仍通过 legacy adapter 执行、读取或透传，其中 workflow/analyze/export/forge 的 legacy route 调用已统一收口到 `apps/api/app/services/bid_workflow_execution_adapter.py`，`bid_generator_service.py` 不再直接 import/call legacy workflow routes；但 `config/template/generate` 当前仍存在一条必须先决策的冲突：legacy 实现通过 `legacy/bid-generator/config.yaml` 中 `dify.api_key` + `dify-bridge.WorkflowManager.run_bid_generation(...)` 执行，而统一后端大纲主链路已以 `.env` 的 `DIFY_WORKFLOW_STRUCTURE_GENERATOR` 为工作流凭据来源。这个凭据来源在统一前不能静默改为 native workflow 调用，否则会形成双权威执行口径。任务状态、任务进度 SSE 和取消已由 apps/api service 原生处理，其中取消会通过 native HTTP 调用 Dify Stop API 并直接取消共享 TaskManager，progress SSE 保留 legacy event/data 协议但不再调用 legacy route；TaskManager 存储本身仍来自 legacy，不能视为任务系统已完全统一后端化。知识同步触发不再作为标书模块迁移目标，统一知识库入口是同步触发的权威入口；标书模块只保留文档/图片资产查询和历史 jobs/status 兼容，`/knowledge/sync`、`/knowledge/sync/{doc_name}`、`/kb/sync` 不在标书统一后端暴露。其余未知业务路径不再通过 legacy `api_lite` router 直接挂载，只保留 `ANY /api/v1/bid-generator/{path:path}` 平台 catch-all proxy 作为未知路径和回滚兜底。

`export-report` 暂不静默迁为 native：legacy 使用 WeasyPrint 生成 PDF，而当前 `apps/api/requirements.txt` 未声明 WeasyPrint，Python 3.10 slim 容器还需要对应系统库。该能力进入冲突记录，等统一后端容器依赖决策后再迁。

`forge-document` 也暂不静默迁为 native：legacy 实现同时依赖 `EntityRegistry`/`FernetEncryptor`、legacy PIPT placeholder protocol、`ImageRegistry`、gateway-out `DocumentForge` 和 `docxcompose` 拼装行为。需要先把 PIPT vault、图片 registry 和 DocumentForge 服务边界统一后再迁。

平台 PIPT gateway 位于 `apps/api/app/services/pipt_gateway_service.py`，强模式识别暂由 `apps/api/app/services/pipt_recognition_adapter.py` 暴露的 `PiptRecognitionProvider` 边界承载，默认 provider 仍隔离调用 legacy `DesensitizeEngine`。这只是 legacy adapter 边界收敛，不能视为识别引擎已完全迁出 legacy。

## 前端状态

`apps/web/src/modules/bid-generator/BidGeneratorPage.tsx` 当前是原标书工作台 UI 的原生嵌入口：通过 lazy-loaded `legacy/LegacyBidGeneratorRuntime.tsx` 渲染已迁入 `apps/web` 的 legacy React 工作台，不再通过 iframe 调用独立 legacy 前端。UI 样式和交互应保持原工作台一致；迁移发生在 Service/API 边界。组件层已清掉直接 `fetch` / `axios` / 底层 `api` 调用，原工作台内部 `legacy/services/api.ts` 已改为基于统一 `bidGeneratorFetch` 的兼容 Service adapter。`services/bidGeneratorApi.ts` 已承载统一后端 Service Layer，包括项目 CRUD、mappings/doc-blocks、任务启动/状态/progress/cancel、PDF/source DOCX/protected assets、analysis-report、forge/export、knowledge documents/images/sync jobs 查询、PIPT gateway 状态、PIPT audit 和 PIPT 公开兼容路由等统一后端入口，其中任务启动、forge/export 和 PIPT 识别等仍通过 legacy adapter 保留原执行语义；任务状态、进度 SSE 和取消已收敛到 apps/api service。知识同步触发应走统一知识库入口，不在标书 Service 中继续暴露。

## 回滚边界

legacy 标书生成前端不删除，仍可独立 build，也可作为复杂编辑器能力的回滚 / 对照入口。`config/apps.yaml` 中 iframe 配置不删除；当前工作台入口进入 `apps/web` 原生页面。需要 legacy iframe 回滚时使用 `python scripts/dev.py --only bid-generator --with-legacy-frontends` 启动；如需 legacy 后端回滚，追加 `--with-legacy-backends`。

## 关键风险点

- legacy 前端当前使用较新的 React / Vite / Tiptap 依赖。
- TaskManager 仍为进程内状态，SSE progress 和 cancel 语义必须保持。
- PDF / DOCX / Excel / 图片下载和鉴权 blob 处理。
- DocumentForge、统一知识库入口联动、历史 kb sync jobs/status 和本地 `data/*` 目录持久化。
- Dify workflow stop、timeout 和上游错误兼容。
- legacy iframe 回滚时 runtime `iframe_url` 与 auth bridge origin 需要匹配。

## 验收重点

- 项目 CRUD、需求提取、内容生成、任务进度和 cancel 行为兼容。
- 文件预览、下载、forge/export 保持文件名和 Content-Disposition。
- SSE 不缓冲完整结果，不改变事件格式。
- 默认启动不依赖 legacy 独立前端进程；当前主页面原生嵌入迁入 `apps/web` 的原 legacy React 工作台。
- iframe 回滚路径在回滚参数启用时仍可使用。
