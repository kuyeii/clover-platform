export const PLATFORM_API_BASE: "/api/v1";
export const CONTRACT_REVIEW_API_PREFIX: "/contract-review";

export function resolveContractReviewApiBaseForRuntime(base?: string | null, origin?: string): string;
export function normalizeContractReviewApiPath(path?: string | null): string;
export function buildContractReviewApiUrl(base: string, path: string, origin?: string): string;
export function buildContractReviewFallbackHeaders(token?: string | null, clientId?: string): Record<string, string>;
