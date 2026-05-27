import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const launcherSource = readFileSync(resolve(currentDir, "CloverLauncher.tsx"), "utf8");

test("workspace launcher app grid fills the available width", () => {
  assert.match(launcherSource, /className="[^"]*\bw-full\b[^"]*"/);
  assert.doesNotMatch(launcherSource, /\bmax-w-\w+/);
});
