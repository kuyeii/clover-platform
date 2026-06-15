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
from app.services import pipt_recognition_adapter
from app.api import pipt_gateway as pipt_gateway_api
from app.services.pipt_redaction_service import apply_current_document_global_redactions


class PiptGatewayServiceTests(unittest.TestCase):
    def test_bid_document_preprocess_mappings_are_permanent_by_default(self) -> None:
        self.assertIsNone(
            service._vault_ttl_seconds(module_code="rag-web-search", purpose="knowledge_sync")
        )
        self.assertIsNone(
            service._vault_ttl_seconds(module_code="bid-generator", purpose="document_preprocess")
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
            patch.object(service, "desensitize_with_platform_recognizer", side_effect=fake_engine.desensitize),
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
        self.assertEqual(result["desensitized_text"], result["text"])
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
            patch.object(service, "desensitize_with_platform_recognizer", side_effect=fake_engine.desensitize),
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
        self.assertEqual(result["desensitized_text"], result["text"])
        self.assertEqual(result["audit"]["details"]["current_document_global_replace_count"], 1)

    def test_compatibility_preprocess_returns_desensitized_text_alias(self) -> None:
        result = service.preprocess_payload(
            {
                "text": "原文",
                "module_code": "bid-generator",
                "purpose": "llm_external_call",
                "mode": "compatibility",
                "enabled": False,
            }
        )

        self.assertEqual(result["text"], "原文")
        self.assertEqual(result["desensitized_text"], "原文")

    def test_recognition_adapter_forwards_to_provider_boundary(self) -> None:
        fake_provider = Mock()
        fake_provider.desensitize.return_value = SimpleNamespace(desensitized_text="@@PIPT:v1:e000001:k11111111@@")

        with patch.object(pipt_recognition_adapter, "get_recognition_provider", return_value=fake_provider):
            result = pipt_recognition_adapter.desensitize_with_platform_recognizer(
                text="张三",
                target_entities=["name"],
                llm_mode="augment",
                audit_context={"source": "test"},
            )

        self.assertEqual(result.desensitized_text, "@@PIPT:v1:e000001:k11111111@@")
        fake_provider.desensitize.assert_called_once_with(
            text="张三",
            target_entities=["name"],
            method="placeholder",
            placeholder_protocol="strong",
            llm_mode="augment",
            audit_context={"source": "test"},
        )

    def test_recognition_adapter_recognize_forwards_to_provider_boundary(self) -> None:
        fake_provider = Mock()
        fake_provider.recognize.return_value = [SimpleNamespace(entity_type="name")]

        with patch.object(pipt_recognition_adapter, "get_recognition_provider", return_value=fake_provider):
            result = pipt_recognition_adapter.recognize_with_platform_recognizer(
                text="张三",
                target_entities=["name"],
                llm_mode="verify_only",
            )

        self.assertEqual(len(result), 1)
        fake_provider.recognize.assert_called_once_with(
            text="张三",
            target_entities=["name"],
            llm_mode="verify_only",
        )

    def test_native_recognition_provider_forwards_to_native_engine(self) -> None:
        fake_engine = Mock()
        fake_engine.desensitize.return_value = SimpleNamespace(desensitized_text="@@PIPT:v1:e000001:k11111111@@")
        fake_engine.recognize.return_value = [SimpleNamespace(entity_type="name")]
        provider = pipt_recognition_adapter.NativePiptRecognitionProvider()

        with patch.object(pipt_recognition_adapter, "_native_desensitize_engine", return_value=fake_engine):
            entities = provider.recognize(
                text="张三",
                target_entities=["name"],
                llm_mode="verify_only",
            )
            result = provider.desensitize(
                text="张三",
                target_entities=["name"],
                llm_mode="augment",
                audit_context={"source": "test"},
            )

        self.assertEqual(len(entities), 1)
        fake_engine.recognize.assert_called_once_with("张三", ["name"], llm_mode_override="verify_only")
        self.assertEqual(result.desensitized_text, "@@PIPT:v1:e000001:k11111111@@")
        fake_engine.desensitize.assert_called_once_with(
            text="张三",
            target_entities=["name"],
            method="placeholder",
            placeholder_protocol="strong",
            db_session=None,
            llm_mode="augment",
            audit_context={"source": "test"},
        )

    def test_recognition_adapter_does_not_expose_legacy_engine_boundary(self) -> None:
        self.assertFalse(hasattr(pipt_recognition_adapter, "_ensure_legacy_runtime"))
        self.assertFalse(hasattr(pipt_recognition_adapter, "_legacy_desensitize_engine"))
        self.assertFalse(hasattr(pipt_recognition_adapter, "LegacyPiptRecognitionProvider"))

    def test_warmup_recognition_provider_initializes_cached_engine(self) -> None:
        fake_engine = Mock()
        fake_provider = Mock()

        with (
            patch.object(pipt_recognition_adapter, "get_recognition_provider", return_value=fake_provider),
            patch.object(pipt_recognition_adapter, "_native_desensitize_engine", return_value=fake_engine),
        ):
            pipt_recognition_adapter.warmup_recognition_provider(load_ner=False)

        fake_engine.warmup.assert_called_once_with(load_ner=False)

    def test_reload_recognition_provider_clears_cache_and_warms_new_engine(self) -> None:
        pipt_recognition_adapter.get_recognition_provider()

        with patch.object(pipt_recognition_adapter, "warmup_recognition_provider") as warmup:
            pipt_recognition_adapter.reload_recognition_provider(load_ner=False)

        self.assertEqual(pipt_recognition_adapter.get_recognition_provider.cache_info().currsize, 0)
        warmup.assert_called_once_with(load_ner=False)

    def test_pipt_config_change_schedules_provider_reload(self) -> None:
        background_tasks = Mock()

        pipt_gateway_api._schedule_pipt_provider_reload(background_tasks)

        background_tasks.add_task.assert_called_once_with(
            pipt_gateway_api._reload_pipt_provider_after_config_change
        )

    def test_pipt_config_reload_task_calls_adapter_reload(self) -> None:
        with patch.object(pipt_gateway_api, "reload_recognition_provider") as reload_provider:
            pipt_gateway_api._reload_pipt_provider_after_config_change()

        reload_provider.assert_called_once_with(load_ner=False)

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

    def test_target_entities_respects_disabled_task_config(self) -> None:
        with patch(
            "app.services.pipt_config_service.get_module_pipt_runtime_config",
            return_value={"enabled": False, "target_entities": ["name"]},
        ):
            result = service._target_entities(["name"], module_code="bid-generator")

        self.assertEqual(result, [])

    def test_custom_regex_test_returns_match_positions(self) -> None:
        from app.services import pipt_config_service

        result = pipt_config_service.test_custom_regex_payload(
            {
                "regex_rules": [{"name": "邮箱", "pattern": r"[A-Za-z0-9._%+-]+@example\.com"}],
                "text": "联系 test@example.com 处理。",
            }
        )

        self.assertEqual(result["count"], 1)
        self.assertEqual(result["matches"][0]["text"], "test@example.com")


if __name__ == "__main__":
    unittest.main()
