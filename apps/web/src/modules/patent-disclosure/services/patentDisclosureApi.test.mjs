import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const serviceSource = await readFile(new URL("./patentDisclosureApi.ts", import.meta.url), "utf8");
const pageSource = await readFile(new URL("../PatentDisclosurePage.tsx", import.meta.url), "utf8");
const generatePanelSource = await readFile(new URL("../components/GenerateSettingsPanel.tsx", import.meta.url), "utf8");

test("patent disclosure API prefix and health endpoint match Stage 10-G", () => {
  assert.match(serviceSource, /PATENT_DISCLOSURE_API_PREFIX = "\/patent-disclosure\/api"/);
  assert.match(serviceSource, /fetchPatentDisclosureHealth/);
  assert.match(serviceSource, /\/health/);
});

test("patent disclosure progress uses EventSource without task polling", () => {
  assert.match(serviceSource, /new EventSource\(/);
  assert.doesNotMatch(pageSource, /setInterval\s*\(/);
  assert.doesNotMatch(serviceSource, /setInterval\s*\(/);
});

test("patent disclosure generation is disabled by health status", () => {
  assert.match(pageSource, /getHealthBlockReason/);
  assert.match(pageSource, /fetchPatentDisclosureHealth/);
  assert.match(pageSource, /Boolean\(healthBlockReason\)/);
  assert.match(generatePanelSource, /disabledReason/);
});

test("patent disclosure UI does not expose unsupported workflows", () => {
  const combined = `${serviceSource}\n${pageSource}\n${generatePanelSource}`;
  assert.doesNotMatch(combined, /\/cancel\b|cancelJob|取消任务/);
  assert.doesNotMatch(combined, /\/preview\b|previewArtifact|在线预览/);
  assert.doesNotMatch(combined, /\/iterate\b|iterateDisclosure|迭代修订/);
});
