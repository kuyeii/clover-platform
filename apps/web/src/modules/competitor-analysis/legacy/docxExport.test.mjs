import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(currentDir, "docxExport.ts"), "utf8")
  .replace(/export function /g, "function ");

const { parseMarkdownBlocks, createDocxFromMarkdown } = new Function(`
${source}
return { parseMarkdownBlocks, createDocxFromMarkdown };
`)();

function decodeDocx(bytes) {
  return new TextDecoder().decode(bytes);
}

test("docx markdown parser recognizes explicit page break markers", () => {
  const blocks = parseMarkdownBlocks([
    "# 竞对分析报告",
    "",
    "### 企业 A",
    "报告 A",
    "",
    "<!-- page-break -->",
    "",
    "### 企业 B",
    "报告 B",
  ].join("\n"));

  assert.deepEqual(
    blocks.map((block) => block.type),
    ["h1", "h3", "p", "pageBreak", "h3", "p"],
  );
});

test("docx export writes Word page break XML for explicit markers", () => {
  const docxText = decodeDocx(createDocxFromMarkdown([
    "### 企业 A",
    "报告 A",
    "",
    "<!-- page-break -->",
    "",
    "### 企业 B",
    "报告 B",
  ].join("\n")));

  assert.match(docxText, /<w:br w:type="page"\/>/);
});

test("docx export does not write page breaks when marker is absent", () => {
  const docxText = decodeDocx(createDocxFromMarkdown([
    "### 企业 A",
    "报告 A",
  ].join("\n")));

  assert.doesNotMatch(docxText, /<w:br w:type="page"\/>/);
});
