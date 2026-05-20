from __future__ import annotations

import json
import os
import py_compile
import re
import shutil
from collections import Counter
from dataclasses import asdict, dataclass
from importlib import import_module
from pathlib import Path
from typing import Any, Literal

from dotenv import dotenv_values
from sqlalchemy import text

from packages.py_common.config.loader import load_yaml
from packages.py_common.db.health import check_database_connection
from packages.py_common.db.session import get_engine
from packages.py_common.ports import PortAllocationError, check_port_plan

CheckStatus = Literal["ok", "warn", "error", "skip"]


@dataclass(frozen=True)
class CheckResult:
    name: str
    status: CheckStatus
    message: str
    fix_hint: str | None = None


@dataclass(frozen=True)
class PreflightReport:
    results: list[CheckResult]
    strict: bool = False

    @property
    def summary(self) -> dict[str, int]:
        counts = Counter(result.status for result in self.results)
        return {status: counts.get(status, 0) for status in ("ok", "warn", "error", "skip")}

    @property
    def ok(self) -> bool:
        summary = self.summary
        if summary["error"] > 0:
            return False
        return not (self.strict and summary["warn"] > 0)

    def exit_code(self) -> int:
        return 0 if self.ok else 1

    def to_json(self) -> str:
        return json.dumps(
            {
                "ok": self.ok,
                "summary": self.summary,
                "results": [asdict(result) for result in self.results],
            },
            ensure_ascii=False,
            indent=2,
        )

    def format_text(self) -> str:
        lines: list[str] = []
        for result in self.results:
            lines.append(f"[{result.status.upper()}] {result.name}: {result.message}")
            if result.fix_hint:
                lines.append(f"       Fix: {result.fix_hint}")
        lines.append("")
        lines.append("Preflight summary:")
        for status, count in self.summary.items():
            lines.append(f"  {status}: {count}")
        if self.strict and self.summary["warn"] > 0:
            lines.append("  strict: warnings cause a non-zero exit code")
        return "\n".join(lines)


PREFERRED_APP_ORDER = (
    "portal",
    "contract-review",
    "rag-web-search",
    "competitor-analysis",
    "bid-generator",
)

PORTAL_TABLES = ("user_profiles", "feedback_submissions")

ROOT_IMPORTS = {
    "sqlalchemy": "SQLAlchemy",
    "psycopg": "psycopg",
    "pydantic": "pydantic",
    "pydantic_settings": "pydantic-settings",
    "dotenv": "python-dotenv",
    "alembic": "alembic",
    "yaml": "PyYAML",
}

PORTAL_IMPORTS = {
    "fastapi": "fastapi",
    "uvicorn": "uvicorn",
    "multipart": "python-multipart",
    "email_validator": "email-validator",
    "sqlalchemy": "SQLAlchemy",
    "psycopg": "psycopg",
}

LEGACY_IMPORTS = {
    "contract-review": {
        "fastapi": "fastapi",
        "uvicorn": "uvicorn",
        "docx": "python-docx",
        "requests": "requests",
        "json_repair": "json_repair",
        "fitz": "PyMuPDF",
        "pdf2docx": "pdf2docx",
    },
    "rag-web-search": {
        "fastapi": "fastapi",
        "uvicorn": "uvicorn",
        "httpx": "httpx",
        "pydantic": "pydantic",
        "pydantic_settings": "pydantic-settings",
        "dotenv": "python-dotenv",
        "multipart": "python-multipart",
    },
    "competitor-analysis": {},
    "bid-generator": {
        "fastapi": "fastapi",
        "uvicorn": "uvicorn",
        "pydantic": "pydantic",
    },
}

MODULE_REQUIREMENTS = {
    "portal": "requirements.txt",
    "contract-review": "requirements.txt",
    "rag-web-search": "requirements.txt",
    "competitor-analysis": "backend/requirements.txt",
    "bid-generator": "pipt-flask/pyproject.toml",
}

ENTRY_FILES = {
    "portal": "backend/main.py",
    "contract-review": "web_api.py",
    "rag-web-search": "app/main.py",
    "competitor-analysis": "backend/server.py",
    "bid-generator": "main_lite.py",
}

CONFIG_HINTS = {
    "contract-review": (
        "Dify configuration is not validated; if review workflows fail, check "
        "DIFY_* workflow variables for contract review."
    ),
    "rag-web-search": (
        "RAG workflow and dataset configuration is not validated; check UPSTREAM_URL, "
        "DIFY_API_BASE_URL, and dataset variables if runtime calls fail."
    ),
    "competitor-analysis": (
        "Dify workflow configuration is not validated; check WORKFLOW_* and "
        "*_API_KEY variables if analysis calls fail."
    ),
    "bid-generator": (
        "Dify keys may be present in config.yaml or environment; preflight only checks "
        "the file and never prints key values."
    ),
}

SENSITIVE_NAME_RE = re.compile(r"(PASSWORD|SECRET|TOKEN|KEY|API_KEY)", re.IGNORECASE)
URL_PASSWORD_RE = re.compile(r"([a-z][a-z0-9+.-]*://[^:/@\s]+:)([^@\s]+)(@)", re.IGNORECASE)


def app_token_maps(apps_config: dict[str, Any]) -> tuple[dict[str, str], list[str], list[str]]:
    apps = apps_config.get("apps") or {}
    ordered_apps = sorted(
        apps.items(),
        key=lambda item: PREFERRED_APP_ORDER.index(str(item[1].get("code")))
        if str(item[1].get("code")) in PREFERRED_APP_ORDER
        else len(PREFERRED_APP_ORDER),
    )
    token_to_code: dict[str, str] = {}
    app_codes: list[str] = []
    module_keys: list[str] = []
    for key, app in ordered_apps:
        code = str(app.get("code") or key)
        module_key = str(app.get("module_key") or key)
        app_codes.append(code)
        module_keys.append(module_key)
        token_to_code[str(key)] = code
        token_to_code[code] = code
        token_to_code[module_key] = code
    return token_to_code, app_codes, module_keys


def unknown_token_message(token: str, app_codes: list[str], module_keys: list[str]) -> str:
    app_codes_text = "\n".join(f"  {code}" for code in app_codes)
    module_keys_text = "\n".join(f"  {module_key}" for module_key in module_keys)
    return (
        f"Unknown app token: {token}\n\n"
        f"Available app codes:\n{app_codes_text}\n\n"
        f"Available module keys:\n{module_keys_text}"
    )


def resolve_app_tokens(apps_config: dict[str, Any], values: list[str]) -> set[str]:
    token_to_code, app_codes, module_keys = app_token_maps(apps_config)
    resolved: set[str] = set()
    for value in values:
        normalized = value.strip()
        if normalized not in token_to_code:
            raise ValueError(unknown_token_message(normalized, app_codes, module_keys))
        resolved.add(token_to_code[normalized])
    return resolved


def auto_start_codes(apps_config: dict[str, Any]) -> set[str]:
    apps = apps_config.get("apps") or {}
    return {
        str(app.get("code"))
        for app in apps.values()
        if isinstance(app, dict) and bool((app.get("dev") or {}).get("enabled", False))
    }


def selected_codes(
    apps_config: dict[str, Any],
    *,
    no_business: bool = False,
    only: set[str] | None = None,
) -> set[str]:
    if no_business:
        return {"portal"}
    if only:
        return set(only)
    return auto_start_codes(apps_config)


def _redact(text_value: str, env_values: dict[str, Any]) -> str:
    redacted = URL_PASSWORD_RE.sub(r"\1***\3", text_value)
    for key, value in env_values.items():
        if not value or not SENSITIVE_NAME_RE.search(key):
            continue
        redacted = redacted.replace(str(value), "***")
    return redacted


def _relative(path: Path, repo_root: Path) -> str:
    try:
        return path.relative_to(repo_root).as_posix()
    except ValueError:
        return path.as_posix()


def _check_file(name: str, path: Path, repo_root: Path, fix_hint: str | None = None) -> CheckResult:
    if path.is_file():
        return CheckResult(name, "ok", f"{_relative(path, repo_root)} exists")
    return CheckResult(name, "error", f"{_relative(path, repo_root)} is missing", fix_hint)


def _check_dir(
    name: str,
    path: Path,
    repo_root: Path,
    *,
    status: CheckStatus = "error",
    fix_hint: str | None = None,
) -> CheckResult:
    if path.is_dir():
        return CheckResult(name, "ok", f"{_relative(path, repo_root)} exists")
    return CheckResult(name, status, f"{_relative(path, repo_root)} is missing", fix_hint)


def _check_command(command: str) -> CheckResult:
    resolved = shutil.which(command)
    if resolved:
        return CheckResult(f"{command} command", "ok", f"{command} found")
    return CheckResult(
        f"{command} command",
        "error",
        f"{command} is not available on PATH",
        f"Install {command} and ensure it is available on PATH.",
    )


def _check_imports(
    name: str,
    imports: dict[str, str],
    *,
    missing_status: CheckStatus,
    fix_hint: str,
) -> CheckResult:
    if not imports:
        return CheckResult(name, "skip", "No third-party Python imports required for this check")

    missing: list[str] = []
    for module_name, package_name in imports.items():
        try:
            import_module(module_name)
        except Exception:
            missing.append(package_name)

    if not missing:
        return CheckResult(name, "ok", "Required Python imports are available")

    unique_missing = sorted(set(missing))
    return CheckResult(
        name,
        missing_status,
        f"Missing Python packages: {', '.join(unique_missing)}",
        fix_hint,
    )


def _compile_file(name: str, path: Path, repo_root: Path) -> CheckResult:
    if not path.is_file():
        return CheckResult(name, "skip", f"{_relative(path, repo_root)} is missing")
    try:
        py_compile.compile(str(path), doraise=True)
    except py_compile.PyCompileError as exc:
        return CheckResult(name, "error", f"Python syntax check failed: {_redact(str(exc), {})}")
    return CheckResult(name, "ok", f"{_relative(path, repo_root)} compiles")


def _load_env(repo_root: Path) -> dict[str, Any]:
    values = dotenv_values(repo_root / ".env")
    merged = dict(values)
    merged.update(os.environ)
    return merged


def _check_root_env(repo_root: Path, env_values: dict[str, Any]) -> list[CheckResult]:
    results = [
        _check_file("root .env", repo_root / ".env", repo_root, "cp .env.example .env"),
    ]
    has_database_url = bool(env_values.get("DATABASE_URL"))
    postgres_required = ("POSTGRES_HOST", "POSTGRES_PORT", "POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD")
    missing_postgres = [key for key in postgres_required if not env_values.get(key)]
    if has_database_url or not missing_postgres:
        results.append(CheckResult("database environment", "ok", "DATABASE_URL or POSTGRES_* settings are configured"))
    else:
        safe_missing = ", ".join(missing_postgres)
        results.append(
            CheckResult(
                "database environment",
                "error",
                f"Database settings are incomplete; missing {safe_missing}",
                "Set DATABASE_URL or POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB, POSTGRES_USER, and POSTGRES_PASSWORD in .env.",
            )
        )
    return results


def _check_database(repo_root: Path, env_values: dict[str, Any]) -> list[CheckResult]:
    result = check_database_connection()
    if not result["ok"]:
        safe_error = _redact(str(result.get("error") or result.get("error_type") or "unknown error"), env_values)
        return [
            CheckResult(
                "PostgreSQL connection",
                "error",
                f"Cannot connect to PostgreSQL: {safe_error}",
                "Check POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB, POSTGRES_USER, and DATABASE_URL.",
            )
        ]

    results = [
        CheckResult("PostgreSQL connection", "ok", "Connected to PostgreSQL"),
    ]
    missing_schema_items = [
        *[f"schema {item}" for item in result.get("missing_schemas", [])],
        *[f"core.{item}" for item in result.get("missing_core_tables", [])],
        *[f"{item}.module_meta" for item in result.get("missing_module_meta_tables", [])],
        *[f"core index {item}" for item in result.get("missing_core_indexes", [])],
    ]
    if missing_schema_items:
        results.append(
            CheckResult(
                "core schema and tables",
                "error",
                f"Missing database objects: {', '.join(missing_schema_items)}",
                "python scripts/init_db.py && alembic upgrade head",
            )
        )
    else:
        results.append(CheckResult("core schema and tables", "ok", "Core schemas, tables, module_meta tables, and indexes exist"))

    try:
        with get_engine().connect() as conn:
            portal_tables = [
                row[0]
                for row in conn.execute(
                    text(
                        """
                        SELECT table_name
                        FROM information_schema.tables
                        WHERE table_schema = 'portal'
                          AND table_name = ANY(:tables)
                        ORDER BY table_name
                        """
                    ),
                    {"tables": list(PORTAL_TABLES)},
                )
            ]
    except Exception as exc:
        safe_error = _redact(str(exc), env_values)
        results.append(
            CheckResult(
                "Portal PostgreSQL tables",
                "error",
                f"Cannot inspect Portal tables: {safe_error}",
                "python scripts/init_db.py && alembic upgrade head",
            )
        )
        return results

    missing_portal = sorted(set(PORTAL_TABLES) - set(portal_tables))
    if missing_portal:
        results.append(
            CheckResult(
                "Portal PostgreSQL tables",
                "error",
                f"Missing Portal tables: {', '.join(f'portal.{table}' for table in missing_portal)}",
                "Start Portal once after database initialization, or run the Portal PostgreSQL initialization step.",
            )
        )
    else:
        results.append(CheckResult("Portal PostgreSQL tables", "ok", "Portal tables exist"))

    return results


def _check_runtime(repo_root: Path) -> CheckResult:
    runtime_dir = repo_root / "runtime"
    if runtime_dir.is_dir():
        return CheckResult("runtime directory", "ok", "runtime directory exists")
    return CheckResult(
        "runtime directory",
        "warn",
        "runtime directory is missing; dev.py will create runtime/ports.json parent directories when needed",
        "mkdir -p runtime",
    )


def _check_port_plan(
    apps_config: dict[str, Any],
    selected: set[str],
    skip: set[str] | None,
    port_plan: dict[str, Any] | None,
) -> list[CheckResult]:
    try:
        plan = port_plan or check_port_plan(apps_config, include_codes=selected, exclude_codes=skip)
    except PortAllocationError as exc:
        return [CheckResult("port plan", "error", str(exc), "Stop the process using the configured port range or adjust config/apps.yaml.")]
    except (OSError, ValueError) as exc:
        return [CheckResult("port plan", "error", str(exc), "Review config/apps.yaml port ranges.")]

    results: list[CheckResult] = [CheckResult("port plan", "ok", "Port plan can be generated")]
    for service in plan.get("services", []):
        label = str(service.get("label") or "service")
        if service.get("changed"):
            results.append(
                CheckResult(
                    f"{label} port",
                    "warn",
                    f"Preferred port {service['preferred_port']} is busy; using {service['port']} from range {service['port_range'][0]}-{service['port_range'][1]}",
                )
            )
        elif service.get("available") is True:
            results.append(CheckResult(f"{label} port", "ok", f"Preferred port {service['port']} is available"))
    return results


def _app_by_code(apps_config: dict[str, Any], code: str) -> dict[str, Any] | None:
    apps = apps_config.get("apps") or {}
    for app in apps.values():
        if isinstance(app, dict) and str(app.get("code")) == code:
            return app
    return None


def _module_paths(app: dict[str, Any], repo_root: Path) -> tuple[Path, Path, Path]:
    code = str(app.get("code"))
    dev = app.get("dev") or {}
    legacy_path = repo_root / str(app.get("legacy_path") or "")
    frontend_dir = repo_root / str(dev.get("frontend_working_dir") or dev.get("working_dir") or app.get("legacy_path"))
    backend_dir = repo_root / str(dev.get("backend_working_dir") or dev.get("working_dir") or app.get("legacy_path"))
    if code == "portal":
        backend_dir = legacy_path
    return legacy_path, frontend_dir, backend_dir


def _check_module_common(app: dict[str, Any], repo_root: Path) -> list[CheckResult]:
    code = str(app.get("code"))
    legacy_path, frontend_dir, backend_dir = _module_paths(app, repo_root)
    install_dir = _relative(frontend_dir, repo_root)
    results = [
        _check_file(f"{code} frontend package.json", frontend_dir / "package.json", repo_root),
        _check_dir(
            f"{code} frontend node_modules",
            frontend_dir / "node_modules",
            repo_root,
            fix_hint=f"cd {install_dir} && npm install",
        ),
    ]

    requirement = MODULE_REQUIREMENTS.get(code)
    if requirement:
        requirement_path = (legacy_path if code != "rag-web-search" else backend_dir) / requirement
        if code == "bid-generator":
            requirement_path = repo_root / "legacy/bid-generator/pipt-flask/pyproject.toml"
        results.append(_check_file(f"{code} Python requirements", requirement_path, repo_root))

    entry = ENTRY_FILES.get(code)
    if entry:
        entry_path = (backend_dir / entry) if code in {"rag-web-search", "bid-generator"} else (legacy_path / entry)
        if code == "competitor-analysis":
            entry_path = legacy_path / entry
        if code == "portal":
            entry_path = legacy_path / entry
        results.append(_check_file(f"{code} backend entry", entry_path, repo_root))
        results.append(_compile_file(f"{code} backend syntax", entry_path, repo_root))

    dev = app.get("dev") or {}
    for label, command_key in (("backend", "backend_command"), ("frontend", "frontend_command")):
        command = str(dev.get(command_key) or "").strip()
        if not command:
            continue
        command_name = command.split()[0].strip('"')
        if command_name in {"{python}", "python"}:
            results.append(CheckResult(f"{code} {label} command", "ok", "Python command is resolved by dev.py"))
        elif shutil.which(command_name):
            results.append(CheckResult(f"{code} {label} command", "ok", f"{command_name} found"))
        else:
            results.append(
                CheckResult(
                    f"{code} {label} command",
                    "error",
                    f"{command_name} is not available on PATH",
                    f"Install {command_name} and ensure it is available on PATH.",
                )
            )

    return results


def _check_portal(app: dict[str, Any], repo_root: Path, env_values: dict[str, Any]) -> list[CheckResult]:
    results = _check_module_common(app, repo_root)
    results.append(
        _check_imports(
            "Portal backend Python dependencies",
            PORTAL_IMPORTS,
            missing_status="error",
            fix_hint="python -m pip install -r legacy/portal-launchpad/requirements.txt",
        )
    )
    for key, default in (("PORTAL_ADMIN_USERNAME", "admin"), ("PORTAL_ADMIN_PASSWORD", "admin123456")):
        if env_values.get(key):
            results.append(CheckResult(key, "ok", f"{key} is configured"))
        else:
            results.append(CheckResult(key, "warn", f"{key} is not set; Portal will use its development default ({default!r})"))
    return results


def _check_legacy_module(app: dict[str, Any], repo_root: Path, env_values: dict[str, Any]) -> list[CheckResult]:
    code = str(app.get("code"))
    results = _check_module_common(app, repo_root)
    imports = LEGACY_IMPORTS.get(code, {})
    if imports:
        results.append(
            _check_imports(
                f"{code} backend Python dependencies",
                imports,
                missing_status="warn",
                fix_hint=f"Install this module's Python dependencies before running {code}.",
            )
        )
    else:
        results.append(CheckResult(f"{code} backend Python dependencies", "ok", "Backend uses the Python standard library for startup"))

    if code == "bid-generator":
        config_path = repo_root / "legacy/bid-generator/config.yaml"
        font_path = repo_root / "legacy/bid-generator/gateway-out/fonts/SimSun.ttf"
        results.append(_check_file("bid-generator config.yaml", config_path, repo_root))
        results.append(
            _check_dir(
                "bid-generator gateway-out",
                repo_root / "legacy/bid-generator/gateway-out",
                repo_root,
                status="warn",
                fix_hint="Restore legacy/bid-generator/gateway-out if document export support is needed.",
            )
        )
        if font_path.is_file():
            results.append(CheckResult("bid-generator SimSun font", "ok", "SimSun.ttf exists"))
        else:
            results.append(
                CheckResult(
                    "bid-generator SimSun font",
                    "warn",
                    "SimSun.ttf is missing; exported Word/PDF Chinese typography may be affected",
                    "Restore legacy/bid-generator/gateway-out/fonts/SimSun.ttf if document export requires SimSun.",
                )
            )

    hint = CONFIG_HINTS.get(code)
    if hint:
        results.append(CheckResult(f"{code} workflow configuration", "warn", hint))

    workflow_refs = app.get("workflow_refs") or []
    if workflow_refs:
        workflows = load_yaml(repo_root / "config" / "workflows.yaml").get("workflows") or {}
        missing_refs = [ref for ref in workflow_refs if not workflows.get(ref)]
        if missing_refs:
            results.append(
                CheckResult(
                    f"{code} workflow refs",
                    "warn",
                    f"Workflow refs are registered but not configured in config/workflows.yaml: {', '.join(map(str, missing_refs))}",
                    "Add non-secret workflow env mappings to config/workflows.yaml; keep actual keys in .env or deployment secrets.",
                )
            )
        else:
            results.append(CheckResult(f"{code} workflow refs", "ok", "Workflow refs are configured"))
    return results


def run_preflight(
    repo_root: str | Path,
    apps_config: dict[str, Any],
    *,
    include_codes: set[str] | None = None,
    exclude_codes: set[str] | None = None,
    strict: bool = False,
    port_plan: dict[str, Any] | None = None,
) -> PreflightReport:
    root = Path(repo_root).resolve()
    selected = include_codes or auto_start_codes(apps_config)
    skip = exclude_codes or set()
    selected = {code for code in selected if code not in skip}
    env_values = _load_env(root)

    results: list[CheckResult] = []
    includes_portal = "portal" in selected

    if includes_portal:
        results.extend(_check_root_env(root, env_values))

    results.append(_check_dir("Python virtual environment", root / ".venv", root, fix_hint="python3 -m venv .venv"))
    results.append(_check_file("root requirements-dev.txt", root / "requirements-dev.txt", root))
    results.append(
        _check_imports(
            "root development Python dependencies",
            ROOT_IMPORTS,
            missing_status="error",
            fix_hint="python -m pip install -r requirements-dev.txt",
        )
    )
    results.extend([_check_command("node"), _check_command("npm")])
    results.append(_check_runtime(root))
    results.extend(_check_port_plan(apps_config, selected, skip, port_plan))

    if includes_portal:
        results.extend(_check_database(root, env_values))

    for code in sorted(selected, key=lambda item: PREFERRED_APP_ORDER.index(item) if item in PREFERRED_APP_ORDER else 99):
        app = _app_by_code(apps_config, code)
        if not app:
            results.append(CheckResult(code, "error", "Selected app is not present in config/apps.yaml"))
            continue
        if code == "portal":
            results.extend(_check_portal(app, root, env_values))
        else:
            results.extend(_check_legacy_module(app, root, env_values))

    return PreflightReport(results=results, strict=strict)
