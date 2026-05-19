import unittest

from src.clause_ref_display import build_clause_alias_map, humanize_clause_refs


CLAUSE = {
    "clause_uid": "segment_7::7.3",
    "clause_id": "7.3",
    "display_clause_id": "7.3",
    "segment_title": "第七条 调试和验收",
}


class ClauseRefDisplayTests(unittest.TestCase):
    def test_keeps_existing_humanized_clause_reference(self):
        alias_map = build_clause_alias_map([CLAUSE])
        text = "条款第7.3条使用'应请'和'由甲方负责'的表述"
        self.assertEqual(humanize_clause_refs(text, alias_map), text)

    def test_normalizes_half_wrapped_clause_reference(self):
        alias_map = build_clause_alias_map([CLAUSE])
        self.assertEqual(humanize_clause_refs("参照7.3条执行", alias_map), "参照第7.3条执行")
        self.assertEqual(humanize_clause_refs("本合同第7.3约定", alias_map), "本合同第7.3条约定")

    def test_does_not_match_inside_longer_numeric_reference(self):
        alias_map = build_clause_alias_map([CLAUSE])
        text = "第7.3.1条约定优先适用"
        self.assertEqual(humanize_clause_refs(text, alias_map), text)

    def test_repairs_double_wrapped_legacy_reference(self):
        text = "条款第第7.3条条使用'应请'和'由甲方负责'的表述"
        expected = "条款第7.3条使用'应请'和'由甲方负责'的表述"
        self.assertEqual(humanize_clause_refs(text, None), expected)


if __name__ == "__main__":
    unittest.main()
