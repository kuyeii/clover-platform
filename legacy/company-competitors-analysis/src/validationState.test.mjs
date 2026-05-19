import test from "node:test";
import assert from "node:assert/strict";
import {
  getValidationPendingLabel,
  getValidationStatusIconType,
  shouldShowValidationDropdown,
  shouldShowValidationPendingStatus
} from "./validationState.js";

test("typing state waits for input completion without opening dropdown loading", () => {
  assert.equal(getValidationPendingLabel("waiting"), "等待用户输入完成");
  assert.equal(getValidationStatusIconType("waiting"), "warning");
  assert.equal(shouldShowValidationPendingStatus("waiting", "南湖实验室"), true);
  assert.equal(
    shouldShowValidationDropdown({
      showDropdown: true,
      keyword: "南湖实验室",
      isValidated: false,
      validationState: "waiting"
    }),
    false
  );
});

test("loading state shows original spinner and dropdown while workflow is running", () => {
  assert.equal(getValidationPendingLabel("loading"), "检索中");
  assert.equal(getValidationStatusIconType("loading"), "loading");
  assert.equal(shouldShowValidationPendingStatus("loading", "南湖实验室"), true);
  assert.equal(
    shouldShowValidationDropdown({
      showDropdown: true,
      keyword: "南湖实验室",
      isValidated: false,
      validationState: "loading"
    }),
    true
  );
});
