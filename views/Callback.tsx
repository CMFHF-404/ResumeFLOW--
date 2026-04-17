import { useHandleSignInCallback } from '@logto/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { trackSignUpSuccessImmediate } from '../utils/analyticsTracker';

const CALLBACK_STUCK_TIMEOUT_MS = 3000;

export default function Callback() {
    const [isStuck, setIsStuck] = useState(false);
    const redirectStartedRef = useRef(false);
    const hasAuthParams = useMemo(() => {
        const searchParams = new URLSearchParams(window.location.search);
        return searchParams.has('code') || searchParams.has('state') || searchParams.has('error');
    }, []);

    const redirectToHome = useCallback(() => {
        window.location.replace('/');
    }, []);

    const finishSignIn = useCallback(async () => {
        if (redirectStartedRef.current) {
            return;
        }

        redirectStartedRef.current = true;

        try {
            await trackSignUpSuccessImmediate();
        } catch (trackingError) {
            console.warn('[Callback] Failed to track sign-up success before redirect', trackingError);
        }

        redirectToHome();
    }, [redirectToHome]);

    const { isLoading, isAuthenticated, error } = useHandleSignInCallback(() => {
        void finishSignIn();
    });

    useEffect(() => {
        if (isAuthenticated) {
            void finishSignIn();
        }
    }, [finishSignIn, isAuthenticated]);

    useEffect(() => {
        if (isLoading || isAuthenticated || error) {
            setIsStuck(false);
            return;
        }

        const timeoutId = window.setTimeout(() => {
            setIsStuck(true);
        }, CALLBACK_STUCK_TIMEOUT_MS);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [error, isAuthenticated, isLoading]);

    if (error) {
        return (
            <div className="flex h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
                <div className="max-w-md rounded-lg bg-white p-8 text-center shadow-lg dark:bg-gray-800">
                    <div className="mb-4 text-5xl text-red-500">!</div>
                    <h2 className="mb-2 text-xl font-bold text-gray-900 dark:text-white">登录失败</h2>
                    <p className="mb-4 text-gray-600 dark:text-gray-400">{error.message}</p>
                    <button
                        onClick={redirectToHome}
                        className="rounded-lg bg-primary px-6 py-2 text-white transition-colors hover:bg-primary-dark"
                    >
                        返回首页
                    </button>
                </div>
            </div>
        );
    }

    const helperMessage = !hasAuthParams
        ? '未检测到有效的登录回调参数，请返回首页后重新发起登录。'
        : '登录回调处理时间较长，可能是浏览器拦截了会话，或登录状态已过期。';

    return (
        <div className="flex h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
            <div className="max-w-md rounded-lg bg-white p-8 text-center shadow-lg dark:bg-gray-800">
                <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-primary"></div>
                <h2 className="mb-2 text-xl font-bold text-gray-900 dark:text-white">正在完成登录</h2>
                <p className="text-gray-600 dark:text-gray-400">
                    {isLoading || isAuthenticated ? '正在验证登录状态，请稍候...' : helperMessage}
                </p>
                {isStuck ? (
                    <div className="mt-6 flex flex-col gap-3">
                        <button
                            onClick={() => window.location.reload()}
                            className="rounded-lg border border-gray-300 px-6 py-2 text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                        >
                            重试回调页
                        </button>
                        <button
                            onClick={redirectToHome}
                            className="rounded-lg bg-primary px-6 py-2 text-white transition-colors hover:bg-primary-dark"
                        >
                            返回首页
                        </button>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

