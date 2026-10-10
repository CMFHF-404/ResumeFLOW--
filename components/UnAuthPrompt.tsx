import React from 'react';
import { useLogto } from '@logto/react';
import { trackLoginStart } from '../utils/analyticsTracker';

const UnAuthPrompt: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
    const { isAuthenticated, signIn } = useLogto();

    if (isAuthenticated) {
        return null;
    }

    const handleSignIn = async () => {
        await trackLoginStart('unauth_prompt');
        await signIn(import.meta.env.VITE_LOGTO_REDIRECT_URI || window.location.href);
    };

    return (
        <div title="您还未登录，登录后享受全部功能！" className={`hidden md:flex shrink-0 items-center whitespace-nowrap text-sm text-gray-600 dark:text-gray-300 bg-amber-50 dark:bg-amber-900/20 py-1.5 border border-amber-200 dark:border-amber-800/50 rounded-full ${compact ? 'px-2 2xl:px-4' : 'px-4 mr-2'}`}>
            <span className={compact ? 'hidden 2xl:inline' : undefined}>您还未登录，登录后享受全部功能！</span>
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
