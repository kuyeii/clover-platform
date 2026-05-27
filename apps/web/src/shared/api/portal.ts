import { apiClient, getPlatformCoreApiBaseUrl } from "./client";
import { clearAccessToken, getAccessToken, getClientId, setAccessToken } from "../auth/token";
import type {
  AppUsageSummary,
  ChangePasswordInput,
  CreatePortalUserInput,
  ModuleCode,
  PortalUser,
  RuntimeAppConfig,
  UpdatePortalUserInput,
} from "../types/portal";

export interface FeedbackSubmissionContext {
  defaultContactEmail: string;
  captchaRequired: boolean;
  captchaHint: string;
}

export interface FeedbackSubmitResult {
  ok: boolean;
  submittedAt: string;
  attachmentCount: number;
}

export async function loginByPassword(account: string, password: string) {
  const data = await apiClient.post<{ token: string; user: PortalUser }>("/core/auth/login", {
    account,
    password,
  });
  setAccessToken(data.token);
  return data.user;
}

export async function fetchCurrentUser() {
  return apiClient.get<{ user: PortalUser }>("/core/auth/me").then((data) => data.user);
}

export async function logoutFromServer() {
  try {
    await apiClient.post<{ ok: true }>("/core/auth/logout", {});
  } finally {
    clearAccessToken();
  }
}

export async function changeCurrentPassword(input: ChangePasswordInput) {
  return apiClient.patch<{ user: PortalUser }>("/core/auth/password", input).then((data) => data.user);
}

export async function fetchUsers() {
  return apiClient.get<{ users: PortalUser[] }>("/core/users").then((data) => data.users);
}

export async function createUser(input: CreatePortalUserInput) {
  return apiClient.post<{ user: PortalUser }>("/core/users", input).then((data) => data.user);
}

export async function updateUser(userId: string, patch: UpdatePortalUserInput) {
  return apiClient
    .patch<{ user: PortalUser }>(`/core/users/${encodeURIComponent(userId)}`, patch)
    .then((data) => data.user);
}

export async function fetchRuntimeApps() {
  return apiClient.get<{ apps: RuntimeAppConfig[] }>("/core/runtime/apps").then((data) => data.apps);
}

export async function fetchUsageSummaries() {
  return apiClient.get<{ summaries: AppUsageSummary[] }>("/core/app-usage").then((data) => data.summaries);
}

export async function enterApp(appId: ModuleCode, confirmedConflict = false) {
  return apiClient
    .post<{ summaries: AppUsageSummary[] }>(`/core/app-usage/${encodeURIComponent(appId)}/enter`, {
      confirmedConflict,
    })
    .then((data) => data.summaries);
}

export async function heartbeatApp(appId: ModuleCode) {
  return apiClient
    .post<{ summaries: AppUsageSummary[] }>(`/core/app-usage/${encodeURIComponent(appId)}/heartbeat`, {})
    .then((data) => data.summaries);
}

export async function leaveApp(appId: ModuleCode) {
  return apiClient
    .delete<{ summaries: AppUsageSummary[] }>(`/core/app-usage/${encodeURIComponent(appId)}/leave`)
    .then((data) => data.summaries);
}

export async function leaveAllApps() {
  return apiClient.delete<{ summaries: AppUsageSummary[] }>("/core/app-usage/leave-all").then((data) => data.summaries);
}

export function leaveAllAppsBeacon() {
  if (typeof window === "undefined") {
    return false;
  }

  const token = getAccessToken();
  if (!token) {
    return false;
  }

  const payload = JSON.stringify({
    token,
    clientId: getClientId(),
  });
  const target = `${getPlatformCoreApiBaseUrl()}/app-usage/leave-all-beacon`;

  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const blob = new Blob([payload], { type: "application/json" });
    if (navigator.sendBeacon(target, blob)) {
      return true;
    }
  }

  fetch(target, {
    method: "POST",
    body: payload,
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    keepalive: true,
  }).catch(() => undefined);

  return true;
}

export function fetchTicketSubmissionContext() {
  return apiClient.get<FeedbackSubmissionContext>("/core/tickets/submission-context");
}

export function fetchFeatureRequestSubmissionContext() {
  return apiClient.get<FeedbackSubmissionContext>("/core/feature-requests/submission-context");
}

export function fetchTicketCaptcha() {
  return apiClient.get<{ code: string; hint: string }>("/core/tickets/captcha", { credentials: "include" });
}

export function fetchFeatureRequestCaptcha() {
  return apiClient.get<{ code: string; hint: string }>("/core/feature-requests/captcha", { credentials: "include" });
}

export function submitTicket(formData: FormData) {
  return apiClient.request<FeedbackSubmitResult>("POST", "/core/tickets", {
    body: formData,
    credentials: "include",
  });
}

export function submitFeatureRequest(formData: FormData) {
  return apiClient.request<FeedbackSubmitResult>("POST", "/core/feature-requests", {
    body: formData,
    credentials: "include",
  });
}
