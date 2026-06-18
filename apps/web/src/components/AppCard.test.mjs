import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const appCardSource = readFileSync(resolve(currentDir, "AppCard.tsx"), "utf8");

test("app card requires confirmation when a module has any active usage", () => {
  assert.match(appCardSource, /if\s*\(\s*usage\.inUse\s*\)\s*{\s*onRequestOccupiedEntry\?\.\(app\)/s);
  assert.doesNotMatch(appCardSource, /if\s*\(\s*usage\.inUseByOthers\s*\)/s);
  assert.doesNotMatch(appCardSource, /<AppEntryConfirmDialog/s);
});
