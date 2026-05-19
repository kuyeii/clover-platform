from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from packages.py_common.config.loader import load_apps_config
from packages.py_common.ports import PortAllocationError, check_port_plan


def main() -> int:
    try:
        apps_config = load_apps_config(REPO_ROOT)
        plan = check_port_plan(apps_config)
    except (OSError, ValueError, PortAllocationError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    print("Port check result:")
    for app in plan["apps"].values():
        if app["code"] == "portal":
            print(
                f"- portal frontend: preferred={app['frontend']['preferred_port']} "
                f"actual={app['frontend_port']} url={app['frontend_url']}"
            )
            print(
                f"- portal backend: preferred={app['backend']['preferred_port']} "
                f"actual={app['backend_port']} url={app['backend_url']}"
            )
            continue

        suffix = "auto" if app["auto_start"] else "manual"
        print(
            f"- {app['code']} iframe: preferred={app['frontend']['preferred_port']} "
            f"actual={app['port']} url={app['iframe_url']} startup={suffix}"
        )
        if "backend" in app:
            print(
                f"  backend: preferred={app['backend']['preferred_port']} "
                f"actual={app['backend_port']} url={app['backend_url']}"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
