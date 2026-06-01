from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch


API_ROOT = Path(__file__).resolve().parents[1]
API_ROOT_VALUE = str(API_ROOT)
if API_ROOT_VALUE not in sys.path:
    sys.path.insert(0, API_ROOT_VALUE)

from app.services import pipt_gateway_service as service
from app.services.pipt_redaction_service import apply_current_document_global_redactions


class PiptGatewayServiceTests(unittest.TestCase):
    def test_knowledge_sync_mappings_are_permanent_by_default(self) -> None:
        self.assertIsNone(
            service._vault_ttl_seconds(module_code="rag-web-search", purpose="knowledge_sync")
        )
        self.assertEqual(
            service._vault_ttl_seconds(module_code="rag-web-search", purpose="llm_external_call"),
            86400,
        )
        self.assertIsNone(service._vault_expires_at(None))

    def test_persist_mapping_vault_binds_null_expires_at_for_permanent_purpose(self) -> None:
        exists_result = Mock()
        exists_result.scalar_one.return_value = True
        insert_result = Mock()
        conn = Mock()
        conn.execute.side_effect = [exists_result, insert_result]
        engine = MagicMock()
        engine.begin.return_value.__enter__.return_value = conn

        with patch.object(service, "get_engine", return_value=engine):
            persisted = service._persist_mapping_vault(
                request_id="req-1",
                module_code="rag-web-search",
                purpose="knowledge_sync",
                mapping_table={"@@PIPT:v1:e000001:k11111111@@": "张三"},
                placeholder_manifest={"@@PIPT:v1:e000001:k11111111@@": {"entity_type": "name"}},
            )

        self.assertTrue(persisted)
        params = conn.execute.call_args_list[1].args[1]
        self.assertIsNone(params["expires_at"])
        self.assertNotIn("ttl_seconds", params)

    def test_strong_preprocess_reuses_historical_mapping_for_missed_entity(self) -> None:
        new_token = "@@PIPT:v1:e000001:k11111111@@"
        old_token = "@@PIPT:v1:e000002:k22222222@@"
        fake_engine = Mock()
        fake_engine.desensitize.return_value = SimpleNamespace(
            desensitized_text=f"旧公司 联系人 {new_token}",
            mapping_table={new_token: "张三"},
            placeholder_manifest={new_token: {"entity_type": "name", "role": "自然人姓名"}},
            placeholder_policy={},
        )

        with (
            patch.object(service, "_legacy_desensitize_engine", return_value=fake_engine),
            patch.object(service, "_persist_mapping_vault", return_value=True) as persist,
            patch.object(service, "_persist_event_from_result", return_value=True),
            patch.object(
                service,
                "_load_historical_mapping_candidates",
                return_value=[{"placeholder": old_token, "original_text": "旧公司", "entity_type": "org"}],
            ),
        ):
            result = service.preprocess_payload(
                {
                    "text": "旧公司 联系人 张三",
                    "module_code": "rag-web-search",
                    "purpose": "knowledge_sync",
                    "mode": "strong",
                    "enabled": True,
                }
            )

        self.assertEqual(result["text"], f"{old_token} 联系人 {new_token}")
        self.assertEqual(result["mapping_table_count"], 2)
        self.assertEqual(result["audit"]["details"]["historical_reuse_count"], 1)
        self.assertIn(old_token, result["placeholder_manifest"])
        persisted_mapping = persist.call_args.kwargs["mapping_table"]
        self.assertEqual(persisted_mapping[old_token], "旧公司")
        self.assertEqual(persisted_mapping[new_token], "张三")

    def test_strong_preprocess_replaces_current_document_missed_same_entity_globally(self) -> None:
        token = "@@PIPT:v1:e000001:k11111111@@"
        fake_engine = Mock()
        fake_engine.desensitize.return_value = SimpleNamespace(
            desensitized_text=f"第一段 张三 未替换。第二段 {token} 已替换。",
            mapping_table={token: "张三"},
            placeholder_manifest={token: {"entity_type": "name", "role": "自然人姓名"}},
            placeholder_policy={},
        )

        with (
            patch.object(service, "_legacy_desensitize_engine", return_value=fake_engine),
            patch.object(service, "_persist_mapping_vault", return_value=True),
            patch.object(service, "_persist_event_from_result", return_value=True),
            patch.object(service, "_load_historical_mapping_candidates", return_value=[]),
        ):
            result = service.preprocess_payload(
                {
                    "text": "第一段 张三 未替换。第二段 张三 已识别。",
                    "module_code": "rag-web-search",
                    "purpose": "knowledge_sync",
                    "mode": "strong",
                    "enabled": True,
                }
            )

        self.assertNotIn("张三", result["text"])
        self.assertEqual(result["text"], f"第一段 {token} 未替换。第二段 {token} 已替换。")
        self.assertEqual(result["audit"]["details"]["current_document_global_replace_count"], 1)

    def test_unified_redaction_service_replaces_current_document_missed_same_entity_globally(self) -> None:
        token = "@@PIPT:v1:e000001:k11111111@@"

        result = apply_current_document_global_redactions(
            source_text="第一段 张三 未替换。第二段 张三 已识别。",
            redacted_text=f"第一段 张三 未替换。第二段 {token} 已替换。",
            mapping_table={token: "张三"},
            replacement_mode="placeholder",
        )

        self.assertNotIn("张三", result.text)
        self.assertEqual(result.text, f"第一段 {token} 未替换。第二段 {token} 已替换。")
        self.assertEqual(result.replacement_count, 1)


if __name__ == "__main__":
    unittest.main()
