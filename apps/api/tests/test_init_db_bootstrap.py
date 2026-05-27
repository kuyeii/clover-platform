from __future__ import annotations

import os
import unittest
from unittest.mock import Mock, patch

from scripts import init_db


class InitDbBootstrapTests(unittest.TestCase):
    def test_seed_default_admin_creates_admin_when_missing(self) -> None:
        exists_result = Mock()
        exists_result.scalar_one.return_value = False
        insert_result = Mock()
        insert_result.mappings.return_value.one.return_value = {
            "id": "00000000-0000-0000-0000-000000000001"
        }
        conn = Mock()
        conn.execute.side_effect = [exists_result, insert_result, Mock(), Mock()]

        with patch.dict(
            os.environ,
            {
                "PORTAL_ADMIN_USERNAME": "RootAdmin ",
                "PORTAL_ADMIN_PASSWORD": "change-me",
                "PORTAL_ADMIN_DISPLAY_NAME": "Root User",
            },
            clear=False,
        ):
            created = init_db.seed_default_admin(conn)

        self.assertTrue(created)
        self.assertEqual(conn.execute.call_count, 4)
        insert_params = conn.execute.call_args_list[1].args[1]
        self.assertEqual(insert_params["username"], "rootadmin")
        self.assertEqual(insert_params["display_name"], "Root User")
        self.assertIn("$", insert_params["password_hash"])

    def test_seed_default_admin_skips_when_admin_exists(self) -> None:
        exists_result = Mock()
        exists_result.scalar_one.return_value = True
        conn = Mock()
        conn.execute.return_value = exists_result

        created = init_db.seed_default_admin(conn)

        self.assertFalse(created)
        self.assertEqual(conn.execute.call_count, 1)


if __name__ == "__main__":
    unittest.main()
