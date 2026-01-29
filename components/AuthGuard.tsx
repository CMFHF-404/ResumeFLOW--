import { useLogto } from '@logto/react';
import { useEffect, ReactNode } from 'react';

interface AuthGuardProps {
    children: ReactNode;
}

export default function AuthGuard({ children }: AuthGuardProps) {
    const { isAuthenticated, isLoading, signIn } = useLogto();

    useEffect(() => {
        if (!isLoading && !isAuthenticated) {
            const redirectUri = import.meta.env.VITE_LOGTO_REDIRECT_URI;
            console.log('Logging in with redirect URI:', redirectUri);
            signIn(redirectUri);
        }
    }, [isAuthenticated, isLoading, signIn]);

    if (isLoading) {
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
        return null;
    }

    return <>{children}</>;
}
