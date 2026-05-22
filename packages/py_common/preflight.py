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
from packages.py_common.apps import PREFERRED_APP_ORDER, app_by_code, auto_start_codes
from packages.py_common.config.loader import load_yaml
from packages.py_common.db.health import check_database_connection
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
    "platform-api": {
        "fastapi": "fastapi",
        "uvicorn": "uvicorn",
        "multipart": "python-multipart",
        "pydantic": "pydantic",
        "pydantic_settings": "pydantic-settings",
        "dotenv": "python-dotenv",
        "httpx": "httpx",
        "sqlalchemy": "SQLAlchemy",
        "psycopg": "psycopg",
        "yaml": "PyYAML",
    },
    "contract-review": {
        "fastapi": "fastapi",
        "uvicorn": "uvicorn",
        "sqlalchemy": "SQLAlchemy",
        "psycopg": "psycopg",
        "docx": "python-docx",
        "requests": "requests",
        "json_repair": "json_repair",
        "fitz": "PyMuPDF",
        "pdf2docx": "pdf2docx",
    },
    "rag-web-search": {
        "fastapi": "fastapi",
        "uvicorn": "uvicorn",
        "sqlalchemy": "SQLAlchemy",
        "psycopg": "psycopg",
        "httpx": "httpx",
        "pydantic": "pydantic",
        "pydantic_settings": "pydantic-settings",
        "dotenv": "python-dotenv",
        "multipart": "python-multipart",
    },
    "competitor-analysis": {
        "sqlalchemy": "SQLAlchemy",
        "psycopg": "psycopg",
        "dotenv": "python-dotenv",
    },
    "bid-generator": {
        "fastapi": "fastapi",
        "uvicorn": "uvicorn",
        "pydantic": "pydantic",
        "sqlalchemy": "SQLAlchemy",
        "psycopg": "psycopg",
        "dotenv": "python-dotenv",
    },
}

MODULE_REQUIREMENTS = {
    "portal": "requirements.txt",
    "platform-api": "requirements.txt",
    "contract-review": "requirements.txt",
    "rag-web-search": "requirements.txt",
    "competitor-analysis": "backend/requirements.txt",
    "bid-generator": "pipt-flask/pyproject.toml",
}

ENTRY_FILES = {
    "portal": "backend/main.py",
    "platform-api": "main.py",
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


def _check_database(
    repo_root: Path,
    env_values: dict[str, Any],
    *,
    check_portal: bool,
    check_contract_review: bool,
    check_bid_generator: bool,
    check_rag: bool,
    check_competitor_analysis: bool,
) -> list[CheckResult]:
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

    if check_portal:
        missing_portal = result.get("missing_portal_tables", [])
        missing_portal_indexes = result.get("missing_portal_indexes", [])
        if missing_portal or missing_portal_indexes:
            missing = [*(f"portal.{table}" for table in missing_portal), *(f"portal index {index}" for index in missing_portal_indexes)]
            results.append(
                CheckResult(
                    "Portal PostgreSQL tables",
                    "error",
                    f"Missing Portal database objects: {', '.join(missing)}",
                    "python scripts/init_db.py && alembic upgrade head",
                )
            )
        else:
            results.append(CheckResult("Portal PostgreSQL tables", "ok", "Portal tables and indexes exist"))

    if check_contract_review:
        missing_tables = result.get("missing_contract_review_tables", [])
        missing_indexes = result.get("missing_contract_review_indexes", [])
        if missing_tables or missing_indexes:
            missing = [
                *(f"contract_review.{table}" for table in missing_tables),
                *(f"contract_review index {index}" for index in missing_indexes),
            ]
            results.append(
                CheckResult(
                    "contract-review PostgreSQL tables",
                    "error",
                    f"Missing contract_review database objects: {', '.join(missing)}",
                    "python scripts/init_db.py && alembic upgrade head",
                )
            )
        else:
            results.append(
                CheckResult(
                    "contract-review PostgreSQL tables",
                    "ok",
                    "Contract review run metadata and artifact tables exist",
                )
            )

    if check_bid_generator:
        missing_tables = result.get("missing_bid_generator_tables", [])
        missing_indexes = result.get("missing_bid_generator_indexes", [])
        if missing_tables or missing_indexes:
            missing = [
                *(f"bid_generator.{table}" for table in missing_tables),
                *(f"bid_generator index {index}" for index in missing_indexes),
            ]
            results.append(
                CheckResult(
                    "bid-generator PostgreSQL tables",
                    "error",
                    f"Missing bid_generator database objects: {', '.join(missing)}",
                    "python scripts/init_db.py && alembic upgrade head",
                )
            )
        else:
            results.append(
                CheckResult(
                    "bid-generator PostgreSQL tables",
                    "ok",
                    "pipt-lite mapping, entity, image, and project tables exist",
                )
            )

    if check_rag:
        missing_tables = result.get("missing_rag_tables", [])
        missing_indexes = result.get("missing_rag_indexes", [])
        if missing_tables or missing_indexes:
            missing = [
                *(f"rag.{table}" for table in missing_tables),
                *(f"rag index {index}" for index in missing_indexes),
            ]
            results.append(
                CheckResult(
                    "RAG PostgreSQL tables",
                    "error",
                    f"Missing RAG database objects: {', '.join(missing)}",
                    "python scripts/init_db.py && alembic upgrade head",
                )
            )
        else:
            results.append(
                CheckResult(
                    "RAG PostgreSQL tables",
                    "ok",
                    "RAG conversations and chat turn tables exist",
                )
            )

    if check_competitor_analysis:
        missing_tables = result.get("missing_competitor_analysis_tables", [])
        missing_indexes = result.get("missing_competitor_analysis_indexes", [])
        if missing_tables or missing_indexes:
            missing = [
                *(f"competitor_analysis.{table}" for table in missing_tables),
                *(f"competitor_analysis index {index}" for index in missing_indexes),
            ]
            results.append(
                CheckResult(
                    "competitor_analysis PostgreSQL tables",
                    "error",
                    f"Missing competitor_analysis database objects: {', '.join(missing)}",
                    "python scripts/init_db.py && alembic upgrade head",
                )
            )
        else:
            results.append(
                CheckResult(
                    "competitor_analysis PostgreSQL tables",
                    "ok",
                    "competitor_analysis history and cache tables exist",
                )
            )

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


def _check_runtime_artifact_dirs(repo_root: Path, selected: set[str]) -> list[CheckResult]:
    """Warn about local artifact directories that should be backed by a persistent volume.

    These checks are intentionally non-blocking. Legacy backends may create missing
    directories on demand; preflight only surfaces deployment/storage boundaries.
    """
    results: list[CheckResult] = []

    def _warn_dir(name: str, relative_path: str, hint: str) -> None:
        path = repo_root / relative_path
        if path.is_dir():
            results.append(CheckResult(name, "ok", f"{relative_path} exists"))
            return
        results.append(
            CheckResult(
                name,
                "warn",
                f"{relative_path} is missing; legacy service may create it on demand, but deployments should mount persistent storage when this module is enabled",
                hint,
            )
        )

    if "contract-review" in selected or "platform-api" in selected:
        _warn_dir(
            "contract-review uploads directory",
            "legacy/contract_review/data/uploads",
            "Create or mount legacy/contract_review/data/uploads for uploaded source contracts.",
        )
        _warn_dir(
            "contract-review runs directory",
            "legacy/contract_review/data/runs",
            "Create or mount legacy/contract_review/data/runs for review artifacts and DOCX exports.",
        )

    if "bid-generator" in selected or "platform-api" in selected:
        for label, relative_path, purpose in (
            ("bid-generator pdf cache directory", "legacy/bid-generator/data/pdf_cache", "PDF preview cache"),
            ("bid-generator docx cache directory", "legacy/bid-generator/data/docx_cache", "source DOCX and locator recovery cache"),
            ("bid-generator raw document cache directory", "legacy/bid-generator/data/raw_doc_cache", "raw text re-extract cache"),
            ("bid-generator extracted images directory", "legacy/bid-generator/data/extracted_images", "extracted document images referenced by image_registry"),
            ("bid-generator project report mirror directory", "legacy/bid-generator/data/projects", "analysis report JSON mirrors"),
            ("bid-generator knowledge sync status directory", "legacy/bid-generator/data/kb_sync_status", "knowledge sync status JSON files"),
        ):
            _warn_dir(
                label,
                relative_path,
                f"Create or mount {relative_path} for {purpose}; missing directories do not block normal startup.",
            )

    return results


def _check_port_plan(
    apps_config: dict[str, Any],
    selected: set[str],
    skip: set[str] | None,
    port_plan: dict[str, Any] | None,
    *,
    include_portal_backend: bool = True,
    include_legacy_backends: bool = False,
) -> list[CheckResult]:
    try:
        plan = port_plan or check_port_plan(
            apps_config,
            include_codes=selected,
            exclude_codes=skip,
            include_portal_backend=include_portal_backend,
            include_legacy_backends=include_legacy_backends,
        )
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


def _selected_needs_node(apps_config: dict[str, Any], selected: set[str]) -> bool:
    apps_by_code = app_by_code(apps_config)
    for code in selected:
        app = apps_by_code.get(code) or {}
        kind = str((app.get("dev") or {}).get("kind") or "")
        if kind != "backend":
            return True
    return False


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
    dev = app.get("dev") or {}
    kind = str(dev.get("kind") or "")
    results: list[CheckResult] = []

    if kind != "backend":
        install_dir = _relative(frontend_dir, repo_root)
        results.extend(
            [
                _check_file(f"{code} frontend package.json", frontend_dir / "package.json", repo_root),
                _check_dir(
                    f"{code} frontend node_modules",
                    frontend_dir / "node_modules",
                    repo_root,
                    fix_hint=f"cd {install_dir} && npm install",
                ),
            ]
        )

    requirement = MODULE_REQUIREMENTS.get(code)
    if requirement:
        requirement_path = (legacy_path if code != "rag-web-search" else backend_dir) / requirement
        if code == "platform-api":
            requirement_path = backend_dir / requirement
        if code == "bid-generator":
            requirement_path = repo_root / "legacy/bid-generator/pipt-flask/pyproject.toml"
        results.append(_check_file(f"{code} Python requirements", requirement_path, repo_root))

    entry = ENTRY_FILES.get(code)
    if entry:
        entry_path = (backend_dir / entry) if code in {"rag-web-search", "bid-generator"} else (legacy_path / entry)
        if code == "platform-api":
            entry_path = backend_dir / entry
        if code == "competitor-analysis":
            entry_path = legacy_path / entry
        if code == "portal":
            entry_path = legacy_path / entry
        results.append(_check_file(f"{code} backend entry", entry_path, repo_root))
        results.append(_compile_file(f"{code} backend syntax", entry_path, repo_root))

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


def _check_business_frontend(app: dict[str, Any], repo_root: Path) -> list[CheckResult]:
    code = str(app.get("code"))
    _, frontend_dir, _ = _module_paths(app, repo_root)
    install_dir = _relative(frontend_dir, repo_root)
    results: list[CheckResult] = [
        _check_file(f"{code} frontend package.json", frontend_dir / "package.json", repo_root),
        _check_dir(
            f"{code} frontend node_modules",
            frontend_dir / "node_modules",
            repo_root,
            fix_hint=f"cd {install_dir} && npm install",
        ),
    ]

    dev = app.get("dev") or {}
    command = str(dev.get("frontend_command") or "").strip()
    if command:
        command_name = command.split()[0].strip('"')
        if shutil.which(command_name):
            results.append(CheckResult(f"{code} frontend command", "ok", f"{command_name} found"))
        else:
            results.append(
                CheckResult(
                    f"{code} frontend command",
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


def _check_portal_frontend(app: dict[str, Any], repo_root: Path) -> list[CheckResult]:
    code = str(app.get("code"))
    dev = app.get("dev") or {}
    frontend_dir = repo_root / str(dev.get("frontend_working_dir") or dev.get("working_dir") or app.get("legacy_path"))
    install_dir = _relative(frontend_dir, repo_root)
    results: list[CheckResult] = [
        _check_file(f"{code} frontend package.json", frontend_dir / "package.json", repo_root),
        _check_dir(
            f"{code} frontend node_modules",
            frontend_dir / "node_modules",
            repo_root,
            fix_hint=f"cd {install_dir} && npm install",
        ),
    ]

    command = str(dev.get("frontend_command") or "").strip()
    if command:
        command_name = command.split()[0].strip('"')
        if shutil.which(command_name):
            results.append(CheckResult(f"{code} frontend command", "ok", f"{command_name} found"))
        else:
            results.append(
                CheckResult(
                    f"{code} frontend command",
                    "error",
                    f"{command_name} is not available on PATH",
                    f"Install {command_name} and ensure it is available on PATH.",
                )
            )
    return results


def _check_legacy_module(app: dict[str, Any], repo_root: Path, env_values: dict[str, Any]) -> list[CheckResult]:
    code = str(app.get("code"))
    results = _check_module_common(app, repo_root)
    imports = LEGACY_IMPORTS.get(code, {})
    if imports:
        missing_status: CheckStatus = "error" if code == "platform-api" else "warn"
        fix_hint = (
            "python -m pip install -r apps/api/requirements.txt"
            if code == "platform-api"
            else f"Install this module's Python dependencies before running {code}."
        )
        results.append(
            _check_imports(
                f"{code} backend Python dependencies",
                imports,
                missing_status=missing_status,
                fix_hint=fix_hint,
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
        env_name = str(env_values.get("PIPT_ENV") or "").strip().lower()
        has_key = bool(env_values.get("PIPT_DB_KEY"))
        if env_name in {"prod", "production"} and not has_key:
            results.append(
                CheckResult(
                    "bid-generator PIPT_DB_KEY",
                    "error",
                    "PIPT_ENV=production requires PIPT_DB_KEY for original_text_enc encryption",
                    "Set PIPT_DB_KEY to a Fernet key in the runtime environment.",
                )
            )
        elif has_key:
            results.append(CheckResult("bid-generator PIPT_DB_KEY", "ok", "PIPT_DB_KEY is configured"))
        else:
            results.append(
                CheckResult(
                    "bid-generator PIPT_DB_KEY",
                    "warn",
                    "PIPT_DB_KEY is not configured; pipt-lite stores original_text_enc as plaintext in development",
                    "Generate a Fernet key before production: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\"",
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


def _check_business_module(
    app: dict[str, Any],
    repo_root: Path,
    env_values: dict[str, Any],
    *,
    include_legacy_backend: bool,
) -> list[CheckResult]:
    code = str(app.get("code"))
    if include_legacy_backend:
        return _check_legacy_module(app, repo_root, env_values)

    results = _check_business_frontend(app, repo_root)
    results.append(
        CheckResult(
            f"{code} legacy backend rollback dependencies",
            "skip",
            "Legacy backend process is not part of the default startup path; rerun with --with-legacy-backends to check rollback dependencies.",
        )
    )
    hint = CONFIG_HINTS.get(code)
    if hint:
        results.append(CheckResult(f"{code} workflow configuration", "warn", hint))
    return results


def run_preflight(
    repo_root: str | Path,
    apps_config: dict[str, Any],
    *,
    include_codes: set[str] | None = None,
    exclude_codes: set[str] | None = None,
    strict: bool = False,
    port_plan: dict[str, Any] | None = None,
    include_portal_backend: bool = True,
    include_legacy_backends: bool = False,
) -> PreflightReport:
    root = Path(repo_root).resolve()
    selected = include_codes or auto_start_codes(apps_config)
    skip = exclude_codes or set()
    selected = {code for code in selected if code not in skip}
    env_values = _load_env(root)

    results: list[CheckResult] = []
    includes_portal = "portal" in selected
    includes_contract_review = "contract-review" in selected
    includes_bid_generator = "bid-generator" in selected
    includes_rag = "rag-web-search" in selected
    includes_competitor_analysis = "competitor-analysis" in selected
    includes_platform_api = "platform-api" in selected
    includes_database = (
        includes_portal
        or includes_platform_api
        or includes_contract_review
        or includes_bid_generator
        or includes_rag
        or includes_competitor_analysis
    )

    if includes_database:
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
    if _selected_needs_node(apps_config, selected):
        results.extend([_check_command("node"), _check_command("npm")])
    results.append(_check_runtime(root))
    results.extend(_check_runtime_artifact_dirs(root, selected))
    results.extend(
        _check_port_plan(
            apps_config,
            selected,
            skip,
            port_plan,
            include_portal_backend=include_portal_backend,
            include_legacy_backends=include_legacy_backends,
        )
    )

    if includes_database:
        results.extend(
            _check_database(
                root,
                env_values,
                check_portal=includes_portal or includes_platform_api,
                check_contract_review=includes_contract_review or includes_platform_api,
                check_bid_generator=includes_bid_generator or includes_platform_api,
                check_rag=includes_rag or includes_platform_api,
                check_competitor_analysis=includes_competitor_analysis or includes_platform_api,
            )
        )

    apps_by_code = app_by_code(apps_config)
    for code in sorted(selected, key=lambda item: PREFERRED_APP_ORDER.index(item) if item in PREFERRED_APP_ORDER else 99):
        app = apps_by_code.get(code)
        if not app:
            results.append(CheckResult(code, "error", "Selected app is not present in config/apps.yaml"))
            continue
        if code == "portal":
            if include_portal_backend:
                results.extend(_check_portal(app, root, env_values))
            else:
                results.extend(_check_portal_frontend(app, root))
        elif code == "platform-api":
            results.extend(_check_legacy_module(app, root, env_values))
        else:
            results.extend(
                _check_business_module(
                    app,
                    root,
                    env_values,
                    include_legacy_backend=include_legacy_backends,
                )
            )

    return PreflightReport(results=results, strict=strict)
