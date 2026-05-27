import unittest
from unittest.mock import patch

import requests

from src.dify_client import DifyWorkflowClient, DifyWorkflowError, extract_blocking_outputs


class DifyClientOutputsTests(unittest.TestCase):
    def test_extract_outputs_raises_on_failed_status(self):
        payload = {
            "data": {
                "status": "failed",
                "error": "upstream failure",
            }
        }
        with self.assertRaises(DifyWorkflowError):
            extract_blocking_outputs(payload)

    def test_extract_outputs_success(self):
        payload = {"data": {"status": "succeeded", "outputs": {"risk_items": []}}}
        out = extract_blocking_outputs(payload)
        self.assertEqual(out, {"risk_items": []})

    def test_workflow_client_retries_transient_connection_error(self):
        client = DifyWorkflowClient(
            base_url="http://dify.local/v1",
            api_key="app-test",
            timeout_seconds=10,
            connect_retry_delay_seconds=0,
        )
        success = unittest.mock.Mock(status_code=200)
        success.json.return_value = {"data": {"status": "succeeded", "outputs": {"ok": True}}}

        with patch(
            "src.dify_client.requests.post",
            side_effect=[requests.ConnectionError("No route to host"), success],
        ) as post:
            response = client.run_workflow(inputs={}, user="u")

        self.assertEqual(response["data"]["outputs"], {"ok": True})
        self.assertEqual(post.call_count, 2)


if __name__ == "__main__":
    unittest.main()
