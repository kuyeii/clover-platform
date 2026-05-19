const DEFAULT_API_BASE_URL = 'http://localhost:5000/api';

function trimTrailingSlash(value: string): string {
    return value.replace(/\/$/, '');
}

function withApiPath(value: string): string {
    const base = trimTrailingSlash(value);
    return base.endsWith('/api') ? base : `${base}/api`;
}

export function getApiBaseUrl(): string {
    const runtimeBase = import.meta.env.VITE_API_BASE_URL;
    if (runtimeBase) {
        return withApiPath(runtimeBase);
    }
    return trimTrailingSlash(import.meta.env.VITE_API_URL || DEFAULT_API_BASE_URL);
}

export function getBackendBaseUrl(): string {
    return getApiBaseUrl().replace(/\/api$/, '');
}
