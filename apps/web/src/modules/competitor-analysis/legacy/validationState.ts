// @ts-nocheck
export function getValidationPendingLabel(validationState) {
  if (validationState === "refreshing") return "正在重新匹配...";
  if (validationState === "waiting") return "正在重新匹配...";
  if (validationState === "localSearching") return "正在匹配本地企业";
  if (validationState === "localEmpty") return "准备联网查找";
  if (validationState === "webSearching") return "正在联网查找";
  if (validationState === "fetching") return "正在获取企业信息";
  if (validationState === "loading") return "检索中";
  return "待确认";
}

export function getValidationStatusIconType(validationState) {
  return ["loading", "fetching", "refreshing", "localSearching", "localEmpty", "webSearching"].includes(validationState) ? "loading" : "warning";
}

export function shouldShowValidationPendingStatus(validationState, keyword) {
  return Boolean(String(keyword || "").trim()) && [
    "waiting",
    "loading",
    "ready",
    "error",
    "fetching",
    "refreshing",
    "localSearching",
    "localMatched",
    "localEmpty",
    "webSearching",
    "webMatched",
    "empty"
  ].includes(validationState);
}

export function shouldShowValidationDropdown({ showDropdown, keyword, isValidated, validationState }) {
  return Boolean(showDropdown && keyword && !isValidated && validationState !== "fetching");
}
