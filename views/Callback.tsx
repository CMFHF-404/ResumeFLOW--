import { useHandleSignInCallback } from '@logto/react';
import { useEffect } from 'react';

export default function Callback() {
    const { isLoading, error } = useHandleSignInCallback(() => {
        // 登录成功后重定向到首页
        window.location.href = '/';
    });

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-50 dark:bg-gray-900">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
                    <p className="text-gray-600 dark:text-gray-400">正在登录...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-50 dark:bg-gray-900">
                <div className="text-center max-w-md p-8 bg-white dark:bg-gray-800 rounded-lg shadow-lg">
                    <div className="text-red-500 text-5xl mb-4">⚠️</div>
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">登录失败</h2>
                    <p className="text-gray-600 dark:text-gray-400 mb-4">{error.message}</p>
                    <button
                        onClick={() => window.location.href = '/'}
                        className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors"
                    >
                        返回首页
                    </button>
                </div>
            </div>
        );
    }

    return null;
}
