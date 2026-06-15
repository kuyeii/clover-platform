from __future__ import annotations

import json
import tempfile
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

API_ROOT = Path(__file__).resolve().parents[1]
API_ROOT_VALUE = str(API_ROOT)
if API_ROOT_VALUE not in sys.path:
    sys.path.insert(0, API_ROOT_VALUE)

from app.services import contract_review_service as service
from app.services import pipt_gateway_service
from app.services.contract_review_engine.split_segments import split_into_segments, validate_pipt_token_boundaries
from app.services.contract_review_engine.workflow_runner import WorkflowRunner


DIFY_CONNECT_TRACEBACK = """Traceback (most recent call last):
  File "/repo/apps/api/app/services/contract_review_engine/dify_client.py", line 50, in run_workflow
    response = requests.post(url, headers=headers, json=payload, timeout=self.timeout_seconds)
requests.exceptions.ConnectionError: HTTPConnectionPool(host='10.88.21.6', port=80): Max retries exceeded with url: /v1/workflows/run (Caused by NewConnectionError("HTTPConnection(host='10.88.21.6', port=80): Failed to establish a new connection: [Errno 65] No route to host"))

The above exception was the direct cause of the following exception:

src.dify_client.DifyWorkflowError: Workflow request could not connect after 3 attempt(s): url=http://10.88.21.6/v1/workflows/run, error=HTTPConnectionPool(host='10.88.21.6', port=80): Max retries exceeded with url: /v1/workflows/run
"""


class ContractReviewPipelineTests(unittest.TestCase):
    def test_document_level_pipt_context_redacts_once_and_segments_keep_token(self) -> None:
        token = "@@PIPT:v1:e000001:k11111111@@"
        with tempfile.TemporaryDirectory() as td:
            run_dir = Path(td)
            with patch.object(
                service,
                "preprocess_internal_payload",
                return_value={
                    "mode": "strong",
                    "text": f"一、主体\n联系人 {token}\n二、付款\n{token} 收款",
                    "desensitized_text": f"一、主体\n联系人 {token}\n二、付款\n{token} 收款",
                    "input_text_hash": "in",
                    "output_text_hash": "out",
                    "mapping_table": {token: "张三"},
                    "mapping_table_count": 1,
                    "mapping_vault_persisted": True,
                    "placeholder_manifest": {token: {"entity_type": "name"}},
                    "placeholder_policy": {"protocol": "pipt"},
                    "workflow_fields": {
                        "placeholder_manifest": "{}",
                        "placeholder_policy": "{}",
                        "pipt_gateway_enabled": "true",
                        "pipt_gateway_mode": "strong",
                    },
                    "validation": {"missing_count": 0, "unexpected_count": 0, "unsupported_count": 0},
                },
            ) as preprocess:
                review_text, context = service._prepare_contract_review_document_pipt(
                    run_id="run_doc_pipt",
                    run_dir=run_dir,
                    cleaned_text="一、主体\n联系人 张三\n二、付款\n张三 收款",
                )

            segments = split_into_segments(review_text)
            report = validate_pipt_token_boundaries(review_text, list(segments["segments"]))
            context_exists = (run_dir / "pipt_context.json").exists()

        self.assertEqual(preprocess.call_count, 1)
        self.assertNotIn("张三", review_text)
        self.assertEqual(context["strategy"], "document_level")
        self.assertEqual(context["mapping_table_count"], 1)
        self.assertTrue(report["valid"])
        self.assertEqual(report["token_count"], 1)
        self.assertTrue(context_exists)

    def test_workflow_runner_injects_document_pipt_fields_without_field_level_redaction(self) -> None:
        captured_inputs: dict[str, object] = {}

        class FakeClient:
            def run_workflow(self, *, inputs, user, response_mode="blocking"):
                captured_inputs.update(inputs)
                return {"data": {"status": "succeeded", "outputs": {"clauses": []}}}

        settings = SimpleNamespace(
            dify_base_url="http://dify/v1",
            dify_clause_workflow_api_key="clause",
            dify_risk_workflow_api_key="risk",
            anchored_risk_api_key=lambda: "risk",
            missing_multi_risk_api_key=lambda: "risk",
            dify_fast_screen_workflow_api_key="fast",
            request_timeout_seconds=5,
            review_side="甲方",
            contract_type_hint="服务合同",
            fast_screen_enabled=False,
            fast_screen_max_candidates="12",
        )
        with tempfile.TemporaryDirectory() as td:
            runner = WorkflowRunner(settings=settings, run_dir=Path(td), user_id="u")
            runner.clause_client = FakeClient()
            runner.set_pipt_workflow_fields(
                {
                    "placeholder_manifest": '{"@@PIPT:v1:e000001:k11111111@@": {"entity_type": "name"}}',
                    "placeholder_policy": '{"protocol": "pipt"}',
                    "pipt_gateway_enabled": "true",
                    "pipt_gateway_mode": "strong",
                }
            )
            with patch.object(service, "_contract_review_pipt_preprocess") as field_preprocess:
                runner.run_clause_splitter(
                    {
                        "segment_id": "segment_1",
                        "segment_title": "一、主体",
                        "segment_text": "联系人 @@PIPT:v1:e000001:k11111111@@",
                    }
                )

        self.assertEqual(field_preprocess.call_count, 0)
        self.assertEqual(captured_inputs["pipt_gateway_mode"], "strong")
        self.assertNotIn("张三", str(captured_inputs))
        self.assertEqual(captured_inputs["segment_text"], "联系人 @@PIPT:v1:e000001:k11111111@@")

    def test_validate_pipt_token_boundaries_detects_broken_token(self) -> None:
        token = "@@PIPT:v1:e000001:k11111111@@"
        report = validate_pipt_token_boundaries(
            f"联系人 {token}",
            [
                {"segment_id": "segment_1", "segment_text": "联系人 @@PIPT:v1:e000001:k"},
                {"segment_id": "segment_2", "segment_text": "11111111@@"},
            ],
        )

        self.assertFalse(report["valid"])
        self.assertIn(token, report["broken_tokens"])

    def test_restore_payload_for_source_docx_restores_clause_lists_with_document_manifest(self) -> None:
        token = "@@PIPT:v1:e000001:k11111111@@"
        with tempfile.TemporaryDirectory() as td:
            run_dir = Path(td)
            (run_dir / "pipt_context.json").write_text(
                '{"placeholder_manifest": {"@@PIPT:v1:e000001:k11111111@@": {"entity_type": "name"}}}',
                encoding="utf-8",
            )
            with (
                patch.object(service, "_contract_review_pipt_enabled", return_value=True),
                patch.object(
                    service,
                    "postprocess_payload",
                    side_effect=lambda payload: {
                        "text": str(payload["text"]).replace(token, "张三"),
                        "validation": {"missing_count": 0, "unexpected_count": 0, "unsupported_count": 0},
                    },
                ) as postprocess,
            ):
                restored = service._contract_review_restore_payload_for_source_docx(
                    [{"clause_text": f"联系人 {token}", "source_excerpt": token}],
                    run_id="run_restore",
                    run_dir=run_dir,
                )

        self.assertEqual(restored[0]["clause_text"], "联系人 张三")
        self.assertEqual(restored[0]["source_excerpt"], "张三")
        self.assertEqual(postprocess.call_args.args[0]["placeholder_manifest"], {token: {"entity_type": "name"}})

    def test_export_docx_uses_restored_for_docx_payloads(self) -> None:
        token = "@@PIPT:v1:e000001:k11111111@@"
        calls: list[list[str]] = []

        def fake_run(cmd, **_kwargs):
            calls.append([str(item) for item in cmd])
            return SimpleNamespace(returncode=0, stdout="", stderr="")

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            run_root = root / "runs"
            upload_root = root / "uploads"
            run_id = "run_export_restore"
            run_dir = run_root / run_id
            run_dir.mkdir(parents=True)
            (run_dir / "source.docx").write_bytes(b"docx")
            (run_dir / "merged_clauses.json").write_text(
                f'[{{"clause_uid":"c1","clause_text":"联系人 {token}","source_excerpt":"{token}"}}]',
                encoding="utf-8",
            )
            (run_dir / "risk_result_validated.json").write_text(
                f'{{"is_valid":true,"risk_result":{{"risk_items":[{{"risk_id":"r1","status":"accepted","clause_uid":"c1","target_text":"{token}"}}]}}}}',
                encoding="utf-8",
            )
            (run_dir / "pipt_context.json").write_text(
                f'{{"placeholder_manifest": {{"{token}": {{"entity_type": "name"}}}}}}',
                encoding="utf-8",
            )

            with (
                patch.object(service, "RUN_ROOT", run_root),
                patch.object(service, "UPLOAD_ROOT", upload_root),
                patch.object(service, "_contract_review_pipt_enabled", return_value=True),
                patch.object(
                    service,
                    "postprocess_payload",
                    side_effect=lambda payload: {
                        "text": str(payload["text"]).replace(token, "张三"),
                        "validation": {"missing_count": 0, "unexpected_count": 0, "unsupported_count": 0},
                    },
                ),
                patch.object(service, "enrich_reviewed_risks_with_locators", return_value={"located_success": 1}) as locator,
                patch.object(service.subprocess, "run", side_effect=fake_run),
            ):
                output = service._export_docx_with_reviewed_risks(run_id)

            reviewed_for_docx = (run_dir / "risk_result_reviewed.for_docx.json").read_text(encoding="utf-8")
            clauses_for_docx = (run_dir / "merged_clauses.for_docx.json").read_text(encoding="utf-8")

        self.assertEqual(output.name, "reviewed_comments.docx")
        self.assertIn("张三", reviewed_for_docx)
        self.assertIn("张三", clauses_for_docx)
        self.assertNotIn(token, reviewed_for_docx)
        self.assertNotIn(token, clauses_for_docx)
        self.assertEqual(locator.call_args.kwargs["reviewed_path"].name, "risk_result_reviewed.for_docx.json")
        self.assertTrue(any("risk_result_reviewed.for_docx.json" in " ".join(call) for call in calls))

    def test_rewrite_inputs_include_pipt_gateway_fields_by_default_enabled_strong(self) -> None:
        token = "@@PIPT:v1:e000001:k1a2b3c4d@@"
        with tempfile.TemporaryDirectory() as td:
            run_dir = Path(td)
            (run_dir / "merged_clauses.json").write_text(
                f'[{{"clause_uid":"c1","clause_text":"联系人 {token}"}}]',
                encoding="utf-8",
            )
            (run_dir / "pipt_context.json").write_text(
                json.dumps(
                    {
                        "enabled": True,
                        "mode": "strong",
                        "placeholder_manifest": {token: {"entity_type": "name"}},
                        "placeholder_policy": {"protocol": "pipt"},
                        "workflow_fields": {
                            "pipt_gateway_enabled": "true",
                            "pipt_gateway_mode": "strong",
                            "placeholder_manifest": json.dumps({token: {"entity_type": "name"}}, ensure_ascii=False),
                            "placeholder_policy": '{"protocol": "pipt"}',
                        },
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            risk = {
                "risk_id": "r1",
                "clause_uid": "c1",
                "target_text": token,
                "suggestion": "保留联系人",
                "issue": "测试",
                "risk_label": "测试风险",
            }
            with (
                patch.object(service, "_read_meta", return_value={"review_side": "甲方", "contract_type_hint": "服务合同"}),
                patch.dict(service.os.environ, {}, clear=True),
            ):
                inputs = service._build_rewrite_inputs(run_id="rewrite_pipt", run_dir=run_dir, risk=risk)

        self.assertEqual(inputs["pipt_gateway_enabled"], "true")
        self.assertEqual(inputs["pipt_gateway_mode"], "strong")
        self.assertIn("placeholder_policy", inputs)
        self.assertIn("placeholder_manifest", inputs)

    def test_redaction_artifact_risk_is_filtered_only_when_manifest_tokens_match(self) -> None:
        token = "@@PIPT:v1:e000001:k11111111@@"
        unknown_token = "@@PIPT:v1:e000002:k22222222@@"
        with tempfile.TemporaryDirectory() as td:
            run_dir = Path(td)
            (run_dir / "pipt_context.json").write_text(
                json.dumps({"placeholder_manifest": {token: {"entity_type": "org", "role": "机构名称"}}}, ensure_ascii=False),
                encoding="utf-8",
            )
            payload = {
                "risk_items": [
                    {
                        "risk_id": 1,
                        "reviewability": "redaction_artifact",
                        "caused_by_redaction": True,
                        "redaction_tokens": [token],
                        "issue": f"仲裁机构名称缺失：提交{token}申请仲裁",
                    },
                    {
                        "risk_id": 2,
                        "reviewability": "redaction_artifact",
                        "caused_by_redaction": True,
                        "redaction_tokens": [unknown_token],
                        "issue": f"未知 token 不能过滤：{unknown_token}",
                    },
                    {
                        "risk_id": 3,
                        "reviewability": "substantive_risk",
                        "caused_by_redaction": False,
                        "redaction_tokens": [],
                        "issue": "真实合同风险保留",
                    },
                ]
            }

            filtered_payload, filtered_items = service._filter_redaction_artifact_risks(
                payload,
                run_dir=run_dir,
                analysis_scope="full_detail",
            )

        self.assertEqual([item["risk_id"] for item in filtered_payload["risk_items"]], [2, 3])
        self.assertEqual(len(filtered_items), 1)
        self.assertEqual(filtered_items[0]["redaction_tokens"], [token])

    def test_redaction_artifact_filter_requires_token_evidence(self) -> None:
        token = "@@PIPT:v1:e000001:k11111111@@"
        with tempfile.TemporaryDirectory() as td:
            run_dir = Path(td)
            (run_dir / "pipt_context.json").write_text(
                json.dumps({"placeholder_manifest": {token: {"entity_type": "org", "role": "机构名称"}}}, ensure_ascii=False),
                encoding="utf-8",
            )
            (run_dir / "merged_clauses.json").write_text(
                '[{"clause_uid":"c1","clause_id":"1","display_clause_id":"1","clause_text":"普通争议解决条款"}]',
                encoding="utf-8",
            )
            payload = {
                "risk_items": [
                    {
                        "risk_id": 1,
                        "reviewability": "redaction_artifact",
                        "caused_by_redaction": True,
                        "redaction_tokens": [token],
                        "clause_uid": "c1",
                        "clause_uids": ["c1"],
                        "issue": "真实风险不应仅因引用任意合法 token 被过滤",
                    }
                ]
            }

            filtered_payload, filtered_items = service._filter_redaction_artifact_risks(
                payload,
                run_dir=run_dir,
                analysis_scope="full_detail",
            )

        self.assertEqual([item["risk_id"] for item in filtered_payload["risk_items"]], [1])
        self.assertEqual(filtered_items, [])

    def test_redaction_artifact_filter_accepts_token_in_related_clause_text(self) -> None:
        token = "@@PIPT:v1:e000001:k11111111@@"
        with tempfile.TemporaryDirectory() as td:
            run_dir = Path(td)
            (run_dir / "pipt_context.json").write_text(
                json.dumps({"placeholder_manifest": {token: {"entity_type": "org", "role": "机构名称"}}}, ensure_ascii=False),
                encoding="utf-8",
            )
            (run_dir / "merged_clauses.json").write_text(
                json.dumps(
                    [
                        {
                            "clause_uid": "c1",
                            "clause_id": "1",
                            "display_clause_id": "1",
                            "clause_text": f"提交{token}申请仲裁",
                        }
                    ],
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            payload = {
                "risk_items": [
                    {
                        "risk_id": 1,
                        "reviewability": "redaction_artifact",
                        "caused_by_redaction": True,
                        "redaction_tokens": [token],
                        "clause_uid": "c1",
                        "clause_uids": ["c1"],
                        "issue": "仲裁机构名称缺失导致条款无效",
                    }
                ]
            }

            filtered_payload, filtered_items = service._filter_redaction_artifact_risks(
                payload,
                run_dir=run_dir,
                analysis_scope="full_detail",
            )

        self.assertEqual(filtered_payload["risk_items"], [])
        self.assertEqual(len(filtered_items), 1)

    def test_redaction_artifact_filter_checks_clause_text_when_excerpt_omits_token(self) -> None:
        token = "@@PIPT:v1:e000001:k11111111@@"
        with tempfile.TemporaryDirectory() as td:
            run_dir = Path(td)
            (run_dir / "pipt_context.json").write_text(
                json.dumps({"placeholder_manifest": {token: {"entity_type": "org", "role": "机构名称"}}}, ensure_ascii=False),
                encoding="utf-8",
            )
            (run_dir / "merged_clauses.json").write_text(
                json.dumps(
                    [
                        {
                            "clause_uid": "c1",
                            "clause_id": "1",
                            "display_clause_id": "1",
                            "source_excerpt": "争议解决条款摘要",
                            "clause_text": f"提交{token}申请仲裁",
                        }
                    ],
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            payload = {
                "risk_items": [
                    {
                        "risk_id": 1,
                        "reviewability": "redaction_artifact",
                        "caused_by_redaction": True,
                        "redaction_tokens": [token],
                        "clause_uid": "c1",
                        "clause_uids": ["c1"],
                        "issue": "仲裁机构名称缺失导致条款无效",
                    }
                ]
            }

            filtered_payload, filtered_items = service._filter_redaction_artifact_risks(
                payload,
                run_dir=run_dir,
                analysis_scope="full_detail",
            )

        self.assertEqual(filtered_payload["risk_items"], [])
        self.assertEqual(len(filtered_items), 1)

    def test_redaction_artifact_filter_rejects_nested_undeclared_token(self) -> None:
        token = "@@PIPT:v1:e000001:k11111111@@"
        undeclared_token = "@@PIPT:v1:e000002:k22222222@@"
        with tempfile.TemporaryDirectory() as td:
            run_dir = Path(td)
            (run_dir / "pipt_context.json").write_text(
                json.dumps({"placeholder_manifest": {token: {"entity_type": "org", "role": "机构名称"}}}, ensure_ascii=False),
                encoding="utf-8",
            )
            (run_dir / "merged_clauses.json").write_text(
                json.dumps(
                    [
                        {
                            "clause_uid": "c1",
                            "clause_id": "1",
                            "display_clause_id": "1",
                            "clause_text": f"提交{token}申请仲裁",
                        }
                    ],
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            payload = {
                "risk_items": [
                    {
                        "risk_id": 1,
                        "reviewability": "redaction_artifact",
                        "caused_by_redaction": True,
                        "redaction_tokens": [token],
                        "clause_uid": "c1",
                        "clause_uids": ["c1"],
                        "issue": "仲裁机构名称缺失导致条款无效",
                        "normative_basis": {"basis_detail": f"嵌套未知 token {undeclared_token}"},
                    }
                ]
            }

            filtered_payload, filtered_items = service._filter_redaction_artifact_risks(
                payload,
                run_dir=run_dir,
                analysis_scope="full_detail",
            )

        self.assertEqual([item["risk_id"] for item in filtered_payload["risk_items"]], [1])
        self.assertEqual(filtered_items, [])

    def test_caused_by_redaction_string_false_does_not_filter(self) -> None:
        token = "@@PIPT:v1:e000001:k11111111@@"
        with tempfile.TemporaryDirectory() as td:
            run_dir = Path(td)
            (run_dir / "pipt_context.json").write_text(
                json.dumps({"placeholder_manifest": {token: {"entity_type": "org", "role": "机构名称"}}}, ensure_ascii=False),
                encoding="utf-8",
            )
            payload = {
                "risk_items": [
                    {
                        "risk_id": 1,
                        "reviewability": "redaction_artifact",
                        "caused_by_redaction": "false",
                        "redaction_tokens": [token],
                        "issue": f"字符串 false 不能触发过滤：{token}",
                    }
                ]
            }

            normalized = service.merge_risk_results(
                anchored_payload=payload,
                missing_multi_payload={"risk_items": []},
                clauses=[{"clause_uid": "c1", "clause_id": "1", "display_clause_id": "1", "clause_text": f"提交{token}申请仲裁"}],
            )
            filtered_payload, filtered_items = service._filter_redaction_artifact_risks(
                normalized,
                run_dir=run_dir,
                analysis_scope="full_detail",
            )

        self.assertEqual(len(filtered_payload["risk_items"]), 1)
        self.assertFalse(filtered_payload["risk_items"][0]["caused_by_redaction"])
        self.assertEqual(filtered_items, [])

    def test_restore_payload_for_result_restores_ai_visible_fields(self) -> None:
        token = "@@PIPT:v1:e000001:k11111111@@"
        with tempfile.TemporaryDirectory() as td:
            run_dir = Path(td)
            (run_dir / "pipt_context.json").write_text(
                json.dumps({"placeholder_manifest": {token: {"entity_type": "name"}}}, ensure_ascii=False),
                encoding="utf-8",
            )
            payload = {
                "risk_result": {
                    "risk_items": [
                        {
                            "risk_id": "r1",
                            "ai_rewrite": {
                                "target_text": token,
                                "revised_text": f"{token}应补充授权",
                                "comment_text": f"将{token}改写",
                                "rationale": f"{token}相关说明",
                            },
                        }
                    ]
                }
            }
            with (
                patch.object(service, "_contract_review_pipt_enabled", return_value=True),
                patch.object(
                    service,
                    "postprocess_payload",
                    side_effect=lambda payload: {
                        "text": str(payload["text"]).replace(token, "张三"),
                        "validation": {"missing_count": 0, "unexpected_count": 0, "unsupported_count": 0},
                    },
                ),
            ):
                restored = service._contract_review_restore_payload_for_source_docx(
                    payload,
                    run_id="run_restore_ai",
                    run_dir=run_dir,
                )

        ai_rewrite = restored["risk_result"]["risk_items"][0]["ai_rewrite"]
        self.assertEqual(ai_rewrite["target_text"], "张三")
        self.assertEqual(ai_rewrite["revised_text"], "张三应补充授权")
        self.assertEqual(ai_rewrite["comment_text"], "将张三改写")
        self.assertEqual(ai_rewrite["rationale"], "张三相关说明")

    def test_contract_review_pipt_can_be_disabled_to_compatibility_mode(self) -> None:
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
                patch.object(service, "preprocess_internal_payload") as preprocess,
                patch.dict(service.os.environ, {"CONTRACT_REVIEW_PIPT_GATEWAY_ENABLED": "false"}),
            ):
                inputs = service._build_rewrite_inputs(run_id="rewrite_pipt_enabled", run_dir=run_dir, risk=risk)

        self.assertEqual(inputs["pipt_gateway_enabled"], "false")
        self.assertEqual(inputs["pipt_gateway_mode"], "compatibility")
        self.assertEqual(preprocess.call_count, 0)

    def test_pipeline_retries_retryable_dify_connect_failure_with_resume(self) -> None:
        writes: list[tuple[str, dict]] = []

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            run_root = root / "runs"
            upload_root = root / "uploads"
            source_docx = run_root / "retry_ok" / "source.docx"
            source_docx.parent.mkdir(parents=True)
            source_docx.write_bytes(b"docx")

            pipeline_calls = [
                service.DifyWorkflowError(DIFY_CONNECT_TRACEBACK),
                None,
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
                patch.object(service, "_run_contract_review_native_pipeline", side_effect=pipeline_calls) as native_pipeline,
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

        self.assertEqual(native_pipeline.call_count, 2)
        self.assertFalse(native_pipeline.call_args_list[0].kwargs["resume"])
        self.assertTrue(native_pipeline.call_args_list[1].kwargs["resume"])
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

            pipeline_calls = [
                service.DifyWorkflowError(DIFY_CONNECT_TRACEBACK),
                service.DifyWorkflowError(DIFY_CONNECT_TRACEBACK),
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
                patch.object(service, "_run_contract_review_native_pipeline", side_effect=pipeline_calls) as native_pipeline,
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

        self.assertEqual(native_pipeline.call_count, 2)
        failed_meta = writes[-1][1]
        self.assertEqual(failed_meta["status"], "failed")
        self.assertEqual(failed_meta["error_code"], "DIFY_WORKFLOW_CONNECT_FAILED")
        self.assertNotIn("Traceback", failed_meta["error"])
        self.assertIn("Traceback", failed_meta["error_detail"])

    def test_pipeline_provider_missing_writes_actionable_config_error(self) -> None:
        writes: list[tuple[str, dict]] = []

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            run_root = root / "runs"
            upload_root = root / "uploads"
            source_docx = run_root / "provider_failed" / "source.docx"
            source_docx.parent.mkdir(parents=True)
            source_docx.write_bytes(b"docx")

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
                patch.object(
                    service,
                    "_run_contract_review_native_pipeline",
                    side_effect=service.DifyWorkflowError(
                        "Workflow returned error: Provider langgenius/openai_api_compatible/openai_api_compatible does not exist."
                    ),
                ) as native_pipeline,
                patch.dict(service.os.environ, {"CONTRACT_REVIEW_PIPELINE_RETRY_ATTEMPTS": "2"}),
            ):
                service._run_pipeline_impl(
                    run_id="provider_failed",
                    file_path=upload_root / "provider_failed.docx",
                    file_name="provider_failed.docx",
                    review_side="甲方",
                    contract_type_hint="service_agreement",
                    analysis_scope="full_detail",
                )

        self.assertEqual(native_pipeline.call_count, 1)
        failed_meta = writes[-1][1]
        self.assertEqual(failed_meta["status"], "failed")
        self.assertEqual(failed_meta["error_code"], "DIFY_WORKFLOW_PROVIDER_MISSING")
        self.assertIn("Dify 工作流", failed_meta["error"])
        self.assertIn("Provider", failed_meta["error_detail"])

    def test_contract_review_pipt_client_desensitizes_inputs_and_restores_outputs(self) -> None:
        captured_inputs: dict[str, object] = {}

        class FakeClient:
            def run_workflow(self, *, inputs, user, response_mode="blocking"):
                captured_inputs.update(inputs)
                return {
                    "data": {
                        "status": "succeeded",
                        "outputs": {
                            "risk_items": [
                                {
                                    "risk_label": "联系人风险",
                                    "issue": "联系人 @@PIPT:v1:e000001:k11111111@@ 未约定授权。",
                                    "evidence_text": "@@PIPT:v1:e000001:k11111111@@",
                                }
                            ]
                        },
                    }
                }

        client = service._ContractReviewPiptWorkflowClient(FakeClient(), purpose="contract_clause_split", run_id="run1")
        with (
            patch.object(
                service,
                "_contract_review_pipt_preprocess",
                side_effect=lambda *, text, purpose, request_id: {
                    "request_id": request_id,
                    "text": str(text).replace("张三", "@@PIPT:v1:e000001:k11111111@@"),
                    "placeholder_manifest": {"@@PIPT:v1:e000001:k11111111@@": {"entity_type": "name"}},
                    "workflow_fields": {
                        "placeholder_manifest": "{}",
                        "placeholder_policy": "{}",
                        "pipt_gateway_enabled": "true",
                        "pipt_gateway_mode": "strong",
                    },
                    "validation": {"missing_count": 0, "unexpected_count": 0, "unsupported_count": 0},
                },
            ),
            patch.object(
                service,
                "_contract_review_pipt_postprocess",
                side_effect=lambda *, text, purpose, request_id, placeholder_manifest: {
                    "request_id": request_id,
                    "text": str(text).replace("@@PIPT:v1:e000001:k11111111@@", "张三"),
                    "restored_count": 1,
                    "validation": {"missing_count": 0, "unexpected_count": 0, "unsupported_count": 0},
                },
            ),
        ):
            response = client.run_workflow(
                inputs={"segment_text": "联系人 张三"},
                user="u1",
            )

        self.assertEqual(captured_inputs["pipt_gateway_enabled"], "true")
        self.assertEqual(captured_inputs["pipt_gateway_mode"], "strong")
        self.assertIn("placeholder_manifest", captured_inputs)
        self.assertEqual(captured_inputs["segment_text"], "联系人 @@PIPT:v1:e000001:k11111111@@")
        self.assertEqual(response["data"]["outputs"]["risk_items"][0]["issue"], "联系人 张三 未约定授权。")
        self.assertNotIn("pipt_gateway_warning", response["data"])

    def test_contract_review_pipt_client_falls_back_to_plain_text_on_preprocess_error(self) -> None:
        captured_inputs: dict[str, object] = {}

        class FakeClient:
            def run_workflow(self, *, inputs, user, response_mode="blocking"):
                captured_inputs.update(inputs)
                return {"data": {"status": "succeeded", "outputs": {"text": "ok"}}}

        client = service._ContractReviewPiptWorkflowClient(FakeClient(), purpose="contract_clause_split", run_id="run1")
        with (
            patch.object(service, "_contract_review_pipt_preprocess", side_effect=RuntimeError("vault down")),
            patch.object(
                service,
                "_contract_review_pipt_workflow_fields",
                return_value={
                    "placeholder_manifest": "{}",
                    "placeholder_policy": "{}",
                    "pipt_gateway_enabled": "true",
                    "pipt_gateway_mode": "strong",
                },
            ),
        ):
            response = client.run_workflow(inputs={"segment_text": "联系人 张三"}, user="u1")

        self.assertEqual(captured_inputs["segment_text"], "联系人 张三")
        self.assertIn("pipt_gateway_preprocess_warning", response["data"])

    def test_contract_review_pipt_purposes_are_permanent(self) -> None:
        for purpose in (
            "contract_review_document_preprocess",
            "contract_clause_split",
            "contract_risk_review",
            "contract_fast_screen",
            "contract_ai_rewrite",
        ):
            self.assertIsNone(
                pipt_gateway_service._vault_ttl_seconds(module_code="contract-review", purpose=purpose)
            )

    def test_attach_contract_review_native_writers_routes_runner_json_to_service_writer(self) -> None:
        original = service.contract_workflow_runner_module.write_json
        try:
            service._attach_contract_review_native_writers()
            self.assertIs(service.contract_workflow_runner_module.write_json, service._write_json_artifact)
        finally:
            service.contract_workflow_runner_module.write_json = original

    def test_read_meta_migrates_archived_run_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            run_root = root / "new" / "runs"
            upload_root = root / "new" / "uploads"
            archived_run_root = root / "old" / "runs"
            archived_upload_root = root / "old" / "uploads"
            archived_run_dir = archived_run_root / "old_run"
            archived_run_dir.mkdir(parents=True)
            archived_upload_root.mkdir(parents=True)
            (archived_run_dir / "merged_clauses.json").write_text("[]", encoding="utf-8")
            (archived_run_dir / "risk_result_validated.json").write_text(
                '{"is_valid": true, "risk_result": {"risk_items": []}}',
                encoding="utf-8",
            )
            (archived_run_dir / "reviewed_comments.docx").write_bytes(b"docx")
            (archived_upload_root / "old_run.docx").write_bytes(b"upload")

            with (
                patch.object(service, "RUN_ROOT", run_root),
                patch.object(service, "UPLOAD_ROOT", upload_root),
                patch.object(service, "ARCHIVED_RUN_ROOT", archived_run_root),
                patch.object(service, "ARCHIVED_UPLOAD_ROOT", archived_upload_root),
                patch.object(service, "get_review_meta", return_value=None),
                patch.object(service, "load_json_artifact_by_path", return_value=None),
            ):
                meta = service._read_meta("old_run")

            self.assertEqual(meta["status"], "completed")
            self.assertTrue((run_root / "old_run" / "merged_clauses.json").exists())
            self.assertTrue((upload_root / "old_run.docx").exists())


if __name__ == "__main__":
    unittest.main()
