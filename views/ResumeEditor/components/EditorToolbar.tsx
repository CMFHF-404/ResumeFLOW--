import React, { useMemo, useState } from 'react';
import { Download, LayoutTemplate, Moon, Sun, Edit2, Check, FileText, Plus } from 'lucide-react';

type EditorToolbarProps = {
    isDarkMode: boolean;
    saveState: 'idle' | 'dirty' | 'saving' | 'saved' | 'error';
    lastSavedAt: string | null;
    onToggleTheme: () => void;
    isSmartPageApplied: boolean;
    onAdjustToSinglePage: () => void;
    onRestoreDefault: () => void;
    isCreatingResume: boolean;
    onCreateResume: () => void;
    resumeName: string;
    onResumeNameChange: (name: string) => void;
    onExportPdf: () => void;
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
    isSmartPageApplied,
    onAdjustToSinglePage,
    onRestoreDefault,
    isCreatingResume,
    onCreateResume,
    resumeName,
    onResumeNameChange,
    onExportPdf,
}) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(resumeName);
    const smartPageButtonBaseClass =
        'flex items-center gap-2 px-3 py-1.5 text-xs rounded-md border transition-colors';
    const smartPageButtonClass = isSmartPageApplied
        ? `${smartPageButtonBaseClass} font-medium border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700`
        : `${smartPageButtonBaseClass} font-semibold border-emerald-500 bg-emerald-600 text-white hover:bg-emerald-700 dark:border-emerald-400 dark:bg-emerald-500 dark:hover:bg-emerald-400`;

    const handleStartEdit = () => {
        setEditValue(resumeName);
        setIsEditing(true);
    };

    const handleSave = () => {
        if (editValue.trim()) {
            onResumeNameChange(editValue.trim());
        }
        setIsEditing(false);
    };

    const handleCancel = () => {
        setEditValue(resumeName);
        setIsEditing(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSave();
        } else if (e.key === 'Escape') {
            handleCancel();
        }
    };

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
                    <FileText className="w-8 h-8" />
                    <span className="font-bold text-xl tracking-tight text-gray-900 dark:text-white">原子简历</span>
                </div>
                <div className="h-6 w-px bg-border-light dark:bg-border-dark"></div>
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-500">简历工厂</span>
                </div>
                <div className="h-6 w-px bg-border-light dark:bg-border-dark"></div>
                <div className="flex items-center gap-2">
                    {isEditing ? (
                        <>
                            <input
                                type="text"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={handleKeyDown}
                                onBlur={handleSave}
                                autoFocus
                                className="text-sm font-medium text-gray-900 dark:text-white bg-white dark:bg-gray-800 border border-primary rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                            <button
                                onClick={handleSave}
                                className="p-1 text-primary hover:bg-primary/10 rounded transition-colors"
                                title="保存"
                            >
                                <Check className="w-4 h-4" />
                            </button>
                        </>
                    ) : (
                        <>
                            <span className="text-sm font-medium text-gray-900 dark:text-white">{resumeName}</span>
                            <button
                                onClick={handleStartEdit}
                                className="p-1 text-gray-400 hover:text-primary hover:bg-primary/10 rounded transition-colors"
                                title="编辑简历名称"
                            >
                                <Edit2 className="w-3.5 h-3.5" />
                            </button>
                        </>
                    )}
                </div>
            </div>
            <div className="flex items-center gap-4">
                <button
                    className="flex items-center gap-2 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors disabled:opacity-60"
                    onClick={onCreateResume}
                    type="button"
                    disabled={isCreatingResume}
                >
                    <Plus className="w-4 h-4" />
                    {isCreatingResume ? '新增中...' : '新增简历'}
                </button>
                <button
                    onClick={isSmartPageApplied ? onRestoreDefault : onAdjustToSinglePage}
                    className={smartPageButtonClass}
                >
                    <LayoutTemplate className="w-4 h-4" />
                    {isSmartPageApplied ? '恢复默认' : '智能一页'}
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
                <button
                    className="flex items-center gap-2 bg-primary hover:bg-primary-dark text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm"
                    onClick={onExportPdf}
                    type="button"
                >
                    <Download className="w-4 h-4" />
                    导出 PDF
                </button>
            </div>
        </header>
    );
};

export default EditorToolbar;
