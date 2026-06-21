const TOKEN_EXPIRY_SKEW_SECONDS = 30;

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

export const isAuthTokenUsable = (
    token?: string | null,
    nowInSeconds = Date.now() / 1000,
    expirySkewSeconds = TOKEN_EXPIRY_SKEW_SECONDS
): boolean => {
    if (!token) {
        return false;
    }
    const payload = decodeJwtPayload(token);
    if (typeof payload?.exp !== 'number') {
        return false;
    }
    return payload.exp > nowInSeconds + expirySkewSeconds;
};

export const readAuthUserKeyFromToken = (token?: string | null): string | null => {
    if (!token) {
        return null;
    }
    const payload = decodeJwtPayload(token);
    return typeof payload?.sub === 'string' ? payload.sub : null;
};
