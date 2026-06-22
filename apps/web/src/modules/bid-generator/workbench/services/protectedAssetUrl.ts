import { fetchProtectedAssetBlob } from '../../services/bidGeneratorApi';

const objectUrlCache = new Map<string, string>();
const pendingUrlCache = new Map<string, Promise<string>>();

function shouldProxyAsset(value: string): boolean {
    if (!value || value.startsWith('blob:') || value.startsWith('data:')) {
        return false;
    }

    if (!/^https?:\/\//i.test(value)) {
        return value.startsWith('/api/');
    }

    try {
        const url = new URL(value);
        return url.pathname.startsWith('/api/');
    } catch {
        return false;
    }
}

function normalizeAssetPath(path: string): string {
    const value = String(path || '').trim();
    if (!value) {
        return '';
    }

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

export async function resolveProtectedAssetUrl(path: string): Promise<string> {
    if (!shouldProxyAsset(path)) {
        return path;
    }

    const normalizedPath = normalizeAssetPath(path);
    if (!normalizedPath) {
        return '';
    }

    const cached = objectUrlCache.get(normalizedPath);
    if (cached) {
        return cached;
    }

    const pending = pendingUrlCache.get(normalizedPath);
    if (pending) {
        return pending;
    }

    const next = fetchProtectedAssetBlob(normalizedPath)
        .then((blob) => {
            const objectUrl = URL.createObjectURL(blob);
            objectUrlCache.set(normalizedPath, objectUrl);
            return objectUrl;
        })
        .finally(() => {
            pendingUrlCache.delete(normalizedPath);
        });

    pendingUrlCache.set(normalizedPath, next);
    return next;
}

export function revokeProtectedAssetUrl(path: string) {
    const normalizedPath = normalizeAssetPath(path);
    const objectUrl = objectUrlCache.get(normalizedPath);
    if (!objectUrl) {
        return;
    }
    URL.revokeObjectURL(objectUrl);
    objectUrlCache.delete(normalizedPath);
}
