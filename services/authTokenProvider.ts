import { isAuthTokenUsable } from './apiClientAuth.ts';

const LOG_PREFIX = '[authTokenProvider]';

export type AuthTokenProvider = () => Promise<string | null>;
export type AuthSessionInvalidator = () => Promise<unknown>;
export type AuthSessionRefresher = () => Promise<unknown>;

let authTokenProvider: AuthTokenProvider | null = null;

export const setAuthTokenProvider = (provider: AuthTokenProvider) => {
    authTokenProvider = provider;
};

export const clearAuthTokenProvider = () => {
    authTokenProvider = null;
};

export const createLogtoAuthSessionRefresher = (
    clearCachedAccessToken?: AuthSessionInvalidator | null,
    refreshAccessToken?: AuthSessionRefresher | null
): AuthSessionRefresher | null => {
    if (!refreshAccessToken) {
        return null;
    }

    return async () => {
        if (clearCachedAccessToken) {
            await clearCachedAccessToken();
        }
        await refreshAccessToken();
    };
};

export const resolveUsableAuthToken = async (
    readAuthToken: AuthTokenProvider,
    refreshAuthSession?: AuthSessionRefresher | null,
    nowInSeconds = Date.now() / 1000
): Promise<string | null> => {
    const token = await readAuthToken();
    if (isAuthTokenUsable(token, nowInSeconds)) {
        return token ?? null;
    }

    if (!refreshAuthSession) {
        return null;
    }

    await refreshAuthSession();
    const refreshedToken = await readAuthToken();
    return isAuthTokenUsable(refreshedToken, nowInSeconds) ? refreshedToken ?? null : null;
};

export const requestAuthToken = async (): Promise<string | null> => {
    if (!authTokenProvider) {
        return null;
    }

    try {
        const token = await authTokenProvider();
        return token ?? null;
    } catch (error) {
        console.warn(`${LOG_PREFIX} Failed to get auth token`, error);
        return null;
    }
};
