from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


API_ROOT = Path(__file__).resolve().parents[1]
API_ROOT_VALUE = str(API_ROOT)
if API_ROOT_VALUE not in sys.path:
    sys.path.insert(0, API_ROOT_VALUE)

from app.services import bid_pipt_compat_service as service


def test_desensitize_payload_returns_legacy_shape() -> None:
    fake_result = SimpleNamespace(
        desensitized_text="@@PIPT:v1:e000001:k11111111@@",
        mapping_table={"@@PIPT:v1:e000001:k11111111@@": "张三"},
        entities=[{"text": "张三", "entity_type": "name", "start": 0, "end": 2, "source": "regex", "confidence": 1.0}],
        entity_count=1,
        placeholder_manifest={"@@PIPT:v1:e000001:k11111111@@": {"entity_type": "name"}},
        placeholder_policy={"protocol": "pipt"},
    )

    with patch.object(service, "desensitize_with_platform_recognizer", return_value=fake_result):
        payload = service.desensitize_payload({"text": "张三", "target_entities": ["name"]})

    assert payload["desensitized_text"] == "@@PIPT:v1:e000001:k11111111@@"
    assert payload["mapping_table"] == {"@@PIPT:v1:e000001:k11111111@@": "张三"}
    assert payload["entity_count"] == 1
    assert payload["entities"][0]["entity_type"] == "name"
    assert payload["placeholder_policy"] == {"protocol": "pipt"}


def test_recognize_payload_uses_entities_without_rewriting_text() -> None:
    fake_result = SimpleNamespace(
        entities=[{"text": "13800138000", "entity_type": "phone", "start": 3, "end": 14}],
    )

    with patch.object(service, "desensitize_with_platform_recognizer", return_value=fake_result):
        payload = service.recognize_payload({"text": "电话 13800138000", "target_entities": ["phone"]})

    assert payload == {
        "entities": [
            {
                "text": "13800138000",
                "entity_type": "phone",
                "start": 3,
                "end": 14,
                "source": "unknown",
                "confidence": 0.0,
                "reason": "",
            }
        ],
        "entity_count": 1,
    }


def test_batch_desensitize_payload_aggregates_total_count() -> None:
    def fake_desensitize(**kwargs: object) -> SimpleNamespace:
        text = str(kwargs["text"])
        return SimpleNamespace(
            desensitized_text=f"{text}-masked",
            mapping_table={},
            entities=[],
            entity_count=2,
            placeholder_manifest={},
            placeholder_policy={},
        )

    with patch.object(service, "desensitize_with_platform_recognizer", side_effect=fake_desensitize):
        payload = service.batch_desensitize_payload({"texts": ["a", "b"]})

    assert payload["total_entity_count"] == 4
    assert [item["desensitized_text"] for item in payload["results"]] == ["a-masked", "b-masked"]


def test_restore_payload_returns_original_text_when_no_placeholder() -> None:
    payload = service.restore_payload({"text": "无需还原", "session_id": "s1"})

    assert payload == {"restored_text": "无需还原", "restored_count": 0}


def test_restore_payload_reads_mapping_with_native_sql() -> None:
    class FakeResult:
        def __init__(self, rows: list[dict[str, object]]) -> None:
            self._rows = rows

        def mappings(self) -> "FakeResult":
            return self

        def all(self) -> list[dict[str, object]]:
            return self._rows

    class FakeConnection:
        def __enter__(self) -> "FakeConnection":
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def execute(self, _stmt: object, params: dict[str, object]) -> FakeResult:
            if "legacy_placeholders" in params:
                return FakeResult([])
            return FakeResult([{"placeholder": "{{__PIPT_name_1__}}", "original_text": "张三"}])

    class FakeEngine:
        def connect(self) -> FakeConnection:
            return FakeConnection()

    with patch.object(service, "get_engine", return_value=FakeEngine()):
        payload = service.restore_payload({"text": "投标人 {{__PIPT_name_1__}}", "session_id": "s1"})

    assert payload == {"restored_text": "投标人 张三", "restored_count": 1}
