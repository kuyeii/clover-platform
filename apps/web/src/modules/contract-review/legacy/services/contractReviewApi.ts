import { PortalBridgeAuthError, getPortalAuthContext } from './portalBridge'
import { getAccessToken, getClientId } from '../../../../shared/auth/token'
import {
  buildContractReviewApiUrl,
  buildContractReviewFallbackHeaders,
  normalizeContractReviewApiPath,
  resolveContractReviewApiBaseForRuntime,
} from './contractReviewApiPaths'

export {
  buildContractReviewApiUrl,
  buildContractReviewFallbackHeaders,
  normalizeContractReviewApiPath,
  resolveContractReviewApiBaseForRuntime,
} from './contractReviewApiPaths'

type ApiTarget = {
  baseUrl: string
  headers: Record<string, string>
  isPlatformApi: boolean
}

type ApiRequestError = Error & {
  status?: number
  isPlatformApiRequest?: boolean
}

let hasWarnedLegacyFallback = false

function getLegacyApiBase() {
  return resolveContractReviewApiBaseForRuntime(
    String(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, ''),
    window.location.origin,
  )
}

function isAbortError(error: unknown) {
  return (
    error instanceof DOMException && error.name === 'AbortError'
  ) || (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  )
}

function createApiRequestError(
  message: string,
  status: number,
  isPlatformApiRequest: boolean,
): ApiRequestError {
  const error = new Error(message) as ApiRequestError
  error.status = status
  error.isPlatformApiRequest = isPlatformApiRequest
  return error
}

function isRetriablePlatformFailure(error: unknown) {
  const requestError = error as ApiRequestError
  return (
    Boolean(requestError?.isPlatformApiRequest) &&
    (requestError.status === 0 || requestError.status === 502 || requestError.status === 503)
  )
}

function isSafeFallbackMethod(init: RequestInit = {}) {
  const method = String(init.method || 'GET').toUpperCase()
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS'
}

function warnLegacyFallback(error: unknown) {
  if (hasWarnedLegacyFallback) {
    return
  }
  hasWarnedLegacyFallback = true
  const message = error instanceof Error && error.message ? error.message : 'platform api unavailable'
  console.warn('合同审查 apps/api 代理不可用，回退到 legacy backend。', message)
}

async function resolveApiTarget(): Promise<ApiTarget> {
  const context = await getPortalAuthContext()
  if (context) {
    return {
      baseUrl: context.apiBaseUrl,
      headers: {
        Authorization: `Bearer ${context.token}`,
        'X-Portal-Client-Id': context.clientId,
      },
      isPlatformApi: true,
    }
  }

  return legacyApiTarget()
}

function legacyApiTarget(): ApiTarget {
  const token = getAccessToken()

  return {
    baseUrl: getLegacyApiBase(),
    headers: buildContractReviewFallbackHeaders(token, getClientId()),
    isPlatformApi: false,
  }
}

async function resolveApiTargetWithFallback(): Promise<ApiTarget> {
  try {
    return await resolveApiTarget()
  } catch (error) {
    if (error instanceof PortalBridgeAuthError) {
      throw error
    }
    return legacyApiTarget()
  }
}

function mergeHeaders(target: ApiTarget, headers?: HeadersInit) {
  const merged = new Headers(headers)
  for (const [name, value] of Object.entries(target.headers)) {
    merged.set(name, value)
  }
  return merged
}

async function fetchWithTarget(
  path: string,
  init: RequestInit,
  target: ApiTarget,
): Promise<Response> {
  try {
    return await fetch(buildContractReviewApiUrl(target.baseUrl, path, window.location.origin), {
      ...init,
      headers: mergeHeaders(target, init.headers),
    })
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }

    const message =
      error instanceof Error && error.message
        ? `请求失败：${error.message}`
        : '请求失败，请稍后重试。'
    throw createApiRequestError(message, 0, target.isPlatformApi)
  }
}

function platformProxyUnavailableResponse(response: Response, target: ApiTarget) {
  return target.isPlatformApi && (response.status === 502 || response.status === 503)
}

export async function getContractReviewApiBase() {
  const target = await resolveApiTargetWithFallback()
  return target.baseUrl
}

export async function contractReviewFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const target = await resolveApiTargetWithFallback()

  try {
    const response = await fetchWithTarget(path, init, target)
    if (!platformProxyUnavailableResponse(response, target)) {
      return response
    }

    if (!isSafeFallbackMethod(init)) {
      return response
    }

    warnLegacyFallback(createApiRequestError(`请求失败（HTTP ${response.status}）`, response.status, true))
    return fetchWithTarget(path, init, legacyApiTarget())
  } catch (error) {
    if (!isRetriablePlatformFailure(error) || !isSafeFallbackMethod(init)) {
      throw error
    }
    warnLegacyFallback(error)
    return fetchWithTarget(path, init, legacyApiTarget())
  }
}

export async function contractReviewJsonFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await contractReviewFetch(path, {
    ...init,
    headers,
  })
  return (await response.json()) as T
}
