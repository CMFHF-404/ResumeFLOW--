import { useEffect, useState } from 'react';

export const useEditorThemeState = () => {
    const [isDarkMode, setIsDarkMode] = useState(() =>
        typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
    );

    useEffect(() => {
        if (typeof document === 'undefined') {
            return;
        }
        const root = document.documentElement;
        const syncThemeState = () => {
            setIsDarkMode(root.classList.contains('dark'));
        };
        syncThemeState();
        const observer = new MutationObserver(syncThemeState);
        observer.observe(root, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, []);

    const toggleTheme = () => {
        const nextIsDark = !document.documentElement.classList.contains('dark');
        document.documentElement.classList.toggle('dark', nextIsDark);
        setIsDarkMode(nextIsDark);
    };

    return {
        isDarkMode,
        toggleTheme,
    };
};
