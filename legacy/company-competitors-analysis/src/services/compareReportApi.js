import { requestJson } from "./analysisApi";

export async function runCompareReportWorkflow(input) {
  return requestJson("/api/workflows/compare-report", {
    method: "POST",
    body: JSON.stringify(input)
  });
}
