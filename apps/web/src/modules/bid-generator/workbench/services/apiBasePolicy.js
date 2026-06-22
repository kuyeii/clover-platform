export function shouldUseLegacyFallbackTarget(isTopLevelWindow) {
  return !isTopLevelWindow;
}
