const AUTH_TOKEN_STORAGE_KEY = "clover.platform.web.session";
const CLIENT_ID_STORAGE_KEY = "clover.platform.web.client";

let memoryAccessToken: string | null = readSessionValue(AUTH_TOKEN_STORAGE_KEY);

function getSessionStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readSessionValue(key: string): string | null {
  try {
    return getSessionStorage()?.getItem(key) || null;
  } catch {
    return null;
  }
}

function writeSessionValue(key: string, value: string | null): void {
  const storage = getSessionStorage();
  if (!storage) {
    return;
  }
  try {
    if (value) {
      storage.setItem(key, value);
    } else {
      storage.removeItem(key);
    }
  } catch {
    // Session storage is an optimization for page refresh recovery.
  }
}

export function setAccessToken(token: string | null): void {
  memoryAccessToken = token;
  writeSessionValue(AUTH_TOKEN_STORAGE_KEY, token);
}

export function getAccessToken(): string | null {
  if (memoryAccessToken) {
    return memoryAccessToken;
  }

  memoryAccessToken = readSessionValue(AUTH_TOKEN_STORAGE_KEY);
  return memoryAccessToken;
}

export function clearAccessToken(): void {
  setAccessToken(null);
}

export function getClientId(): string {
  const existing = readSessionValue(CLIENT_ID_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const nextClientId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  writeSessionValue(CLIENT_ID_STORAGE_KEY, nextClientId);
  return nextClientId;
}
