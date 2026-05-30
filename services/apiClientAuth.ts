const LOGTO_STORAGE_PREFIX = 'logto';
const LOGTO_ACCESS_TOKEN_ITEM = 'accessToken';
const TOKEN_EXPIRY_SKEW_SECONDS = 30;

export type LogtoAccessTokenEntry = {
    token?: string;
    scope?: string;
    expiresAt?: number;
};

type TokenStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const buildLogtoAccessTokenKey = (appId: string) => {
    return `${LOGTO_STORAGE_PREFIX}:${appId}:${LOGTO_ACCESS_TOKEN_ITEM}`;
};

export const parseLogtoAccessTokenMap = (
    raw: string
): Record<string, LogtoAccessTokenEntry> | null => {
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

export const isAccessTokenUsable = (entry: LogtoAccessTokenEntry): boolean => {
    if (!entry?.token) {
        return false;
    }
    if (typeof entry.expiresAt !== 'number') {
        return true;
    }
    const nowInSeconds = Date.now() / 1000;
    return entry.expiresAt > nowInSeconds + TOKEN_EXPIRY_SKEW_SECONDS;
};

export const pickLogtoAccessToken = (
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

const getBrowserStorage = (): TokenStorage | null => {
    if (typeof window === 'undefined') {
        return null;
    }
    return window.localStorage;
};

export const getCachedLogtoAccessToken = (
    appId: string | undefined,
    resource?: string,
    storage: TokenStorage | null = getBrowserStorage()
): string | null => {
    if (!appId || !storage) {
        return null;
    }

    const storageKey = buildLogtoAccessTokenKey(appId);
    const tokenData = storage.getItem(storageKey);
    if (!tokenData) {
        return null;
    }

    const tokenMap = parseLogtoAccessTokenMap(tokenData);
    if (!tokenMap) {
        return null;
    }

    return pickLogtoAccessToken(tokenMap, resource);
};

export const removeCachedLogtoAccessTokenEntries = (
    tokenMap: Record<string, LogtoAccessTokenEntry>,
    resource?: string
): Record<string, LogtoAccessTokenEntry> => {
    if (!resource) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(tokenMap).filter(([key]) => !key.includes(`@${resource}`))
    );
};

export const clearCachedLogtoAccessTokens = (
    appId: string | undefined,
    resource?: string,
    storage: TokenStorage | null = getBrowserStorage()
): boolean => {
    if (!appId || !storage) {
        return false;
    }

    const storageKey = buildLogtoAccessTokenKey(appId);
    const tokenData = storage.getItem(storageKey);
    if (!tokenData) {
        return false;
    }

    const tokenMap = parseLogtoAccessTokenMap(tokenData);
    if (!tokenMap) {
        storage.removeItem(storageKey);
        return true;
    }

    const nextTokenMap = removeCachedLogtoAccessTokenEntries(tokenMap, resource);
    if (Object.keys(nextTokenMap).length === Object.keys(tokenMap).length) {
        return false;
    }

    if (Object.keys(nextTokenMap).length === 0) {
        storage.removeItem(storageKey);
    } else {
        storage.setItem(storageKey, JSON.stringify(nextTokenMap));
    }
    return true;
};

const decodeJwtPayload = (token: string): Record<string, unknown> | null => {
    const segments = token.split('.');
    if (segments.length < 2) {
        return null;
    }
    try {
        const base64 = segments[1]
            .replace(/-/g, '+')
            .replace(/_/g, '/')
            .padEnd(Math.ceil(segments[1].length / 4) * 4, '=');
        const json = atob(base64);
        return JSON.parse(json) as Record<string, unknown>;
    } catch (error) {
        return null;
    }
};

export const readAuthUserKeyFromAccessToken = (token?: string | null): string | null => {
    if (!token) {
        return null;
    }
    const payload = decodeJwtPayload(token);
    return typeof payload?.sub === 'string' ? payload.sub : null;
};
