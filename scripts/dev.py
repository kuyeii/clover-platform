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

from packages.py_common.apps import auto_start_codes, resolve_app_tokens, select_app_codes
from packages.py_common.config.loader import load_apps_config
from packages.py_common.ports import PortAllocationError, check_port_plan
from packages.py_common.process_manager import ProcessManager, ProcessSpec
from packages.py_common.runtime import build_ports_payload, write_ports_file


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Start clover-platform development services.")
    parser.add_argument(
        "--no-business",
        action="store_true",
        help="Start apps/web and platform-api without legacy rollback services.",
    )
    parser.add_argument("--write-ports-only", action="store_true", help="Write runtime/ports.json without starting services.")
    parser.add_argument("--only", action="append", default=[], help="Only start selected app code or module key.")
    parser.add_argument("--skip", action="append", default=[], help="Skip selected app code or module key.")
    parser.add_argument(
        "--with-legacy-backends",
        action="store_true",
        help="Also start legacy business backends for rollback/debug fallback.",
    )
    parser.add_argument(
        "--with-legacy-frontends",
        action="store_true",
        help="Also start legacy Portal and business frontends for iframe rollback/debug fallback.",
    )
    parser.add_argument(
        "--legacy-portal",
        action="store_true",
        help="Also start legacy/portal-launchpad frontend/backend as a rollback entry.",
    )
    parser.add_argument("--skip-preflight", action="store_true", help="Skip startup preflight checks.")
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
    env: dict[str, str] = {}
    for key, value in env_config.items():
        text = str(value)
        if "backend_port" in text and "backend_port" not in plan:
            continue
        env[key] = _format_value(text, app, plan)
    return env


def _inject_portal_platform_env(env: dict[str, str], port_plan: dict[str, Any]) -> None:
    platform_plan = (port_plan.get("apps") or {}).get("platform-api")
    if not isinstance(platform_plan, dict):
        return

    backend_url = str(platform_plan.get("backend_url") or "").rstrip("/")
    backend_port = platform_plan.get("backend_port")
    if not backend_url and backend_port:
        backend_url = f"http://127.0.0.1:{backend_port}"
    if not backend_url:
        return

    ws_url = backend_url.replace("https://", "wss://", 1).replace("http://", "ws://", 1)
    env.setdefault("PLATFORM_API_PORT", str(backend_port or ""))
    env.setdefault("PLATFORM_API_URL", backend_url)
    env.setdefault("PLATFORM_WS_URL", ws_url)
    env.setdefault("VITE_PLATFORM_API_BASE_URL", f"{backend_url}/api/v1/core")
    env.setdefault("VITE_PLATFORM_WS_BASE_URL", f"{ws_url}/ws/core")
    env.setdefault("VITE_PLATFORM_API_PROXY_TARGET", backend_url)
    env.setdefault("VITE_PLATFORM_WS_PROXY_TARGET", ws_url)


def _inject_apps_web_platform_env(env: dict[str, str], port_plan: dict[str, Any]) -> None:
    platform_plan = (port_plan.get("apps") or {}).get("platform-api")
    if not isinstance(platform_plan, dict):
        return

    backend_url = str(platform_plan.get("backend_url") or "").rstrip("/")
    backend_port = platform_plan.get("backend_port")
    if not backend_url and backend_port:
        backend_url = f"http://127.0.0.1:{backend_port}"
    if not backend_url:
        return

    ws_url = backend_url.replace("https://", "wss://", 1).replace("http://", "ws://", 1)
    env.setdefault("VITE_API_BASE_URL", f"{backend_url}/api/v1")
    env.setdefault("VITE_WS_BASE_URL", f"{ws_url}/ws/core")


def _port_plan_include_codes(
    apps_config: dict[str, Any],
    *,
    no_business: bool,
    only: set[str],
) -> set[str] | None:
    return select_app_codes(
        apps_config,
        no_business=no_business,
        only=only,
    )


def _include_platform_for_business_only(apps_config: dict[str, Any], selected: set[str]) -> set[str]:
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


def _legacy_business_codes(apps_config: dict[str, Any]) -> set[str]:
    apps = apps_config.get("apps") or {}
    return {
        str(app.get("code") or key)
        for key, app in apps.items()
        if isinstance(app, dict) and bool(app.get("iframe_enabled", False))
    }


def _augment_selected_for_legacy_modes(
    apps_config: dict[str, Any],
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
        next_selected.update(auto_start_codes(apps_config))
    if legacy_portal or (with_legacy_frontends and not has_explicit_selection):
        next_selected.add("portal")
    if with_legacy_frontends or with_legacy_backends:
        if next_selected & legacy_business_codes:
            next_selected.update(next_selected & legacy_business_codes)
        else:
            next_selected.update(legacy_business_codes)
    return next_selected


def _should_include_portal_backend(*, only: set[str]) -> bool:
    return "portal" in only


def _is_legacy_mode(args: argparse.Namespace) -> bool:
    return bool(args.legacy_portal or args.with_legacy_frontends or args.with_legacy_backends)


def should_start_app(
    app: dict[str, Any],
    *,
    no_business: bool,
    only: set[str],
    skip: set[str],
    force_start_codes: set[str],
) -> bool:
    code = str(app.get("code"))
    if code in skip:
        return False
    if only and code not in only:
        return False
    if no_business and code not in {"apps-web", "platform-api"}:
        return False
    return code in force_start_codes or bool((app.get("dev") or {}).get("enabled", False))


def build_process_specs(
    apps_config: dict[str, Any],
    port_plan: dict[str, Any],
    *,
    no_business: bool,
    only: set[str],
    skip: set[str],
    with_legacy_backends: bool,
    include_portal_backend: bool,
    force_start_codes: set[str],
) -> list[ProcessSpec]:
    specs: list[ProcessSpec] = []
    apps = apps_config.get("apps") or {}
    plan_by_code = port_plan["apps"]

    for _, app in apps.items():
        code = str(app.get("code"))
        dev = app.get("dev") or {}
        if not should_start_app(app, no_business=no_business, only=only, skip=skip, force_start_codes=force_start_codes):
            continue
        plan = plan_by_code[code]

        env = _format_env(dev.get("env") or {}, app, plan)
        if code == "apps-web":
            _inject_apps_web_platform_env(env, port_plan)
            frontend_command = _format_value(str(dev["frontend_command"]), app, plan)
            frontend_cwd = REPO_ROOT / str(dev.get("frontend_working_dir") or dev.get("working_dir"))
            specs.append(ProcessSpec(f"{code}:frontend", frontend_command, frontend_cwd, env))
        elif code == "portal":
            _inject_portal_platform_env(env, port_plan)
            frontend_command = _format_value(str(dev["frontend_command"]), app, plan)
            frontend_cwd = REPO_ROOT / str(dev.get("frontend_working_dir") or dev.get("working_dir"))
            if include_portal_backend:
                backend_command = _format_value(str(dev["backend_command"]), app, plan)
                backend_cwd = REPO_ROOT / str(dev.get("backend_working_dir") or dev.get("working_dir"))
                specs.append(ProcessSpec(f"{code}:backend", backend_command, backend_cwd, env))
            specs.append(ProcessSpec(f"{code}:frontend", frontend_command, frontend_cwd, env))
        elif str(dev.get("kind") or "") == "frontend_backend":
            backend_command = _format_value(str(dev.get("backend_command") or ""), app, plan)
            frontend_command = _format_value(str(dev.get("frontend_command") or ""), app, plan)
            backend_cwd = REPO_ROOT / str(dev.get("backend_working_dir") or dev.get("working_dir"))
            frontend_cwd = REPO_ROOT / str(dev.get("frontend_working_dir") or dev.get("working_dir"))
            if backend_command and with_legacy_backends and "backend_port" in plan:
                specs.append(ProcessSpec(f"{code}:backend", backend_command, backend_cwd, env))
            if frontend_command and "frontend_port" in plan:
                specs.append(ProcessSpec(f"{code}:frontend", frontend_command, frontend_cwd, env))
        elif str(dev.get("kind") or "") == "backend":
            backend_command = _format_value(str(dev.get("backend_command") or ""), app, plan)
            backend_cwd = REPO_ROOT / str(dev.get("backend_working_dir") or dev.get("working_dir"))
            if backend_command:
                specs.append(ProcessSpec(f"{code}:backend", backend_command, backend_cwd, env))
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
        only = resolve_app_tokens(apps_config, args.only)
        only = _include_platform_for_business_only(apps_config, only)
        only = _augment_selected_for_legacy_modes(
            apps_config,
            only,
            legacy_portal=args.legacy_portal,
            with_legacy_frontends=args.with_legacy_frontends,
            with_legacy_backends=args.with_legacy_backends,
        )
        skip = resolve_app_tokens(apps_config, args.skip)
        effective_no_business = args.no_business and not _is_legacy_mode(args)
        include_portal_backend = _should_include_portal_backend(only=only)
        include_codes = _port_plan_include_codes(
            apps_config,
            no_business=effective_no_business,
            only=only,
        )
        port_plan = check_port_plan(
            apps_config,
            include_codes=include_codes,
            exclude_codes=skip,
            include_portal_backend=include_portal_backend,
            include_legacy_frontends=args.with_legacy_frontends,
            include_legacy_backends=args.with_legacy_backends,
        )
    except (OSError, ValueError, PortAllocationError) as exc:
        print(str(exc), file=sys.stderr)
        return 1

    if not args.write_ports_only and not args.skip_preflight:
        from packages.py_common.preflight import run_preflight

        preflight_report = run_preflight(
            REPO_ROOT,
            apps_config,
            include_codes=include_codes or auto_start_codes(apps_config),
            exclude_codes=skip,
            port_plan=port_plan,
            include_portal_backend=include_portal_backend,
            include_legacy_frontends=args.with_legacy_frontends,
            include_legacy_backends=args.with_legacy_backends,
        )
        print(preflight_report.format_text())
        if not preflight_report.ok:
            print("Preflight failed; fix the errors above or rerun with --skip-preflight.", file=sys.stderr)
            return preflight_report.exit_code()
    elif args.skip_preflight:
        print("Skipping preflight checks.")

    payload = build_ports_payload(apps_config, port_plan, env=os.getenv("APP_ENV", "dev"))
    ports_path = write_ports_file(REPO_ROOT, payload)
    print(f"Wrote {ports_path}")

    if args.write_ports_only:
        return 0

    specs = build_process_specs(
        apps_config,
        port_plan,
        no_business=effective_no_business,
        only=only,
        skip=skip,
        with_legacy_backends=args.with_legacy_backends,
        include_portal_backend=include_portal_backend,
        force_start_codes=only,
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
