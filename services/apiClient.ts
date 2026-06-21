import axios from 'axios';
import { requestAuthToken } from './authTokenProvider';
import { dispatchLoginRequired } from './authRedirect';
import { devLog } from './devLogger';
import { readAuthUserKeyFromToken } from './apiClientAuth';

let authTokenRequestInFlight: Promise<string | null> | null = null;

const resolveAuthTokenFromActiveSession = async (): Promise<string | null> => {
    const inFlightRequest = authTokenRequestInFlight;
    if (inFlightRequest) {
        return inFlightRequest;
    }

    const requestPromise = (async () => {
        const providerToken = await requestAuthToken();
        return providerToken ?? null;
    })();

    authTokenRequestInFlight = requestPromise;

    try {
        return await requestPromise;
    } finally {
        if (authTokenRequestInFlight === requestPromise) {
            authTokenRequestInFlight = null;
        }
    }
};

const resolveAuthToken = async (): Promise<string | null> => {
    return resolveAuthTokenFromActiveSession();
};

export const resolveAuthUserKeyFromActiveSession = async (): Promise<string | null> => {
    const token = await resolveAuthTokenFromActiveSession();
    return readAuthUserKeyFromToken(token);
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
    const token = await resolveAuthToken();
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
    const token = await resolveAuthToken();
    return readAuthUserKeyFromToken(token) ?? token ?? 'anonymous';
};

// 请求拦截器:自动添加JWT Token
apiClient.interceptors.request.use(
    async (config) => {
        if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
            // 让浏览器为 FormData 自动设置带 boundary 的 Content-Type。
            config.headers.delete('Content-Type');
        }

        const token = await resolveAuthToken();
        devLog(`[API Client] ID token found: ${!!token}`);

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
            dispatchLoginRequired(
                isWriteMethod(error.config?.method) ? 'unauthorized-write' : 'unauthorized'
            );
        }
        return Promise.reject(error);
    }
);

export default apiClient;
