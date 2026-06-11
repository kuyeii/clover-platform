export function shouldBlockProjectNavigation(activeProjectId, busyProjectIds) {
  if (!activeProjectId) return false;
  return Array.isArray(busyProjectIds) && busyProjectIds.includes(activeProjectId);
}
