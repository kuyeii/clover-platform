from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


API_ROOT = Path(__file__).resolve().parents[1]
API_ROOT_VALUE = str(API_ROOT)
if API_ROOT_VALUE not in sys.path:
    sys.path.insert(0, API_ROOT_VALUE)

from app.services import rag_knowledge_service as service


def test_recognize_privacy_uses_platform_pipt_provider_boundary() -> None:
    with patch.object(
        service,
        "recognize_with_platform_recognizer",
        return_value=[
            SimpleNamespace(
                text="张三",
                entity_type="name",
                start=0,
                end=2,
                source="regex",
                confidence=0.98,
                reason="",
            )
        ],
    ) as recognize:
        payload = service._recognize_privacy("张三")

    recognize.assert_called_once_with(
        text="张三",
        target_entities=service.DEFAULT_TARGET_ENTITIES,
        llm_mode="verify_only",
    )
    assert payload["status"] == "recognized"
    assert payload["has_sensitive"] is True
    assert payload["sensitive_count"] == 1
    assert payload["sensitive_types"] == ["name"]


def test_dual_dataset_id_helpers_fallback_to_default() -> None:
    with (
        patch("app.services.rag_dify_service._env_value", side_effect=lambda names, fallback="": fallback or "default-dataset"),
        patch("app.services.rag_dify_service.get_default_dataset_id", return_value="default-dataset"),
    ):
        from app.services import rag_dify_service

        assert rag_dify_service.get_raw_dataset_id() == "default-dataset"
        assert rag_dify_service.get_desensitized_dataset_id() == "default-dataset"
