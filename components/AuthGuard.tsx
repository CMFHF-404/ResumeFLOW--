import { useLogto } from '@logto/react';
import { useCallback, useEffect, ReactNode, useRef, useState } from 'react';
import {
    clearAuthTokenProvider,
    createLogtoAuthSessionRefresher,
    resolveUsableAuthToken,
    setAuthTokenProvider,
} from '../services/authTokenProvider';
import { subscribeLoginRequired } from '../services/authRedirect';
import { devLog } from '../services/devLogger';
import {
    isForceReauthReason,
    markUserSignInStarted,
    shouldAutoSignInForLoginRequired,
} from '../services/authFlowState';
import { trackLoginStart } from '../utils/analyticsTracker';

interface AuthGuardProps {
    children: ReactNode;
}

export default function AuthGuard({ children }: AuthGuardProps) {
    const {
        isAuthenticated,
        isLoading,
        signIn,
        clearAccessToken,
        getAccessToken,
        getIdToken,
    } = useLogto();
    const [isTokenReady, setIsTokenReady] = useState(false);
    const [hasAuthenticatedOnce, setHasAuthenticatedOnce] = useState(false);
    const clearAccessTokenRef = useRef(clearAccessToken ?? null);
    const getAccessTokenRef = useRef(getAccessToken ?? null);
    const getIdTokenRef = useRef(getIdToken ?? null);
    const isSigningInRef = useRef(false);
    const hasTokenGetter = !!getIdToken;

    useEffect(() => {
        clearAccessTokenRef.current = clearAccessToken ?? null;
        getAccessTokenRef.current = getAccessToken ?? null;
        getIdTokenRef.current = getIdToken ?? null;
    }, [clearAccessToken, getAccessToken, getIdToken]);

    useEffect(() => {
        if (isAuthenticated) {
            markUserSignInStarted();
            setHasAuthenticatedOnce(true);
        }
    }, [isAuthenticated]);

    useEffect(() => {
        const unsubscribe = subscribeLoginRequired(({ reason, redirectUri }) => {
            const shouldForceReauth = isForceReauthReason(reason);

            if (!shouldAutoSignInForLoginRequired({
                reason,
                isAuthenticated,
                isLoading,
                isSigningIn: isSigningInRef.current,
            })) {
                return;
            }
            devLog('[AuthGuard] Login required:', reason || 'unknown');
            markUserSignInStarted();
            isSigningInRef.current = true;
            void (async () => {
                await trackLoginStart(shouldForceReauth ? 'auth_guard_reauth' : 'auth_guard');
                await signIn(redirectUri || import.meta.env.VITE_LOGTO_REDIRECT_URI);
            })();
        });

        return unsubscribe;
    }, [isAuthenticated, isLoading, signIn]);

    useEffect(() => {
        if (!isLoading) {
            isSigningInRef.current = false;
        }
    }, [isLoading]);

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

    const handleUnauthenticatedSignIn = useCallback(() => {
        if (isLoading || isSigningInRef.current) {
            return;
        }

        markUserSignInStarted();
        isSigningInRef.current = true;
        void (async () => {
            try {
                await trackLoginStart('auth_guard_unauthenticated');
                await signIn(import.meta.env.VITE_LOGTO_REDIRECT_URI || window.location.href);
            } catch (error) {
                isSigningInRef.current = false;
                console.warn('[AuthGuard] Failed to start sign-in', error);
            }
        })();
    }, [isLoading, signIn]);

    const shouldShowLoading =
        (isLoading && !hasAuthenticatedOnce) || (isAuthenticated && !isTokenReady);

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

    if (!isAuthenticated) {
        return (
            <div className="flex h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-900">
                <div className="w-full max-w-sm rounded-lg bg-white p-8 text-center shadow-lg dark:bg-gray-800">
                    <h1 className="mb-3 text-xl font-bold text-gray-900 dark:text-white">
                        需要登录
                    </h1>
                    <p className="mb-6 text-sm text-gray-600 dark:text-gray-300">
                        登录后继续使用 ResumeFLOW。
                    </p>
                    <button
                        type="button"
                        onClick={handleUnauthenticatedSignIn}
                        className="rounded-lg bg-primary px-6 py-2 font-medium text-white transition-colors hover:bg-primary-dark"
                    >
                        登录
                    </button>
                </div>
            </div>
        );
    }

    return <>{children}</>;
}
