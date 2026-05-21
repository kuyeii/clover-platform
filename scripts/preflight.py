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
        help="Check Portal frontend and platform-api without business modules.",
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
        include_codes = select_app_codes(apps_config, no_business=args.no_business, only=only)
        report = run_preflight(
            REPO_ROOT,
            apps_config,
            include_codes=include_codes,
            strict=args.strict,
            include_portal_backend=not args.no_business,
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
