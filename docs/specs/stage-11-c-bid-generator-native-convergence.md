# Stage 11-C: Bid Generator Native Convergence

## 1. Problem Statement

The bid generator is exposed through the unified platform and has converged to native `apps/api` route/service ownership for the main business flows.

Current evidence:

- `apps/api/app/api/bid_generator_proxy.py` no longer mounts `legacy/bid-generator/pipt-flask/app/api_lite` routers by default. Public bid-generator paths are declared in `apps/api`; legacy router/init/preload entrypoints have been removed from the bid service.
- `apps/web/src/modules/bid-generator/BidGeneratorPage.tsx` now natively embeds the migrated legacy React workbench through `legacy/LegacyBidGeneratorRuntime.tsx`; it is no longer loaded through a standalone legacy frontend iframe. The original workbench UI and interaction model are intentionally preserved.
- `apps/api/app/services/pipt_gateway_service.py` already provides a platform PIPT gateway. Strong preprocessing now calls `apps/api/app/services/pipt_recognition_adapter.py`, which uses the native `apps/api/app/services/pipt_engine` implementation.
- RAG knowledge privacy recognition now also calls `apps/api/app/services/pipt_recognition_adapter.py`; it no longer imports bid-generator legacy runtime helpers or `app.api_lite.routes.get_engine` directly.
- `apps/api/app/services/bid_workflow_execution_adapter.py` now runs `config/template/generate` through the unified backend `DIFY_WORKFLOW_STRUCTURE_GENERATOR` workflow instead of the legacy Dify bridge; export and forge response assembly have moved into `bid_generator_service.py`.
- `apps/api/app/services/pipt_redaction_service.py` provides the current-document final global redaction pass for missed same-document entities.
- Unknown bid-generator paths no longer default proxy to legacy; `BID_GENERATOR_ALLOW_LEGACY_PROXY=true` is required for temporary rollback proxy.

This means the module is in the intended convergence state; `config/template/generate` uses the unified backend Dify credential source.

## 2. Target State

Follow the RAG and competitor-analysis migration pattern:

- `apps/api` owns bid-generator API routes through native services and schemas.
- PIPT is an `apps/api` platform capability, not business logic added to legacy pipt-flask.
- `apps/web/src/modules/bid-generator` owns the bid-generator entrypoint and Service/API boundary. The visible workbench UI should continue to reuse the original migrated React workbench until a separate, explicitly approved UI rewrite is planned.
- Legacy bid-generator code remains available only as rollback/reference until explicit retirement.

## 3. Non-Negotiable Boundary Rules

- Existing public route paths must stay stable unless a separate compatibility plan says otherwise.
- Do not create two active implementations for the same path and behavior.
- If an `apps/api` native implementation and a legacy implementation would both own the same capability, stop and record a conflict before editing.
- New platform behavior must be implemented in `apps/api` or shared packages. Do not add new business rules to `legacy/bid-generator` except for emergency compatibility patches explicitly approved for rollback.
- UI code must keep API calls in `apps/web/src/modules/bid-generator/services`; components must not call `fetch` or `axios` directly.

## 4. Conflict Rule

When existing backend capability and legacy capability overlap, classify before implementation:

- `native_only`: `apps/api` owns the capability; legacy is not mounted for that route.
- `legacy_adapter`: legacy is still called internally, but route/service ownership and new behavior live in `apps/api`.
- `blocked_conflict`: both sides would actively own the same behavior. Stop and ask for a decision.

Do not silently convert `blocked_conflict` into a narrower compatibility patch.

## 5. Migration Slices

### Slice A: PIPT Service Ownership

Goal: PIPT becomes a first-class platform service under `apps/api`.

Allowed work:

- Add reusable PIPT redaction, placeholder validation, mapping vault, restore, and audit services under `apps/api/app/services`.
- Add tests around `apps/api` services.
- Keep existing bid-generator route paths stable.

Blocked without explicit decision:

- Changing the public request/response shape of `/api/v1/bid-generator/api/desensitize`, `/recognize`, `/desensitize/batch`, or `/restore`.
- Adding new PIPT business behavior into `legacy/bid-generator/pipt-flask/app/api_lite/engine.py`.

Current classification:

| Capability | Current owner | Target owner | Classification | Decision |
| --- | --- | --- | --- | --- |
| Platform PIPT gateway `/api/v1/pipt-gateway/*` | `apps/api` native route/service | `apps/api` | `native_only` | Can continue inside `apps/api`; bid Service Layer now exposes status, validate, preprocess, and postprocess methods for future native slices. |
| Final current-document global redaction pass | `apps/api/app/services/pipt_redaction_service.py` | `apps/api` | `native_only` | Can be tested and reused by native services. |
| Bid PIPT audit logs `/api/v1/bid-generator/api/pipt-audit-logs` | `apps/api/app/api/bid_generator_proxy.py` + `apps/api/app/services/bid_generator_service.py` | `apps/api` | `native_only` | Read-only audit visibility; legacy api_lite routers are not mounted by default. |
| PIPT recognition engine implementation | `apps/api/app/services/pipt_engine` + `apps/api/app/services/pipt_recognition_adapter.py` provider boundary | `apps/api` | `native_only` | The former legacy `api_lite.engine.DesensitizeEngine` implementation has been migrated into `apps/api/app/services/pipt_engine`; gateway/bid/RAG knowledge services depend on `PiptRecognitionProvider` and no longer import `app.api_lite.engine` or `ensure_legacy_runtime`. Optional HanLP model assets are not copied into apps/api; they are loaded by `PIPT_ASSETS_DIR` or the existing legacy asset file path as external model files only. |
| Bid public PIPT routes `/api/v1/bid-generator/api/desensitize`, `/recognize`, `/desensitize/batch`, `/restore`, `/bidder/normalize-pipt` | `apps/api/app/api/bid_generator_proxy.py` + `apps/api/app/services/bid_pipt_compat_service.py` + `apps/api/app/services/bid_bidder_pipt_service.py` + `apps/api/app/services/pipt_engine` | `apps/api` | `native_only` | Route ownership is native and legacy api_lite routers are not mounted by default. Public response shape stays legacy-compatible. Restore/vault reads are now native SQL against `bid_generator.entity_registry` / `mapping_records`; bidder normalize、正文生成前投标人必填校验和 bidder PIPT context 合并均写入/读取 `bid_generator.entity_registry` through native SQL and preserve legacy strong-token/prompt fields. Recognition/desensitize now use the native apps/api PIPT engine package. |
| Bid health/config/entity routes `/api/v1/bid-generator/api/health`, `/config/workflow-status`, `/config/analysis-framework`, `/config/template`, `/config/global`, `/config/template/generate`, `/entities` | `apps/api/app/api/bid_generator_proxy.py` + `apps/api/app/services/bid_generator_service.py` + `apps/api/app/services/bid_workflow_execution_adapter.py` | `apps/api` | `native_only` | Route ownership is native and legacy api_lite routers are not mounted by default; health/config/entity reads and template/global config mutation are native file/config operations. `config/template/generate` 已按用户决策采用统一后端 `.env` 的 `DIFY_WORKFLOW_STRUCTURE_GENERATOR`，输出仍保持 legacy-compatible `structure_dict` 响应形状，不再读取 legacy `config.yaml:dify.api_key` 或调用 `dify-bridge.WorkflowManager.run_bid_generation(...)`。 |
| Bid project CRUD/index and DOCX locator routes `/api/v1/bid-generator/api/projects`, `/projects/batch`, `/projects/{project_id}`, `/projects/{project_id}/mappings`, `/projects/{project_id}/doc-blocks`, `/projects/{project_id}/rebuild-locator`, `/bid-attachment/test-locators`, `/bid-attachment/extract`, `/bid-attachment/extract-by-block`, `/bid-attachment/extract-by-block-docx` | `apps/api/app/api/bid_generator_proxy.py` + `apps/api/app/services/bid_generator_service.py` | `apps/api` | `native_only` | Legacy api_lite routers are not mounted by default; doc-blocks, locator preview, and HTML attachment extraction read the persisted `__doc_blocks_cache` snapshot. Rebuild-locator parses uploaded DOCX in apps/api, persists source DOCX cache, and updates the project snapshot. Binary DOCX slicing now reads the cached source DOCX and slices `word/document.xml` natively. |
| Bid analysis report routes `/api/v1/bid-generator/api/projects/{project_id}/analysis-report` | `apps/api/app/api/bid_generator_proxy.py` + `apps/api/app/services/bid_generator_service.py` | `apps/api` | `native_only` | Legacy api_lite routers are not mounted by default; file mirror remains for compatibility. |
| Bid project file/image/artifact routes `/api/v1/bid-generator/api/projects/pdf/{project_id}`, `/projects/upload-pdf`, `/projects/{project_id}/source-docx`, `/extracted-images/by-hash/{image_hash}`, `/extracted-images/{filename}`, `/diagram-artifacts/{diagram_id}.svg`, `/diagram-artifacts/{diagram_id}.mmd` | `apps/api/app/api/bid_generator_proxy.py` + `apps/api/app/services/bid_generator_service.py` | `apps/api` | `native_only` | Legacy api_lite routers are not mounted by default; existing cache/artifact directories remain for compatibility. Diagram artifact read does not migrate task generation. |
| Bid scoring table export `/api/v1/bid-generator/api/projects/export-scoring-table` | `apps/api/app/api/bid_generator_proxy.py` + `apps/api/app/services/bid_generator_service.py` | `apps/api` | `native_only` | Legacy api_lite routers are not mounted by default; Excel generation uses apps/api `openpyxl` directly and preserves legacy-compatible workbook columns and download headers. |
| Bid analysis report PDF export `/api/v1/bid-generator/api/projects/export-report` | `apps/api/app/api/bid_generator_proxy.py` + `apps/api/app/services/bid_generator_service.py` | `apps/api` | `native_only` | Legacy api_lite routers are not mounted by default; PDF generation now uses apps/api `reportlab` directly and no longer depends on legacy WeasyPrint/system libraries. |
| Bid knowledge asset routes `/api/v1/bid-generator/api/knowledge/images`, `/knowledge/images/{image_hash}`, `/knowledge/documents` | `apps/api/app/api/bid_generator_proxy.py` + `apps/api/app/services/bid_generator_service.py` | `apps/api` | `native_only` | Legacy api_lite routers are not mounted by default; `/knowledge/documents` only queries Dify dataset document metadata. |
| Bid extract/task start/status/progress/cancel `/api/v1/bid-generator/api/projects/extract`, `/projects/extract-stream`, `/projects/re-extract`, `/tasks/start-*`, `/tasks/{task_id}/status`, `/tasks/{task_id}/progress`, `/tasks/{task_id}/cancel` | `apps/api/app/api/bid_generator_proxy.py` + `apps/api/app/services/bid_task_runtime_service.py` | `apps/api` native task service | `native_only` | Route ownership is native. Task status, progress SSE, cancel, project/task concurrency slot checks, diagram quota reservation, task timeout cleanup, and partial event storage now use the apps/api native `TaskManager`, preserving the legacy polling/SSE/cancel protocol. The obsolete `bid_task_execution_adapter.py` legacy task route wrapper and legacy task route tests have been removed; `bid_generator_service.py` no longer imports or exposes `call_legacy_task_route`, `legacy_task_manager`, `_legacy_task_manager`, `_get_legacy_task`, or `_require_legacy_task_owner`. `projects/extract` / `extract-stream` / `re-extract` and `tasks/start-extract` now parse PDF/DOCX/DOC/TXT inputs through native `apps/api` helpers and no longer call `app.api_lite.routes`; `use_vision_parsing=true` now registers DOCX embedded images and PDF `pymupdf4llm` extracted images into `bid_generator.image_registry` / `knowledge_image_assets`, optionally using `REMOTE_VISION_*` for captions. `tasks/start-analyze`、正文/重写/分组/评审、图表任务、PIPT/BIDDER 占位符正文还原、投标人信息校验、runtime writing hint 拼装和图表 artifact 落盘已迁入统一后端。 |
| Bid KB sync status/listing `/api/v1/bid-generator/api/kb/sync-status/{job_id}`, `/kb/sync-jobs` | `apps/api/app/api/bid_generator_proxy.py` + sync status service | unified knowledge base entrypoint for trigger actions | `native_only` | Status/listing route ownership is native for compatibility. Sync triggers `/knowledge/sync`, `/knowledge/sync/{doc_name}`, and `/kb/sync` are not exposed by bid-generator because knowledge synchronization is now handled by the unified knowledge base entrypoint. |
| Bid workflow generation/analyze/forge `/api/v1/bid-generator/api/projects/generate-*`, `/projects/analyze`, `/projects/{project_id}/analyze-node`, `/projects/build-scoring-table`, `/projects/fill-scoring-row`, `/projects/forge-document` | `apps/api/app/api/bid_generator_proxy.py` + `apps/api/app/services/bid_generator_service.py` + `apps/api/app/services/bid_document_forge_service.py` + `apps/api/app/services/bid_document_forge_engine` | `apps/api` native workflow/file service | `native_only` | Route ownership is native. `build-scoring-table`、`generate-blueprint`、`fill-scoring-row`、`generate-attachment`、`analyze-node`、`projects/analyze` 直连 SSE、`generate-outline`（同步 blocking 版本）以及 `generate-outline-stream` 已原生迁到 `apps/api/app/services/bid_generator_service.py` / `bid_docanalysis_service.py` / `bid_outline_service.py`；评分表 Excel export、解析报告 PDF export、`forge-document` 响应组装也已原生。`forge-document` 现在由统一后端查询 `entity_registry` / `image_registry`，并原生处理 `docx_slice` 的缓存 DOCX 切片、混合拼装、标题编号和目录后处理。Markdown/DOCX 转换器本体已迁入 `apps/api/app/services/bid_document_forge_engine`，`bid_generator_service.py` 和 `bid_document_forge_service.py` 不再导入 legacy `src.forge` 或注入 `gateway-out/src` namespace。 |
| Bid project cache cleanup `/api/v1/bid-generator/api/projects/{project_id}/caches` | `apps/api/app/api/bid_generator_proxy.py` + `apps/api/app/services/bid_generator_service.py` | `apps/api` native file/cache service | `native_only` | Route ownership is native; deletes PDF/raw-doc/source DOCX cache files and no longer touches legacy in-memory locator cache. |
| Bid unknown/catch-all fallback `/api/v1/bid-generator/{path:path}` | `apps/api/app/api/bid_generator_proxy.py` | rollback-only explicit proxy | `native_only` with explicit rollback switch | Unknown bid-generator paths no longer default-proxy to legacy. They return `BID_GENERATOR_LEGACY_PROXY_BLOCKED` / 410 unless `BID_GENERATOR_ALLOW_LEGACY_PROXY=true` is explicitly set for temporary rollback. |

### Slice B: Native Bid API Routes

Goal: Replace legacy router ownership with native `apps/api` route/service ownership slice by slice.

Order:

1. Health, config, and entity endpoints. Current status: health, workflow status, analysis framework, template/config read, template/global config mutation, template generation, and entities are native route-owned and native service-owned; legacy api_lite routers are not mounted by default.
2. PIPT endpoints after Slice A ownership is decided. Current status: platform PIPT gateway status/validate/preprocess/postprocess methods, bid PIPT audit log reading, and bid public desensitize/recognize/batch/restore/bidder-normalize routes are native route-owned. Bid public PIPT restore now reads the vault through native SQL; bidder normalize writes the global entity registry through native SQL while preserving legacy response fields; recognition/desensitize now enter through the unified provider boundary and use the native apps/api PIPT engine package.
3. Project CRUD, mappings, and persisted doc-blocks snapshot. Current status: native-owned; legacy api_lite routers are not mounted by default.
4. Extract and task progress endpoints. Current status: PDF/source DOCX/extracted image/diagram artifact file access and cache cleanup are native-owned; status, progress SSE, cancel logic, ordinary document parsing, locator extraction, raw document cache writes, vision-enhanced image extraction/knowledge-image registration, task start execution, PIPT recognition, and extract result assembly are native service-owned.
5. Workflow generation and export endpoints. Current status: analysis-report persistence, analyze/analyze-node, outline/content generation, attachment/scoring/blueprint helpers, export, and forge routes are native route-owned. Export and forge response assembly plus Markdown/DOCX conversion are native service-owned.
6. Knowledge/kb endpoints. Current status: knowledge image asset list/update, knowledge documents listing, kb sync-jobs listing, and kb sync-status route are native route-owned for compatibility. Knowledge sync trigger actions are handled by the unified knowledge base entrypoint and are not exposed by bid-generator instead of being migrated as bid-generator-native trigger routes.

Each endpoint group requires:

- Legacy-compatible request/response contract.
- Explicit rollback route or feature flag if behavior is risky.
- Tests proving the legacy router is no longer the active owner for that group.

### Slice C: Native Frontend Entrypoint

Goal: move from iframe loading to native `apps/web` embedding while preserving the original bid-generator workbench UI.

Current status:

- `BidGeneratorPage.tsx` is a thin native entrypoint that lazy-loads `legacy/LegacyBidGeneratorRuntime.tsx`.
- `LegacyBidGeneratorRuntime.tsx` wraps the migrated workbench with `HashRouter` and imports the original workbench stylesheet.
- The primary route may render `./legacy/App` through this runtime because the requirement is native embedding, not a visual rewrite.
- Migrated workbench components no longer call `fetch`, `axios`, or a low-level legacy `api` client directly. API access is routed through module services and the unified `bidGeneratorApi.ts` Service Layer; the obsolete `legacy/services/api.ts` shim has been removed.
- `legacy/services/projectService.ts` no longer calls `bidGeneratorFetch` directly. Project patch persistence, extract/analyze progress SSE, task cancel, content/rewrite/group/review task start and status polling, single-node analysis SSE, and source DOCX access now go through `apps/web/src/modules/bid-generator/services/bidGeneratorApi.ts`.
- `legacy/services/diagramService.ts` no longer calls `bidGeneratorFetch` directly. Diagram artifact reads, diagram batch task start, task status, and cancel now go through `bidGeneratorApi.ts`; the service keeps only Mermaid rendering fallback and legacy workbench result shaping.
- `legacy/services/configService.ts` now uses `bidGeneratorApi.ts` for template/global config read-write and keeps only legacy UI type mapping.
- `legacy/services/protectedAssetUrl.ts` now uses `bidGeneratorApi.ts` for authenticated blob reads; `legacy/services/api.ts` has been removed because it had no remaining callers.
- Knowledge sync trigger controls were removed from the bid-generator workbench because synchronization is owned by the unified knowledge base entrypoint. The bid workbench keeps status/document visibility only.
- The standalone legacy frontend remains rollback/reference only.

Remaining frontend service boundary note:

- `legacy/services/apiBase.ts` remains the low-level compatibility bridge for code paths that need normalized bid-generator URLs, authenticated raw `Response` objects, or local blob URL helpers.
- It is kept as a service-layer compatibility utility, not as component-level API access.

Rules:

- Do not replace the original workbench UI with a new overview shell unless a separate UI rewrite is explicitly approved.
- All new or migrated API calls must stay in module service files; components must not directly call `fetch`, `axios`, or low-level API clients.
- Frontend migration work should focus on Service/API ownership, import boundaries, auth/runtime integration, and iframe removal.
- UI style and interaction behavior must remain aligned with the original workbench.

## 6. Verification

Before marking this stage complete, evidence must prove:

- `apps/api/app/api/bid_generator_proxy.py` no longer mounts legacy api_lite routers by default.
- PIPT behavior used by bid-generator comes from `apps/api` services or shared packages.
- `apps/web/src/modules/bid-generator/BidGeneratorPage.tsx` no longer relies on a standalone legacy iframe; the primary route natively embeds the migrated original workbench UI.
- Legacy rollback remains documented and does not receive new feature logic.
- `npm run build` passes in `apps/web` when a full frontend build is explicitly allowed.
- Relevant `apps/api` tests pass for migrated endpoint groups.

## 7. Current Status

Status: converged.

The current code proves native route/service ownership for the major bid-generator runtime flows, native frontend embedding without the standalone legacy iframe, native PIPT recognition/desensitization engine ownership under `apps/api`, native template generation through `DIFY_WORKFLOW_STRUCTURE_GENERATOR`, and native DOCX forge conversion ownership under `apps/api`. The full frontend build gate is not run in this work session because it was explicitly avoided; `npx tsc --noEmit` and the relevant backend pytest suite are the current verification evidence.
