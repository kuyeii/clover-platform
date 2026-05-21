import { ToolkitApp } from "../types/app";
import {
  AppUsageSummary,
  ChangePasswordInput,
  CreatePortalUserInput,
  PortalUser,
  UpdatePortalUserInput,
} from "../types/user";

const AUTH_TOKEN_STORAGE_KEY = "portal.launchpad.authToken.v2";
const CLIENT_ID_STORAGE_KEY = "portal.launchpad.clientId.v2";

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

function getSessionStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.sessionStorage;
}

export function getAuthToken() {
  return getSessionStorage()?.getItem(AUTH_TOKEN_STORAGE_KEY) ?? "";
}

export function setAuthToken(token: string | null) {
  const storage = getSessionStorage();

  if (!storage) {
    return;
  }

  if (token) {
    storage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
  } else {
    storage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  }
}

export function getClientId() {
  const storage = getSessionStorage();

  if (!storage) {
    return "browser-client";
  }

  const existingClientId = storage.getItem(CLIENT_ID_STORAGE_KEY);
  if (existingClientId) {
    return existingClientId;
  }

  const nextClientId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  storage.setItem(CLIENT_ID_STORAGE_KEY, nextClientId);
  return nextClientId;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/$/, "");
}

function joinUrl(baseUrl: string, path: string) {
  const normalizedBaseUrl = trimTrailingSlash(baseUrl);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBaseUrl}${normalizedPath}`;
}

function getPlatformApiBaseUrl() {
  const baseUrl = import.meta.env.VITE_PLATFORM_API_BASE_URL || "/api/v1/core";
  return trimTrailingSlash(String(baseUrl));
}

function getPlatformWsBaseUrl() {
  const explicitBaseUrl = import.meta.env.VITE_PLATFORM_WS_BASE_URL;
  if (explicitBaseUrl) {
    return trimTrailingSlash(String(explicitBaseUrl));
  }

  const platformApiBaseUrl = import.meta.env.VITE_PLATFORM_API_BASE_URL;
  if (platformApiBaseUrl && /^https?:\/\//i.test(String(platformApiBaseUrl))) {
    try {
      const url = new URL(String(platformApiBaseUrl));
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.pathname = "/ws/core";
      url.search = "";
      url.hash = "";
      return trimTrailingSlash(url.toString());
    } catch {
      // Fall through to the current origin websocket URL.
    }
  }

  if (typeof window === "undefined") {
    return "";
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/core`;
}

export function getAppUsageWebSocketUrl() {
  return joinUrl(getPlatformWsBaseUrl(), "/app-usage");
}

async function legacyApiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("x-portal-client-id", getClientId());

  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : null;

  if (!response.ok) {
    const message = data?.error?.message || `请求失败：${response.status}`;
    throw new ApiError(message, response.status, data?.error?.code);
  }

  return data as T;
}

async function platformApiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("x-portal-client-id", getClientId());

  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(joinUrl(getPlatformApiBaseUrl(), path), {
      ...init,
      headers,
      credentials: "same-origin",
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? `平台 API 不可用：${error.message}`
        : "平台 API 不可用，请确认 apps/api 已启动。";
    throw new ApiError(message, 0);
  }
  const contentType = response.headers.get("content-type") || "";
  const envelope = contentType.includes("application/json") ? await response.json() : null;

  if (!response.ok) {
    const message =
      envelope?.error?.message ||
      (response.status >= 500
        ? "平台 API 不可用，请确认 apps/api 已启动。"
        : `请求失败：${response.status}`);
    throw new ApiError(message, response.status, envelope?.error?.code);
  }

  if (envelope?.success === false) {
    const message = envelope?.error?.message || "请求失败，请稍后重试。";
    throw new ApiError(message, response.status, envelope?.error?.code);
  }

  if (!envelope || envelope.success !== true) {
    throw new ApiError("平台接口返回了无法识别的响应。", response.status);
  }

  return envelope.data as T;
}

async function legacyApiFormDataFetch<T>(path: string, formData: FormData, method: string = "POST"): Promise<T> {
  const token = getAuthToken();
  const headers = new Headers();
  headers.set("accept", "application/json");
  headers.set("x-portal-client-id", getClientId());

  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }

  const response = await fetch(path, {
    method,
    headers,
    body: formData,
    credentials: "same-origin",
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : null;

  if (!response.ok) {
    const message = data?.error?.message || `请求失败：${response.status}`;
    throw new ApiError(message, response.status, data?.error?.code);
  }

  return data as T;
}

export interface FeedbackSubmissionContext {
  defaultContactEmail: string;
  captchaRequired: boolean;
  captchaHint: string;
}

export async function fetchTicketSubmissionContext() {
  return legacyApiFetch<FeedbackSubmissionContext>("/api/tickets/submission-context");
}

export async function fetchFeatureRequestSubmissionContext() {
  return legacyApiFetch<FeedbackSubmissionContext>("/api/feature-requests/submission-context");
}

export async function fetchTicketCaptcha() {
  return legacyApiFetch<{ code: string; hint: string }>("/api/tickets/captcha");
}

export async function fetchFeatureRequestCaptcha() {
  return legacyApiFetch<{ code: string; hint: string }>("/api/feature-requests/captcha");
}

export interface FeedbackSubmitResult {
  ok: boolean;
  submittedAt: string;
  attachmentCount: number;
}

export async function submitTicket(formData: FormData) {
  return legacyApiFormDataFetch<FeedbackSubmitResult>("/api/tickets", formData, "POST");
}

export async function submitFeatureRequest(formData: FormData) {
  return legacyApiFormDataFetch<FeedbackSubmitResult>("/api/feature-requests", formData, "POST");
}

export async function loginByPassword(account: string, password: string) {
  const data = await platformApiFetch<{ token: string; user: PortalUser }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ account, password }),
  });
  setAuthToken(data.token);
  return data.user;
}

export async function fetchCurrentUser() {
  return platformApiFetch<{ user: PortalUser }>("/auth/me").then((data) => data.user);
}

export async function logoutFromServer() {
  try {
    await platformApiFetch<{ ok: true }>("/auth/logout", { method: "POST" });
  } finally {
    setAuthToken(null);
  }
}

export async function changeCurrentPassword(input: ChangePasswordInput) {
  return platformApiFetch<{ user: PortalUser }>("/auth/password", {
    method: "PATCH",
    body: JSON.stringify(input),
  }).then((data) => data.user);
}

export async function fetchUsers() {
  return platformApiFetch<{ users: PortalUser[] }>("/users").then((data) => data.users);
}

export async function createUser(input: CreatePortalUserInput) {
  return platformApiFetch<{ user: PortalUser }>("/users", {
    method: "POST",
    body: JSON.stringify(input),
  }).then((data) => data.user);
}

export async function updateUser(userId: string, patch: UpdatePortalUserInput) {
  return platformApiFetch<{ user: PortalUser }>(`/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  }).then((data) => data.user);
}

export async function fetchUsageSummaries() {
  return platformApiFetch<{ summaries: AppUsageSummary[] }>("/app-usage").then(
    (data) => data.summaries,
  );
}

export interface RuntimeAppConfig {
  code: ToolkitApp["id"];
  name: string;
  frontendUrl?: string;
  backendUrl?: string;
  iframeUrl: string;
  url?: string;
  healthUrl?: string;
  enabled: boolean;
}

export async function fetchRuntimeApps() {
  return platformApiFetch<{ apps: RuntimeAppConfig[] }>("/runtime/apps").then((data) => data.apps);
}

export async function enterApp(appId: ToolkitApp["id"], confirmedConflict = false) {
  return platformApiFetch<{ summaries: AppUsageSummary[] }>(
    `/app-usage/${encodeURIComponent(appId)}/enter`,
    {
      method: "POST",
      body: JSON.stringify({ confirmedConflict }),
    },
  ).then((data) => data.summaries);
}

export async function heartbeatApp(appId: ToolkitApp["id"]) {
  return platformApiFetch<{ summaries: AppUsageSummary[] }>(
    `/app-usage/${encodeURIComponent(appId)}/heartbeat`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  ).then((data) => data.summaries);
}

export async function leaveApp(appId: ToolkitApp["id"]) {
  return platformApiFetch<{ summaries: AppUsageSummary[] }>(
    `/app-usage/${encodeURIComponent(appId)}/leave`,
    { method: "DELETE" },
  ).then((data) => data.summaries);
}

export async function leaveAllApps() {
  return platformApiFetch<{ summaries: AppUsageSummary[] }>("/app-usage/leave-all", {
    method: "DELETE",
  }).then((data) => data.summaries);
}

export function leaveAllAppsBeacon() {
  if (typeof window === "undefined") {
    return false;
  }

  const token = getAuthToken();
  if (!token) {
    return false;
  }

  const payload = JSON.stringify({
    token,
    clientId: getClientId(),
  });

  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const blob = new Blob([payload], { type: "application/json" });
    if (navigator.sendBeacon(joinUrl(getPlatformApiBaseUrl(), "/app-usage/leave-all-beacon"), blob)) {
      return true;
    }
  }

  fetch(joinUrl(getPlatformApiBaseUrl(), "/app-usage/leave-all-beacon"), {
    method: "POST",
    body: payload,
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    keepalive: true,
  }).catch(() => undefined);

  return true;
}
