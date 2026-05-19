import threading
import unittest

import backend.server as server


class ParallelWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.original_run_company_detail_workflow = server.run_company_detail_workflow
        self.original_as_completed = server.as_completed

    def tearDown(self):
        server.run_company_detail_workflow = self.original_run_company_detail_workflow
        server.as_completed = self.original_as_completed

    def test_company_detail_workflows_start_together(self):
        competitors = [
            {"id": "c1", "name": "竞品一", "intro": "竞品一介绍"},
            {"id": "c2", "name": "竞品二", "intro": "竞品二介绍"},
            {"id": "c3", "name": "竞品三", "intro": "竞品三介绍"},
        ]
        barrier = threading.Barrier(len(competitors) + 1)
        entered_names = []
        entered_names_lock = threading.Lock()

        def fake_company_detail_workflow(companyName="", **_):
            with entered_names_lock:
                entered_names.append(companyName)
            barrier.wait(timeout=3)
            return {"data": {"product": f"{companyName} 产品", "tech": f"{companyName} 技术", "lately": f"{companyName} 动态"}}

        server.run_company_detail_workflow = fake_company_detail_workflow

        target_detail, competitor_details, target_error = server.load_analysis_company_details(
            target_name="我方企业",
            current_target_info={"intro": "我方介绍", "business": "我方业务"},
            current_competitors=competitors,
        )

        self.assertEqual(target_error, "")
        self.assertEqual(target_detail["product"], "我方企业 产品")
        self.assertEqual(set(entered_names), {"我方企业", "竞品一", "竞品二", "竞品三"})
        self.assertEqual(
            {key: value["status"] for key, value in competitor_details.items()},
            {"c1": "success", "c2": "success", "c3": "success"},
        )
        self.assertEqual(competitor_details["c2"]["data"]["tech"], "竞品二 技术")

    def test_company_detail_workflow_errors_are_preserved(self):
        competitors = [
            {"id": "c1", "name": "竞品一", "intro": "竞品一介绍"},
            {"id": "c2", "name": "竞品二", "intro": "竞品二介绍"},
        ]
        emitted_target = []
        emitted_competitors = []

        def fake_company_detail_workflow(companyName="", **_):
            if companyName == "我方企业":
                raise server.AppError("目标详情失败")
            if companyName == "竞品二":
                raise RuntimeError("竞品二详情失败")
            return {"data": {"product": f"{companyName} 产品"}}

        server.run_company_detail_workflow = fake_company_detail_workflow

        target_detail, competitor_details, target_error = server.load_analysis_company_details(
            target_name="我方企业",
            current_target_info={"intro": "我方介绍", "business": "我方业务"},
            current_competitors=competitors,
            on_target_detail=lambda detail, error: emitted_target.append((detail, error)),
            on_competitor_detail=lambda competitor_id, detail: emitted_competitors.append((competitor_id, detail)),
        )

        self.assertIsNone(target_detail)
        self.assertEqual(target_error, "目标详情失败")
        self.assertEqual(emitted_target, [(None, "目标详情失败")])
        self.assertEqual(competitor_details["c1"]["status"], "success")
        self.assertEqual(competitor_details["c2"], {"status": "error", "data": None, "error": "竞品二详情失败"})
        self.assertEqual(
            dict(emitted_competitors),
            {
                "c1": {"status": "success", "data": {"product": "竞品一 产品"}, "error": ""},
                "c2": {"status": "error", "data": None, "error": "竞品二详情失败"},
            },
        )

    def test_callbacks_emit_target_before_competitors_when_competitors_complete_first(self):
        competitors = [
            {"id": "c1", "name": "竞品一", "intro": "竞品一介绍"},
            {"id": "c2", "name": "竞品二", "intro": "竞品二介绍"},
        ]
        callback_order = []

        def fake_company_detail_workflow(companyName="", **_):
            return {"data": {"product": f"{companyName} 产品"}}

        def competitors_first(futures):
            return list(reversed(list(futures)))

        server.run_company_detail_workflow = fake_company_detail_workflow
        server.as_completed = competitors_first

        server.load_analysis_company_details(
            target_name="我方企业",
            current_target_info={"intro": "我方介绍", "business": "我方业务"},
            current_competitors=competitors,
            on_target_detail=lambda *_: callback_order.append("target"),
            on_competitor_detail=lambda competitor_id, _: callback_order.append(competitor_id),
        )

        self.assertEqual(callback_order[0], "target")
        self.assertEqual(set(callback_order[1:]), {"c1", "c2"})


if __name__ == "__main__":
    unittest.main()
