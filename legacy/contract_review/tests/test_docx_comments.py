import unittest
import types
import sys

fake_lxml = types.ModuleType("lxml")
fake_lxml.etree = types.SimpleNamespace(_Element=object)
sys.modules.setdefault("lxml", fake_lxml)

from src.docx_comments import _build_comment_text


class DocxCommentsTests(unittest.TestCase):
    def test_build_comment_text_prefers_basis_minimal(self):
        comment = _build_comment_text(
            {
                "issue": "测试问题",
                "basis_minimal": "最简依据",
                "basis_summary": "摘要依据",
                "basis": "完整依据",
                "suggestion": "建议补充明确约定。",
            },
            [],
        )

        self.assertIn("【依据】最简依据", comment)

    def test_build_comment_text_falls_back_to_basis_summary(self):
        comment = _build_comment_text(
            {
                "issue": "测试问题",
                "basis_summary": "摘要依据",
                "basis": "完整依据",
                "suggestion": "建议补充明确约定。",
            },
            [],
        )

        self.assertIn("【依据】摘要依据", comment)


if __name__ == "__main__":
    unittest.main()
