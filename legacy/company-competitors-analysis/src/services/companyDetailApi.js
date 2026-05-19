import { requestJson } from "./analysisApi";

export async function runCompanyDetailWorkflow(input) {
  return requestJson("/api/workflows/company-detail", {
    method: "POST",
    body: JSON.stringify(input)
  });
}
