import { requestJson } from "./analysisApi";

const companyValidationCache = new Map();
const companyValidationCacheRequests = new Map();

function normalizeCompanyCacheKey(input) {
  return String(
    input?.companyName ||
    input?.targetCompanyName ||
    input?.competitorCompanyName ||
    ""
  ).trim().toLowerCase();
}

function hasCompanyValidationCacheContent(payload) {
  const company = payload?.company || {};
  return Boolean(
    payload?.cacheHit ||
    company?.intro ||
    company?.business ||
    (Array.isArray(payload?.candidateItems) && payload.candidateItems.length)
  );
}

function rememberCompanyValidationPayload(input, payload) {
  const key = normalizeCompanyCacheKey(input);
  if (!key || !hasCompanyValidationCacheContent(payload)) return;
  companyValidationCache.set(key, payload);
}

export async function runInputValidationWorkflow(input) {
  return requestJson("/api/workflows/validate", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function runCompanyNameValidationWorkflow(input) {
  const payload = await requestJson("/api/workflows/company-name-validate", {
    method: "POST",
    body: JSON.stringify(input)
  });
  rememberCompanyValidationPayload(input, payload);
  if (input?.sourceQuery) {
    rememberCompanyValidationPayload({ companyName: input.sourceQuery }, payload);
  }
  return payload;
}


export async function lookupCompanyNameValidationCache(input) {
  const key = normalizeCompanyCacheKey(input);
  if (key && companyValidationCache.has(key)) {
    return companyValidationCache.get(key);
  }
  if (key && companyValidationCacheRequests.has(key)) {
    return companyValidationCacheRequests.get(key);
  }
  const request = requestJson("/api/workflows/company-name-validate", {
    method: "POST",
    body: JSON.stringify({ ...(input || {}), cacheOnly: true })
  })
    .then((payload) => {
      rememberCompanyValidationPayload(input, payload);
      return payload;
    })
    .finally(() => {
      if (key) companyValidationCacheRequests.delete(key);
    });
  if (key) companyValidationCacheRequests.set(key, request);
  return request;
}
