import { requestJson } from "./analysisApi";

export async function runScoreWorkflow(input) {
  return requestJson("/api/workflows/score", {
    method: "POST",
    body: JSON.stringify(input)
  });
}
