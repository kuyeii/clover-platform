import axios, { AxiosHeaders, type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import {
    getApiBaseUrl,
    resolveBidGeneratorApiTarget,
    warnLegacyFallback,
} from './apiBase';

type BidGeneratorAxiosConfig = InternalAxiosRequestConfig & {
    bidGeneratorTargetIsPlatformApi?: boolean;
    bidGeneratorRetriedLegacy?: boolean;
};

export const baseURL = getApiBaseUrl();

const api = axios.create({
    // 因为引入了多模态打标和 PIPT 实体本地校验，并发量大时后端模型推理以及Dify生成可能需要长达 1小时
    timeout: 3600000,
});

api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
    const nextConfig = config as BidGeneratorAxiosConfig;
    const headers = AxiosHeaders.from(config.headers);

    if (nextConfig.bidGeneratorRetriedLegacy) {
        headers.delete('Authorization');
        headers.delete('X-Portal-Client-Id');
        nextConfig.baseURL = getApiBaseUrl();
        nextConfig.headers = headers;
        nextConfig.bidGeneratorTargetIsPlatformApi = false;
        return nextConfig;
    }

    const target = await resolveBidGeneratorApiTarget();

    for (const [name, value] of Object.entries(target.headers)) {
        headers.set(name, value);
    }

    nextConfig.baseURL = target.baseUrl;
    nextConfig.headers = headers;
    nextConfig.bidGeneratorTargetIsPlatformApi = target.isPlatformApi;
    return nextConfig;
});

function shouldFallbackToLegacy(error: AxiosError) {
    const config = error.config as BidGeneratorAxiosConfig | undefined;
    if (!config?.bidGeneratorTargetIsPlatformApi || config.bidGeneratorRetriedLegacy) {
        return false;
    }
    if (error.response?.status === 502 || error.response?.status === 503) {
        return true;
    }
    return !error.response && error.code !== 'ERR_CANCELED';
}

api.interceptors.response.use(
    (response) => response.data,
    async (error: AxiosError) => {
        if (shouldFallbackToLegacy(error)) {
            warnLegacyFallback(error);
            const retryConfig = error.config as BidGeneratorAxiosConfig;
            const headers = AxiosHeaders.from(retryConfig.headers);
            headers.delete('Authorization');
            headers.delete('X-Portal-Client-Id');
            retryConfig.baseURL = getApiBaseUrl();
            retryConfig.headers = headers;
            retryConfig.bidGeneratorTargetIsPlatformApi = false;
            retryConfig.bidGeneratorRetriedLegacy = true;
            return api.request(retryConfig);
        }

        console.error('API Error:', error.response?.data || error.message);
        return Promise.reject(error);
    }
);

export default api;
