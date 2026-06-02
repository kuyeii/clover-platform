import { bidGeneratorFetch } from './apiBase';

type LegacyApiRequestConfig = {
    params?: Record<string, string | number | boolean | null | undefined>;
    headers?: HeadersInit;
    responseType?: 'blob' | 'json' | string;
    signal?: AbortSignal;
};

function appendQuery(path: string, params?: LegacyApiRequestConfig['params']): string {
    if (!params) return path;
    const [pathname, rawSearch = ''] = path.split('?', 2);
    const search = new URLSearchParams(rawSearch);
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
            search.set(key, String(value));
        }
    });
    const query = search.toString();
    return query ? `${pathname}?${query}` : pathname;
}

function buildRequestInit(method: string, body?: unknown, config: LegacyApiRequestConfig = {}): RequestInit {
    const headers = new Headers(config.headers);
    const init: RequestInit = {
        method,
        headers,
        signal: config.signal,
    };
    if (body !== undefined) {
        if (body instanceof FormData || body instanceof Blob) {
            init.body = body;
        } else {
            if (!headers.has('Content-Type')) {
                headers.set('Content-Type', 'application/json');
            }
            init.body = JSON.stringify(body);
        }
    }
    return init;
}

async function readErrorDetail(response: Response): Promise<string> {
    try {
        const payload = await response.clone().json();
        return String(payload?.detail || payload?.message || payload?.error?.message || `HTTP ${response.status}`);
    } catch {
        const text = await response.clone().text().catch(() => '');
        return text || `HTTP ${response.status}`;
    }
}

async function request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    config: LegacyApiRequestConfig = {},
): Promise<T> {
    const response = await bidGeneratorFetch(
        appendQuery(path, config.params),
        buildRequestInit(method, body, config),
    );
    if (!response.ok) {
        throw new Error(await readErrorDetail(response));
    }
    if (config.responseType === 'blob') {
        return await response.blob() as T;
    }
    if (response.status === 204) {
        return undefined as T;
    }
    const contentType = response.headers.get('Content-Type') || '';
    if (contentType.includes('application/json')) {
        return await response.json() as T;
    }
    return await response.text() as T;
}

const api = {
    get<T = unknown>(path: string, config?: LegacyApiRequestConfig): Promise<T> {
        return request<T>('GET', path, undefined, config);
    },
    post<T = unknown>(path: string, body?: unknown, config?: LegacyApiRequestConfig): Promise<T> {
        return request<T>('POST', path, body, config);
    },
    put<T = unknown>(path: string, body?: unknown, config?: LegacyApiRequestConfig): Promise<T> {
        return request<T>('PUT', path, body, config);
    },
    patch<T = unknown>(path: string, body?: unknown, config?: LegacyApiRequestConfig): Promise<T> {
        return request<T>('PATCH', path, body, config);
    },
    delete<T = unknown>(path: string, config?: LegacyApiRequestConfig): Promise<T> {
        return request<T>('DELETE', path, undefined, config);
    },
};

export const baseURL = '';
export default api;
