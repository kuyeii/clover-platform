from __future__ import annotations

import socket
from typing import Any


class PortAllocationError(RuntimeError):
    """Raised when no usable port can be found in a configured range."""


def is_port_available(host: str, port: int) -> bool:
    if port <= 0 or port > 65535:
        raise ValueError(f"Invalid port: {port}")

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((host, int(port)))
        except OSError:
            return False
    return True


def _normalize_port_range(port_range: Any) -> tuple[int, int]:
    if not isinstance(port_range, (list, tuple)) or len(port_range) != 2:
        raise ValueError(f"port_range must be [start, end], got {port_range!r}")
    start = int(port_range[0])
    end = int(port_range[1])
    if start <= 0 or end > 65535 or start > end:
        raise ValueError(f"Invalid port_range: {port_range!r}")
    return start, end


def find_available_port(
    preferred_port: int,
    port_range: list[int] | tuple[int, int],
    host: str = "127.0.0.1",
) -> int:
    start, end = _normalize_port_range(port_range)
    preferred = int(preferred_port)

    if start <= preferred <= end and is_port_available(host, preferred):
        return preferred

    for port in range(start, end + 1):
        if port == preferred:
            continue
        if is_port_available(host, port):
            return port

    raise PortAllocationError(
        f"No available port in range {start}-{end} on {host}; preferred={preferred}"
    )


def _reserve_port(
    *,
    label: str,
    preferred_port: int,
    port_range: list[int] | tuple[int, int],
    host: str,
    reserved: set[int],
) -> dict[str, Any]:
    start, end = _normalize_port_range(port_range)
    preferred = int(preferred_port)
    candidates = []
    if start <= preferred <= end:
        candidates.append(preferred)
    candidates.extend(port for port in range(start, end + 1) if port != preferred)

    for port in candidates:
        if port in reserved:
            continue
        if is_port_available(host, port):
            reserved.add(port)
            return {
                "label": label,
                "preferred_port": preferred,
                "port_range": [start, end],
                "port": port,
                "available": True,
                "changed": port != preferred,
            }

    raise PortAllocationError(
        f"{label}: no available port in range {start}-{end} on {host}; preferred={preferred}"
    )


def _static_port(
    *,
    label: str,
    preferred_port: int | None,
    port_range: list[int] | tuple[int, int] | None,
) -> dict[str, Any] | None:
    if preferred_port is None or port_range is None:
        return None

    start, end = _normalize_port_range(port_range)
    preferred = int(preferred_port)
    if preferred <= 0:
        return None

    return {
        "label": label,
        "preferred_port": preferred,
        "port_range": [start, end],
        "port": preferred,
        "available": None,
        "changed": False,
    }


def _dev_value(dev: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in dev:
            return dev[key]
    return None


def check_port_plan(
    apps_config: dict[str, Any],
    host: str = "127.0.0.1",
    include_codes: set[str] | None = None,
    include_module_keys: set[str] | None = None,
    exclude_codes: set[str] | None = None,
    exclude_module_keys: set[str] | None = None,
) -> dict[str, Any]:
    apps = apps_config.get("apps") or {}
    if not isinstance(apps, dict):
        raise ValueError("config/apps.yaml must contain an apps mapping")

    reserved: set[int] = set()
    plan: dict[str, Any] = {"host": host, "apps": {}, "services": []}

    for app_key, app in apps.items():
        if not isinstance(app, dict):
            raise ValueError(f"Invalid app config for {app_key}")

        code = str(app.get("code") or app_key)
        module_key = str(app.get("module_key") or app_key)
        if exclude_codes is not None and code in exclude_codes:
            continue
        if exclude_module_keys is not None and module_key in exclude_module_keys:
            continue
        if include_codes is not None and code not in include_codes:
            continue
        if include_module_keys is not None and module_key not in include_module_keys:
            continue

        name = str(app.get("name") or code)
        dev = app.get("dev") or {}
        if not isinstance(dev, dict):
            raise ValueError(f"Invalid dev config for {code}")

        kind = str(dev.get("kind") or "legacy")
        auto_start = bool(dev.get("enabled", False))

        app_plan: dict[str, Any] = {
            "key": app_key,
            "code": code,
            "name": name,
            "enabled": bool(app.get("enabled", True)),
            "auto_start": auto_start,
            "kind": kind,
            "iframe_enabled": bool(app.get("iframe_enabled", False)),
        }

        if code == "portal":
            frontend = _reserve_port(
                label="portal frontend",
                preferred_port=int(dev.get("frontend_preferred_port", 5200)),
                port_range=dev.get("frontend_port_range", [5200, 5209]),
                host=host,
                reserved=reserved,
            )
            backend = _reserve_port(
                label="portal backend",
                preferred_port=int(dev.get("backend_preferred_port", 5210)),
                port_range=dev.get("backend_port_range", [5210, 5219]),
                host=host,
                reserved=reserved,
            )
            app_plan.update(
                {
                    "frontend_port": frontend["port"],
                    "backend_port": backend["port"],
                    "frontend": frontend,
                    "backend": backend,
                    "frontend_url": f"http://localhost:{frontend['port']}",
                    "backend_url": f"http://localhost:{backend['port']}",
                }
            )
            plan["services"].extend([frontend, backend])

        elif kind == "frontend_backend" and auto_start:
            frontend = _reserve_port(
                label=f"{code} frontend",
                preferred_port=int(_dev_value(dev, "frontend_preferred_port", "preferred_port")),
                port_range=_dev_value(dev, "frontend_port_range", "port_range"),
                host=host,
                reserved=reserved,
            )
            backend = _reserve_port(
                label=f"{code} backend",
                preferred_port=int(dev["backend_preferred_port"]),
                port_range=dev["backend_port_range"],
                host=host,
                reserved=reserved,
            )
            app_plan.update(
                {
                    "frontend_port": frontend["port"],
                    "backend_port": backend["port"],
                    "port": frontend["port"],
                    "frontend": frontend,
                    "backend": backend,
                    "frontend_url": f"http://127.0.0.1:{frontend['port']}",
                    "backend_url": f"http://127.0.0.1:{backend['port']}",
                    "url": f"http://127.0.0.1:{frontend['port']}",
                    "iframe_url": f"http://127.0.0.1:{frontend['port']}",
                }
            )
            plan["services"].extend([frontend, backend])

        else:
            frontend = _static_port(
                label=f"{code} iframe",
                preferred_port=_dev_value(dev, "frontend_preferred_port", "preferred_port"),
                port_range=_dev_value(dev, "frontend_port_range", "port_range"),
            )
            backend = _static_port(
                label=f"{code} backend",
                preferred_port=dev.get("backend_preferred_port"),
                port_range=dev.get("backend_port_range"),
            )

            if frontend:
                app_plan.update(
                    {
                        "frontend_port": frontend["port"],
                        "port": frontend["port"],
                        "frontend": frontend,
                        "frontend_url": f"http://127.0.0.1:{frontend['port']}",
                        "url": f"http://127.0.0.1:{frontend['port']}",
                        "iframe_url": f"http://127.0.0.1:{frontend['port']}",
                    }
                )
            if backend:
                app_plan.update(
                    {
                        "backend_port": backend["port"],
                        "backend_url": f"http://127.0.0.1:{backend['port']}",
                        "backend": backend,
                    }
                )

        plan["apps"][code] = app_plan

    return plan
