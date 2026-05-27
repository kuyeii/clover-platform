import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const portalSource = readFileSync(resolve(currentDir, "portal.ts"), "utf8");

test("leave-all beacon targets the configured platform API base", () => {
  assert.doesNotMatch(portalSource, /window\.location\.origin.*leave-all-beacon/s);
  assert.match(portalSource, /getPlatformCoreApiBaseUrl\(\).*leave-all-beacon/s);
});
