from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


def runtime_dir(repo_root: str | Path) -> Path:
    return Path(repo_root) / "runtime"


def ports_file_path(repo_root: str | Path) -> Path:
    return runtime_dir(repo_root) / "ports.json"


def build_ports_payload(
    apps_config: dict[str, Any],
    port_plan: dict[str, Any],
    env: str = "dev",
) -> dict[str, Any]:
    apps_config_map = apps_config.get("apps") or {}
    payload_apps: dict[str, Any] = {}

    for _, app in apps_config_map.items():
        code = str(app.get("code"))
        plan = port_plan["apps"].get(code)
        if not plan:
            continue

        if code == "portal":
            payload_apps[code] = {
                "code": code,
                "name": app.get("name"),
                "frontend_port": plan["frontend_port"],
                "backend_port": plan["backend_port"],
                "frontend_url": plan["frontend_url"],
                "backend_url": plan["backend_url"],
            }
            continue

        dev = app.get("dev") or {}
        frontend_url = plan.get("frontend_url") or plan.get("url") or plan.get("iframe_url")
        health_check = str(dev.get("health_check") or app.get("legacy_health_check") or "")

        app_payload = {
            "code": code,
            "name": app.get("name"),
            "enabled": bool(app.get("enabled", True)),
            "auto_start": bool(dev.get("enabled", False)),
            "dev_mode": "auto" if bool(dev.get("enabled", False)) else "manual",
        }
        if "frontend_port" in plan:
            app_payload["frontend_port"] = plan["frontend_port"]
        if "port" in plan:
            app_payload["port"] = plan["port"]
        if frontend_url:
            app_payload["frontend_url"] = frontend_url
            app_payload["url"] = frontend_url
            app_payload["iframe_url"] = plan.get("iframe_url") or frontend_url
        else:
            app_payload["iframe_url"] = ""

        if "backend_port" in plan:
            app_payload["backend_port"] = plan["backend_port"]
            app_payload["backend_url"] = plan["backend_url"]
            app_payload["health_url"] = (
                f"{plan['backend_url']}{health_check}" if health_check else plan["backend_url"]
            )
        elif frontend_url and health_check:
            app_payload["health_url"] = f"{frontend_url}{health_check}"

        payload_apps[code] = app_payload

    return {
        "generated_at": datetime.now(ZoneInfo("Asia/Shanghai")).isoformat(timespec="seconds"),
        "env": env,
        "apps": payload_apps,
    }


def write_ports_file(repo_root: str | Path, payload: dict[str, Any]) -> Path:
    path = ports_file_path(repo_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def read_ports_file(repo_root: str | Path) -> dict[str, Any] | None:
    path = ports_file_path(repo_root)
    if not path.is_file():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"Expected object in {path}")
    return data
