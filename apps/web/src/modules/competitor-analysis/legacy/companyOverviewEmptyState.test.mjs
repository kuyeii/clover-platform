import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(resolve(currentDir, "App.tsx"), "utf8");

test("company overview does not fall back to demo news items", () => {
  assert.equal(appSource.includes("DEMO_TARGET_DETAIL"), false);
  assert.equal(appSource.includes("DEMO_COMPETITORS"), false);
  assert.equal(appSource.includes("buildDemo"), false);
  assert.equal(appSource.includes("演示数据"), false);
});

test("company overview renders an empty recent-news state", () => {
  assert.match(appSource, /Array\.isArray\(targetDetail\?\.latelyItems\) \? targetDetail\.latelyItems : \[\]/);
  assert.match(appSource, /暂无近期动态。/);
});
