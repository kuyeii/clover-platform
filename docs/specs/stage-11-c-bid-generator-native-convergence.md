# Stage 11-C: Bid Generator Native Convergence

## 1. Problem Statement

The bid generator is currently exposed through the unified platform, but its business implementation is not yet fully native.

Current evidence:

- `apps/api/app/api/bid_generator_proxy.py` no longer mounts `legacy/bid-generator/pipt-flask/app/api_lite` routers by default. Public bid-generator paths are declared in `apps/api`; legacy router/init/preload entrypoints have been removed from the bid service, and remaining legacy-backed execution paths are invoked only through explicit service adapters.
- `apps/web/src/modules/bid-generator/BidGeneratorPage.tsx` now natively embeds the migrated legacy React workbench through `legacy/LegacyBidGeneratorRuntime.tsx`; it is no longer loaded through a standalone legacy frontend iframe. The original workbench UI and interaction model are intentionally preserved.
- `apps/api/app/services/pipt_gateway_service.py` already provides a platform PIPT gateway. Strong preprocessing now calls `apps/api/app/services/pipt_recognition_adapter.py`, which isolates the interim legacy `app.api_lite.engine.DesensitizeEngine` dependency.
- `apps/api/app/services/bid_workflow_execution_adapter.py` now centralizes the remaining legacy workflow, analysis, export, and forge route calls so `bid_generator_service.py` no longer directly imports/calls legacy workflow routes.
- `apps/api/app/services/pipt_redaction_service.py` provides the current-document final global redaction pass for missed same-document entities.
- `modules/bid_generator/README.md` describes a more advanced native state than the current code proves.

This means the module is in a compatibility state: unified entrypoints are present, but legacy code still owns substantial runtime behavior.

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
| PIPT recognition engine implementation | `apps/api/app/services/pipt_recognition_adapter.py` provider boundary wrapping legacy `DesensitizeEngine` | `apps/api` or shared package | `legacy_adapter` | Allowed as an interim adapter; gateway/bid services depend on `PiptRecognitionProvider`, not the legacy engine function directly, but engine ownership is not fully migrated. |
| Bid public PIPT routes `/api/v1/bid-generator/api/desensitize`, `/recognize`, `/desensitize/batch`, `/restore`, `/bidder/normalize-pipt` | `apps/api/app/api/bid_generator_proxy.py` + `apps/api/app/services/bid_pipt_compat_service.py` + `apps/api/app/services/bid_bidder_pipt_service.py` | `apps/api` | `legacy_adapter` | Route ownership is native and legacy api_lite routers are not mounted by default. Public response shape stays legacy-compatible. Restore/vault reads are now native SQL against `bid_generator.entity_registry` / `mapping_records`; bidder normalize writes `bid_generator.entity_registry` through native SQL and preserves legacy strong-token/prompt fields. Recognition still uses the legacy `DesensitizeEngine` adapter until the PIPT engine is fully native. |
| Bid health/config/entity routes `/api/v1/bid-generator/api/health`, `/config/workflow-status`, `/config/analysis-framework`, `/config/template`, `/config/global`, `/config/template/generate`, `/entities` | `apps/api/app/api/bid_generator_proxy.py` + `apps/api/app/services/bid_generator_service.py` | `apps/api` | `legacy_adapter` | Route ownership is native and legacy api_lite routers are not mounted by default; health/config/entity reads and template/global config mutation are native file/config operations. Template generation still calls the legacy-compatible Dify bridge implementation through the service adapter. **Conflict note:** `config/template/generate` 的 legacy 实现当前通过 `legacy/bid-generator/config.yaml` 中 `dify.api_key` + `dify-bridge.WorkflowManager.run_bid_generation(...)` 执行，而统一后端其余大纲主链路已按 `.env` 的 `DIFY_WORKFLOW_STRUCTURE_GENERATOR` 作为工作流凭据来源。若继续将该接口静默 native 化，就会在“哪一把 Dify key / 哪个工作流入口是权威来源”上产生双实现语义冲突，因此这一条执行链在凭据来源决策前不得直接改为 native workflow 调用。 |
| Bid project CRUD/index and DOCX locator routes `/api/v1/bid-generator/api/projects`, `/projects/batch`, `/projects/{project_id}`, `/projects/{project_id}/mappings`, `/projects/{project_id}/doc-blocks`, `/projects/{project_id}/rebuild-locator`, `/bid-attachment/test-locators`, `/bid-attachment/extract`, `/bid-attachment/extract-by-block`, `/bid-attachment/extract-by-block-docx` | `apps/api/app/api/bid_generator_proxy.py` + `apps/api/app/services/bid_generator_service.py` | `apps/api` | `native_only` | Legacy api_lite routers are not mounted by default; doc-blocks, locator preview, and HTML attachment extraction read the persisted `__doc_blocks_cache` snapshot. Rebuild-locator parses uploaded DOCX in apps/api, persists source DOCX cache, and updates the project snapshot. Binary DOCX slicing now reads the cached source DOCX and slices `word/document.xml` natively. |
| Bid analysis report routes `/api/v1/bid-generator/api/projects/{project_id}/analysis-report` | `apps/api/app/api/bid_generator_proxy.py` + `apps/api/app/services/bid_generator_service.py` | `apps/api` | `native_only` | Legacy api_lite routers are not mounted by default; file mirror remains for compatibility. |
| Bid project file/image/artifact routes `/api/v1/bid-generator/api/projects/pdf/{project_id}`, `/projects/upload-pdf`, `/projects/{project_id}/source-docx`, `/extracted-images/by-hash/{image_hash}`, `/extracted-images/{filename}`, `/diagram-artifacts/{diagram_id}.svg`, `/diagram-artifacts/{diagram_id}.mmd` | `apps/api/app/api/bid_generator_proxy.py` + `apps/api/app/services/bid_generator_service.py` | `apps/api` | `native_only` | Legacy api_lite routers are not mounted by default; existing cache/artifact directories remain for compatibility. Diagram artifact read does not migrate task generation. |
| Bid scoring table export `/api/v1/bid-generator/api/projects/export-scoring-table` | `apps/api/app/api/bid_generator_proxy.py` + `apps/api/app/services/bid_generator_service.py` | `apps/api` | `native_only` | Legacy api_lite routers are not mounted by default; Excel generation uses apps/api `openpyxl` directly and preserves legacy-compatible workbook columns and download headers. |
| Bid knowledge asset routes `/api/v1/bid-generator/api/knowledge/images`, `/knowledge/images/{image_hash}`, `/knowledge/documents` | `apps/api/app/api/bid_generator_proxy.py` + `apps/api/app/services/bid_generator_service.py` | `apps/api` | `native_only` | Legacy api_lite routers are not mounted by default; `/knowledge/documents` only queries Dify dataset document metadata. |
| Bid extract/task start/status/progress/cancel `/api/v1/bid-generator/api/projects/extract`, `/projects/extract-stream`, `/projects/re-extract`, `/tasks/start-*`, `/tasks/{task_id}/status`, `/tasks/{task_id}/progress`, `/tasks/{task_id}/cancel` | `apps/api/app/api/bid_generator_proxy.py` + legacy task execution adapter | `apps/api` native task service | `legacy_adapter` | Route ownership is native. Task status, progress SSE, and cancel are handled in `apps/api` service code; cancel now stops Dify workflows through native HTTP and cancels the shared task manager directly, and progress SSE preserves the legacy event/data protocol without calling the legacy route. `tasks/start-analyze` 已迁到 `apps/api` 原生任务编排：统一后端负责原文缓存读取、分组 Dify 调度、附件目录锚点补齐、`analysis_v2`/`analysisReport` 持久化，以及 legacy `bid_attachments` / `analysis_v2` / `structure_stage` 事件兼容。Extraction、其余 task start execution、PIPT extraction path、共享 in-memory TaskManager storage and most Dify orchestration still rely on legacy adapters. |
| Bid KB sync status/listing `/api/v1/bid-generator/api/kb/sync-status/{job_id}`, `/kb/sync-jobs` | `apps/api/app/api/bid_generator_proxy.py` + sync status service | unified knowledge base entrypoint for trigger actions | `legacy_adapter` | Status/listing route ownership is native for compatibility. Sync triggers `/knowledge/sync`, `/knowledge/sync/{doc_name}`, and `/kb/sync` are not exposed by bid-generator because knowledge synchronization is now handled by the unified knowledge base entrypoint. |
| Bid workflow generation/analyze/export/forge `/api/v1/bid-generator/api/projects/generate-*`, `/projects/analyze`, `/projects/{project_id}/analyze-node`, `/projects/build-scoring-table`, `/projects/fill-scoring-row`, `/projects/export-report`, `/projects/forge-document` | `apps/api/app/api/bid_generator_proxy.py` + `apps/api/app/services/bid_workflow_execution_adapter.py` | `apps/api` native workflow/file service | `legacy_adapter` | Route ownership is native; `bid_generator_service.py` 已不再直接 import/call legacy workflow routes，剩余执行统一收口到 workflow adapter。SSE/binary response contracts are preserved while remaining Dify workflow execution, WeasyPrint PDF export, and DocumentForge still use legacy-compatible adapters。`build-scoring-table`、`generate-blueprint`、`fill-scoring-row`、`generate-attachment`、`analyze-node`、`projects/analyze` 直连 SSE、`generate-outline`（同步 blocking 版本）以及 `generate-outline-stream`（保留 legacy `stage/done/error` SSE 契约、补齐 `workflow_run_id` fallback GET 和字数预算归一化）已原生迁到 `apps/api/app/services/bid_generator_service.py` / `bid_docanalysis_service.py` / `bid_outline_service.py`；评分表 Excel export 也已原生。`tasks/start-analyze` 已在 task slice 中原生化。`export-report` and `forge-document` remain blocked for the previously recorded dependency reasons. |
| Bid project cache cleanup `/api/v1/bid-generator/api/projects/{project_id}/caches` | `apps/api/app/api/bid_generator_proxy.py` + `apps/api/app/services/bid_generator_service.py` | `apps/api` native file/cache service | `native_only` | Route ownership is native; deletes PDF/raw-doc/source DOCX cache files and no longer touches legacy in-memory locator cache. |

### Slice B: Native Bid API Routes

Goal: Replace legacy router ownership with native `apps/api` route/service ownership slice by slice.

Order:

1. Health, config, and entity endpoints. Current status: health, workflow status, analysis framework, template/config read, template/global config mutation, and entities are native route-owned and native service-owned; legacy api_lite routers are not mounted by default. Template generation remains native route-owned but still uses legacy-compatible Dify bridge adapter semantics.
2. PIPT endpoints after Slice A ownership is decided. Current status: platform PIPT gateway status/validate/preprocess/postprocess methods, bid PIPT audit log reading, and bid public desensitize/recognize/batch/restore/bidder-normalize routes are native route-owned. Bid public PIPT restore now reads the vault through native SQL; bidder normalize writes the global entity registry through native SQL while preserving legacy response fields; recognition/desensitize now enter through the unified provider boundary and still use the legacy recognizer adapter underneath to preserve contract and extraction quality.
3. Project CRUD, mappings, and persisted doc-blocks snapshot. Current status: native-owned; legacy api_lite routers are not mounted by default.
4. Extract and task progress endpoints. Current status: PDF/source DOCX/extracted image/diagram artifact file access and cache cleanup are native-owned; status, progress SSE, and cancel logic are native service-owned while still using the shared legacy TaskManager storage. extract/extract-stream/re-extract, task start, parsing, PIPT extraction path, and Dify orchestration still use legacy adapters.
5. Workflow generation and export endpoints. Current status: analysis-report persistence, analyze/analyze-node, outline/content generation, attachment/scoring/blueprint helpers, export, and forge routes are native route-owned; execution/generation still uses `bid_workflow_execution_adapter.py` as the centralized legacy-compatible adapter boundary.
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
- Migrated workbench components no longer call `fetch`, `axios`, or the low-level legacy `api` client directly. API access is routed through module services; the legacy-compatible `legacy/services/api.ts` client is now a `bidGeneratorFetch` adapter for existing service code.
- Knowledge sync trigger controls were removed from the bid-generator workbench because synchronization is owned by the unified knowledge base entrypoint. The bid workbench keeps status/document visibility only.
- The standalone legacy frontend remains rollback/reference only.

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
- `npm run build` passes in `apps/web`.
- Relevant `apps/api` tests pass for migrated endpoint groups.

## 7. Current Status

Status: not complete.

The current code still proves legacy ownership for major bid-generator runtime behavior. Frontend progress is limited to native embedding of the original workbench and Service/API boundary preparation; complex workbench flows, task orchestration, generation, export, and knowledge tools remain legacy-backed or legacy-adapter-backed. This spec is the execution boundary for future convergence work.
