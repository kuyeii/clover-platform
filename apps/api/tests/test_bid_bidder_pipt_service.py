from __future__ import annotations

import sys
from pathlib import Path
from typing import Any
from unittest.mock import patch


API_ROOT = Path(__file__).resolve().parents[1]
API_ROOT_VALUE = str(API_ROOT)
if API_ROOT_VALUE not in sys.path:
    sys.path.insert(0, API_ROOT_VALUE)

from app.services import bid_bidder_pipt_service as service


class FakeScalarResult:
    def __init__(self, value: int) -> None:
        self._value = value

    def scalar_one(self) -> int:
        return self._value


class FakeRowsResult:
    def __init__(self, row: dict[str, Any] | None) -> None:
        self._row = row

    def mappings(self) -> "FakeRowsResult":
        return self

    def first(self) -> dict[str, Any] | None:
        return self._row


class FakeConnection:
    def __init__(self) -> None:
        self.rows: dict[str, dict[str, Any]] = {}
        self.max_index_by_type = {"org": 0, "name": 0, "phone": 0}
        self.executed_sql: list[str] = []
        self.inserted_originals: list[str] = []

    def __enter__(self) -> "FakeConnection":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def execute(self, stmt: object, params: dict[str, Any] | None = None) -> FakeRowsResult | FakeScalarResult:
        sql = str(stmt)
        self.executed_sql.append(sql)
        values = params or {}
        if "SELECT placeholder, strong_placeholder" in sql:
            return FakeRowsResult(self.rows.get(str(values["entity_key"])))
        if "SELECT pg_advisory_xact_lock" in sql:
            return FakeScalarResult(0)
        if "SELECT COALESCE(MAX(global_index)" in sql:
            entity_type = str(values["entity_type"])
            return FakeScalarResult(self.max_index_by_type.get(entity_type, 0) + 1)
        if "INSERT INTO bid_generator.entity_registry" in sql:
            entity_key = str(values["entity_key"])
            entity_type = str(values["entity_type"])
            self.rows[entity_key] = {
                "placeholder": values["placeholder"],
                "strong_placeholder": values["strong_placeholder"],
            }
            self.max_index_by_type[entity_type] = int(values["global_index"])
            self.inserted_originals.append(str(values["original_text_enc"]))
            return FakeScalarResult(0)
        if "UPDATE bid_generator.entity_registry" in sql:
            row = self.rows[str(values["entity_key"])]
            row["strong_placeholder"] = values["strong_placeholder"]
            return FakeScalarResult(0)
        raise AssertionError(f"unexpected SQL: {sql}")


class FakeEngine:
    def __init__(self, conn: FakeConnection) -> None:
        self.conn = conn

    def begin(self) -> FakeConnection:
        return self.conn


def test_normalize_bidder_pipt_payload_uses_native_sql_and_legacy_shape() -> None:
    conn = FakeConnection()
    with patch.object(service, "get_engine", return_value=FakeEngine(conn)):
        payload = service.normalize_bidder_pipt_payload(
            {
                "bidder_info": {
                    "orgName": "测试公司",
                    "legalRep": "张三",
                    "projectLead": "李四",
                    "phone": "13800138000",
                    "docDate": "2026-06-02",
                }
            }
        )

    assert set(payload) == {
        "mapping_table",
        "placeholder_manifest",
        "placeholder_policy",
        "placeholder_hint",
        "fields",
    }
    assert len(payload["fields"]) == 5
    assert payload["fields"][-1] == {
        "field": "docDate",
        "role": "文件编制日期",
        "token": service.DOC_DATE_TOKEN,
    }
    assert payload["mapping_table"][service.DOC_DATE_TOKEN] == "2026-06-02"
    assert payload["placeholder_manifest"][service.DOC_DATE_TOKEN]["entity_type"] == "bidder_field"
    assert all(str(item["token"]).startswith("@@PIPT:v1:") for item in payload["fields"])
    assert "投标人信息占位符使用规则" in payload["placeholder_hint"]
    assert any("INSERT INTO bid_generator.entity_registry" in sql for sql in conn.executed_sql)
    assert len(conn.inserted_originals) == 4


def test_normalize_bidder_pipt_payload_reuses_existing_strong_placeholder() -> None:
    conn = FakeConnection()
    entity_key = service._make_entity_key("测试公司", "org")
    conn.rows[entity_key] = {
        "placeholder": "{{__PIPT_org_1__}}",
        "strong_placeholder": "@@PIPT:v1:e000123:kabcdef12@@",
    }
    conn.max_index_by_type["org"] = 1

    with patch.object(service, "get_engine", return_value=FakeEngine(conn)):
        payload = service.normalize_bidder_pipt_payload({"bidder_info": {"orgName": "测试公司"}})

    assert payload["mapping_table"] == {"@@PIPT:v1:e000123:kabcdef12@@": "测试公司"}
    assert not conn.inserted_originals
    assert any("UPDATE bid_generator.entity_registry" in sql for sql in conn.executed_sql)


def test_normalize_bidder_pipt_payload_returns_empty_for_invalid_bidder_info() -> None:
    payload = service.normalize_bidder_pipt_payload({"bidder_info": []})

    assert payload["mapping_table"] == {}
    assert payload["placeholder_manifest"] == {}
    assert payload["fields"] == []


def test_validate_required_bidder_info_reports_missing_fields() -> None:
    try:
        service.validate_required_bidder_info({"orgName": "测试公司", "phone": "13800138000"})
    except service.BidderInfoRequiredError as exc:
        assert exc.missing_fields == ["法定代表人", "项目负责人"]
        assert "正文生成前必须先配置投标人信息" in str(exc)
    else:
        raise AssertionError("expected BidderInfoRequiredError")


def test_merge_bidder_pipt_context_combines_existing_mapping_and_hint() -> None:
    conn = FakeConnection()
    with patch.object(service, "get_engine", return_value=FakeEngine(conn)):
        mapping, hint, context = service.merge_bidder_pipt_context(
            mapping_table={"@@PIPT:v1:e000001:k11111111@@": "既有实体"},
            placeholder_hint="既有提示",
            bidder_info={
                "orgName": "测试公司",
                "legalRep": "张三",
                "projectLead": "李四",
                "phone": "13800138000",
            },
        )

    assert mapping["@@PIPT:v1:e000001:k11111111@@"] == "既有实体"
    assert len(mapping) == 5
    assert "既有提示" in hint
    assert "投标人信息占位符使用规则" in hint
    assert len(context["fields"]) == 4
    assert any("INSERT INTO bid_generator.entity_registry" in sql for sql in conn.executed_sql)
