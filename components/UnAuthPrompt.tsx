import React from 'react';
import { useLogto } from '@logto/react';

const UnAuthPrompt: React.FC = () => {
    const { isAuthenticated, signIn } = useLogto();

    if (isAuthenticated) {
        return null;
    }

    const handleSignIn = async () => {
        await signIn(import.meta.env.VITE_LOGTO_REDIRECT_URI || window.location.href);
    };

    return (
        <div className="hidden md:flex items-center text-sm text-gray-600 dark:text-gray-300 bg-amber-50 dark:bg-amber-900/20 px-4 py-1.5 border border-amber-200 dark:border-amber-800/50 rounded-full mr-2">
            <span>您还未登录，登录后享受全部功能！</span>
            <button 
                onClick={handleSignIn}
                className="text-primary font-medium hover:underline ml-1"
                type="button"
            >
                登录
            </button>
        </div>
    );
};

export default UnAuthPrompt;
