from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any, Protocol


class PiptRecognitionProvider(Protocol):
    """PIPT 识别提供方边界，统一后端业务层只依赖该协议。"""

    def desensitize(
        self,
        *,
        text: str,
        target_entities: list[str],
        method: str = "placeholder",
        placeholder_protocol: str = "strong",
        llm_mode: str | None = None,
        audit_context: dict[str, Any] | None = None,
    ) -> Any:
        """识别并脱敏文本，返回兼容 legacy DesensitizeResult 的对象。"""


class LegacyPiptRecognitionProvider:
    """当前 PIPT 识别引擎仍在 legacy，统一后端通过该 provider 适配。"""

    def desensitize(
        self,
        *,
        text: str,
        target_entities: list[str],
        method: str = "placeholder",
        placeholder_protocol: str = "strong",
        llm_mode: str | None = None,
        audit_context: dict[str, Any] | None = None,
    ) -> Any:
        return _legacy_desensitize_engine().desensitize(
            text=text,
            target_entities=target_entities,
            method=method,
            placeholder_protocol=placeholder_protocol,
            db_session=None,
            llm_mode=llm_mode,
            audit_context=audit_context,
        )


def desensitize_with_platform_recognizer(
    *,
    text: str,
    target_entities: list[str],
    method: str = "placeholder",
    placeholder_protocol: str = "strong",
    llm_mode: str | None = None,
    audit_context: dict[str, Any] | None = None,
) -> Any:
    """统一 PIPT 识别入口；当前底层通过 legacy adapter 调用 DesensitizeEngine。"""
    return get_recognition_provider().desensitize(
        text=text,
        target_entities=target_entities,
        method=method,
        placeholder_protocol=placeholder_protocol,
        llm_mode=llm_mode,
        audit_context=audit_context,
    )


@lru_cache(maxsize=1)
def get_recognition_provider() -> PiptRecognitionProvider:
    return LegacyPiptRecognitionProvider()


@lru_cache(maxsize=1)
def _legacy_desensitize_engine() -> Any:
    _ensure_legacy_runtime()
    from app.api_lite.engine import DesensitizeEngine

    return DesensitizeEngine()


def _ensure_legacy_runtime() -> None:
    repo_root = _repo_root()
    legacy_root = repo_root / "legacy" / "bid-generator"
    pipt_root = legacy_root / "pipt-flask"
    os.environ.setdefault("PRO_ENGINE_ROOT", str(legacy_root))
    os.environ.setdefault("PIPT_ROOT", str(pipt_root))
    import app as platform_app

    legacy_app_path = str(pipt_root / "app")
    if legacy_app_path not in platform_app.__path__:
        platform_app.__path__.append(legacy_app_path)


def _repo_root() -> Path:
    current = Path(__file__).resolve()
    for candidate in (current, *current.parents):
        if (candidate / "legacy" / "bid-generator").is_dir() and (candidate / "packages" / "py_common").is_dir():
            return candidate
    raise RuntimeError("Cannot locate clover-platform root")
