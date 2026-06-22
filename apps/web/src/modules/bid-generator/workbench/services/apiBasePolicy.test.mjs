import test from "node:test";
import assert from "node:assert/strict";
import { shouldUseLegacyFallbackTarget } from "./apiBasePolicy.js";

test("bid generator legacy fallback is disabled in top-level unified frontend mode", () => {
  assert.equal(shouldUseLegacyFallbackTarget(true), false);
});

test("bid generator legacy fallback remains available outside top-level unified frontend mode", () => {
  assert.equal(shouldUseLegacyFallbackTarget(false), true);
});
