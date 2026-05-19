import unittest

from src.clause_reference_rendering import sanitize_user_visible_risk_fields


CLAUSE = {
    "clause_uid": "segment_7::7.3",
    "clause_id": "7.3",
    "display_clause_id": "7.3",
    "source_clause_id": "7.3",
    "segment_title": "第七条 调试和验收",
    "clause_text": "甲方应在验收后付款。",
}


class ClauseReferenceRenderingTests(unittest.TestCase):
    def test_sanitizes_basis_minimal_clause_reference(self):
        item = {"basis_minimal": "参照segment_7::7.3执行"}
        changed = sanitize_user_visible_risk_fields(item, clauses=[CLAUSE])
        self.assertTrue(changed)
        self.assertEqual(item["basis_minimal"], "参照7.3执行")


if __name__ == "__main__":
    unittest.main()
