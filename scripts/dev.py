from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from dotenv import load_dotenv

from packages.py_common.config.loader import load_apps_config
from packages.py_common.ports import PortAllocationError, check_port_plan
from packages.py_common.process_manager import ProcessManager, ProcessSpec
from packages.py_common.runtime import build_ports_payload, write_ports_file


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Start clover-platform development services.")
    parser.add_argument("--no-business", action="store_true", help="Start only Portal frontend/backend.")
    parser.add_argument("--write-ports-only", action="store_true", help="Write runtime/ports.json without starting services.")
    parser.add_argument("--only", action="append", default=[], help="Only start selected app code or module key.")
    parser.add_argument("--skip", action="append", default=[], help="Skip selected app code or module key.")
    return parser.parse_args()


def _python_bin_for_app(app: dict[str, Any]) -> str:
    dev = app.get("dev") or {}
    env_name = str(dev.get("python_bin_env") or "").strip()
    if env_name and os.getenv(env_name):
        return str(os.getenv(env_name))

    if bool(dev.get("prefer_local_python", False)):
        backend_working_dir = str(dev.get("backend_working_dir") or "").strip()
        if backend_working_dir:
            backend_python = REPO_ROOT / backend_working_dir / ".venv" / "bin" / "python"
            if backend_python.is_file():
                return str(backend_python)

        legacy_path = str(app.get("legacy_path") or "")
        if legacy_path:
            local_python = REPO_ROOT / legacy_path / ".venv" / "bin" / "python"
            if local_python.is_file():
                return str(local_python)

    return sys.executable


def _format_value(value: str, app: dict[str, Any], plan: dict[str, Any]) -> str:
    return value.format(
        python=_python_bin_for_app(app),
        port=plan.get("port", ""),
        backend_port=plan.get("backend_port", ""),
        frontend_port=plan.get("frontend_port", ""),
        code=app.get("code", ""),
        module_key=app.get("module_key", ""),
    )


def _format_env(env_config: dict[str, Any], app: dict[str, Any], plan: dict[str, Any]) -> dict[str, str]:
    return {key: _format_value(str(value), app, plan) for key, value in env_config.items()}


def _app_token_maps(apps_config: dict[str, Any]) -> tuple[dict[str, str], list[str], list[str]]:
    apps = apps_config.get("apps") or {}
    preferred_order = [
        "portal",
        "bid-generator",
        "contract-review",
        "competitor-analysis",
        "rag-web-search",
    ]
    ordered_apps = sorted(
        apps.items(),
        key=lambda item: preferred_order.index(str(item[1].get("code")))
        if str(item[1].get("code")) in preferred_order
        else len(preferred_order),
    )
    token_to_code: dict[str, str] = {}
    app_codes: list[str] = []
    module_keys: list[str] = []
    for key, app in ordered_apps:
        code = str(app.get("code"))
        module_key = str(app.get("module_key") or key)
        app_codes.append(code)
        module_keys.append(module_key)
        token_to_code[str(key)] = code
        token_to_code[code] = code
        token_to_code[module_key] = code
    return token_to_code, app_codes, module_keys


def _unknown_token_message(token: str, app_codes: list[str], module_keys: list[str]) -> str:
    app_codes_text = "\n".join(f"  {code}" for code in app_codes)
    module_keys_text = "\n".join(f"  {module_key}" for module_key in module_keys)
    return (
        f"Unknown app token: {token}\n\n"
        f"Available app codes:\n{app_codes_text}\n\n"
        f"Available module keys:\n{module_keys_text}"
    )


def _resolve_app_tokens(apps_config: dict[str, Any], values: list[str]) -> set[str]:
    token_to_code, app_codes, module_keys = _app_token_maps(apps_config)
    resolved: set[str] = set()
    for value in values:
        normalized = value.strip()
        if normalized not in token_to_code:
            raise ValueError(_unknown_token_message(normalized, app_codes, module_keys))
        resolved.add(token_to_code[normalized])
    return resolved


def _auto_start_codes(apps_config: dict[str, Any]) -> set[str]:
    apps = apps_config.get("apps") or {}
    return {
        str(app.get("code"))
        for app in apps.values()
        if isinstance(app, dict) and bool((app.get("dev") or {}).get("enabled", False))
    }


def _port_plan_include_codes(
    apps_config: dict[str, Any],
    *,
    no_business: bool,
    write_ports_only: bool,
    only: set[str],
) -> set[str] | None:
    if no_business:
        return {"portal"}
    if only:
        return set(only)
    if write_ports_only:
        return None
    return _auto_start_codes(apps_config)


def should_start_app(
    app: dict[str, Any],
    *,
    no_business: bool,
    only: set[str],
    skip: set[str],
) -> bool:
    code = str(app.get("code"))
    if code in skip:
        return False
    if only and code not in only:
        return False
    if no_business and code != "portal":
        return False
    return bool((app.get("dev") or {}).get("enabled", False))


def build_process_specs(
    apps_config: dict[str, Any],
    port_plan: dict[str, Any],
    *,
    no_business: bool,
    only: set[str],
    skip: set[str],
) -> list[ProcessSpec]:
    specs: list[ProcessSpec] = []
    apps = apps_config.get("apps") or {}
    plan_by_code = port_plan["apps"]

    for _, app in apps.items():
        code = str(app.get("code"))
        dev = app.get("dev") or {}
        if not should_start_app(app, no_business=no_business, only=only, skip=skip):
            continue
        plan = plan_by_code[code]

        env = _format_env(dev.get("env") or {}, app, plan)
        if code == "portal":
            frontend_command = _format_value(str(dev["frontend_command"]), app, plan)
            backend_command = _format_value(str(dev["backend_command"]), app, plan)
            frontend_cwd = REPO_ROOT / str(dev.get("frontend_working_dir") or dev.get("working_dir"))
            backend_cwd = REPO_ROOT / str(dev.get("backend_working_dir") or dev.get("working_dir"))
            specs.append(ProcessSpec(f"{code}:backend", backend_command, backend_cwd, env))
            specs.append(ProcessSpec(f"{code}:frontend", frontend_command, frontend_cwd, env))
        elif str(dev.get("kind") or "") == "frontend_backend":
            backend_command = _format_value(str(dev.get("backend_command") or ""), app, plan)
            frontend_command = _format_value(str(dev.get("frontend_command") or ""), app, plan)
            backend_cwd = REPO_ROOT / str(dev.get("backend_working_dir") or dev.get("working_dir"))
            frontend_cwd = REPO_ROOT / str(dev.get("frontend_working_dir") or dev.get("working_dir"))
            if backend_command:
                specs.append(ProcessSpec(f"{code}:backend", backend_command, backend_cwd, env))
            if frontend_command:
                specs.append(ProcessSpec(f"{code}:frontend", frontend_command, frontend_cwd, env))
        else:
            command = _format_value(str(dev.get("frontend_command") or ""), app, plan)
            if command:
                cwd = REPO_ROOT / str(dev.get("frontend_working_dir") or dev.get("working_dir"))
                specs.append(ProcessSpec(f"{code}:frontend", command, cwd, env))

    return specs


def print_manual_modules(apps_config: dict[str, Any]) -> None:
    apps = apps_config.get("apps") or {}
    manual = [
        (str(app.get("code")), str((app.get("dev") or {}).get("note") or "manual startup required"))
        for app in apps.values()
        if str(app.get("code")) != "portal" and not bool((app.get("dev") or {}).get("enabled", False))
    ]
    if manual:
        print("Manual startup modules:")
        for code, note in manual:
            print(f"- {code}: {note}")


def main() -> int:
    args = parse_args()
    os.chdir(REPO_ROOT)
    load_dotenv(REPO_ROOT / ".env")

    try:
        apps_config = load_apps_config(REPO_ROOT)
        only = _resolve_app_tokens(apps_config, args.only)
        skip = _resolve_app_tokens(apps_config, args.skip)
        include_codes = _port_plan_include_codes(
            apps_config,
            no_business=args.no_business,
            write_ports_only=args.write_ports_only,
            only=only,
        )
        port_plan = check_port_plan(
            apps_config,
            include_codes=include_codes,
            exclude_codes=skip,
        )
    except (OSError, ValueError, PortAllocationError) as exc:
        print(str(exc), file=sys.stderr)
        return 1

    payload = build_ports_payload(apps_config, port_plan, env=os.getenv("APP_ENV", "dev"))
    ports_path = write_ports_file(REPO_ROOT, payload)
    print(f"Wrote {ports_path}")

    if args.write_ports_only:
        return 0

    specs = build_process_specs(
        apps_config,
        port_plan,
        no_business=args.no_business,
        only=only,
        skip=skip,
    )
    if not specs:
        print("No services selected.")
        return 0

    for spec in specs:
        print(f"Starting {spec.name}: {spec.command}")
    print_manual_modules(apps_config)

    manager = ProcessManager()
    try:
        for spec in specs:
            manager.start(spec)
        return manager.wait()
    finally:
        manager.stop_all()


if __name__ == "__main__":
    raise SystemExit(main())
