import { isAuthTokenUsable, readAuthUserKeyFromToken } from './apiClientAuth.ts';

const LOG_PREFIX = '[authTokenProvider]';

export type AuthTokenProvider = () => Promise<string | null>;
export type AuthSessionInvalidator = () => Promise<unknown>;
export type AuthSessionRefresher = () => Promise<unknown>;

let authTokenProvider: AuthTokenProvider | null = null;
let authProviderGeneration = 0;
let authTokenRequestGeneration = 0;
let latestCompletedAuthTokenRequestGeneration = 0;
let authVerificationProbeGeneration = 0;
let authSessionInvalidError: unknown = null;
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

export interface AuthTokenVerificationProbe {
    readonly ownerKey: string | null;
    publish: (expectedOwnerKey: string) => boolean;
    discard: () => void;
}

export const isAuthSessionInvalidError = (error: unknown): boolean => {
    if (!error || typeof error !== 'object') {
        return false;
    }
    const code = 'code' in error ? error.code : undefined;
    return code === 'oidc.invalid_grant' || code === 'invalid_grant';
};

export const markAuthSessionInvalid = (error: unknown): boolean => {
    if (!isAuthSessionInvalidError(error)) {
        return false;
    }
    authSessionInvalidError = error;
    return true;
};

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
    authVerificationProbeGeneration += 1;
    authTokenProvider = provider;
    authTokenRequestGeneration = 0;
    latestCompletedAuthTokenRequestGeneration = 0;
    authSessionInvalidError = null;
    pendingClaimsOwnerKey = null;
    advanceAuthSession(null, 'none', true);
};

export const clearAuthTokenProvider = () => {
    authProviderGeneration += 1;
    authVerificationProbeGeneration += 1;
    authTokenProvider = null;
    authTokenRequestGeneration = 0;
    latestCompletedAuthTokenRequestGeneration = 0;
    authSessionInvalidError = null;
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

const requestAuthTokenInternal = async (
    propagateSessionInvalidError: boolean,
): Promise<string | null> => {
    const provider = authTokenProvider;
    if (!provider) {
        return null;
    }
    if (authSessionInvalidError) {
        if (propagateSessionInvalidError) {
            throw authSessionInvalidError;
        }
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
        // A pending claims identity may only be promoted by an atomic
        // verification proof after its fresh-claims recheck. Ordinary API token
        // reads stay fail-closed even when the token happens to match pending.
        if (pendingClaimsOwnerKey !== null) {
            return null;
        }
        if (
            !isAuthSessionSnapshotCurrent(sessionAtRequestStart)
            && tokenOwnerKey !== authSessionOwnerKey
        ) {
            return null;
        }
        if (requestGeneration < latestCompletedAuthTokenRequestGeneration) {
            if (tokenOwnerKey !== authSessionOwnerKey) {
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
        advanceAuthSession(tokenOwnerKey, 'token');
        return normalizedToken;
    } catch (error) {
        if (isAuthSessionInvalidError(error)) {
            if (
                provider === authTokenProvider
                && providerGeneration === authProviderGeneration
            ) {
                markAuthSessionInvalid(error);
            }
            if (propagateSessionInvalidError) {
                throw error;
            }
            return null;
        }
        console.warn(`${LOG_PREFIX} Failed to get auth token`, error);
        return null;
    }
};

export const setAuthSessionPendingClaimsOwner = (ownerKey: string) => {
    const isUnchangedPendingOwner = (
        authSessionOwnerKey === null
        && authSessionAuthority === 'pending-claims'
        && pendingClaimsOwnerKey === ownerKey
    );
    const wasAlreadyPending = authSessionAuthority === 'pending-claims';
    pendingClaimsOwnerKey = ownerKey;
    if (isUnchangedPendingOwner) {
        return;
    }
    advanceAuthSession(
        null,
        'pending-claims',
        authSessionOwnerKey === null && wasAlreadyPending,
    );
};

export const requestAuthToken = async (): Promise<string | null> => (
    requestAuthTokenInternal(false)
);

const createInactiveVerificationProbe = (
    ownerKey: string | null = null,
): AuthTokenVerificationProbe => ({
    ownerKey,
    publish: () => false,
    discard: () => undefined,
});

export const probeAuthTokenForVerification = async (): Promise<AuthTokenVerificationProbe> => {
    const provider = authTokenProvider;
    if (!provider) {
        return createInactiveVerificationProbe();
    }
    if (authSessionInvalidError) {
        throw authSessionInvalidError;
    }

    const providerGeneration = authProviderGeneration;
    const sessionAtProbeStart = readAuthSessionSnapshot();
    const probeGeneration = authVerificationProbeGeneration + 1;
    authVerificationProbeGeneration = probeGeneration;

    try {
        const token = await provider();
        if (
            provider !== authTokenProvider
            || providerGeneration !== authProviderGeneration
            || probeGeneration !== authVerificationProbeGeneration
        ) {
            return createInactiveVerificationProbe();
        }

        const ownerKey = readAuthUserKeyFromToken(token ?? null);
        let active = true;
        return {
            ownerKey,
            publish: (expectedOwnerKey: string) => {
                if (!active) {
                    return false;
                }
                active = false;
                if (
                    ownerKey !== expectedOwnerKey
                    || provider !== authTokenProvider
                    || providerGeneration !== authProviderGeneration
                    || probeGeneration !== authVerificationProbeGeneration
                    || !isAuthSessionSnapshotCurrent(sessionAtProbeStart)
                    || (
                        pendingClaimsOwnerKey !== null
                        && pendingClaimsOwnerKey !== expectedOwnerKey
                    )
                ) {
                    return false;
                }
                pendingClaimsOwnerKey = null;
                advanceAuthSession(expectedOwnerKey, 'token');
                return true;
            },
            discard: () => {
                // Proofs can be shared by multiple useAuthUserKey consumers.
                // Releasing one consumer must not invalidate another; safety is
                // enforced by the one-shot publish CAS and provider/session gens.
            },
        };
    } catch (error) {
        if (isAuthSessionInvalidError(error)) {
            if (
                provider === authTokenProvider
                && providerGeneration === authProviderGeneration
            ) {
                markAuthSessionInvalid(error);
            }
            throw error;
        }
        console.warn(`${LOG_PREFIX} Failed to probe auth token`, error);
        return createInactiveVerificationProbe();
    }
};
