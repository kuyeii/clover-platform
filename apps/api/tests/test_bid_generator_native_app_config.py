from __future__ import annotations

import sys
from pathlib import Path


API_ROOT = Path(__file__).resolve().parents[1]
API_ROOT_VALUE = str(API_ROOT)
if API_ROOT_VALUE not in sys.path:
    sys.path.insert(0, API_ROOT_VALUE)

from app.services import portal_store
from packages.py_common.config.loader import load_apps_config


REPO_ROOT = API_ROOT.parents[1]


def test_bid_generator_is_not_registered_as_iframe_runtime_app() -> None:
    apps_config = load_apps_config(REPO_ROOT)
    bid_app = apps_config["apps"]["bid_generator"]

    assert bid_app["code"] == "bid-generator"
    assert bid_app["route_path"] == "/apps/bid-generator"
    assert bid_app["target_api_prefix"] == "/api/v1/bid-generator"
    assert bid_app["iframe_enabled"] is False


def test_portal_app_permissions_still_include_native_bid_generator() -> None:
    portal_store.app_ids.cache_clear()
    try:
        assert "bid-generator" in portal_store.app_ids()
    finally:
        portal_store.app_ids.cache_clear()
