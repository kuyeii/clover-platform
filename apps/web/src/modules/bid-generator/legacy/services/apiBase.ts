import { PortalBridgeAuthError, getPortalAuthContext } from './portalBridge';
import { getApiBaseUrl as getPlatformApiBaseUrl } from '../../../../shared/api/client';
import { getAccessToken, getClientId } from '../../../../shared/auth/token';
import { shouldUseLegacyFallbackTarget } from './apiBasePolicy';

const DEFAULT_API_BASE_URL = 'http://localhost:5000/api';

export type BidGeneratorApiTarget = {
    baseUrl: string;
    backendBaseUrl: string;
    headers: Record<string, string>;
    isPlatformApi: boolean;
};

export type BidGeneratorRequestError = Error & {
    status?: number;
    isPlatformApiRequest?: boolean;
};

let hasWarnedLegacyFallback = false;

function isTopLevelUnifiedFrontend(): boolean {
    return typeof window !== 'undefined' && window.parent === window;
}

function canUseLegacyFallbackTarget(): boolean {
    return shouldUseLegacyFallbackTarget(isTopLevelUnifiedFrontend());
}

function trimTrailingSlash(value: string): string {
    return value.replace(/\/$/, '');
}

function withApiPath(value: string): string {
    const base = trimTrailingSlash(value);
    return base.endsWith('/api') ? base : `${base}/api`;
}

function joinApiUrl(base: string, path: string): string {
    const normalizedBase = trimTrailingSlash(base);
    let normalizedPath = normalizeLegacyApiPath(path);
    if (normalizedBase.endsWith('/api') && normalizedPath.startsWith('/api/')) {
        normalizedPath = normalizedPath.slice('/api'.length);
    }
    return `${normalizedBase}${normalizedPath}`;
}

function normalizeLegacyApiPath(path: string): string {
    const value = String(path || '').trim();
    if (!/^https?:\/\//i.test(value)) {
        return value.startsWith('/') ? value : `/${value}`;
    }

    try {
        const url = new URL(value);
        return `${url.pathname}${url.search}`;
    } catch {
        return value;
    }
}

export function getApiBaseUrl(): string {
    const runtimeBase = import.meta.env.VITE_API_BASE_URL;
    if (runtimeBase && String(runtimeBase).includes('/bid-generator')) {
        return withApiPath(runtimeBase);
    }
    if (isTopLevelUnifiedFrontend()) {
        return `${getPlatformApiBaseUrl()}/bid-generator/api`;
    }
    return trimTrailingSlash(import.meta.env.VITE_API_URL || DEFAULT_API_BASE_URL);
}

export function getBackendBaseUrl(): string {
    return getApiBaseUrl().replace(/\/api$/, '');
}

function legacyApiTarget(): BidGeneratorApiTarget {
    return {
        baseUrl: getApiBaseUrl(),
        backendBaseUrl: getBackendBaseUrl(),
        headers: {},
        isPlatformApi: false,
    };
}

function createApiRequestError(
    message: string,
    status: number,
    isPlatformApiRequest: boolean,
): BidGeneratorRequestError {
    const error = new Error(message) as BidGeneratorRequestError;
    error.status = status;
    error.isPlatformApiRequest = isPlatformApiRequest;
    return error;
}

function isAbortError(error: unknown) {
    return (
        error instanceof DOMException && error.name === 'AbortError'
    ) || (
        typeof error === 'object' &&
        error !== null &&
        (error as { name?: unknown }).name === 'AbortError'
    );
}

export function isRetriablePlatformFailure(error: unknown) {
    const requestError = error as BidGeneratorRequestError;
    return (
        Boolean(requestError?.isPlatformApiRequest) &&
        (requestError.status === 0 || requestError.status === 502 || requestError.status === 503)
    );
}

export function isSafeFallbackMethod(init: RequestInit = {}): boolean {
    const method = String(init.method || 'GET').toUpperCase();
    return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
}

export function warnLegacyFallback(error: unknown) {
    if (hasWarnedLegacyFallback) {
        return;
    }
    hasWarnedLegacyFallback = true;
    const message = error instanceof Error && error.message ? error.message : 'platform api unavailable';
    console.warn('标书生成 apps/api 代理不可用，回退到 legacy backend。', message);
}

async function resolveApiTarget(): Promise<BidGeneratorApiTarget> {
    if (typeof window !== 'undefined' && window.parent === window) {
        const token = getAccessToken();
        return {
            baseUrl: getApiBaseUrl(),
            backendBaseUrl: `${getPlatformApiBaseUrl()}/bid-generator`,
            headers: {
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                'X-Portal-Client-Id': getClientId(),
            },
            isPlatformApi: true,
        };
    }

    const context = await getPortalAuthContext();
    if (context) {
        return {
            baseUrl: joinApiUrl(context.apiBaseUrl, '/api'),
            backendBaseUrl: context.apiBaseUrl,
            headers: {
                Authorization: `Bearer ${context.token}`,
                'X-Portal-Client-Id': context.clientId,
            },
            isPlatformApi: true,
        };
    }

    return legacyApiTarget();
}

export async function resolveBidGeneratorApiTarget(): Promise<BidGeneratorApiTarget> {
    try {
        return await resolveApiTarget();
    } catch (error) {
        if (error instanceof PortalBridgeAuthError) {
            throw error;
        }
        return legacyApiTarget();
    }
}

function mergeHeaders(target: BidGeneratorApiTarget, headers?: HeadersInit) {
    const merged = new Headers(headers);
    for (const [name, value] of Object.entries(target.headers)) {
        merged.set(name, value);
    }
    return merged;
}

async function fetchWithTarget(
    path: string,
    init: RequestInit,
    target: BidGeneratorApiTarget,
): Promise<Response> {
    try {
        return await fetch(joinApiUrl(target.baseUrl, path), {
            ...init,
            headers: mergeHeaders(target, init.headers),
        });
    } catch (error) {
        if (isAbortError(error)) {
            throw error;
        }

        const message =
            error instanceof Error && error.message
                ? `请求失败：${error.message}`
                : '请求失败，请稍后重试。';
        throw createApiRequestError(message, 0, target.isPlatformApi);
    }
}

function platformProxyUnavailableResponse(response: Response, target: BidGeneratorApiTarget) {
    return target.isPlatformApi && (response.status === 502 || response.status === 503);
}

export async function bidGeneratorFetch(
    path: string,
    init: RequestInit = {},
): Promise<Response> {
    const target = await resolveBidGeneratorApiTarget();

    try {
        const response = await fetchWithTarget(path, init, target);
        if (!platformProxyUnavailableResponse(response, target)) {
            return response;
        }

        if (!isSafeFallbackMethod(init) || !canUseLegacyFallbackTarget()) {
            return response;
        }

        warnLegacyFallback(createApiRequestError(`请求失败（HTTP ${response.status}）`, response.status, true));
        return fetchWithTarget(path, init, legacyApiTarget());
    } catch (error) {
        if (!isRetriablePlatformFailure(error) || !isSafeFallbackMethod(init) || !canUseLegacyFallbackTarget()) {
            throw error;
        }
        warnLegacyFallback(error);
        return fetchWithTarget(path, init, legacyApiTarget());
    }
}

async function readErrorDetail(response: Response, fallbackPrefix = '请求失败') {
    let detail = `${fallbackPrefix}: HTTP ${response.status}`;
    try {
        const payload = (await response.clone().json()) as {
            detail?: unknown;
            message?: unknown;
            error?: { message?: unknown };
        };
        if (typeof payload.detail === 'string') {
            detail = payload.detail;
        } else if (typeof payload.error?.message === 'string') {
            detail = payload.error.message;
        } else if (typeof payload.message === 'string') {
            detail = payload.message;
        }
    } catch {
        const text = await response.clone().text().catch(() => '');
        if (text) {
            detail = text;
        }
    }
    return detail;
}

export async function bidGeneratorJsonFetch<T>(
    path: string,
    init: RequestInit = {},
    errorPrefix = '请求失败',
): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }

    const response = await bidGeneratorFetch(path, {
        ...init,
        headers,
    });
    if (!response.ok) {
        throw createApiRequestError(await readErrorDetail(response, errorPrefix), response.status, false);
    }
    return (await response.json()) as T;
}
