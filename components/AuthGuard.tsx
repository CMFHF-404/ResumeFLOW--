import { useLogto } from '@logto/react';
import { useEffect, ReactNode, useRef, useState } from 'react';
import {
    clearAuthTokenProvider,
    createLogtoAuthSessionRefresher,
    isAuthSessionSnapshotCurrent,
    isAuthSessionInvalidError,
    markAuthSessionInvalid,
    readAuthSessionSnapshot,
    resolveUsableAuthToken,
    setAuthTokenProvider,
} from '../services/authTokenProvider';
import { subscribeLoginRequired } from '../services/authRedirect';
import {
    handleAuthFailure,
    readAuthRecoveryIssue,
    resetAuthRecoveryCycle,
    scheduleAuthDependencyProbe,
    subscribeAuthRecoveryIssue,
    type AuthRecoveryIssue,
} from '../services/authRecoveryCoordinator';
import apiClient from '../services/apiClient';
import { devLog } from '../services/devLogger';
import {
    isForceReauthReason,
    markUserSignInStarted,
    shouldAutoSignInForLoginRequired,
} from '../services/authFlowState';
import { trackLoginStart } from '../utils/analyticsTracker';

interface AuthGuardProps {
    authUserKey: string | null;
    children: ReactNode;
}

type LoginRequiredPayload = {
    reason?: string;
    redirectUri?: string;
};

export default function AuthGuard({ authUserKey, children }: AuthGuardProps) {
    const {
        isAuthenticated,
        isLoading,
        error: authError,
        signIn,
        clearAccessToken,
        clearAllTokens,
        getAccessToken,
        getIdToken,
    } = useLogto();
    const [isTokenReady, setIsTokenReady] = useState(false);
    const [hasAuthenticatedOnce, setHasAuthenticatedOnce] = useState(false);
    const [recoveryIssue, setRecoveryIssue] = useState<AuthRecoveryIssue | null>(
        () => readAuthRecoveryIssue(),
    );
    const [dependencyProbeAttempt, setDependencyProbeAttempt] = useState(0);
    const clearAccessTokenRef = useRef(clearAccessToken ?? null);
    const clearAllTokensRef = useRef(clearAllTokens ?? null);
    const getAccessTokenRef = useRef(getAccessToken ?? null);
    const getIdTokenRef = useRef(getIdToken ?? null);
    const isSigningInRef = useRef(false);
    const hasQueuedInvalidSessionReauthRef = useRef(false);
    const pendingLoginRequiredRef = useRef<LoginRequiredPayload | null>(null);
    const hasTokenGetter = !!getIdToken;

    useEffect(() => {
        clearAccessTokenRef.current = clearAccessToken ?? null;
        clearAllTokensRef.current = clearAllTokens ?? null;
        getAccessTokenRef.current = getAccessToken ?? null;
        getIdTokenRef.current = getIdToken ?? null;
    }, [clearAccessToken, clearAllTokens, getAccessToken, getIdToken]);

    useEffect(() => {
        if (isAuthenticated) {
            markUserSignInStarted();
            setHasAuthenticatedOnce(true);
        }
    }, [isAuthenticated]);

    useEffect(() => {
        if (!isAuthenticated) {
            hasQueuedInvalidSessionReauthRef.current = false;
        }
    }, [isAuthenticated]);

    useEffect(() => subscribeAuthRecoveryIssue(setRecoveryIssue), []);

    useEffect(() => {
        if (!isLoading) {
            isSigningInRef.current = false;
        }
    }, [isLoading]);

    useEffect(() => {
        const handleLoginRequired = ({ reason, redirectUri }: LoginRequiredPayload) => {
            const shouldForceReauth = isForceReauthReason(reason);
            const decisionNow = Date.now();
            const decisionInput = {
                reason,
                isAuthenticated,
                isLoading,
                isSigningIn: isSigningInRef.current,
                now: decisionNow,
            };

            if (!shouldAutoSignInForLoginRequired(decisionInput)) {
                // The recovery coordinator has already recorded this login
                // request. Preserve it only when Logto loading is the sole
                // blocker at this same decision instant; logout suppression
                // and an active sign-in must cancel the stale event.
                const shouldReplayAfterLoading = isLoading
                    && shouldAutoSignInForLoginRequired({
                        ...decisionInput,
                        isLoading: false,
                    });
                pendingLoginRequiredRef.current = shouldReplayAfterLoading
                    ? { reason, redirectUri }
                    : null;
                return;
            }
            pendingLoginRequiredRef.current = null;
            devLog('[AuthGuard] Login required:', reason || 'unknown');
            markUserSignInStarted();
            isSigningInRef.current = true;
            void (async () => {
                try {
                    if (shouldForceReauth) {
                        await clearAllTokensRef.current?.();
                    }
                    await trackLoginStart(
                        shouldForceReauth
                            ? 'auth_guard_reauth'
                            : isAuthenticated
                                ? 'auth_guard'
                                : 'auth_guard_unauthenticated'
                    );
                    await signIn(redirectUri || import.meta.env.VITE_LOGTO_REDIRECT_URI);
                } catch (error) {
                    console.error('[AuthGuard] Failed to start sign-in', error);
                    isSigningInRef.current = false;
                    setRecoveryIssue({
                        kind: 'reauth-failed',
                        code: 'sign_in_start_failed',
                        message: '无法启动重新登录，请稍后重试。',
                    });
                }
            })();
        };

        const unsubscribe = subscribeLoginRequired(handleLoginRequired);
        const pendingLoginRequired = pendingLoginRequiredRef.current;
        if (pendingLoginRequired) {
            handleLoginRequired(pendingLoginRequired);
        }

        return unsubscribe;
    }, [isAuthenticated, isLoading, signIn]);

    useEffect(() => {
        if (
            !isAuthenticated
            || !markAuthSessionInvalid(authError)
            || hasQueuedInvalidSessionReauthRef.current
        ) {
            return;
        }
        const session = readAuthSessionSnapshot();
        const outcome = handleAuthFailure({
            status: 401,
            data: { error: { code: 'session_invalid' } },
            sessionOwnerKey: session.ownerKey,
            isAuthenticated,
            isCurrentSession: isAuthSessionSnapshotCurrent(session),
        });
        if (outcome !== 'ignored') {
            hasQueuedInvalidSessionReauthRef.current = true;
        }
    }, [authError, isAuthenticated]);

    useEffect(() => {
        if (!isAuthenticated || !hasTokenGetter) {
            clearAuthTokenProvider();
            setIsTokenReady(false);
            return;
        }

        // 通过 ref 读取最新的 getIdToken，避免函数引用变化导致反复卸载子树
        setAuthTokenProvider(async () => {
            const tokenGetter = getIdTokenRef.current;
            if (!tokenGetter) {
                return null;
            }
            try {
                return await resolveUsableAuthToken(
                    tokenGetter,
                    createLogtoAuthSessionRefresher(
                        clearAccessTokenRef.current,
                        getAccessTokenRef.current
                    )
                );
            } catch (error) {
                console.warn('[AuthGuard] Failed to get ID token', error);
                if (isAuthSessionInvalidError(error)) {
                    if (!hasQueuedInvalidSessionReauthRef.current) {
                        const session = readAuthSessionSnapshot();
                        const outcome = handleAuthFailure({
                            status: 401,
                            data: { error: { code: 'session_invalid' } },
                            sessionOwnerKey: session.ownerKey,
                            isAuthenticated,
                            isCurrentSession: isAuthSessionSnapshotCurrent(session),
                        });
                        if (outcome !== 'ignored') {
                            hasQueuedInvalidSessionReauthRef.current = true;
                        }
                    }
                    throw error;
                }
                return null;
            }
        });
        setIsTokenReady(true);

        const tokenGetter = getIdTokenRef.current;
        if (tokenGetter) {
            tokenGetter().catch((error) => {
                console.warn('[AuthGuard] ID token warmup failed', error);
            });
        }

        return () => {
            clearAuthTokenProvider();
            setIsTokenReady(false);
        };
    }, [hasTokenGetter, isAuthenticated]);

    useEffect(() => {
        if (recoveryIssue?.kind !== 'dependency-unavailable') {
            if (dependencyProbeAttempt !== 0) {
                setDependencyProbeAttempt(0);
            }
            return;
        }
        if (!isAuthenticated || !isTokenReady) {
            return;
        }

        const cancelProbe = scheduleAuthDependencyProbe(
            dependencyProbeAttempt,
            async () => {
                try {
                    const sessionOwnerKey = (
                        authUserKey
                        ?? readAuthSessionSnapshot().ownerKey
                        ?? undefined
                    );
                    await apiClient.get('/profile', {
                        expectedAuthCacheKey: sessionOwnerKey,
                        suppressAuthRecovery: true,
                    });
                } catch {
                    // The visible dependency state remains while the bounded probe retries.
                } finally {
                    setDependencyProbeAttempt((current) => (
                        Math.max(current, dependencyProbeAttempt + 1)
                    ));
                }
            },
        );
        if (!cancelProbe) {
            return;
        }
        return cancelProbe;
    }, [
        authUserKey,
        dependencyProbeAttempt,
        isAuthenticated,
        isTokenReady,
        recoveryIssue?.kind,
    ]);

    const shouldShowLoading =
        (isLoading && !hasAuthenticatedOnce)
        || (isAuthenticated && (!isTokenReady || !authUserKey));

    const handleManualSignIn = () => {
        if (isSigningInRef.current) {
            return;
        }
        if (!resetAuthRecoveryCycle()) {
            return;
        }
        markUserSignInStarted();
        isSigningInRef.current = true;
        void (async () => {
            try {
                await clearAllTokensRef.current?.();
                await trackLoginStart('auth_guard_reauth');
                await signIn(import.meta.env.VITE_LOGTO_REDIRECT_URI);
            } catch (error) {
                console.error('[AuthGuard] Manual sign-in failed', error);
                isSigningInRef.current = false;
                setRecoveryIssue({
                    kind: 'reauth-failed',
                    code: 'sign_in_start_failed',
                    message: '无法启动重新登录，请稍后重试。',
                });
            }
        })();
    };

    const handleManualRetry = () => {
        if (!resetAuthRecoveryCycle()) {
            return;
        }
        window.location.reload();
    };

    if (recoveryIssue) {
        const dependencyUnavailable = recoveryIssue.kind === 'dependency-unavailable';
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-50 px-4 dark:bg-gray-900">
                <div className="w-full max-w-md rounded-xl bg-white p-6 text-center shadow-sm dark:bg-gray-800">
                    <h1 className="mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
                        {dependencyUnavailable ? '认证服务暂时不可用' : '认证状态未能恢复'}
                    </h1>
                    <p className="mb-2 text-sm text-gray-600 dark:text-gray-300">
                        {recoveryIssue.message}
                    </p>
                    <p className="mb-5 font-mono text-xs text-gray-400">
                        错误码：{recoveryIssue.code}
                    </p>
                    <div className="flex justify-center gap-3">
                        <button
                            type="button"
                            className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                            onClick={handleManualRetry}
                        >
                            重试
                        </button>
                        <button
                            type="button"
                            className="rounded-md bg-primary px-4 py-2 text-sm text-white hover:opacity-90"
                            onClick={handleManualSignIn}
                        >
                            手动重新登录
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (shouldShowLoading) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-50 dark:bg-gray-900">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
                    <p className="text-gray-600 dark:text-gray-400">加载中...</p>
                </div>
            </div>
        );
    }

    return <>{children}</>;
}
