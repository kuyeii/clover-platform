const APP_CODE = "competitor-analysis";
const AUTH_REQUEST_TYPE = "clover:auth-request";
const AUTH_CONTEXT_TYPE = "clover:auth-context";
const AUTH_ERROR_TYPE = "clover:auth-error";
const DEFAULT_TIMEOUT_MS = 2000;

let cachedContext = null;
let pendingRequest = null;
let deniedMessage = "";

export class PortalBridgeAuthError extends Error {
  constructor(message) {
    super(message || "Portal 鉴权桥接不可用。");
    this.name = "PortalBridgeAuthError";
  }
}

function isBrowser() {
  return typeof window !== "undefined";
}

function createRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `auth-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getExpectedParentOrigin() {
  if (!isBrowser() || !document.referrer) {
    const ancestorOrigins = window.location?.ancestorOrigins;
    return ancestorOrigins?.length ? ancestorOrigins[0] : "";
  }

  try {
    return new URL(document.referrer).origin;
  } catch {
    return "";
  }
}

function isTrustedParentMessage(event, parentOrigin) {
  if (!isBrowser() || event.source !== window.parent) {
    return false;
  }

  return Boolean(parentOrigin) && event.origin === parentOrigin;
}

function normalizeContext(message) {
  if (
    message?.type !== AUTH_CONTEXT_TYPE ||
    message?.appCode !== APP_CODE ||
    typeof message?.token !== "string" ||
    typeof message?.clientId !== "string" ||
    typeof message?.apiBaseUrl !== "string"
  ) {
    return null;
  }

  const apiBaseUrl = message.apiBaseUrl.replace(/\/$/, "");
  if (!message.token || !message.clientId || !apiBaseUrl) {
    return null;
  }

  return {
    appCode: APP_CODE,
    token: message.token,
    clientId: message.clientId,
    apiBaseUrl,
  };
}

export function clearPortalAuthContext() {
  cachedContext = null;
  pendingRequest = null;
  deniedMessage = "";
}

export async function getPortalAuthContext(timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (cachedContext) {
    return cachedContext;
  }

  if (!isBrowser() || window.parent === window) {
    return null;
  }

  if (deniedMessage) {
    throw new PortalBridgeAuthError(deniedMessage);
  }

  if (pendingRequest) {
    return pendingRequest;
  }

  pendingRequest = new Promise((resolve, reject) => {
    const requestId = createRequestId();
    let settled = false;

    const cleanup = () => {
      window.removeEventListener("message", handleMessage);
      window.clearTimeout(timer);
      pendingRequest = null;
    };

    const finish = (callback) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback();
    };

    const parentOrigin = getExpectedParentOrigin();
    if (!parentOrigin) {
      finish(() => resolve(null));
      return;
    }

    const handleMessage = (event) => {
      if (!isTrustedParentMessage(event, parentOrigin)) {
        return;
      }

      const message = event.data;
      if (!message || message.requestId !== requestId || message.appCode !== APP_CODE) {
        return;
      }

      if (message.type === AUTH_CONTEXT_TYPE) {
        const context = normalizeContext(message);
        if (!context) {
          finish(() => reject(new PortalBridgeAuthError("Portal 鉴权上下文格式无效。")));
          return;
        }
        cachedContext = context;
        finish(() => resolve(context));
        return;
      }

      if (message.type === AUTH_ERROR_TYPE) {
        deniedMessage = message.message || "当前账号没有访问竞对分析的权限。";
        finish(() => reject(new PortalBridgeAuthError(deniedMessage)));
      }
    };

    const timer = window.setTimeout(() => {
      finish(() => resolve(null));
    }, timeoutMs);

    window.addEventListener("message", handleMessage);
    window.parent.postMessage(
      {
        type: AUTH_REQUEST_TYPE,
        appCode: APP_CODE,
        requestId,
      },
      parentOrigin,
    );
  });

  return pendingRequest;
}
