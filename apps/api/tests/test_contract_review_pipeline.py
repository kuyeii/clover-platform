from __future__ import annotations

import tempfile
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

API_ROOT = Path(__file__).resolve().parents[1]
API_ROOT_VALUE = str(API_ROOT)
if API_ROOT_VALUE not in sys.path:
    sys.path.insert(0, API_ROOT_VALUE)

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
    def test_rewrite_inputs_include_pipt_gateway_fields_by_default_disabled(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            run_dir = Path(td)
            (run_dir / "merged_clauses.json").write_text(
                '[{"clause_uid":"c1","clause_text":"联系人 @@PIPT:v1:e000001:k1a2b3c4d@@"}]',
                encoding="utf-8",
            )
            risk = {
                "risk_id": "r1",
                "clause_uid": "c1",
                "target_text": "@@PIPT:v1:e000001:k1a2b3c4d@@",
                "suggestion": "保留联系人",
                "issue": "测试",
                "risk_label": "测试风险",
            }
            with (
                patch.object(service, "_read_meta", return_value={"review_side": "甲方", "contract_type_hint": "服务合同"}),
                patch.dict(service.os.environ, {}, clear=False),
            ):
                inputs = service._build_rewrite_inputs(run_id="rewrite_pipt", run_dir=run_dir, risk=risk)

        self.assertEqual(inputs["pipt_gateway_enabled"], "false")
        self.assertEqual(inputs["pipt_gateway_mode"], "compatibility")
        self.assertIn("placeholder_policy", inputs)
        self.assertIn("placeholder_manifest", inputs)

    def test_contract_review_pipt_enabled_still_uses_compatibility_mode(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            run_dir = Path(td)
            (run_dir / "merged_clauses.json").write_text(
                '[{"clause_uid":"c1","clause_text":"联系人 张三"}]',
                encoding="utf-8",
            )
            risk = {
                "risk_id": "r1",
                "clause_uid": "c1",
                "target_text": "张三",
                "suggestion": "保留联系人",
                "issue": "测试",
                "risk_label": "测试风险",
            }
            with (
                patch.object(service, "_read_meta", return_value={"review_side": "甲方", "contract_type_hint": "服务合同"}),
                patch.object(service, "preprocess_payload", return_value={
                    "workflow_fields": {
                        "pipt_gateway_enabled": "true",
                        "pipt_gateway_mode": "compatibility",
                        "placeholder_manifest": "{}",
                        "placeholder_policy": "{}",
                    }
                }) as preprocess,
                patch.dict(service.os.environ, {"CONTRACT_REVIEW_PIPT_GATEWAY_ENABLED": "true"}),
            ):
                inputs = service._build_rewrite_inputs(run_id="rewrite_pipt_enabled", run_dir=run_dir, risk=risk)

        self.assertEqual(inputs["pipt_gateway_enabled"], "true")
        self.assertEqual(inputs["pipt_gateway_mode"], "compatibility")
        call_payload = preprocess.call_args.args[0]
        self.assertEqual(call_payload["mode"], "compatibility")
        self.assertTrue(call_payload["enabled"])

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
