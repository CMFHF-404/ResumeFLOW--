import { useLogto } from '@logto/react';
import { useEffect, ReactNode, useMemo, useRef, useState } from 'react';
import { clearAccessTokenProvider, setAccessTokenProvider } from '../services/authTokenProvider';
import { subscribeLoginRequired } from '../services/authRedirect';

interface AuthGuardProps {
    children: ReactNode;
}

export default function AuthGuard({ children }: AuthGuardProps) {
    const { isAuthenticated, isLoading, signIn, getAccessToken } = useLogto();
    const [isTokenReady, setIsTokenReady] = useState(false);
    const [hasAuthenticatedOnce, setHasAuthenticatedOnce] = useState(false);
    const logtoResource = useMemo(() => import.meta.env.VITE_LOGTO_RESOURCE, []);
    const getAccessTokenRef = useRef(getAccessToken ?? null);
    const hasTokenGetter = !!getAccessToken;

    useEffect(() => {
        getAccessTokenRef.current = getAccessToken ?? null;
    }, [getAccessToken]);

    useEffect(() => {
        if (isAuthenticated) {
            setHasAuthenticatedOnce(true);
        }
    }, [isAuthenticated]);

    useEffect(() => {
        const unsubscribe = subscribeLoginRequired(({ reason, redirectUri }) => {
            if (isLoading || isAuthenticated) {
                return;
            }
            console.log('[AuthGuard] Login required:', reason || 'unknown');
            signIn(redirectUri || import.meta.env.VITE_LOGTO_REDIRECT_URI);
        });

        return unsubscribe;
    }, [isAuthenticated, isLoading, signIn]);

    useEffect(() => {
        if (!isAuthenticated || !hasTokenGetter) {
            clearAccessTokenProvider();
            setIsTokenReady(false);
            return;
        }

        // 通过 ref 读取最新的 getAccessToken，避免函数引用变化导致反复卸载子树
        setAccessTokenProvider(async (resource?: string) => {
            const tokenGetter = getAccessTokenRef.current;
            if (!tokenGetter) {
                return null;
            }
            try {
                const token = await tokenGetter(resource);
                return token ?? null;
            } catch (error) {
                console.warn('[AuthGuard] Failed to get access token', error);
                return null;
            }
        });
        setIsTokenReady(true);

        if (logtoResource) {
            const tokenGetter = getAccessTokenRef.current;
            if (tokenGetter) {
                tokenGetter(logtoResource).catch((error) => {
                    console.warn('[AuthGuard] Token warmup failed', error);
                });
            }
        }

        return () => {
            clearAccessTokenProvider();
            setIsTokenReady(false);
        };
    }, [hasTokenGetter, isAuthenticated, logtoResource]);

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

    return <>{children}</>;
}
