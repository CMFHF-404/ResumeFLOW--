import axios from 'axios';

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
    }

    const fallback = usableEntries.find(([, entry]) => typeof entry?.token === 'string');
    return fallback ? fallback[1].token ?? null : null;
};

const getLogtoAccessToken = (): string | null => {
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

    return pickLogtoAccessToken(tokenMap, import.meta.env.VITE_LOGTO_RESOURCE);
};

const apiClient = axios.create({
    baseURL: import.meta.env.VITE_API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

// 请求拦截器:自动添加JWT Token
apiClient.interceptors.request.use(
    async (config) => {
        const token = getLogtoAccessToken();
        if (token) {
            config.headers = config.headers ?? {};
            config.headers.Authorization = `Bearer ${token}`;
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
            // Token过期或无效,清除本地存储并重定向到登录
            console.error('Authentication failed, redirecting to login...');
            // 可以在这里触发重新登录
        }
        return Promise.reject(error);
    }
);

export default apiClient;
