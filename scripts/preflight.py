from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from dotenv import load_dotenv

from packages.py_common.config.loader import load_apps_config
from packages.py_common.preflight import resolve_app_tokens, run_preflight, selected_codes


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run clover-platform development environment preflight checks.")
    parser.add_argument("--only", action="append", default=[], help="Only check selected app code or module key.")
    parser.add_argument("--no-business", action="store_true", help="Check only Portal frontend/backend.")
    parser.add_argument("--strict", action="store_true", help="Treat warnings as failures.")
    parser.add_argument("--json", action="store_true", help="Output machine-readable JSON.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    os.chdir(REPO_ROOT)
    load_dotenv(REPO_ROOT / ".env")

    try:
        apps_config = load_apps_config(REPO_ROOT)
        only = resolve_app_tokens(apps_config, args.only)
        include_codes = selected_codes(apps_config, no_business=args.no_business, only=only)
        report = run_preflight(
            REPO_ROOT,
            apps_config,
            include_codes=include_codes,
            strict=args.strict,
        )
    except (OSError, ValueError) as exc:
        if args.json:
            print(
                json.dumps(
                    {
                        "ok": False,
                        "summary": {"ok": 0, "warn": 0, "error": 1, "skip": 0},
                        "results": [
                            {
                                "name": "preflight",
                                "status": "error",
                                "message": str(exc),
                                "fix_hint": None,
                            }
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                )
            )
        else:
            print(str(exc), file=sys.stderr)
        return 1

    print(report.to_json() if args.json else report.format_text())
    return report.exit_code()


if __name__ == "__main__":
    raise SystemExit(main())
