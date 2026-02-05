import React, { useMemo } from 'react';
import { Download, LayoutTemplate, Moon, Sun } from 'lucide-react';

type EditorToolbarProps = {
    isDarkMode: boolean;
    saveState: 'idle' | 'dirty' | 'saving' | 'saved' | 'error';
    lastSavedAt: string | null;
    onToggleTheme: () => void;
    onAdjustToSinglePage: () => void;
};

const buildSaveStatusText = (state: EditorToolbarProps['saveState'], lastSavedAt: string | null) => {
    const labels = {
        idle: '未保存',
        dirty: '待保存',
        saving: '保存中...',
        saved: lastSavedAt ? `已保存 ${lastSavedAt}` : '已保存',
        error: '保存失败',
    };
    return labels[state];
};

const buildSaveStatusClass = (state: EditorToolbarProps['saveState']) => {
    const colors = {
        idle: 'text-gray-400',
        dirty: 'text-gray-500',
        saving: 'text-amber-600',
        saved: 'text-emerald-600',
        error: 'text-red-600',
    };
    return colors[state];
};

const EditorToolbar: React.FC<EditorToolbarProps> = ({
    isDarkMode,
    saveState,
    lastSavedAt,
    onToggleTheme,
    onAdjustToSinglePage,
}) => {
    const saveStatusText = useMemo(
        () => buildSaveStatusText(saveState, lastSavedAt),
        [lastSavedAt, saveState]
    );
    const saveStatusClass = useMemo(
        () => buildSaveStatusClass(saveState),
        [saveState]
    );

    return (
        <header className="h-16 bg-surface-light dark:bg-surface-dark border-b border-border-light dark:border-border-dark flex items-center justify-between px-6 shrink-0 z-20">
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 text-primary hover:opacity-80 transition-opacity cursor-pointer">
                    <LayoutTemplate className="w-8 h-8" />
                    <span className="font-bold text-xl tracking-tight text-gray-900 dark:text-white">Elephant</span>
                </div>
                <div className="h-6 w-px bg-border-light dark:bg-border-dark"></div>
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-500">简历工厂 / Resume Factory</span>
                </div>
            </div>
            <div className="flex items-center gap-4">
                <button
                    onClick={onAdjustToSinglePage}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                    <LayoutTemplate className="w-4 h-4" />
                    智能一页
                </button>
                <div className="flex items-center gap-2 text-xs">
                    <span className="text-gray-400">自动保存</span>
                    <span className={`font-semibold ${saveStatusClass}`}>{saveStatusText}</span>
                </div>
                <div className="h-6 w-px bg-border-light dark:bg-border-dark"></div>
                <button
                    className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400"
                    onClick={onToggleTheme}
                >
                    {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                </button>
                <button className="flex items-center gap-2 bg-primary hover:bg-primary-dark text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm">
                    <Download className="w-4 h-4" />
                    导出 PDF
                </button>
            </div>
        </header>
    );
};

export default EditorToolbar;
