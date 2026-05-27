import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildContractReviewApiUrl,
  buildContractReviewFallbackHeaders,
  resolveContractReviewApiBaseForRuntime,
} from "./contractReviewApiPaths.js";

const nativeContractSource = await readFile(new URL("../../services/contractReviewApi.ts", import.meta.url), "utf8");
const ragSource = await readFile(new URL("../../../rag/services/ragApi.ts", import.meta.url), "utf8");
const competitorSource = await readFile(new URL("../../../competitor-analysis/services/competitorApi.ts", import.meta.url), "utf8");
const bidSource = await readFile(new URL("../../../bid-generator/services/bidGeneratorApi.ts", import.meta.url), "utf8");

test("contract review legacy fallback maps platform base to module entrypoint exactly once", () => {
  assert.equal(resolveContractReviewApiBaseForRuntime("/api/v1"), "/api/v1/contract-review");
  assert.equal(resolveContractReviewApiBaseForRuntime("/api/v1/contract-review"), "/api/v1/contract-review");
  assert.equal(resolveContractReviewApiBaseForRuntime("/api/v1/contract-review/api"), "/api/v1/contract-review");
  assert.equal(resolveContractReviewApiBaseForRuntime("http://127.0.0.1:5220/api/v1"), "http://127.0.0.1:5220/api/v1/contract-review");
  assert.equal(
    resolveContractReviewApiBaseForRuntime("http://127.0.0.1:5220/api/v1/contract-review"),
    "http://127.0.0.1:5220/api/v1/contract-review",
  );
  assert.equal(
    resolveContractReviewApiBaseForRuntime("http://127.0.0.1:5220/api/v1/contract-review/api"),
    "http://127.0.0.1:5220/api/v1/contract-review",
  );
});

test("contract review legacy fallback keeps standalone legacy backend bases unchanged", () => {
  assert.equal(resolveContractReviewApiBaseForRuntime("http://127.0.0.1:18125"), "http://127.0.0.1:18125");
});

test("contract review start-review URL targets apps/api business route", () => {
  assert.equal(buildContractReviewApiUrl("/api/v1", "/api/reviews"), "/api/v1/contract-review/api/reviews");
  assert.equal(
    buildContractReviewApiUrl("http://127.0.0.1:5220/api/v1", "/api/reviews"),
    "http://127.0.0.1:5220/api/v1/contract-review/api/reviews",
  );
});

test("contract review fallback headers include session token and client id", () => {
  assert.deepEqual(buildContractReviewFallbackHeaders("session-token", "client-id"), {
    Authorization: "Bearer session-token",
    "X-Portal-Client-Id": "client-id",
  });
  assert.deepEqual(buildContractReviewFallbackHeaders("", "client-id"), {
    "X-Portal-Client-Id": "client-id",
  });
});

test("native module API prefixes match stage 10-H spec", () => {
  assert.match(nativeContractSource, /CONTRACT_REVIEW_API_PREFIX = "\/contract-review\/api"/);
  assert.match(ragSource, /RAG_API_PREFIX = "\/rag\/api\/v1"/);
  assert.match(competitorSource, /API_PREFIX = "\/competitor-analysis\/api"/);
  assert.match(bidSource, /API_PREFIX = "\/bid-generator\/api"/);
  assert.match(bidSource, /apiClient\.get<\{ status\?: string; service\?: string \}>\("\/bid-generator\/health"/);
});
