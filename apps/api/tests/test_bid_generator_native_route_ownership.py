from __future__ import annotations

import sys
from pathlib import Path


API_ROOT = Path(__file__).resolve().parents[1]
API_ROOT_VALUE = str(API_ROOT)
if API_ROOT_VALUE not in sys.path:
    sys.path.insert(0, API_ROOT_VALUE)

import app.api.bid_generator_proxy as bid_generator_proxy
from app.services import bid_generator_service


router = bid_generator_proxy.router


def _route_count(method: str, path: str) -> int:
    target_method = method.upper()
    return sum(
        1
        for route in router.routes
        if getattr(route, "path", None) == path
        and target_method in {str(item).upper() for item in (getattr(route, "methods", None) or set())}
    )


def test_bid_generator_routes_are_owned_by_apps_api_without_legacy_router_mount() -> None:
    native_owned_routes = [
        ("GET", "/bid-generator/api/config/workflow-status"),
        ("GET", "/bid-generator/api/config/analysis-framework"),
        ("GET", "/bid-generator/api/config/template"),
        ("PUT", "/bid-generator/api/config/template"),
        ("DELETE", "/bid-generator/api/config/template"),
        ("PUT", "/bid-generator/api/config/global"),
        ("POST", "/bid-generator/api/config/template/generate"),
        ("GET", "/bid-generator/api/entities"),
        ("GET", "/bid-generator/api/health"),
        ("GET", "/bid-generator/api/pipt-audit-logs"),
        ("POST", "/bid-generator/api/recognize"),
        ("POST", "/bid-generator/api/desensitize"),
        ("POST", "/bid-generator/api/desensitize/batch"),
        ("POST", "/bid-generator/api/restore"),
        ("POST", "/bid-generator/api/bidder/normalize-pipt"),
        ("POST", "/bid-generator/api/bid-attachment/extract"),
        ("POST", "/bid-generator/api/bid-attachment/extract-by-block"),
        ("POST", "/bid-generator/api/bid-attachment/extract-by-block-docx"),
        ("GET", "/bid-generator/api/bid-attachment/test-locators"),
        ("GET", "/bid-generator/api/projects"),
        ("POST", "/bid-generator/api/projects"),
        ("POST", "/bid-generator/api/projects/batch"),
        ("GET", "/bid-generator/api/projects/{project_id}"),
        ("PUT", "/bid-generator/api/projects/{project_id}"),
        ("PATCH", "/bid-generator/api/projects/{project_id}"),
        ("DELETE", "/bid-generator/api/projects/{project_id}"),
        ("DELETE", "/bid-generator/api/projects/{project_id}/caches"),
        ("GET", "/bid-generator/api/projects/{project_id}/mappings"),
        ("GET", "/bid-generator/api/projects/{project_id}/doc-blocks"),
        ("POST", "/bid-generator/api/projects/{project_id}/rebuild-locator"),
        ("GET", "/bid-generator/api/projects/{project_id}/analysis-report"),
        ("POST", "/bid-generator/api/projects/{project_id}/analysis-report"),
        ("POST", "/bid-generator/api/projects/analyze"),
        ("POST", "/bid-generator/api/projects/{project_id}/analyze-node"),
        ("POST", "/bid-generator/api/projects/extract"),
        ("POST", "/bid-generator/api/projects/extract-stream"),
        ("POST", "/bid-generator/api/projects/re-extract"),
        ("POST", "/bid-generator/api/projects/generate-outline"),
        ("POST", "/bid-generator/api/projects/generate-outline-stream"),
        ("POST", "/bid-generator/api/projects/generate-content"),
        ("POST", "/bid-generator/api/projects/generate-content-stream"),
        ("POST", "/bid-generator/api/projects/generate-attachment"),
        ("POST", "/bid-generator/api/projects/build-scoring-table"),
        ("POST", "/bid-generator/api/projects/fill-scoring-row"),
        ("POST", "/bid-generator/api/projects/generate-blueprint"),
        ("POST", "/bid-generator/api/projects/export-report"),
        ("POST", "/bid-generator/api/projects/export-scoring-table"),
        ("POST", "/bid-generator/api/projects/forge-document"),
        ("GET", "/bid-generator/api/projects/pdf/{project_id}"),
        ("POST", "/bid-generator/api/projects/upload-pdf"),
        ("GET", "/bid-generator/api/projects/{project_id}/source-docx"),
        ("GET", "/bid-generator/api/extracted-images/by-hash/{image_hash}"),
        ("GET", "/bid-generator/api/extracted-images/{filename}"),
        ("GET", "/bid-generator/api/diagram-artifacts/{diagram_id}.svg"),
        ("GET", "/bid-generator/api/diagram-artifacts/{diagram_id}.mmd"),
        ("POST", "/bid-generator/api/tasks/start-outline"),
        ("POST", "/bid-generator/api/tasks/start-extract"),
        ("POST", "/bid-generator/api/tasks/start-content"),
        ("POST", "/bid-generator/api/tasks/start-content-rewrite"),
        ("POST", "/bid-generator/api/tasks/start-content-group"),
        ("POST", "/bid-generator/api/tasks/start-group-review"),
        ("POST", "/bid-generator/api/tasks/start-diagram"),
        ("POST", "/bid-generator/api/tasks/start-diagram-batch"),
        ("POST", "/bid-generator/api/tasks/start-analyze"),
        ("GET", "/bid-generator/api/tasks/{task_id}/status"),
        ("GET", "/bid-generator/api/tasks/{task_id}/progress"),
        ("GET", "/bid-generator/api/knowledge/images"),
        ("PATCH", "/bid-generator/api/knowledge/images/{image_hash}"),
        ("GET", "/bid-generator/api/knowledge/documents"),
        ("GET", "/bid-generator/api/kb/sync-status/{job_id}"),
        ("GET", "/bid-generator/api/kb/sync-jobs"),
        ("POST", "/bid-generator/api/tasks/{task_id}/cancel"),
    ]

    for method, path in native_owned_routes:
        assert _route_count(method, path) == 1


def test_legacy_router_specific_unknown_routes_are_not_mounted() -> None:
    # 统一后端不再默认 include legacy api_lite routers；未知路径只走平台 catch-all proxy 回滚边界。
    assert _route_count("POST", "/bid-generator/api/knowledge/sync") == 0
    assert _route_count("POST", "/bid-generator/api/knowledge/sync/{doc_name}") == 0
    assert _route_count("POST", "/bid-generator/api/kb/sync") == 0


def test_removed_legacy_router_paths_do_not_create_direct_routes() -> None:
    assert _route_count("POST", "/bid-generator/api/legacy-router-probe") == 0
    assert _route_count("GET", "/bid-generator/api/legacy-router-probe") == 0


def test_bid_generator_proxy_import_does_not_mount_legacy_routers() -> None:
    assert not hasattr(bid_generator_proxy, "get_legacy_api_routers")


def test_bid_generator_service_does_not_expose_legacy_router_entrypoints() -> None:
    assert not hasattr(bid_generator_service, "get_legacy_api_routers")
    assert not hasattr(bid_generator_service, "init_legacy_storage")
    assert not hasattr(bid_generator_service, "preload_legacy_engine")
