from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run clover-platform development environment preflight checks.")
    parser.add_argument("--only", action="append", default=[], help="Only check selected app code or module key.")
    parser.add_argument(
        "--no-business",
        action="store_true",
        help="Check apps/web and platform-api without legacy rollback services.",
    )
    parser.add_argument(
        "--with-legacy-frontends",
        action="store_true",
        help="Also check legacy Portal and business frontend rollback dependencies.",
    )
    parser.add_argument(
        "--with-legacy-backends",
        action="store_true",
        help="Also check legacy business backend rollback dependencies.",
    )
    parser.add_argument(
        "--legacy-portal",
        action="store_true",
        help="Also check legacy/portal-launchpad frontend/backend rollback dependencies.",
    )
    parser.add_argument("--strict", action="store_true", help="Treat warnings as failures.")
    parser.add_argument("--json", action="store_true", help="Output machine-readable JSON.")
    return parser.parse_args()


def _dependency_error(module_name: str, *, as_json: bool) -> None:
    result = {
        "ok": False,
        "summary": {"ok": 0, "warn": 0, "error": 1, "skip": 0},
        "results": [
            {
                "name": "root infrastructure dependencies",
                "status": "error",
                "message": f"Missing Python module: {module_name}",
                "fix_hint": "python -m pip install -r requirements-dev.txt",
            }
        ],
    }
    if as_json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    print(f"Missing root infrastructure dependency: {module_name}", file=sys.stderr)
    print("Fix: python -m pip install -r requirements-dev.txt", file=sys.stderr)


def _error_json(name: str, message: str) -> str:
    return json.dumps(
        {
            "ok": False,
            "summary": {"ok": 0, "warn": 0, "error": 1, "skip": 0},
            "results": [
                {
                    "name": name,
                    "status": "error",
                    "message": message,
                    "fix_hint": None,
                }
            ],
        },
        ensure_ascii=False,
        indent=2,
    )


def _include_platform_for_business_only(apps_config: dict, selected: set[str]) -> set[str]:
    if not selected:
        return selected
    apps = apps_config.get("apps") or {}
    business_codes = {
        str(app.get("code") or key)
        for key, app in apps.items()
        if isinstance(app, dict) and bool(app.get("iframe_enabled", False))
    }
    if selected & business_codes:
        return set(selected) | {"platform-api"}
    return selected


def _include_portal_backend(*, no_business: bool, only: set[str]) -> bool:
    if no_business:
        return False
    return "portal" in only


def _legacy_business_codes(apps_config: dict) -> set[str]:
    apps = apps_config.get("apps") or {}
    return {
        str(app.get("code") or key)
        for key, app in apps.items()
        if isinstance(app, dict) and bool(app.get("iframe_enabled", False))
    }


def _augment_selected_for_legacy_modes(
    apps_config: dict,
    selected: set[str],
    *,
    legacy_portal: bool,
    with_legacy_frontends: bool,
    with_legacy_backends: bool,
) -> set[str]:
    next_selected = set(selected)
    has_explicit_selection = bool(selected)
    legacy_business_codes = _legacy_business_codes(apps_config)
    legacy_mode = legacy_portal or with_legacy_frontends or with_legacy_backends
    if legacy_mode and not next_selected:
        from packages.py_common.apps import auto_start_codes

        next_selected.update(auto_start_codes(apps_config))
    if legacy_portal or (with_legacy_frontends and not has_explicit_selection):
        next_selected.add("portal")
    if with_legacy_frontends or with_legacy_backends:
        if next_selected & legacy_business_codes:
            next_selected.update(next_selected & legacy_business_codes)
        else:
            next_selected.update(legacy_business_codes)
    return next_selected


def _is_legacy_mode(args: argparse.Namespace) -> bool:
    return bool(args.legacy_portal or args.with_legacy_frontends or args.with_legacy_backends)


def main() -> int:
    args = parse_args()
    os.chdir(REPO_ROOT)

    try:
        from dotenv import load_dotenv

        from packages.py_common.apps import resolve_app_tokens, select_app_codes
        from packages.py_common.config.loader import load_apps_config
        from packages.py_common.preflight import run_preflight

        load_dotenv(REPO_ROOT / ".env")
        apps_config = load_apps_config(REPO_ROOT)
        only = resolve_app_tokens(apps_config, args.only)
        only = _include_platform_for_business_only(apps_config, only)
        only = _augment_selected_for_legacy_modes(
            apps_config,
            only,
            legacy_portal=args.legacy_portal,
            with_legacy_frontends=args.with_legacy_frontends,
            with_legacy_backends=args.with_legacy_backends,
        )
        effective_no_business = args.no_business and not _is_legacy_mode(args)
        include_codes = select_app_codes(apps_config, no_business=effective_no_business, only=only)
        include_portal_backend = _include_portal_backend(no_business=effective_no_business, only=only)
        report = run_preflight(
            REPO_ROOT,
            apps_config,
            include_codes=include_codes,
            strict=args.strict,
            include_portal_backend=include_portal_backend,
            include_legacy_frontends=args.with_legacy_frontends,
            include_legacy_backends=args.with_legacy_backends,
        )
    except ModuleNotFoundError as exc:
        _dependency_error(exc.name or "unknown", as_json=args.json)
        return 1
    except (OSError, ValueError) as exc:
        if args.json:
            print(_error_json("preflight", str(exc)))
        else:
            print(str(exc), file=sys.stderr)
        return 1

    print(report.to_json() if args.json else report.format_text())
    return report.exit_code()


if __name__ == "__main__":
    raise SystemExit(main())
