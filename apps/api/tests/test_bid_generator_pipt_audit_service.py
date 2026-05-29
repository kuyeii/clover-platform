from __future__ import annotations

import unittest
from datetime import datetime, timezone
from pathlib import Path
import sys
from unittest.mock import MagicMock, Mock, patch


API_ROOT = Path(__file__).resolve().parents[1]
API_ROOT_VALUE = str(API_ROOT)
if API_ROOT_VALUE not in sys.path:
    sys.path.insert(0, API_ROOT_VALUE)

from app.services import bid_generator_service


class BidGeneratorPiptAuditServiceTests(unittest.TestCase):
    def test_list_pipt_audit_logs_filters_and_caps_limit(self) -> None:
        exists_result = Mock()
        exists_result.scalar_one.return_value = True
        row_result = Mock()
        row_result.mappings.return_value.all.return_value = [
            {
                "id": "log-1",
                "operation": "resolve",
                "status": "ambiguous",
                "source": "task.start_content",
                "session_id": None,
                "project_id": "proj-1",
                "task_id": "task-1",
                "placeholder": "{{PIPT_1}}",
                "entity_type": None,
                "original_hash": None,
                "text_hash": "abc",
                "details": {"reason": "pipt_index_without_type"},
                "created_at": datetime(2026, 5, 29, tzinfo=timezone.utc),
            }
        ]
        conn = Mock()
        conn.execute.side_effect = [exists_result, row_result]
        engine = MagicMock()
        engine.begin.return_value.__enter__.return_value = conn

        with patch.object(bid_generator_service, "get_engine", return_value=engine):
            payload = bid_generator_service.list_pipt_audit_logs_payload(
                project_id="proj-1",
                operation="resolve",
                status="ambiguous",
                limit=999,
            )

        self.assertEqual(payload["count"], 1)
        self.assertEqual(payload["limit"], 500)
        self.assertEqual(payload["items"][0]["placeholder"], "{{PIPT_1}}")
        self.assertEqual(payload["items"][0]["details"]["reason"], "pipt_index_without_type")
        self.assertNotIn("original_text", payload["items"][0])
        params = conn.execute.call_args_list[1].args[1]
        self.assertEqual(params["project_id"], "proj-1")
        self.assertEqual(params["operation"], "resolve")
        self.assertEqual(params["status"], "ambiguous")
        self.assertEqual(params["limit"], 500)


if __name__ == "__main__":
    unittest.main()
