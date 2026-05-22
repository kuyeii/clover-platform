import { PortalBridgeAuthError, getPortalAuthContext } from "./portalBridge";

let hasWarnedLegacyFallback = false;

function getApiBase() {
  const base = import.meta.env.VITE_API_BASE_URL || "";
  return base.replace(/\/$/, "");
}

function joinApiUrl(base, path) {
  return `${base.replace(/\/$/, "")}${path}`;
}

function isRetriablePlatformFailure(error) {
  return error?.isPlatformApiRequest && (error.status === 0 || error.status === 502 || error.status === 503);
}

function isSafeFallbackMethod(options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

function warnLegacyFallback(error) {
  if (hasWarnedLegacyFallback) {
    return;
  }
  hasWarnedLegacyFallback = true;
  const message = error instanceof Error && error.message ? error.message : "platform api unavailable";
  console.warn("竞对分析 apps/api 代理不可用，回退到 legacy backend。", message);
}

async function resolveApiTarget() {
  const legacyBaseUrl = getApiBase();
  const context = await getPortalAuthContext();
  if (context) {
    return {
      baseUrl: context.apiBaseUrl,
      headers: {
        Authorization: `Bearer ${context.token}`,
        "X-Portal-Client-Id": context.clientId
      },
      isPlatformApi: true
    };
  }

  return {
    baseUrl: legacyBaseUrl,
    headers: {},
    isPlatformApi: false
  };
}

function legacyApiTarget() {
  return {
    baseUrl: getApiBase(),
    headers: {},
    isPlatformApi: false
  };
}

function apiError(message, status, isPlatformApiRequest) {
  const error = new Error(message);
  error.status = status;
  error.isPlatformApiRequest = Boolean(isPlatformApiRequest);
  return error;
}

async function fetchWithTarget(path, options, target) {
  let response;
  try {
    response = await fetch(joinApiUrl(target.baseUrl, path), {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...target.headers,
        ...(options.headers || {})
      }
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? `请求失败：${error.message}`
        : "请求失败，请稍后重试。";
    throw apiError(message, 0, target.isPlatformApi);
  }

  return response;
}

export async function requestJson(path, options = {}) {
  let target;
  try {
    target = await resolveApiTarget();
  } catch (error) {
    if (error instanceof PortalBridgeAuthError) {
      throw error;
    }
    target = legacyApiTarget();
  }

  try {
    return await requestJsonWithTarget(path, options, target);
  } catch (error) {
    if (!isRetriablePlatformFailure(error) || !isSafeFallbackMethod(options)) {
      throw error;
    }
    warnLegacyFallback(error);
    return requestJsonWithTarget(path, options, legacyApiTarget());
  }
}

async function requestJsonWithTarget(path, options, target) {
  const response = await fetchWithTarget(path, options, target);

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Keep payload null and use a generic message below.
  }

  if (!response.ok) {
    const message =
      payload?.message ||
      payload?.error?.message ||
      `请求失败（HTTP ${response.status}）`;
    throw apiError(message, response.status, target.isPlatformApi);
  }

  return payload;
}

export async function runAnalysis(input) {
  return requestJson("/api/analysis", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function runAnalysisStream(input, onEvent) {
  let target;
  try {
    target = await resolveApiTarget();
  } catch (error) {
    if (error instanceof PortalBridgeAuthError) {
      throw error;
    }
    target = legacyApiTarget();
  }

  try {
    return await runAnalysisStreamWithTarget(input, onEvent, target);
  } catch (error) {
    if (!isRetriablePlatformFailure(error) || !isSafeFallbackMethod({ method: "POST" })) {
      throw error;
    }
    warnLegacyFallback(error);
    return runAnalysisStreamWithTarget(input, onEvent, legacyApiTarget());
  }
}

async function runAnalysisStreamWithTarget(input, onEvent, target) {
  const response = await fetchWithTarget("/api/analysis/stream", {
    method: "POST",
    body: JSON.stringify(input)
  }, target);

  if (!response.ok || !response.body) {
    let message = `请求失败（HTTP ${response.status}）`;
    try {
      const payload = await response.clone().json();
      message = payload?.message || payload?.error?.message || message;
    } catch {
      // Keep the HTTP status message for non-JSON stream errors.
    }
    throw apiError(message, response.status, target.isPlatformApi);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      onEvent(JSON.parse(line));
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    onEvent(JSON.parse(buffer));
  }
}

export async function listHistory() {
  const payload = await requestJson("/api/history");
  return Array.isArray(payload.items) ? payload.items : [];
}

export async function getHistoryRecord(id) {
  const payload = await requestJson(`/api/history/${encodeURIComponent(id)}`);
  return payload.item || null;
}
