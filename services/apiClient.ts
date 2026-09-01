import axios from 'axios';
import {
    isAuthSessionSnapshotCurrent,
    readAuthSessionSnapshot,
    requestAuthToken,
    type AuthSessionSnapshot,
} from './authTokenProvider';
import { dispatchLoginRequired } from './authRedirect';
import {
    handleAuthFailure,
    markProtectedAuthSuccess,
} from './authRecoveryCoordinator';
import { devLog } from './devLogger';
import { readAuthUserKeyFromToken } from './apiClientAuth';
import {
    dispatchQuotaPurchaseRequired,
    readQuotaPurchaseMessage,
} from './quotaPurchasePrompt';

declare module 'axios' {
    interface AxiosRequestConfig<D = any> {
        expectedAuthCacheKey?: string;
        authCacheKeyAtDispatch?: string;
        authSessionEpochAtDispatch?: number;
        authSessionOwnerAtDispatch?: string | null;
        suppressAuthRecovery?: boolean;
    }
}

export interface AuthOwnerOptions {
    expectedAuthCacheKey?: string;
}

interface AuthTokenRequestEntry {
    generation: number;
    sessionAtStart: AuthSessionSnapshot;
    promise: Promise<ResolvedAuthToken>;
}

interface ResolvedAuthToken {
    token: string | null;
    session: AuthSessionSnapshot;
}

const authTokenRequestsInFlight = new Map<string, AuthTokenRequestEntry>();
let authTokenRequestGeneration = 0;
const AUTH_TOKEN_REQUEST_TIMEOUT_MS = 10_000;
const AUTH_TOKEN_REQUEST_TIMEOUT_MESSAGE = '获取登录状态超时，请刷新页面或重新登录后重试。';

export class AuthContextChangedError extends Error {
    constructor(message = 'Authentication context changed during operation') {
        super(message);
        this.name = 'AuthContextChangedError';
    }
}

export const isAuthContextChangedError = (error: unknown): error is AuthContextChangedError => (
    error instanceof Error && error.name === 'AuthContextChangedError'
);

const withAuthTokenRequestTimeout = async <T,>(
    promise: Promise<T>,
): Promise<T> => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(AUTH_TOKEN_REQUEST_TIMEOUT_MESSAGE));
        }, AUTH_TOKEN_REQUEST_TIMEOUT_MS);
    });

    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
        }
    }
};

const assertTokenOwner = (token: string | null, expectedAuthCacheKey?: string) => {
    if (!expectedAuthCacheKey) {
        return;
    }
    const tokenOwnerKey = readAuthUserKeyFromToken(token) ?? token ?? 'anonymous';
    if (tokenOwnerKey !== expectedAuthCacheKey) {
        throw new AuthContextChangedError(
            'Authentication context changed before request dispatch'
        );
    }
};

const assertResolvedTokenSession = (
    resolved: ResolvedAuthToken,
    sessionAtStart: AuthSessionSnapshot,
    expectedAuthCacheKey?: string,
) => {
    if (!isAuthSessionSnapshotCurrent(resolved.session)) {
        throw new AuthContextChangedError();
    }
    const initializedExpectedOwner = (
        sessionAtStart.ownerKey === null
        && !!expectedAuthCacheKey
        && resolved.session.ownerKey === expectedAuthCacheKey
    );
    const initializedUnboundSession = (
        sessionAtStart.ownerKey === null
        && !expectedAuthCacheKey
    );
    if (
        !initializedExpectedOwner
        && !initializedUnboundSession
        && (
            sessionAtStart.epoch !== resolved.session.epoch
            || sessionAtStart.ownerKey !== resolved.session.ownerKey
        )
    ) {
        throw new AuthContextChangedError();
    }
    assertTokenOwner(resolved.token, expectedAuthCacheKey);
};

const resolveAuthTokenWithSession = async (
    expectedAuthCacheKey?: string,
): Promise<ResolvedAuthToken> => {
    const sessionAtStart = readAuthSessionSnapshot();
    if (expectedAuthCacheKey) {
        const inFlightRequest = authTokenRequestsInFlight.get(expectedAuthCacheKey);
        if (
            inFlightRequest
            && inFlightRequest.sessionAtStart.epoch === sessionAtStart.epoch
            && inFlightRequest.sessionAtStart.ownerKey === sessionAtStart.ownerKey
        ) {
            const resolved = await withAuthTokenRequestTimeout(inFlightRequest.promise);
            assertResolvedTokenSession(
                resolved,
                inFlightRequest.sessionAtStart,
                expectedAuthCacheKey,
            );
            return resolved;
        }
    }

    const requestPromise = (async () => {
        const providerToken = await requestAuthToken();
        return {
            token: providerToken ?? null,
            session: readAuthSessionSnapshot(),
        };
    })();

    const generation = authTokenRequestGeneration + 1;
    authTokenRequestGeneration = generation;
    if (expectedAuthCacheKey) {
        authTokenRequestsInFlight.set(expectedAuthCacheKey, {
            generation,
            sessionAtStart,
            promise: requestPromise,
        });
    }

    try {
        const resolved = await withAuthTokenRequestTimeout(requestPromise);
        assertResolvedTokenSession(resolved, sessionAtStart, expectedAuthCacheKey);
        return resolved;
    } finally {
        if (
            expectedAuthCacheKey
            && authTokenRequestsInFlight.get(expectedAuthCacheKey)?.generation === generation
        ) {
            authTokenRequestsInFlight.delete(expectedAuthCacheKey);
        }
    }
};

const resolveAuthToken = async (expectedAuthCacheKey?: string): Promise<string | null> => {
    return (await resolveAuthTokenWithSession(expectedAuthCacheKey)).token;
};

export const resolveAuthUserKeyFromActiveSession = async (): Promise<string | null> => {
    const token = await resolveAuthToken();
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

export const getAuthorizationHeader = async (
    expectedAuthCacheKey?: string,
): Promise<string | null> => {
    const token = await resolveAuthToken(expectedAuthCacheKey);
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
    const establishedOwnerKey = readAuthSessionSnapshot().ownerKey;
    if (establishedOwnerKey !== null) {
        return establishedOwnerKey;
    }
    const token = await resolveAuthToken();
    return (
        readAuthSessionSnapshot().ownerKey
        ?? readAuthUserKeyFromToken(token)
        ?? token
        ?? 'anonymous'
    );
};

export const assertAuthCacheKey = async (expectedAuthCacheKey: string): Promise<void> => {
    const session = readAuthSessionSnapshot();
    if (session.ownerKey !== null) {
        if (session.ownerKey !== expectedAuthCacheKey) {
            throw new AuthContextChangedError();
        }
        return;
    }
    await resolveAuthToken(expectedAuthCacheKey);
};

export const captureAuthCacheKey = async (
    expectedAuthCacheKey?: string,
): Promise<string> => {
    const activeSessionOwnerKey = readAuthSessionSnapshot().ownerKey;
    const capturedAuthCacheKey = (
        expectedAuthCacheKey
        ?? activeSessionOwnerKey
        ?? await getAuthCacheKey()
    );
    if (!capturedAuthCacheKey || capturedAuthCacheKey === 'anonymous') {
        throw new AuthContextChangedError();
    }
    await assertAuthCacheKey(capturedAuthCacheKey);
    return capturedAuthCacheKey;
};

// 请求拦截器:自动添加JWT Token
apiClient.interceptors.request.use(
    async (config) => {
        if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
            // 让浏览器为 FormData 自动设置带 boundary 的 Content-Type。
            config.headers.delete('Content-Type');
        }

        const resolvedAuthToken = await resolveAuthTokenWithSession(
            config.expectedAuthCacheKey
        );
        const token = resolvedAuthToken.token;
        devLog(`[API Client] ID token found: ${!!token}`);

        const activeAuthCacheKey = readAuthUserKeyFromToken(token) ?? token ?? 'anonymous';
        if (
            config.expectedAuthCacheKey
            && config.expectedAuthCacheKey !== activeAuthCacheKey
        ) {
            return Promise.reject(
                new AuthContextChangedError('Authentication context changed before request dispatch')
            );
        }
        config.authCacheKeyAtDispatch = config.expectedAuthCacheKey ?? activeAuthCacheKey;
        config.authSessionEpochAtDispatch = resolvedAuthToken.session.epoch;
        config.authSessionOwnerAtDispatch = resolvedAuthToken.session.ownerKey;

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
    (response) => {
        if (
            typeof response.config?.authSessionEpochAtDispatch === 'number'
            && !isAuthSessionSnapshotCurrent({
                epoch: response.config.authSessionEpochAtDispatch,
                ownerKey: response.config.authSessionOwnerAtDispatch ?? null,
            })
        ) {
            return Promise.reject(new AuthContextChangedError());
        }
        markProtectedAuthSuccess(
            response.config?.url,
            response.status,
            response.config?.authSessionOwnerAtDispatch,
        );
        return response;
    },
    (error) => {
        const dispatchSession = typeof error.config?.authSessionEpochAtDispatch === 'number'
            ? {
                epoch: error.config.authSessionEpochAtDispatch,
                ownerKey: error.config.authSessionOwnerAtDispatch ?? null,
            }
            : null;
        if (dispatchSession && !isAuthSessionSnapshotCurrent(dispatchSession)) {
            return Promise.reject(new AuthContextChangedError());
        }
        if (error.response && !error.config?.suppressAuthRecovery) {
            handleAuthFailure({
                status: error.response.status,
                data: error.response.data,
                sessionOwnerKey: error.config?.authSessionOwnerAtDispatch,
                isCurrentSession: dispatchSession !== null,
            });
        }
        if (error.response?.status === 402) {
            dispatchQuotaPurchaseRequired(readQuotaPurchaseMessage(error.response.data));
        }
        return Promise.reject(error);
    }
);

export default apiClient;
