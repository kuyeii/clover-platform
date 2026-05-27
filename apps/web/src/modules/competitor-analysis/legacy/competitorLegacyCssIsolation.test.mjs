import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const globalCssPath = resolve(currentDir, "../../../styles/global.css");

const LEGACY_INTERNAL_CLASSES = [
  "analysis-form",
  "analysis-form-grid",
  "company-overview",
  "competitor-card",
  "competitor-grid-native",
  "competitor-home",
  "competitor-results",
  "competitor-section",
  "competitor-shell",
  "competitor-sidebar",
  "details-panel",
  "history-entry",
  "tabbar",
];

function extractSelectors(cssText) {
  const withoutComments = cssText.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutComments
    .split("{")
    .slice(0, -1)
    .flatMap((chunk) => {
      const selectorGroup = chunk.slice(chunk.lastIndexOf("}") + 1).trim();
      if (!selectorGroup || selectorGroup.startsWith("@")) {
        return [];
      }
      return selectorGroup
        .split(",")
        .map((selector) => selector.trim())
        .filter(Boolean);
    });
}

test("global CSS does not style competitor legacy internals directly", () => {
  const selectors = extractSelectors(readFileSync(globalCssPath, "utf8"));
  const leakedSelectors = selectors.filter((selector) =>
    LEGACY_INTERNAL_CLASSES.some((className) => selector.includes(`.${className}`)),
  );

  assert.deepEqual(leakedSelectors, []);
});
