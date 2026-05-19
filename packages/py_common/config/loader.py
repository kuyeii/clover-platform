from pathlib import Path
from typing import Any

import yaml


def find_repo_root(start: str | Path | None = None) -> Path:
    current = Path(start or Path.cwd()).resolve()
    if current.is_file():
        current = current.parent

    for candidate in (current, *current.parents):
        if (
            (candidate / "config" / "apps.yaml").is_file()
            and (candidate / "packages" / "py_common").is_dir()
            and (candidate / "legacy" / "portal-launchpad").is_dir()
        ):
            return candidate

    raise FileNotFoundError(f"Cannot locate clover-platform root from {current}")


def load_yaml(path: str | Path) -> dict[str, Any]:
    config_path = Path(path)
    if not config_path.exists():
        return {}
    with config_path.open("r", encoding="utf-8") as file:
        data = yaml.safe_load(file) or {}
    if not isinstance(data, dict):
        raise ValueError(f"Expected YAML mapping in {config_path}")
    return data


def load_apps_config(repo_root: str | Path | None = None) -> dict[str, Any]:
    root = find_repo_root(repo_root or Path.cwd())
    return load_yaml(root / "config" / "apps.yaml")
