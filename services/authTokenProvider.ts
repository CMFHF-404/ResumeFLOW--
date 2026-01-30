const LOG_PREFIX = '[authTokenProvider]';

export type AccessTokenProvider = (resource?: string) => Promise<string | null>;

let accessTokenProvider: AccessTokenProvider | null = null;

export const setAccessTokenProvider = (provider: AccessTokenProvider) => {
    accessTokenProvider = provider;
};

export const clearAccessTokenProvider = () => {
    accessTokenProvider = null;
};

export const requestAccessToken = async (resource?: string): Promise<string | null> => {
    if (!accessTokenProvider) {
        return null;
    }

    try {
        const token = await accessTokenProvider(resource);
        return token ?? null;
    } catch (error) {
        console.warn(`${LOG_PREFIX} Failed to get access token`, error);
        return null;
    }
};
