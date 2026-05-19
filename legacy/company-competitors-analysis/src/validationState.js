export function getValidationPendingLabel(validationState) {
  if (validationState === "waiting") return "等待用户输入完成";
  if (validationState === "fetching") return "正在获取企业信息";
  if (validationState === "loading") return "检索中";
  return "待确认";
}

export function getValidationStatusIconType(validationState) {
  return validationState === "loading" || validationState === "fetching" ? "loading" : "warning";
}

export function shouldShowValidationPendingStatus(validationState, keyword) {
  return Boolean(String(keyword || "").trim()) && ["waiting", "loading", "ready", "error", "fetching"].includes(validationState);
}

export function shouldShowValidationDropdown({ showDropdown, keyword, isValidated, validationState }) {
  return Boolean(showDropdown && keyword && !isValidated && !["waiting", "fetching"].includes(validationState));
}
