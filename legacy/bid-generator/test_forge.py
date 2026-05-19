import sys
import logging
logging.basicConfig(level=logging.INFO)
from pathlib import Path
sys.path.insert(0, "/home/haisuchen/pro-engine/gateway-out")
from src.forge import DocumentForge

forge = DocumentForge()
sections = [
    {"id": "550e8400-e29b-41d4-a716-446655440000", "title": "第一章 实施方案", "content": "这是正文部分。"}
]
scoring_rows = [
    {
        "indicator": "1.1",
        "maxScore": "10",
        "criteria": "好",
        "selfResponse": "excellent",
        "selfComment": "我们很好",
        "evidenceRefs": ["550e8400-e29b-41d4-a716-446655440000", "some-other-id"]
    }
]

docx_bytes = forge.build(sections=sections, scoring_rows=scoring_rows, attachments=[])
with open("/home/haisuchen/pro-engine/test_forge.docx", "wb") as f:
    f.write(docx_bytes)
print("SUCCESS!")
