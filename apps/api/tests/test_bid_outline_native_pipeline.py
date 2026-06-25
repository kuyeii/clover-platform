from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import patch


API_ROOT = Path(__file__).resolve().parents[1]
API_ROOT_VALUE = str(API_ROOT)
if API_ROOT_VALUE not in sys.path:
    sys.path.insert(0, API_ROOT_VALUE)

from app.services import bid_outline_native_pipeline as pipeline
from app.services import bid_outline_knowledge
from app.services.bid_model_manifest import get_bid_model_completion_params, get_bid_model_node
from app.services.bid_outline_llm import BidOutlineLlmClient, get_bid_outline_llm_config


def test_normalize_outline_stages_preserve_fixed_h2_and_response_self_generation() -> None:
    seed_json = (
        '[{"id":"h2-1","title":"总体技术方案"},'
        '{"id":"h2-2","title":"响应情况","generation_strategy":"response_special"}]'
    )
    draft = {
        "outline": [
            {
                "title": "总体技术方案",
                "wordCount": 800,
                "keywords": ["总体架构"],
                "writingHint": "围绕总体架构展开。",
                "children": [
                    {
                        "title": "技术路线",
                        "wordCount": 800,
                        "keywords": ["技术路线"],
                        "writingHint": "说明技术路线。",
                    }
                ],
            },
            {
                "title": "响应情况",
                "wordCount": 300,
                "keywords": ["响应策略", "偏离控制"],
                "writingHint": "逐条响应采购需求并控制偏离风险。",
                "children": [{"title": "不应保留"}],
            },
        ]
    }

    parsed = pipeline.normalize_outline_parse_stage(
        draft,
        requirements="",
        structure_heading_seed_json=seed_json,
        technical_h2_bindings_json="",
    )
    assert "总体架构" in parsed["keywords_for_search"]
    final = pipeline.normalize_outline_final_stage(
        draft,
        requirements="",
        total_words=1100,
        structure_heading_seed_json=seed_json,
        technical_h2_bindings_json="",
    )
    structured = pipeline._loads_json_object(final["structured_output"])

    assert structured is not None
    assert [item["title"] for item in structured["outline"]] == ["总体技术方案", "响应情况"]
    assert structured["outline"][0]["children"][0]["title"] == "技术路线"
    assert structured["outline"][1]["children"] == []
    assert structured["outline"][1]["generatesFromSelf"] is True
    assert len(structured["outline"][1]["keywords"]) >= 2


def test_response_special_outline_keywords_are_completed_before_quality_check() -> None:
    seed_headings = [{"id": "h2-response", "title": "响应情况", "generation_strategy": "response_special"}]
    sections = pipeline.build_seeded_outline_sections(
        [
            {
                "title": "响应情况",
                "wordCount": 800,
                "keywords": ["响应情况"],
                "writingHint": "围绕采购需求逐条响应，说明关键条款符合性、偏离控制和闭环措施，避免编造参数或承诺。",
                "children": [],
            }
        ],
        seed_headings,
        max_diagrams=0,
    )
    quality = pipeline.evaluate_outline_quality(sections, seed_headings)

    assert sections[0]["children"] == []
    assert sections[0]["generatesFromSelf"] is True
    assert len(sections[0]["keywords"]) >= 2
    assert quality["pass"] is True


def test_run_outline_batches_native_respects_concurrency_and_keeps_result_order() -> None:
    async def run_case() -> None:
        active = 0
        max_active = 0
        released = asyncio.Event()
        started: list[int] = []

        async def fake_generate_outline_batch_native(**kwargs):
            nonlocal active, max_active
            batch_index = int(kwargs["batch_index"])
            started.append(batch_index)
            active += 1
            max_active = max(max_active, active)
            if len(started) >= 2:
                released.set()
            await released.wait()
            await asyncio.sleep(0)
            active -= 1
            return pipeline.NativeOutlineBatchResult(
                batch_index=batch_index,
                sections=[{"id": f"h2-{batch_index}", "title": f"章节{batch_index}", "children": []}],
            )

        batch_jobs = [
            {"batch_index": 1, "seed_headings": [], "inputs": {}},
            {"batch_index": 2, "seed_headings": [], "inputs": {}},
            {"batch_index": 3, "seed_headings": [], "inputs": {}},
        ]
        with (
            patch.dict(pipeline.os.environ, {"BID_OUTLINE_NATIVE_MAX_CONCURRENCY": "2"}, clear=False),
            patch.object(pipeline, "generate_outline_batch_native", new=fake_generate_outline_batch_native),
            patch.object(pipeline, "BidOutlineLlmClient", return_value=object()),
        ):
            sections = await pipeline.run_outline_batches_native(
                batch_jobs=batch_jobs,
                expected_total_words=0,
                max_diagrams=0,
                use_knowledge=False,
                ensure_running=lambda: None,
            )

        assert max_active == 2
        assert [section["title"] for section in sections] == ["章节1", "章节2", "章节3"]

    asyncio.run(run_case())


def test_run_outline_batches_native_cancels_pending_children_on_parent_cancel() -> None:
    async def run_case() -> None:
        entered = asyncio.Event()
        cancelled: list[int] = []

        async def fake_generate_outline_batch_native(**kwargs):
            batch_index = int(kwargs["batch_index"])
            entered.set()
            try:
                await asyncio.sleep(30)
            except asyncio.CancelledError:
                cancelled.append(batch_index)
                raise

        batch_jobs = [
            {"batch_index": 1, "seed_headings": [], "inputs": {}},
            {"batch_index": 2, "seed_headings": [], "inputs": {}},
        ]
        with (
            patch.dict(pipeline.os.environ, {"BID_OUTLINE_NATIVE_MAX_CONCURRENCY": "2"}, clear=False),
            patch.object(pipeline, "generate_outline_batch_native", new=fake_generate_outline_batch_native),
            patch.object(pipeline, "BidOutlineLlmClient", return_value=object()),
        ):
            task = asyncio.create_task(
                pipeline.run_outline_batches_native(
                    batch_jobs=batch_jobs,
                    expected_total_words=0,
                    max_diagrams=0,
                    use_knowledge=False,
                    ensure_running=lambda: None,
                )
            )
            await entered.wait()
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            else:
                raise AssertionError("parent cancellation must propagate")

        assert sorted(cancelled) == [1, 2]

    asyncio.run(run_case())


def test_retrieve_outline_knowledge_uses_dify_dataset_retrieve_payload() -> None:
    async def run_case() -> None:
        calls: list[dict[str, object]] = []

        class FakeResponse:
            status_code = 200
            text = ""

            def json(self) -> dict[str, object]:
                return {
                    "records": [
                        {"segment": {"content": "知识片段一"}},
                        {"segment": {"content": "知识片段二"}},
                    ]
                }

        class FakeClient:
            async def __aenter__(self) -> "FakeClient":
                return self

            async def __aexit__(self, exc_type, exc, tb) -> None:
                return None

            async def post(self, url: str, *, headers: dict[str, str], json: dict[str, object]) -> FakeResponse:
                calls.append({"url": url, "headers": headers, "json": json})
                return FakeResponse()

        with (
            patch.object(bid_outline_knowledge, "get_dataset_api_base_url", return_value="http://dify.local/v1"),
            patch.object(bid_outline_knowledge, "get_dataset_api_key", return_value="dataset-key"),
            patch.object(bid_outline_knowledge, "get_default_dataset_id", return_value="default-dataset"),
            patch.dict(bid_outline_knowledge.os.environ, {"BID_OUTLINE_DATASET_ID": "outline-dataset"}, clear=False),
            patch.object(bid_outline_knowledge.httpx, "AsyncClient", return_value=FakeClient()),
        ):
            text = await bid_outline_knowledge.retrieve_outline_knowledge("总体架构", top_k=2)

        assert text == "知识片段一\n\n知识片段二"
        assert calls[0]["url"] == "http://dify.local/v1/datasets/outline-dataset/retrieve"
        payload = calls[0]["json"]
        assert payload["query"] == "总体架构"
        assert payload["retrieval_model"]["top_k"] == 2
        assert payload["retrieval_model"]["reranking_enable"] is False
        assert calls[0]["headers"]["Authorization"] == "Bearer dataset-key"

    asyncio.run(run_case())


def test_bid_outline_llm_config_reuses_dashscope_env_when_specific_env_missing() -> None:
    with patch.dict(
        pipeline.os.environ,
        {
            "BID_OUTLINE_LLM_BASE_URL": "",
            "BID_OUTLINE_LLM_API_KEY": "",
            "BID_OUTLINE_LLM_MODEL": "",
            "DIFY_TONGYI_DASHSCOPE_API_KEY": "dashscope-key",
        },
        clear=False,
    ):
        config = get_bid_outline_llm_config("review")

    assert config.base_url == "https://dashscope.aliyuncs.com/compatible-mode/v1"
    assert config.api_key == "dashscope-key"
    assert config.model == "qwen3.6-flash"
    assert config.temperature == 0.15
    assert config.top_p == 0.7
    assert config.enable_thinking is False


def test_bid_outline_draft_llm_config_matches_dsl_defaults() -> None:
    with patch.dict(
        pipeline.os.environ,
        {
            "BID_OUTLINE_LLM_BASE_URL": "",
            "BID_OUTLINE_LLM_API_KEY": "",
            "BID_OUTLINE_LLM_MODEL": "",
            "BID_OUTLINE_LLM_TEMPERATURE": "",
            "DIFY_TONGYI_DASHSCOPE_API_KEY": "dashscope-key",
            "DIFY_TONGYI_DASHSCOPE_MODEL": "qwen3.6-flash",
        },
        clear=False,
    ):
        config = get_bid_outline_llm_config("draft")

    assert config.base_url == "https://dashscope.aliyuncs.com/compatible-mode/v1"
    assert config.api_key == "dashscope-key"
    assert config.model == "Kimi-K2.5"
    assert config.temperature == 0.2
    assert config.top_p == 0.7
    assert config.enable_thinking is True


def test_bid_model_manifest_records_outline_dsl_models() -> None:
    draft_node = get_bid_model_node("ProEngine_Structure_Generate", "outline_draft")
    review_node = get_bid_model_node("ProEngine_Structure_Generate", "outline_review")
    draft_params = get_bid_model_completion_params("ProEngine_Structure_Generate", "outline_draft")
    review_params = get_bid_model_completion_params("ProEngine_Structure_Generate", "outline_review")

    assert draft_node["default_model"] == "Kimi-K2.5"
    assert draft_node["env_prefix"] == "BID_OUTLINE_DRAFT_LLM"
    assert draft_params["enable_thinking"] is True
    assert draft_params["temperature"] == 0.2
    assert draft_params["top_p"] == 0.7
    assert review_node["default_model"] == "qwen3.6-flash"
    assert review_node["env_prefix"] == "BID_OUTLINE_REVIEW_LLM"
    assert review_params["enable_thinking"] is False
    assert review_params["temperature"] == 0.15
    assert review_params["top_p"] == 0.7


def test_bid_outline_llm_config_specific_env_takes_precedence() -> None:
    with patch.dict(
        pipeline.os.environ,
        {
            "BID_OUTLINE_LLM_BASE_URL": "https://relay.local/v1",
            "BID_OUTLINE_LLM_API_KEY": "outline-key",
            "BID_OUTLINE_LLM_MODEL": "outline-model",
            "DIFY_TONGYI_DASHSCOPE_API_KEY": "dashscope-key",
        },
        clear=False,
    ):
        config = get_bid_outline_llm_config("review")

    assert config.base_url == "https://relay.local/v1"
    assert config.api_key == "outline-key"
    assert config.model == "outline-model"


def test_bid_outline_lifecycle_specific_env_takes_precedence() -> None:
    with patch.dict(
        pipeline.os.environ,
        {
            "BID_OUTLINE_LLM_BASE_URL": "https://shared.local/v1",
            "BID_OUTLINE_LLM_API_KEY": "shared-key",
            "BID_OUTLINE_LLM_MODEL": "",
            "BID_OUTLINE_DRAFT_LLM_BASE_URL": "https://draft.local/v1",
            "BID_OUTLINE_DRAFT_LLM_API_KEY": "draft-key",
            "BID_OUTLINE_DRAFT_LLM_MODEL": "Kimi-K2.5",
            "BID_OUTLINE_REVIEW_LLM_MODEL": "qwen3.6-flash",
        },
        clear=False,
    ):
        draft = get_bid_outline_llm_config("draft")
        review = get_bid_outline_llm_config("review")

    assert draft.base_url == "https://draft.local/v1"
    assert draft.api_key == "draft-key"
    assert draft.model == "Kimi-K2.5"
    assert review.base_url == "https://shared.local/v1"
    assert review.api_key == "shared-key"
    assert review.model == "qwen3.6-flash"


def test_bid_outline_chat_payload_keeps_dsl_generation_params() -> None:
    async def run_case() -> None:
        calls: list[dict[str, object]] = []

        class FakeResponse:
            status_code = 200
            text = ""

            def json(self) -> dict[str, object]:
                return {"choices": [{"message": {"content": "{\"outline\": []}"}}]}

            def raise_for_status(self) -> None:
                return None

        class FakeClient:
            def __init__(self, *args, **kwargs) -> None:
                return None

            async def __aenter__(self) -> "FakeClient":
                return self

            async def __aexit__(self, exc_type, exc, tb) -> None:
                return None

            async def post(self, url: str, *, headers: dict[str, str], json: dict[str, object]) -> FakeResponse:
                calls.append({"url": url, "headers": headers, "json": json})
                return FakeResponse()

        with (
            patch.dict(
                pipeline.os.environ,
                {
                    "BID_OUTLINE_LLM_BASE_URL": "https://relay.local/v1",
                    "BID_OUTLINE_LLM_API_KEY": "outline-key",
                    "BID_OUTLINE_LLM_MODEL": "",
                    "BID_OUTLINE_LLM_TOP_P": "",
                    "BID_OUTLINE_DRAFT_LLM_MODEL": "Kimi-K2.5",
                },
                clear=False,
            ),
            patch("app.services.bid_outline_llm.httpx.AsyncClient", FakeClient),
        ):
            client = BidOutlineLlmClient(purpose="draft")
            parsed = await client.chat_json([{"role": "user", "content": "x"}])

        assert parsed == {"outline": []}
        payload = calls[0]["json"]
        assert payload["model"] == "Kimi-K2.5"
        assert payload["temperature"] == 0.2
        assert payload["top_p"] == 0.7
        assert payload["enable_thinking"] is True
        assert payload["response_format"] == {"type": "json_object"}

    asyncio.run(run_case())
