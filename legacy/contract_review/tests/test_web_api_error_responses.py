import io
import unittest

from fastapi.testclient import TestClient

import web_api


class WebApiErrorResponseTests(unittest.TestCase):
    def test_create_review_invalid_file_type_returns_user_facing_payload(self):
        client = TestClient(web_api.app)

        response = client.post(
            "/api/reviews",
            files={"file": ("bad.pdf", io.BytesIO(b"%PDF-1.4"), "application/pdf")},
        )

        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertEqual(payload["error"]["code"], "UNSUPPORTED_FILE_TYPE")
        self.assertEqual(payload["error"]["title"], "文件格式不支持")
        self.assertEqual(payload["error"]["message"], "请上传 .docx 格式的合同文件后再试。")
        self.assertIn(".docx", str(payload.get("detail", "")))


if __name__ == "__main__":
    unittest.main()
