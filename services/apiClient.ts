import axios from 'axios';
import { requestAccessToken } from './authTokenProvider';
import { dispatchLoginRequired } from './authRedirect';

const LOGTO_STORAGE_PREFIX = 'logto';
const LOGTO_ACCESS_TOKEN_ITEM = 'accessToken';
const TOKEN_EXPIRY_SKEW_SECONDS = 30;

type LogtoAccessTokenEntry = {
    token?: string;
    scope?: string;
    expiresAt?: number;
};

const buildLogtoAccessTokenKey = (appId: string) => {
    return `${LOGTO_STORAGE_PREFIX}:${appId}:${LOGTO_ACCESS_TOKEN_ITEM}`;
};

const getLogtoResource = (): string | undefined => {
    return import.meta.env.VITE_LOGTO_RESOURCE;
};

const parseLogtoAccessTokenMap = (raw: string): Record<string, LogtoAccessTokenEntry> | null => {
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') {
            return null;
        }
        return parsed as Record<string, LogtoAccessTokenEntry>;
    } catch (error) {
        console.error('Failed to parse Logto access token map', error);
        return null;
    }
};

const isAccessTokenUsable = (entry: LogtoAccessTokenEntry): boolean => {
    if (!entry?.token) {
        return false;
    }
    if (typeof entry.expiresAt !== 'number') {
        return true;
    }
    const nowInSeconds = Date.now() / 1000;
    return entry.expiresAt > nowInSeconds + TOKEN_EXPIRY_SKEW_SECONDS;
};

const pickLogtoAccessToken = (
    tokenMap: Record<string, LogtoAccessTokenEntry>,
    resource?: string
): string | null => {
    const entries = Object.entries(tokenMap);
    if (!entries.length) {
        return null;
    }

    const usableEntries = entries.filter(([, entry]) => isAccessTokenUsable(entry));
    if (!usableEntries.length) {
        return null;
    }

    if (resource) {
        const match = usableEntries.find(([key, entry]) => {
            return key.includes(`@${resource}`) && typeof entry?.token === 'string';
        });
        if (match) {
            return match[1].token ?? null;
        }
        // 如果指定了资源但没找到对应的Token,不要降级使用其他Token,因为Audience不匹配会导致401
        console.warn(`[pickLogtoAccessToken] No token found for resource: ${resource}`);
        return null;
    }

    const fallback = usableEntries.find(([, entry]) => typeof entry?.token === 'string');
    return fallback ? fallback[1].token ?? null : null;
};

const getLogtoAccessToken = (resource?: string): string | null => {
    const appId = import.meta.env.VITE_LOGTO_APP_ID;
    if (!appId) {
        return null;
    }

    const storageKey = buildLogtoAccessTokenKey(appId);
    const tokenData = localStorage.getItem(storageKey);
    if (!tokenData) {
        return null;
    }

    const tokenMap = parseLogtoAccessTokenMap(tokenData);
    if (!tokenMap) {
        return null;
    }

    return pickLogtoAccessToken(tokenMap, resource);
};

const resolveAccessToken = async (resource?: string): Promise<string | null> => {
    const providerToken = await requestAccessToken(resource);
    if (providerToken) {
        return providerToken;
    }
    return getLogtoAccessToken(resource);
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
        const resource = getLogtoResource();
        const token = await resolveAccessToken(resource);
        console.log(`[API Client] Resource: ${resource}, Token found: ${!!token}`);

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
            console.error('Authentication failed, redirecting to login...');
            if (isWriteMethod(error.config?.method)) {
                dispatchLoginRequired('unauthorized-write');
            }
        }
        return Promise.reject(error);
    }
);

export default apiClient;
