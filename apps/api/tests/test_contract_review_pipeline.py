from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from app.services import contract_review_service as service


DIFY_CONNECT_TRACEBACK = """Traceback (most recent call last):
  File "/repo/legacy/contract_review/src/dify_client.py", line 50, in run_workflow
    response = requests.post(url, headers=headers, json=payload, timeout=self.timeout_seconds)
requests.exceptions.ConnectionError: HTTPConnectionPool(host='10.88.21.6', port=80): Max retries exceeded with url: /v1/workflows/run (Caused by NewConnectionError("HTTPConnection(host='10.88.21.6', port=80): Failed to establish a new connection: [Errno 65] No route to host"))

The above exception was the direct cause of the following exception:

src.dify_client.DifyWorkflowError: Workflow request could not connect after 3 attempt(s): url=http://10.88.21.6/v1/workflows/run, error=HTTPConnectionPool(host='10.88.21.6', port=80): Max retries exceeded with url: /v1/workflows/run
"""


class FakeProcess:
    def __init__(self, returncode: int, *, stdout: str = "", stderr: str = "") -> None:
        self.returncode = returncode
        self._stdout = stdout
        self._stderr = stderr

    def poll(self) -> int:
        return self.returncode

    def communicate(self) -> tuple[str, str]:
        return self._stdout, self._stderr


class ContractReviewPipelineTests(unittest.TestCase):
    def test_pipeline_retries_retryable_dify_connect_failure_with_resume(self) -> None:
        writes: list[tuple[str, dict]] = []

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            run_root = root / "runs"
            upload_root = root / "uploads"
            source_docx = run_root / "retry_ok" / "source.docx"
            source_docx.parent.mkdir(parents=True)
            source_docx.write_bytes(b"docx")

            processes = [
                FakeProcess(1, stderr=DIFY_CONNECT_TRACEBACK),
                FakeProcess(0, stdout="ok"),
            ]

            with (
                patch.object(service, "RUN_ROOT", run_root),
                patch.object(service, "UPLOAD_ROOT", upload_root),
                patch.object(service, "_write_meta", side_effect=lambda run_id, payload: writes.append((run_id, dict(payload)))),
                patch.object(
                    service,
                    "normalize_upload_to_docx",
                    return_value=SimpleNamespace(
                        working_docx_path=source_docx,
                        converted=False,
                        source_format="docx",
                        warnings=[],
                    ),
                ),
                patch.object(service.subprocess, "Popen", side_effect=processes) as popen,
                patch.object(service.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout="", stderr="")),
                patch.object(service, "_safe_json", return_value={"is_valid": True}),
                patch.object(service, "get_or_create_reviewed_risks", return_value={}),
                patch.object(service, "_has_rewrite_workflow_key", return_value=False),
                patch.dict(service.os.environ, {"CONTRACT_REVIEW_PIPELINE_RETRY_ATTEMPTS": "2"}),
            ):
                service._run_pipeline_impl(
                    run_id="retry_ok",
                    file_path=upload_root / "retry_ok.docx",
                    file_name="retry_ok.docx",
                    review_side="甲方",
                    contract_type_hint="service_agreement",
                    analysis_scope="full_detail",
                )

        self.assertEqual(popen.call_count, 2)
        retry_cmd = popen.call_args_list[1].args[0]
        self.assertIn("--resume", retry_cmd)
        self.assertEqual(writes[-1][1]["status"], "completed")

    def test_pipeline_exhausted_dify_connect_failure_writes_user_facing_error(self) -> None:
        writes: list[tuple[str, dict]] = []

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            run_root = root / "runs"
            upload_root = root / "uploads"
            source_docx = run_root / "retry_failed" / "source.docx"
            source_docx.parent.mkdir(parents=True)
            source_docx.write_bytes(b"docx")

            processes = [
                FakeProcess(1, stderr=DIFY_CONNECT_TRACEBACK),
                FakeProcess(1, stderr=DIFY_CONNECT_TRACEBACK),
            ]

            with (
                patch.object(service, "RUN_ROOT", run_root),
                patch.object(service, "UPLOAD_ROOT", upload_root),
                patch.object(service, "_write_meta", side_effect=lambda run_id, payload: writes.append((run_id, dict(payload)))),
                patch.object(
                    service,
                    "normalize_upload_to_docx",
                    return_value=SimpleNamespace(
                        working_docx_path=source_docx,
                        converted=False,
                        source_format="docx",
                        warnings=[],
                    ),
                ),
                patch.object(service.subprocess, "Popen", side_effect=processes) as popen,
                patch.dict(service.os.environ, {"CONTRACT_REVIEW_PIPELINE_RETRY_ATTEMPTS": "2"}),
            ):
                service._run_pipeline_impl(
                    run_id="retry_failed",
                    file_path=upload_root / "retry_failed.docx",
                    file_name="retry_failed.docx",
                    review_side="甲方",
                    contract_type_hint="service_agreement",
                    analysis_scope="full_detail",
                )

        self.assertEqual(popen.call_count, 2)
        failed_meta = writes[-1][1]
        self.assertEqual(failed_meta["status"], "failed")
        self.assertEqual(failed_meta["error_code"], "DIFY_WORKFLOW_CONNECT_FAILED")
        self.assertNotIn("Traceback", failed_meta["error"])
        self.assertIn("Traceback", failed_meta["error_detail"])


if __name__ == "__main__":
    unittest.main()
