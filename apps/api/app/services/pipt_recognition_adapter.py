from __future__ import annotations

from functools import lru_cache
from typing import Any, Protocol

from app.services.pipt_engine import DesensitizeEngine


class PiptRecognitionProvider(Protocol):
    """PIPT 识别提供方边界，统一后端业务层只依赖该协议。"""

    def recognize(
        self,
        *,
        text: str,
        target_entities: list[str],
        llm_mode: str | None = None,
    ) -> list[Any]:
        """识别文本中的敏感实体，返回兼容 legacy EntityItem 的对象列表。"""

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


class NativePiptRecognitionProvider:
    """统一后端 PIPT 识别引擎 provider。"""

    def recognize(
        self,
        *,
        text: str,
        target_entities: list[str],
        llm_mode: str | None = None,
    ) -> list[Any]:
        entities = _native_desensitize_engine().recognize(
            text,
            target_entities,
            llm_mode_override=llm_mode,
        )
        return entities if isinstance(entities, list) else []

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
        return _native_desensitize_engine().desensitize(
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
    """统一 PIPT 识别入口。"""
    return get_recognition_provider().desensitize(
        text=text,
        target_entities=target_entities,
        method=method,
        placeholder_protocol=placeholder_protocol,
        llm_mode=llm_mode,
        audit_context=audit_context,
    )


def recognize_with_platform_recognizer(
    *,
    text: str,
    target_entities: list[str],
    llm_mode: str | None = None,
) -> list[Any]:
    """统一 PIPT 实体识别入口；业务模块不得直接导入 legacy engine。"""
    return get_recognition_provider().recognize(
        text=text,
        target_entities=target_entities,
        llm_mode=llm_mode,
    )


@lru_cache(maxsize=1)
def get_recognition_provider() -> PiptRecognitionProvider:
    return NativePiptRecognitionProvider()


@lru_cache(maxsize=1)
def _native_desensitize_engine() -> DesensitizeEngine:
    return DesensitizeEngine()
