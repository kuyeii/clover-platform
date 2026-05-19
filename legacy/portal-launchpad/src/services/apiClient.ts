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

export function getAppUsageWebSocketUrl() {
  if (typeof window === "undefined") {
    return "";
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/app-usage`;
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
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

async function apiFormDataFetch<T>(path: string, formData: FormData, method: string = "POST"): Promise<T> {
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
  return apiFetch<FeedbackSubmissionContext>("/api/tickets/submission-context");
}

export async function fetchFeatureRequestSubmissionContext() {
  return apiFetch<FeedbackSubmissionContext>("/api/feature-requests/submission-context");
}

export async function fetchTicketCaptcha() {
  return apiFetch<{ code: string; hint: string }>("/api/tickets/captcha");
}

export async function fetchFeatureRequestCaptcha() {
  return apiFetch<{ code: string; hint: string }>("/api/feature-requests/captcha");
}

export interface FeedbackSubmitResult {
  ok: boolean;
  submittedAt: string;
  attachmentCount: number;
}

export async function submitTicket(formData: FormData) {
  return apiFormDataFetch<FeedbackSubmitResult>("/api/tickets", formData, "POST");
}

export async function submitFeatureRequest(formData: FormData) {
  return apiFormDataFetch<FeedbackSubmitResult>("/api/feature-requests", formData, "POST");
}

export async function loginByPassword(account: string, password: string) {
  const data = await apiFetch<{ token: string; user: PortalUser }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ account, password }),
  });
  setAuthToken(data.token);
  return data.user;
}

export async function fetchCurrentUser() {
  return apiFetch<{ user: PortalUser }>("/api/auth/me").then((data) => data.user);
}

export async function logoutFromServer() {
  try {
    await apiFetch<{ ok: true }>("/api/auth/logout", { method: "POST" });
  } finally {
    setAuthToken(null);
  }
}

export async function changeCurrentPassword(input: ChangePasswordInput) {
  return apiFetch<{ user: PortalUser }>("/api/auth/password", {
    method: "PATCH",
    body: JSON.stringify(input),
  }).then((data) => data.user);
}

export async function fetchUsers() {
  return apiFetch<{ users: PortalUser[] }>("/api/users").then((data) => data.users);
}

export async function createUser(input: CreatePortalUserInput) {
  return apiFetch<{ user: PortalUser }>("/api/users", {
    method: "POST",
    body: JSON.stringify(input),
  }).then((data) => data.user);
}

export async function updateUser(userId: string, patch: UpdatePortalUserInput) {
  return apiFetch<{ user: PortalUser }>(`/api/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  }).then((data) => data.user);
}

export async function fetchUsageSummaries() {
  return apiFetch<{ summaries: AppUsageSummary[] }>("/api/app-usage").then(
    (data) => data.summaries,
  );
}

export async function enterApp(appId: ToolkitApp["id"], confirmedConflict = false) {
  return apiFetch<{ summaries: AppUsageSummary[] }>(
    `/api/app-usage/${encodeURIComponent(appId)}/enter`,
    {
      method: "POST",
      body: JSON.stringify({ confirmedConflict }),
    },
  ).then((data) => data.summaries);
}

export async function heartbeatApp(appId: ToolkitApp["id"]) {
  return apiFetch<{ summaries: AppUsageSummary[] }>(
    `/api/app-usage/${encodeURIComponent(appId)}/heartbeat`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  ).then((data) => data.summaries);
}

export async function leaveApp(appId: ToolkitApp["id"]) {
  return apiFetch<{ summaries: AppUsageSummary[] }>(
    `/api/app-usage/${encodeURIComponent(appId)}/leave`,
    { method: "DELETE" },
  ).then((data) => data.summaries);
}

export async function leaveAllApps() {
  return apiFetch<{ summaries: AppUsageSummary[] }>("/api/app-usage/leave-all", {
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
    if (navigator.sendBeacon("/api/app-usage/leave-all-beacon", blob)) {
      return true;
    }
  }

  fetch("/api/app-usage/leave-all-beacon", {
    method: "POST",
    body: payload,
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    keepalive: true,
  }).catch(() => undefined);

  return true;
}
