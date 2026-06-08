from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any


def ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def _mirror_artifacts_enabled() -> bool:
    return os.getenv("MIRROR_RUN_ARTIFACTS_TO_DB", "1").strip().lower() in {"1", "true", "yes", "on"}


def _atomic_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    tmp.write_text(content, encoding="utf-8")
    tmp.replace(path)


def _mirror_text_to_db(path: Path, content: str) -> None:
    if not _mirror_artifacts_enabled():
        return
    try:
        from .review_store import store_text_artifact_by_path

        store_text_artifact_by_path(path, content)
    except Exception:
        # 数据库是持久化增强层；文件落盘仍然是兜底路径，不能因为索引失败中断主流程。
        return


def _mirror_json_to_db(path: Path, payload: Any) -> None:
    if not _mirror_artifacts_enabled():
        return
    try:
        from .review_store import store_json_artifact_by_path

        store_json_artifact_by_path(path, payload)
    except Exception:
        return


def write_text(path: Path, content: str) -> None:
    _atomic_write_text(path, content)
    _mirror_text_to_db(path, content)


def write_json(path: Path, payload: Any) -> None:
    _atomic_write_text(path, json.dumps(payload, ensure_ascii=False, indent=2))
    _mirror_json_to_db(path, payload)
