// @ts-nocheck
const APP_ROUTE_PREFIX = "/apps/competitor-analysis";
const HOME_ROUTE = APP_ROUTE_PREFIX;
const RESULT_ROUTE_PREFIX = "results";
const RESERVED_SINGLE_SEGMENTS = new Set(["", "index.html", "favicon.ico", "hero-analysis-icon.png"]);
const RESERVED_PREFIXES = new Set(["api", "assets", "src", "node_modules", "@vite", "@react-refresh"]);

function getBrowserLocation() {
  return typeof window === "undefined" ? { pathname: HOME_ROUTE } : window.location;
}

function normalizePathname(pathname = HOME_ROUTE) {
  return String(pathname || HOME_ROUTE).replace(/^\/+|\/+$/g, "");
}

function getSearchParams(location = getBrowserLocation()) {
  return new URLSearchParams(location.search || "");
}

function decodePathSegment(segment = "") {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function isLegacyResultPath(rawPath) {
  const firstSegment = rawPath.split("/")[0] || "";
  return !RESERVED_SINGLE_SEGMENTS.has(rawPath) && !RESERVED_PREFIXES.has(firstSegment) && !rawPath.includes("/");
}

function buildQuery(options = {}) {
  const params = new URLSearchParams();
  const mode = options.mode === "exact" ? "exact" : "";
  const tab = String(options.tab || "").trim();
  const competitorId = String(options.competitorId || "").trim();

  if (mode) params.set("mode", mode);
  if (tab) params.set("tab", tab);
  if (competitorId) params.set("competitor", competitorId);

  const text = params.toString();
  return text ? `?${text}` : "";
}

export function parseAppRoute(location = getBrowserLocation()) {
  const pathname = String(location.pathname || HOME_ROUTE);
  const relativePath = pathname.startsWith(APP_ROUTE_PREFIX)
    ? pathname.slice(APP_ROUTE_PREFIX.length) || "/"
    : pathname;
  const rawPath = normalizePathname(relativePath);
  const segments = rawPath ? rawPath.split("/") : [];
  const params = getSearchParams(location);
  const mode = params.get("mode") === "exact" ? "exact" : "auto";

  if (RESERVED_SINGLE_SEGMENTS.has(rawPath)) {
    return { page: "home", mode };
  }

  if (segments[0] === RESULT_ROUTE_PREFIX && segments.length === 2 && segments[1]) {
    return {
      page: "results",
      resultId: decodePathSegment(segments[1]),
      competitorId: params.get("competitor") || "",
      tab: params.get("tab") || "",
      mode: "auto"
    };
  }

  // Backward compatibility for old shared URLs shaped as /{result_id}.
  if (isLegacyResultPath(rawPath)) {
    return {
      page: "results",
      resultId: decodePathSegment(rawPath),
      competitorId: params.get("competitor") || "",
      tab: params.get("tab") || "",
      mode: "auto"
    };
  }

  return { page: "home", mode };
}

export function getRouteResultId(location = getBrowserLocation()) {
  const route = parseAppRoute(location);
  return route.page === "results" ? route.resultId : "";
}

export function buildHomeRoute(options = {}) {
  return `${HOME_ROUTE}${buildQuery({ mode: options.mode })}`;
}

export function buildResultRoute(resultId, options = {}) {
  const id = String(resultId || "").trim();
  return id
    ? `${APP_ROUTE_PREFIX}/${RESULT_ROUTE_PREFIX}/${encodeURIComponent(id)}${buildQuery({
        tab: options.tab,
        competitorId: options.competitorId
      })}`
    : buildHomeRoute(options);
}

function syncRoute(path, state = {}, options = {}) {
  if (typeof window === "undefined" || !path) return;
  const currentPath = `${window.location.pathname}${window.location.search}`;
  if (currentPath === path) return;
  const method = options.replace ? "replaceState" : "pushState";
  window.history[method](state, "", path);
}

export function pushResultRoute(resultId, options = {}) {
  const path = buildResultRoute(resultId, options);
  if (path !== HOME_ROUTE) {
    syncRoute(path, { resultId, tab: options.tab, competitorId: options.competitorId }, options);
  }
}

export function replaceResultRoute(resultId, options = {}) {
  pushResultRoute(resultId, { ...options, replace: true });
}

export function pushHomeRoute(options = {}) {
  syncRoute(buildHomeRoute(options), {}, options);
}
