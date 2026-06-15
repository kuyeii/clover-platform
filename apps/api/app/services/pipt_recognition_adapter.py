from __future__ import annotations

from functools import lru_cache
import logging
from threading import Lock
from typing import Any, Protocol

from app.services.pipt_engine import DesensitizeEngine

logger = logging.getLogger(__name__)
_RELOAD_LOCK = Lock()


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


def warmup_recognition_provider(*, load_ner: bool = True) -> None:
    """启动或配置更新后预热 PIPT provider，提前加载规则和可选 NER 模型。"""
    provider = get_recognition_provider()
    engine = _native_desensitize_engine()
    if hasattr(engine, "warmup"):
        engine.warmup(load_ner=load_ner)
    logger.info("PIPT 识别引擎预热完成: provider=%s load_ner=%s", provider.__class__.__name__, load_ner)


def reload_recognition_provider(*, warmup: bool = True, load_ner: bool = True) -> None:
    """
    清理当前进程内 PIPT provider/engine 缓存，并按需预热。

    该函数只影响当前 Python 进程；多 worker/多实例部署需要额外广播机制。
    """
    with _RELOAD_LOCK:
        get_recognition_provider.cache_clear()
        _native_desensitize_engine.cache_clear()
        logger.info("PIPT 识别引擎缓存已清理")
        if warmup:
            warmup_recognition_provider(load_ner=load_ner)


@lru_cache(maxsize=1)
def get_recognition_provider() -> PiptRecognitionProvider:
    return NativePiptRecognitionProvider()


@lru_cache(maxsize=1)
def _native_desensitize_engine() -> DesensitizeEngine:
    return DesensitizeEngine()
