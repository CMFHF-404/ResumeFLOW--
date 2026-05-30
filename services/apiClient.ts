import axios from 'axios';
import { requestAccessToken } from './authTokenProvider';
import { dispatchLoginRequired } from './authRedirect';
import {
    clearCachedLogtoAccessTokens,
    getCachedLogtoAccessToken,
    readAuthUserKeyFromAccessToken,
} from './apiClientAuth';

const DEFAULT_ACCESS_TOKEN_REQUEST_KEY = '__default__';

const getLogtoAppId = (): string | undefined => {
    return import.meta.env.VITE_LOGTO_APP_ID;
};

const getLogtoResource = (): string | undefined => {
    return import.meta.env.VITE_LOGTO_RESOURCE;
};

const getLogtoAccessToken = (resource?: string): string | null => {
    return getCachedLogtoAccessToken(getLogtoAppId(), resource);
};

const accessTokenRequestInFlight = new Map<string, Promise<string | null>>();

const buildAccessTokenRequestKey = (resource?: string): string => {
    const normalizedResource = resource?.trim();
    return normalizedResource || DEFAULT_ACCESS_TOKEN_REQUEST_KEY;
};

export const readAuthUserKeyFromCachedAccessToken = (): string | null => {
    const resource = getLogtoResource();
    const token = getLogtoAccessToken(resource);
    return readAuthUserKeyFromAccessToken(token);
};

const resolveAccessTokenFromActiveSession = async (resource?: string): Promise<string | null> => {
    const requestKey = buildAccessTokenRequestKey(resource);
    const inFlightRequest = accessTokenRequestInFlight.get(requestKey);
    if (inFlightRequest) {
        return inFlightRequest;
    }

    const requestPromise = (async () => {
        const providerToken = await requestAccessToken(resource);
        return providerToken ?? null;
    })();

    accessTokenRequestInFlight.set(requestKey, requestPromise);

    try {
        return await requestPromise;
    } finally {
        if (accessTokenRequestInFlight.get(requestKey) === requestPromise) {
            accessTokenRequestInFlight.delete(requestKey);
        }
    }
};

const resolveAccessToken = async (resource?: string): Promise<string | null> => {
    const cachedToken = getLogtoAccessToken(resource);
    if (cachedToken) {
        return cachedToken;
    }

    const providerToken = await resolveAccessTokenFromActiveSession(resource);
    if (providerToken) {
        return providerToken;
    }
    return getLogtoAccessToken(resource);
};

export const resolveAuthUserKeyFromActiveSession = async (): Promise<string | null> => {
    const resource = getLogtoResource();
    const token = await resolveAccessTokenFromActiveSession(resource);
    return readAuthUserKeyFromAccessToken(token);
};

export const getApiBaseUrl = (): string => {
    const envBaseUrl = import.meta.env.VITE_API_BASE_URL;
    if (import.meta.env.DEV) {
        return '/api';
    }
    return envBaseUrl || '';
};

const isWriteMethod = (method?: string) => {
    if (!method) {
        return false;
    }
    const normalizedMethod = method.toUpperCase();
    return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(normalizedMethod);
};


export const getAuthorizationHeader = async (): Promise<string | null> => {
    const resource = getLogtoResource();
    const token = await resolveAccessToken(resource);
    if (!token) {
        return null;
    }
    return `Bearer ${token}`;
};

const apiClient = axios.create({
    baseURL: getApiBaseUrl(),
    headers: {
        'Content-Type': 'application/json',
    },
});

export const getAuthCacheKey = async (): Promise<string> => {
    const resource = getLogtoResource();
    const token = await resolveAccessToken(resource);
    return token ?? 'anonymous';
};

// 请求拦截器:自动添加JWT Token
apiClient.interceptors.request.use(
    async (config) => {
        if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
            // 让浏览器为 FormData 自动设置带 boundary 的 Content-Type。
            config.headers.delete('Content-Type');
        }

        const resource = getLogtoResource();
        const token = await resolveAccessToken(resource);
        if (import.meta.env.DEV) {
            console.log(`[API Client] Resource: ${resource}, Token found: ${!!token}`);
        }

        const shouldRequireLogin = isWriteMethod(config.method);

        if (!token && shouldRequireLogin) {
            dispatchLoginRequired('write-operation');
            return Promise.reject(new Error('Authentication required for write operation'));
        }

        if (token) {
            // 使用 Axios headers API 设置 Authorization header
            config.headers.set('Authorization', `Bearer ${token}`);
        }

        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// 响应拦截器:处理401错误
apiClient.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            const resource = getLogtoResource();
            clearCachedLogtoAccessTokens(getLogtoAppId(), resource);
            console.error('Authentication failed, redirecting to login...');
            dispatchLoginRequired(
                isWriteMethod(error.config?.method) ? 'unauthorized-write' : 'unauthorized'
            );
        }
        return Promise.reject(error);
    }
);

export default apiClient;
