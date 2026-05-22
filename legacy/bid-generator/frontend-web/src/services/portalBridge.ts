const APP_CODE = 'bid-generator';
const AUTH_REQUEST_TYPE = 'clover:auth-request';
const AUTH_CONTEXT_TYPE = 'clover:auth-context';
const AUTH_ERROR_TYPE = 'clover:auth-error';
const DEFAULT_TIMEOUT_MS = 2000;

type AuthContextMessage = {
    type: typeof AUTH_CONTEXT_TYPE;
    requestId: string;
    appCode: string;
    token: string;
    clientId: string;
    apiBaseUrl: string;
};

type AuthErrorMessage = {
    type: typeof AUTH_ERROR_TYPE;
    requestId: string;
    appCode: string;
    message?: string;
};

export type PortalAuthContext = {
    appCode: typeof APP_CODE;
    token: string;
    clientId: string;
    apiBaseUrl: string;
};

let cachedContext: PortalAuthContext | null = null;
let pendingRequest: Promise<PortalAuthContext | null> | null = null;
let deniedMessage = '';

export class PortalBridgeAuthError extends Error {
    constructor(message?: string) {
        super(message || 'Portal 鉴权桥接不可用。');
        this.name = 'PortalBridgeAuthError';
    }
}

function isBrowser() {
    return typeof window !== 'undefined';
}

function createRequestId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `auth-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getExpectedParentOrigin() {
    if (!isBrowser()) {
        return '';
    }

    if (document.referrer) {
        try {
            return new URL(document.referrer).origin;
        } catch {
            return '';
        }
    }

    const ancestorOrigins = (window.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
    return ancestorOrigins?.length ? ancestorOrigins[0] : '';
}

function isTrustedParentMessage(event: MessageEvent, parentOrigin: string) {
    if (!isBrowser() || event.source !== window.parent) {
        return false;
    }

    return Boolean(parentOrigin) && event.origin === parentOrigin;
}

function isAuthContextMessage(message: unknown): message is AuthContextMessage {
    if (!message || typeof message !== 'object') {
        return false;
    }

    const value = message as Record<string, unknown>;
    return (
        value.type === AUTH_CONTEXT_TYPE &&
        value.appCode === APP_CODE &&
        typeof value.requestId === 'string' &&
        typeof value.token === 'string' &&
        typeof value.clientId === 'string' &&
        typeof value.apiBaseUrl === 'string'
    );
}

function isAuthErrorMessage(message: unknown): message is AuthErrorMessage {
    if (!message || typeof message !== 'object') {
        return false;
    }

    const value = message as Record<string, unknown>;
    return (
        value.type === AUTH_ERROR_TYPE &&
        value.appCode === APP_CODE &&
        typeof value.requestId === 'string'
    );
}

function normalizeContext(message: unknown): PortalAuthContext | null {
    if (!isAuthContextMessage(message)) {
        return null;
    }

    const apiBaseUrl = message.apiBaseUrl.replace(/\/$/, '');
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
    deniedMessage = '';
}

export async function getPortalAuthContext(
    timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<PortalAuthContext | null> {
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
        let timer: number | undefined;
        let handleMessage: ((event: MessageEvent) => void) | null = null;

        const cleanup = () => {
            if (handleMessage) {
                window.removeEventListener('message', handleMessage);
            }
            if (timer !== undefined) {
                window.clearTimeout(timer);
            }
            pendingRequest = null;
        };

        const finish = (callback: () => void) => {
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

        handleMessage = (event: MessageEvent) => {
            if (!isTrustedParentMessage(event, parentOrigin)) {
                return;
            }

            const message = event.data;
            if (
                !message ||
                typeof message !== 'object' ||
                (message as Record<string, unknown>).requestId !== requestId ||
                (message as Record<string, unknown>).appCode !== APP_CODE
            ) {
                return;
            }

            if (isAuthContextMessage(message)) {
                const context = normalizeContext(message);
                if (!context) {
                    finish(() => reject(new PortalBridgeAuthError('Portal 鉴权上下文格式无效。')));
                    return;
                }
                cachedContext = context;
                finish(() => resolve(context));
                return;
            }

            if (isAuthErrorMessage(message)) {
                deniedMessage = message.message || '当前账号没有访问标书生成的权限。';
                finish(() => reject(new PortalBridgeAuthError(deniedMessage)));
            }
        };

        timer = window.setTimeout(() => {
            finish(() => resolve(null));
        }, timeoutMs);

        window.addEventListener('message', handleMessage);
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
