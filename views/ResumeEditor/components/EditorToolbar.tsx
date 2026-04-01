import React, { useMemo, useState } from 'react';
import { Download, LayoutTemplate, Moon, Sun, Edit2, Check, FileText, Plus, SlidersHorizontal } from 'lucide-react';
import UnAuthPrompt from '../../../components/UnAuthPrompt';

type EditorToolbarProps = {
    isDarkMode: boolean;
    saveState: 'idle' | 'dirty' | 'saving' | 'saved' | 'error';
    lastSavedAt: string | null;
    onToggleTheme: () => void;
    isLayoutModified: boolean;
    isSmartPageApplied: boolean;
    isLayoutAdjustToolbarOpen: boolean;
    onToggleLayoutAdjustToolbar: () => void;
    onAdjustToSinglePage: () => void;
    onRestoreDefault: () => void;
    canCreateResume: boolean;
    isCreatingResume: boolean;
    onCreateResume: () => void;
    resumeName: string;
    onResumeNameChange: (name: string) => void;
    onExportPdf: () => void;
    isExportingPdf: boolean;
    onOpenTemplateSelector: () => void;
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
    isLayoutModified,
    isSmartPageApplied,
    isLayoutAdjustToolbarOpen,
    onToggleLayoutAdjustToolbar,
    onAdjustToSinglePage,
    onRestoreDefault,
    canCreateResume,
    isCreatingResume,
    onCreateResume,
    resumeName,
    onResumeNameChange,
    onExportPdf,
    isExportingPdf,
    onOpenTemplateSelector,
}) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(resumeName);
    const canRestoreDefault = isLayoutModified || isSmartPageApplied;
    const actionButtonBaseClass =
        'flex items-center gap-2 px-3 py-1.5 text-xs rounded-md border transition-colors';
    const smartPageButtonClass = canRestoreDefault
        ? `${actionButtonBaseClass} font-medium border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700`
        : `${actionButtonBaseClass} font-semibold border-emerald-500 bg-emerald-600 text-white hover:bg-emerald-700 dark:border-emerald-400 dark:bg-emerald-500 dark:hover:bg-emerald-400`;
    const settingsButtonClass = [
        actionButtonBaseClass,
        'rounded-r-none border-r-0',
        isLayoutAdjustToolbarOpen
            ? 'border-primary bg-primary/10 text-primary dark:border-primary/70 dark:bg-primary/15'
            : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800',
    ].join(' ');
    const smartPageButtonJoinedClass = [
        smartPageButtonClass,
        'rounded-l-none',
    ].join(' ');

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
    const isCreateResumeDisabled = isCreatingResume || !canCreateResume;
    const createResumeTitle = isCreatingResume
        ? '新增中...'
        : canCreateResume
            ? '新增简历'
            : '当前简历加载中';

    return (
        <header className="bg-surface-light dark:bg-surface-dark border-b border-border-light dark:border-border-dark px-4 py-3 shrink-0 z-20 md:px-6">
            <div className="flex flex-col gap-3 md:h-10 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 flex-wrap items-center gap-3 md:gap-4">
                    <div className="flex items-center gap-2 text-primary hover:opacity-80 transition-opacity cursor-pointer">
                        <FileText className="w-8 h-8" />
                        <span className="font-bold text-lg tracking-tight text-gray-900 dark:text-white md:text-xl">原子简历</span>
                    </div>
                    <div className="hidden h-6 w-px bg-border-light dark:bg-border-dark md:block"></div>
                    <div className="hidden items-center gap-2 md:flex">
                        <span className="text-sm font-medium text-gray-500">简历工厂</span>
                        <button
                            type="button"
                            onClick={onOpenTemplateSelector}
                            className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                        >
                            <LayoutTemplate className="h-3.5 w-3.5" />
                            模板
                        </button>
                    </div>
                    <div className="hidden h-6 w-px bg-border-light dark:bg-border-dark md:block"></div>
                    <div className="flex min-w-0 items-center gap-2">
                        {isEditing ? (
                            <>
                                <input
                                    type="text"
                                    value={editValue}
                                    onChange={(e) => setEditValue(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    onBlur={handleSave}
                                    autoFocus
                                    className="w-full rounded border border-primary bg-white px-2 py-1 text-sm font-medium text-gray-900 focus:outline-none focus:ring-1 focus:ring-primary dark:bg-gray-800 dark:text-white sm:w-auto"
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
                                <span className="max-w-full truncate text-sm font-medium text-gray-900 dark:text-white">{resumeName}</span>
                                <button
                                    onClick={handleStartEdit}
                                    className="p-1 text-gray-400 hover:text-primary hover:bg-primary/10 rounded transition-colors"
                                    title="编辑简历名称"
                                >
                                    <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                    onClick={onCreateResume}
                                    className="p-1 text-gray-400 hover:text-primary hover:bg-primary/10 rounded transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                    title={createResumeTitle}
                                    type="button"
                                    disabled={isCreateResumeDisabled}
                                >
                                    <Plus className="w-3.5 h-3.5" />
                                </button>
                            </>
                        )}
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 md:justify-end md:gap-4">
                    <UnAuthPrompt />
                    <button
                        className="md:hidden flex items-center gap-2 rounded-md border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                        onClick={onCreateResume}
                        type="button"
                        disabled={isCreateResumeDisabled}
                        title={createResumeTitle}
                    >
                        <Plus className="w-4 h-4" />
                        {isCreatingResume ? '新增中...' : '新增简历'}
                    </button>
                    <div className="inline-flex items-center">
                        <button
                            type="button"
                            onClick={onToggleLayoutAdjustToolbar}
                            className={settingsButtonClass}
                            aria-label="打开手动调节工具栏"
                            aria-pressed={isLayoutAdjustToolbarOpen}
                            title="手动调节"
                        >
                            <SlidersHorizontal className="w-4 h-4" />
                        </button>
                        <button
                            onClick={canRestoreDefault ? onRestoreDefault : onAdjustToSinglePage}
                            className={smartPageButtonJoinedClass}
                        >
                            <LayoutTemplate className="w-4 h-4" />
                            {canRestoreDefault ? '恢复默认' : '智能一页'}
                        </button>
                    </div>
                    {/* min-w 固定宽度：避免不同状态文字长度不同导致"智能一页"按钮位置抖动 */}
                    <div className="order-last flex w-full items-center gap-2 text-xs md:order-none md:w-auto">
                        <span className="text-gray-400 shrink-0">自动保存</span>
                        <span className={`font-semibold min-w-[7rem] ${saveStatusClass}`}>{saveStatusText}</span>
                    </div>
                    <button
                        className="rounded-full p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 md:hidden"
                        onClick={onToggleTheme}
                    >
                        {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                    </button>
                    <button
                        className="ml-auto flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary-dark disabled:opacity-60 md:ml-0"
                        onClick={onExportPdf}
                        type="button"
                        disabled={isExportingPdf}
                    >
                        <Download className="w-4 h-4" />
                        {isExportingPdf ? '导出中...' : '导出 PDF'}
                    </button>
                </div>
            </div>
        </header>
    );
};

export default EditorToolbar;
