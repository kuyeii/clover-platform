from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]

APP_ORDER: tuple[str, ...] = (
    "portal",
    "contract-review",
    "rag-web-search",
    "competitor-analysis",
    "bid-generator",
)

APP_ALIASES: dict[str, str] = {
    "portal": "portal",
    "contract-review": "contract-review",
    "contract_review": "contract-review",
    "rag-web-search": "rag-web-search",
    "rag_qa": "rag-web-search",
    "competitor-analysis": "competitor-analysis",
    "competitor_analysis": "competitor-analysis",
    "bid-generator": "bid-generator",
    "bid_generator": "bid-generator",
}

PYTHON_REQUIREMENTS_BY_APP: dict[str, tuple[str, ...]] = {
    "portal": ("legacy/portal-launchpad/requirements.txt",),
    "contract-review": ("legacy/contract_review/requirements.txt",),
    "rag-web-search": ("legacy/chat_with_rag_and_websearch/backend/requirements.txt",),
    "competitor-analysis": ("legacy/company-competitors-analysis/backend/requirements.txt",),
    "bid-generator": ("legacy/bid-generator/pipt-flask/requirements-lite.txt",),
}

FRONTEND_INSTALLS_BY_APP: dict[str, tuple[str, str]] = {
    "portal": ("legacy/portal-launchpad", "npm ci"),
    "contract-review": ("legacy/contract_review/frontend", "npm ci"),
    "rag-web-search": ("legacy/chat_with_rag_and_websearch/frontend", "npm ci"),
    "competitor-analysis": ("legacy/company-competitors-analysis", "npm ci"),
    "bid-generator": ("legacy/bid-generator/frontend-web", "npm ci"),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Bootstrap clover-platform for the first local development run."
    )
    parser.add_argument(
        "--skip-python",
        action="store_true",
        help="Skip Python virtualenv creation and pip dependency installation.",
    )
    parser.add_argument(
        "--skip-frontend",
        action="store_true",
        help="Skip frontend npm dependency installation.",
    )
    parser.add_argument(
        "--skip-db",
        action="store_true",
        help="Skip database checks, schema initialization, and Alembic migrations.",
    )
    parser.add_argument(
        "--skip-preflight",
        action="store_true",
        help="Skip the final preflight check.",
    )
    parser.add_argument(
        "--start",
        action="store_true",
        help="Start the development services after bootstrap completes.",
    )
    parser.add_argument(
        "--only",
        action="append",
        default=[],
        help="Forward selected app code or module key to preflight/dev.py. Can be used multiple times.",
    )
    parser.add_argument(
        "--no-business",
        action="store_true",
        help="Forward --no-business to preflight/dev.py for Portal-only setup checks or startup.",
    )
    parser.add_argument(
        "--npm-install",
        action="store_true",
        help="Use npm install instead of npm ci for frontend dependencies.",
    )
    return parser.parse_args()


def _python_bin() -> Path:
    if os.name == "nt":
        return REPO_ROOT / ".venv" / "Scripts" / "python.exe"
    return REPO_ROOT / ".venv" / "bin" / "python"


def _run(command: list[str], *, cwd: Path = REPO_ROOT, allow_failure: bool = False) -> int:
    command_text = " ".join(command)
    relative_cwd = cwd.relative_to(REPO_ROOT) if cwd != REPO_ROOT else Path(".")
    print(f"\n==> ({relative_cwd}) {command_text}", flush=True)
    completed = subprocess.run(command, cwd=cwd)
    if completed.returncode != 0 and not allow_failure:
        raise SystemExit(completed.returncode)
    return completed.returncode


def ensure_env_file() -> None:
    env_file = REPO_ROOT / ".env"
    env_example = REPO_ROOT / ".env.example"
    if env_file.exists():
        print("==> .env already exists; keeping current local configuration")
        return
    if not env_example.is_file():
        raise SystemExit(".env is missing and .env.example was not found")
    shutil.copyfile(env_example, env_file)
    print("==> Created .env from .env.example")
    print("    Review PostgreSQL and secret values in .env before starting real workflows.")


def ensure_venv(python: Path) -> None:
    if python.is_file():
        print(f"==> Python virtualenv already exists: {python}")
        return
    _run([sys.executable, "-m", "venv", ".venv"])


def selected_apps(args: argparse.Namespace) -> tuple[str, ...]:
    if args.no_business:
        return ("portal",)
    if not args.only:
        return APP_ORDER

    selected: list[str] = []
    for item in args.only:
        code = APP_ALIASES.get(item)
        if not code:
            valid = ", ".join(sorted(APP_ALIASES))
            raise SystemExit(f"Unknown app selector: {item}. Valid values: {valid}")
        if code not in selected:
            selected.append(code)
    return tuple(code for code in APP_ORDER if code in selected)


def install_python_dependencies(python: Path, apps: tuple[str, ...]) -> None:
    _run([str(python), "-m", "pip", "install", "--upgrade", "pip"])
    requirements = ["requirements-dev.txt"]
    for app in apps:
        requirements.extend(PYTHON_REQUIREMENTS_BY_APP.get(app, ()))

    for requirement in requirements:
        path = REPO_ROOT / requirement
        if not path.is_file():
            raise SystemExit(f"Required dependency file is missing: {requirement}")
        _run([str(python), "-m", "pip", "install", "-r", requirement])


def install_frontend_dependencies(apps: tuple[str, ...], *, use_npm_install: bool) -> None:
    if shutil.which("npm") is None:
        raise SystemExit("npm is not available on PATH. Install Node.js/npm first.")
    for app in apps:
        directory, default_command = FRONTEND_INSTALLS_BY_APP[app]
        cwd = REPO_ROOT / directory
        if not (cwd / "package.json").is_file():
            raise SystemExit(f"package.json is missing: {directory}")
        command = "npm install" if use_npm_install else default_command
        if command == "npm ci" and not (cwd / "package-lock.json").is_file():
            command = "npm install"
        _run(command.split(), cwd=cwd)


def initialize_database(python: Path) -> None:
    _run([str(python), "scripts/check_db.py"], allow_failure=True)
    _run([str(python), "scripts/init_db.py"])
    _run([str(python), "-m", "alembic", "upgrade", "head"])
    _run([str(python), "scripts/check_db.py"])


def selected_args(args: argparse.Namespace) -> list[str]:
    forwarded: list[str] = []
    if args.no_business:
        forwarded.append("--no-business")
    for item in args.only:
        forwarded.extend(["--only", item])
    return forwarded


def print_next_run(forwarded: list[str]) -> None:
    dev_command = "python scripts/dev.py"
    if forwarded:
        dev_command = f"{dev_command} {' '.join(forwarded)}"

    print("\nBootstrap completed.")
    print("Next run:")
    print("  source .venv/bin/activate")
    print(f"  {dev_command}")


def main() -> int:
    args = parse_args()
    os.chdir(REPO_ROOT)

    ensure_env_file()
    python = _python_bin()
    apps = selected_apps(args)
    print(f"==> Selected apps: {', '.join(apps)}")

    if not args.skip_python:
        ensure_venv(python)
        install_python_dependencies(python, apps)
    elif not python.is_file():
        python = Path(sys.executable)
        print(f"==> Skipping .venv setup; using current Python: {python}")

    if not args.skip_frontend:
        install_frontend_dependencies(apps, use_npm_install=args.npm_install)

    if not args.skip_db:
        initialize_database(python)

    forwarded = selected_args(args)
    if not args.skip_preflight:
        _run([str(python), "scripts/preflight.py", *forwarded])

    print_next_run(forwarded)

    if args.start:
        _run([str(python), "scripts/dev.py", *forwarded])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
