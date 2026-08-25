import { isAuthTokenUsable, readAuthUserKeyFromToken } from './apiClientAuth.ts';

const LOG_PREFIX = '[authTokenProvider]';

export type AuthTokenProvider = () => Promise<string | null>;
export type AuthSessionInvalidator = () => Promise<unknown>;
export type AuthSessionRefresher = () => Promise<unknown>;

let authTokenProvider: AuthTokenProvider | null = null;
let authProviderGeneration = 0;
let authTokenRequestGeneration = 0;
let latestCompletedAuthTokenRequestGeneration = 0;
let authSessionEpoch = 0;
let authSessionOwnerKey: string | null = null;
type AuthSessionAuthority = 'none' | 'claims' | 'pending-claims' | 'token' | 'explicit';
let authSessionAuthority: AuthSessionAuthority = 'none';
let pendingClaimsOwnerKey: string | null = null;
let authSessionSnapshot: AuthSessionSnapshot = { epoch: 0, ownerKey: null };
const authSessionSubscribers = new Set<() => void>();

export interface AuthSessionSnapshot {
    epoch: number;
    ownerKey: string | null;
}

const notifyAuthSessionSubscribers = () => {
    for (const subscriber of [...authSessionSubscribers]) {
        try {
            subscriber();
        } catch (error) {
            console.warn(`${LOG_PREFIX} Auth session subscriber failed`, error);
        }
    }
};

const advanceAuthSession = (
    ownerKey: string | null,
    authority: AuthSessionAuthority,
    force = false,
) => {
    if (!force && ownerKey === authSessionOwnerKey) {
        authSessionAuthority = authority;
        return;
    }
    authSessionEpoch += 1;
    authSessionOwnerKey = ownerKey;
    authSessionAuthority = authority;
    authSessionSnapshot = { epoch: authSessionEpoch, ownerKey: authSessionOwnerKey };
    notifyAuthSessionSubscribers();
};

export const readAuthSessionSnapshot = (): AuthSessionSnapshot => authSessionSnapshot;

export const subscribeAuthSession = (subscriber: () => void) => {
    authSessionSubscribers.add(subscriber);
    return () => {
        authSessionSubscribers.delete(subscriber);
    };
};

export const isAuthSessionSnapshotCurrent = (snapshot: AuthSessionSnapshot): boolean => (
    snapshot.epoch === authSessionEpoch
    && snapshot.ownerKey === authSessionOwnerKey
);

export const setAuthSessionOwner = (ownerKey: string | null) => {
    const hadPendingClaimsOwner = pendingClaimsOwnerKey !== null;
    pendingClaimsOwnerKey = null;
    advanceAuthSession(
        ownerKey,
        ownerKey === null ? 'none' : 'explicit',
        hadPendingClaimsOwner,
    );
};

export const setAuthSessionOwnerFromClaims = (
    ownerKey: string | null,
    previousClaimsOwnerKey: string | null | undefined,
) => {
    if (authSessionOwnerKey === ownerKey) {
        if (authSessionAuthority === 'none') {
            authSessionAuthority = 'claims';
        }
        return;
    }

    const isInitialClaimsAuthority = previousClaimsOwnerKey === undefined;
    const claimsIdentityChanged = !isInitialClaimsAuthority
        && previousClaimsOwnerKey !== ownerKey;

    // A stable Logto getter may publish a new account without first toggling
    // isAuthenticated. A fresh claims identity change must hide the previous
    // token-owned subtree immediately, but the weaker claims value may not
    // select the new owner until the token provider confirms it.
    if (authSessionAuthority === 'token' || authSessionAuthority === 'explicit') {
        if (claimsIdentityChanged && ownerKey !== null) {
            pendingClaimsOwnerKey = ownerKey;
            advanceAuthSession(null, 'pending-claims');
        }
        return;
    }

    if (authSessionAuthority === 'pending-claims') {
        if (
            claimsIdentityChanged
            && ownerKey !== null
            && ownerKey !== pendingClaimsOwnerKey
        ) {
            pendingClaimsOwnerKey = ownerKey;
            // The public owner remains null, but advancing the epoch invalidates
            // a token request for the superseded pending claims identity.
            advanceAuthSession(null, 'pending-claims', true);
        }
        return;
    }

    if (authSessionOwnerKey === null || claimsIdentityChanged) {
        pendingClaimsOwnerKey = null;
        advanceAuthSession(ownerKey, ownerKey === null ? 'none' : 'claims');
    }
};

export const setAuthTokenProvider = (provider: AuthTokenProvider) => {
    authProviderGeneration += 1;
    authTokenProvider = provider;
    authTokenRequestGeneration = 0;
    latestCompletedAuthTokenRequestGeneration = 0;
    pendingClaimsOwnerKey = null;
    advanceAuthSession(null, 'none', true);
};

export const clearAuthTokenProvider = () => {
    authProviderGeneration += 1;
    authTokenProvider = null;
    authTokenRequestGeneration = 0;
    latestCompletedAuthTokenRequestGeneration = 0;
    pendingClaimsOwnerKey = null;
    advanceAuthSession(null, 'none', true);
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
    const provider = authTokenProvider;
    if (!provider) {
        return null;
    }
    const providerGeneration = authProviderGeneration;
    const sessionAtRequestStart = readAuthSessionSnapshot();
    const requestGeneration = authTokenRequestGeneration + 1;
    authTokenRequestGeneration = requestGeneration;

    try {
        const token = await provider();
        if (
            provider !== authTokenProvider
            || providerGeneration !== authProviderGeneration
        ) {
            return null;
        }
        const normalizedToken = token ?? null;
        const tokenOwnerKey = readAuthUserKeyFromToken(normalizedToken);
        const confirmsPendingClaims = (
            pendingClaimsOwnerKey !== null
            && tokenOwnerKey === pendingClaimsOwnerKey
        );
        if (
            !isAuthSessionSnapshotCurrent(sessionAtRequestStart)
            && tokenOwnerKey !== authSessionOwnerKey
            && !confirmsPendingClaims
        ) {
            return null;
        }
        if (requestGeneration < latestCompletedAuthTokenRequestGeneration) {
            if (tokenOwnerKey !== authSessionOwnerKey && !confirmsPendingClaims) {
                return null;
            }
        }
        latestCompletedAuthTokenRequestGeneration = Math.max(
            latestCompletedAuthTokenRequestGeneration,
            requestGeneration,
        );
        // A missing/invalid token makes this request fail closed, but it is not
        // affirmative evidence of logout. Preserve an already-known owner;
        // clearAuthTokenProvider()/the unauthenticated transition owns logout.
        if (tokenOwnerKey === null) {
            return null;
        }
        if (
            pendingClaimsOwnerKey !== null
            && tokenOwnerKey !== pendingClaimsOwnerKey
        ) {
            return null;
        }
        pendingClaimsOwnerKey = null;
        advanceAuthSession(tokenOwnerKey, 'token');
        return normalizedToken;
    } catch (error) {
        console.warn(`${LOG_PREFIX} Failed to get auth token`, error);
        return null;
    }
};
