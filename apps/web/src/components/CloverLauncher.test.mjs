import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const launcherSource = readFileSync(resolve(currentDir, "CloverLauncher.tsx"), "utf8");

test("workspace launcher app grid fills the available width", () => {
  assert.match(
    launcherSource,
    /className="[^"]*\bgrid\b[^"]*\bh-full\b[^"]*\bw-full\b[^"]*\bmd:grid-cols-2\b[^"]*"/,
  );
});

test("workspace launcher uses fixed clover pages instead of rendering every app at once", () => {
  assert.match(launcherSource, /const pageAppIds = \[/);
  assert.match(launcherSource, /"bid-generator", "contract-review", "competitor-analysis", "rag-web-search"/);
  assert.match(launcherSource, /"contract-review", "patent-disclosure", "rag-web-search"/);
  assert.doesNotMatch(launcherSource, /\{apps\.map\(\(app,\s*index\)/);
});

test("workspace launcher exposes bid reference sites as a static launcher item", () => {
  assert.match(launcherSource, /id: "bid-reference-sites"/);
  assert.match(launcherSource, /route: "\/bid-reference-sites"/);
  assert.match(launcherSource, /type: "reference-sites"/);
  assert.match(launcherSource, /ctaLabel: "进入应用"/);
});

test("workspace launcher uses a consistent app CTA and sliding page transition", () => {
  assert.match(launcherSource, /ctaLabelOverride="进入应用"/);
  assert.match(launcherSource, /x: direction > 0 \? "100%" : "-100%"/);
  assert.match(launcherSource, /x: direction > 0 \? "-100%" : "100%"/);
  assert.match(launcherSource, /<AnimatePresence initial=\{false\} custom=\{direction\}>/);
  assert.match(launcherSource, /className="[^"]*\boverflow-hidden\b[^"]*"/);
  assert.match(launcherSource, /className="[^"]*\babsolute\b[^"]*\binset-0\b[^"]*\bgrid\b[^"]*\bh-full\b[^"]*\bw-full\b[^"]*"/);
  assert.match(launcherSource, /style=\{\{ willChange: "transform" \}\}/);
  assert.match(launcherSource, /initial=\{false\}/);
  assert.doesNotMatch(launcherSource, /mode="wait"/);
});

test("workspace launcher includes numbered page controls in the lower right", () => {
  assert.match(launcherSource, /pages\.map\(\(_, index\)/);
  assert.match(launcherSource, /\{index \+ 1\}/);
  assert.match(launcherSource, /justify-end/);
  assert.match(launcherSource, /aria-current=\{pageIndex === index \? "page" : undefined\}/);
  assert.match(launcherSource, /goToNextPage/);
  assert.match(launcherSource, /goToPreviousPage/);
  assert.doesNotMatch(launcherSource, /top-1\/2/);
  assert.doesNotMatch(launcherSource, /translate-x-1\/2/);
});
