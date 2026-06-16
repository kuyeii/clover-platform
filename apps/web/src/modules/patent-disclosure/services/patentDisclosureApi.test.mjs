import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const serviceSource = await readFile(new URL("./patentDisclosureApi.ts", import.meta.url), "utf8");
const pageSource = await readFile(new URL("../PatentDisclosurePage.tsx", import.meta.url), "utf8");
const createPanelSource = await readFile(new URL("../components/CaseCreatePanel.tsx", import.meta.url), "utf8");
const artifactListSource = await readFile(new URL("../components/ArtifactDownloadList.tsx", import.meta.url), "utf8");
const progressPanelSource = await readFile(new URL("../components/JobSseProgressPanel.tsx", import.meta.url), "utf8");

test("patent disclosure API prefix and health endpoint match Stage 10-G", () => {
  assert.match(serviceSource, /PATENT_DISCLOSURE_API_PREFIX = "\/patent-disclosure\/api"/);
  assert.match(serviceSource, /fetchPatentDisclosureHealth/);
  assert.match(serviceSource, /\/health/);
});

test("patent disclosure progress uses authenticated fetch stream without URL token", () => {
  assert.doesNotMatch(serviceSource, /new EventSource\(/);
  assert.doesNotMatch(serviceSource, /access_token/);
  assert.match(serviceSource, /apiClient\.raw\("GET", path/);
  assert.match(serviceSource, /Accept: "text\/event-stream"/);
  assert.match(serviceSource, /AbortController/);
  assert.doesNotMatch(pageSource, /setInterval\s*\(/);
  assert.doesNotMatch(serviceSource, /setInterval\s*\(/);
});

test("patent disclosure progress log merges duplicate phase updates", () => {
  assert.match(pageSource, /function mergeProgressEvent/);
  assert.match(pageSource, /getProgressEventKey\(latest\) === getProgressEventKey\(event\)/);
  assert.doesNotMatch(pageSource, /setEvents\(\(current\) => \[\.\.\.current,\s*event\]/);
});

test("patent disclosure generation is disabled by health status", () => {
  assert.match(pageSource, /getHealthBlockReason/);
  assert.match(pageSource, /fetchPatentDisclosureHealth/);
  assert.match(pageSource, /disabledReason=\{healthBlockReason\}/);
  assert.match(createPanelSource, /disabledReason/);
});

test("patent disclosure upload copy advertises zip code repositories", () => {
  assert.match(createPanelSource, /\.zip 代码仓库/);
});

test("patent disclosure workflow maps backend generation steps to visible milestones", () => {
  assert.match(progressPanelSource, /build_disclosure/);
  assert.match(progressPanelSource, /export_docx/);
  assert.match(progressPanelSource, /\[\.\.\.events\]\s*\n\s*\.reverse\(\)/);
  assert.match(progressPanelSource, /latest\?\.message \|\| job\?\.message \|\| currentStep/);
});

test("patent disclosure revision posts user instruction and reuses job stream", () => {
  assert.match(serviceSource, /startPatentDisclosureRevision/);
  assert.match(serviceSource, /\/revise/);
  assert.match(serviceSource, /revisionInstruction/);
  assert.match(pageSource, /生成修订版/);
  assert.match(pageSource, /connectJobStream\(nextJob\.id, caseId\)/);
});

test("patent disclosure revision keeps document preview interactive while progress updates", () => {
  assert.match(pageSource, /isRevisionJob = job\?\.jobType === "revise_disclosure"/);
  assert.match(pageSource, /isGenerateJob = !job\?\.jobType \|\| job\.jobType === "generate_disclosure"/);
  assert.match(pageSource, /isGeneratingDisclosurePreview = !isRevising && !isRevisionJob/);
  assert.match(pageSource, /isBusy=\{isGeneratingDisclosurePreview && isLatestVersionSelected\}/);
  assert.doesNotMatch(pageSource, /isBusy=\{isTaskRunning && isLatestVersionSelected\}/);
  const reviseBody = pageSource.match(/async function handleRevise[\s\S]*?\n  }\n\n  function handleNewCase/)?.[0] || "";
  assert.doesNotMatch(reviseBody, /setIsGenerating\(true\)/);
});

test("patent disclosure artifacts support latest and all-version result views", () => {
  assert.match(serviceSource, /encodeURIComponent\(options\.scope\)/);
  assert.match(pageSource, /buildDisclosureVersions/);
  assert.match(pageSource, /下载 DOCX/);
  assert.match(pageSource, /查看全部文件/);
  assert.match(artifactListSource, /最终 Markdown 和 Word 文件/);
});

test("patent disclosure preview hides delivery metadata from generated documents", () => {
  assert.match(pageSource, /stripDisclosureDeliveryMetadataFromPreview/);
  assert.match(pageSource, /DISCLOSURE_DELIVERY_MARKERS/);
  assert.match(pageSource, /交付文件路径/);
  assert.match(pageSource, /若您希望权利要求\/保护点表述/);
  const previewRenderBody = pageSource.match(/await renderAsync[\s\S]*?setPreviewState\("ready"\)/)?.[0] || "";
  assert.match(previewRenderBody, /stripDisclosureDeliveryMetadataFromPreview\(previewRef\.current\)/);
});

test("patent disclosure UI only exposes supported job workflows", () => {
  const combined = `${serviceSource}\n${pageSource}\n${createPanelSource}`;
  assert.doesNotMatch(combined, /\/cancel\b|cancelJob|取消任务/);
  assert.doesNotMatch(combined, /\/iterate\b|iterateDisclosure|迭代修订/);
});
