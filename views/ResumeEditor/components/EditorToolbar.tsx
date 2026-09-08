import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Check,
    Columns3,
    Download,
    Edit2,
    LayoutTemplate,
    Moon,
    PanelLeft,
    PanelRight,
    Plus,
    Sun,
} from 'lucide-react';
import UnAuthPrompt from '../../../components/UnAuthPrompt';
import type { ResumeEditorWorkspaceLayout } from './ResumeEditorDesktopWorkspace';

type EditorToolbarProps = {
    isDarkMode: boolean;
    saveState: 'idle' | 'dirty' | 'saving' | 'saved' | 'error';
    lastSavedAt: string | null;
    onToggleTheme: () => void;
    isLayoutModified: boolean;
    isSmartPageApplied: boolean;
    onAdjustToSinglePage: () => void;
    onRestoreDefault: () => void;
    canCreateResume: boolean;
    isCreatingResume: boolean;
    onCreateResume: () => void;
    resumeName: string;
    onResumeNameChange: (name: string) => void;
    onExportPdf: () => void;
    isExportingPdf: boolean;
    isPreviewOverflowing?: boolean;
    workspaceLayout: ResumeEditorWorkspaceLayout;
    onWorkspaceLayoutChange: (layout: ResumeEditorWorkspaceLayout) => void | false | Promise<void | false>;
    canOpenWorkspacePanels?: boolean;
    isWorkspaceLayoutLocked?: boolean;
};

const WORKSPACE_LAYOUT_OPTIONS = [
    { id: 'list', label: '列表布局', icon: PanelLeft },
    { id: 'triple', label: '三栏布局', icon: Columns3 },
    { id: 'ai', label: 'AI 布局', icon: PanelRight },
] as const satisfies ReadonlyArray<{
    id: ResumeEditorWorkspaceLayout;
    label: string;
    icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>;
}>;

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
    onAdjustToSinglePage,
    onRestoreDefault,
    canCreateResume,
    isCreatingResume,
    onCreateResume,
    resumeName,
    onResumeNameChange,
    onExportPdf,
    isExportingPdf,
    isPreviewOverflowing = false,
    workspaceLayout,
    onWorkspaceLayoutChange,
    canOpenWorkspacePanels = false,
    isWorkspaceLayoutLocked = false,
}) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(resumeName);
    const workspaceLayoutRadioRefs = useRef<Record<ResumeEditorWorkspaceLayout, HTMLButtonElement | null>>({
        list: null,
        triple: null,
        ai: null,
    });
    const pendingWorkspaceLayoutFocusRef = useRef<{
        layout: ResumeEditorWorkspaceLayout;
        requestId: number;
    } | null>(null);
    const workspaceLayoutFocusRequestIdRef = useRef(0);
    const canRestoreDefault = isLayoutModified || isSmartPageApplied;
    const actionButtonBaseClass =
        'flex items-center gap-2 px-3 py-1.5 text-xs rounded-md border transition-colors';
    const smartPageButtonClass = canRestoreDefault
        ? `${actionButtonBaseClass} font-medium border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700`
        : `${actionButtonBaseClass} font-semibold border-emerald-500 bg-emerald-600 text-white hover:bg-emerald-700 dark:border-emerald-400 dark:bg-emerald-500 dark:hover:bg-emerald-400`;

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
    const exportButtonTitle = isPreviewOverflowing
        ? '当前预览已超出单页 A4，导出时将自动分页'
        : (isExportingPdf ? '导出中...' : '导出 PDF');
    const isWorkspaceLayoutOptionDisabled = (layout: ResumeEditorWorkspaceLayout) => (
        (layout !== 'list' && !canOpenWorkspacePanels)
        || (isWorkspaceLayoutLocked && layout !== workspaceLayout)
    );
    useEffect(() => {
        const pendingFocus = pendingWorkspaceLayoutFocusRef.current;
        if (!pendingFocus || workspaceLayout !== pendingFocus.layout) return;

        pendingWorkspaceLayoutFocusRef.current = null;
        workspaceLayoutRadioRefs.current[workspaceLayout]?.focus();
    }, [workspaceLayout]);

    const requestWorkspaceLayoutFromKeyboard = (layout: ResumeEditorWorkspaceLayout) => {
        const requestId = workspaceLayoutFocusRequestIdRef.current + 1;
        workspaceLayoutFocusRequestIdRef.current = requestId;
        pendingWorkspaceLayoutFocusRef.current = { layout, requestId };

        try {
            void Promise.resolve(onWorkspaceLayoutChange(layout)).then(
                (result) => {
                    // The controlled prop is the only success signal. A callback can
                    // explicitly decline with false; otherwise retain the keyboard intent
                    // until the parent commits the requested layout.
                    if (
                        result === false
                        && pendingWorkspaceLayoutFocusRef.current?.requestId === requestId
                    ) {
                        pendingWorkspaceLayoutFocusRef.current = null;
                    }
                },
                () => {
                    if (pendingWorkspaceLayoutFocusRef.current?.requestId === requestId) {
                        pendingWorkspaceLayoutFocusRef.current = null;
                    }
                },
            );
        } catch {
            if (pendingWorkspaceLayoutFocusRef.current?.requestId === requestId) {
                pendingWorkspaceLayoutFocusRef.current = null;
            }
        }
    };

    const handleWorkspaceLayoutClick = (layout: ResumeEditorWorkspaceLayout) => {
        // A pointer interaction owns its native focus; it must not inherit a stale
        // keyboard focus request that resolves during a later controlled update.
        pendingWorkspaceLayoutFocusRef.current = null;
        try {
            void Promise.resolve(onWorkspaceLayoutChange(layout)).catch(() => {});
        } catch {
            // The parent owns pointer-triggered error reporting.
        }
    };

    const handleWorkspaceLayoutKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        const enabledOptions = WORKSPACE_LAYOUT_OPTIONS.filter(
            (option) => !isWorkspaceLayoutOptionDisabled(option.id),
        );
        if (enabledOptions.length === 0) return;
        event.preventDefault();
        const currentIndex = Math.max(0, enabledOptions.findIndex((option) => option.id === workspaceLayout));
        const nextIndex = event.key === 'Home'
            ? 0
            : event.key === 'End'
                ? enabledOptions.length - 1
                : ['ArrowLeft', 'ArrowUp'].includes(event.key)
                    ? (currentIndex - 1 + enabledOptions.length) % enabledOptions.length
                    : (currentIndex + 1) % enabledOptions.length;
        const nextLayout = enabledOptions[nextIndex].id;
        if (nextLayout === workspaceLayout) {
            pendingWorkspaceLayoutFocusRef.current = null;
            return;
        }
        requestWorkspaceLayoutFromKeyboard(nextLayout);
    };

    return (
        <header className="bg-surface-light dark:bg-surface-dark border-b border-border-light dark:border-border-dark px-4 py-3 shrink-0 z-20 md:px-6">
            <div className="flex flex-col gap-3 md:h-10 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 flex-wrap items-center gap-3 md:gap-4">
                    <div className="flex items-center gap-2 text-primary hover:opacity-80 transition-opacity cursor-pointer">
                        <img
                            src="/logo-mark-128.png"
                            alt="原子简历 favicon"
                            className="h-8 w-8 object-contain"
                        />
                        <span className="font-bold text-lg tracking-tight text-gray-900 dark:text-white md:text-xl">原子简历</span>
                    </div>
                    <div className="hidden h-6 w-px bg-border-light dark:bg-border-dark md:block"></div>
                    <div className="hidden items-center gap-2 md:flex">
                        <span className="text-sm font-medium text-gray-500">简历工厂</span>
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
                    <div
                        role="radiogroup"
                        aria-label="编辑器布局"
                        onKeyDown={handleWorkspaceLayoutKeyDown}
                        className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-100/90 p-1 shadow-inner shadow-slate-200/40 dark:border-slate-700 dark:bg-slate-900 dark:shadow-none"
                    >
                        {WORKSPACE_LAYOUT_OPTIONS.map((option) => {
                            const Icon = option.icon;
                            const selected = workspaceLayout === option.id;
                            const disabled = isWorkspaceLayoutOptionDisabled(option.id);
                            return (
                                <button
                                    key={option.id}
                                    type="button"
                                    role="radio"
                                    aria-checked={workspaceLayout === option.id}
                                    aria-label={option.label}
                                    title={option.label}
                                    tabIndex={selected ? 0 : -1}
                                    disabled={disabled}
                                    onClick={() => handleWorkspaceLayoutClick(option.id)}
                                    ref={(element) => {
                                        workspaceLayoutRadioRefs.current[option.id] = element;
                                    }}
                                    className={[
                                        'group relative grid h-8 w-8 place-items-center rounded-md transition-all',
                                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2',
                                        'disabled:cursor-not-allowed disabled:opacity-35 dark:focus-visible:ring-offset-slate-950',
                                        selected
                                            ? 'bg-white text-emerald-700 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:text-emerald-300 dark:ring-slate-700'
                                            : 'text-slate-400 hover:bg-white/75 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200',
                                    ].join(' ')}
                                >
                                    <Icon className="h-[18px] w-[18px]" aria-hidden="true">
                                        {option.id !== 'list' ? (
                                            <rect
                                                x="15"
                                                y="3"
                                                width="6"
                                                height="18"
                                                rx="1"
                                                className="fill-emerald-100 stroke-emerald-600 dark:fill-emerald-900 dark:stroke-emerald-400"
                                            />
                                        ) : null}
                                    </Icon>
                                    <span
                                        role="tooltip"
                                        className="pointer-events-none absolute left-1/2 top-[calc(100%+10px)] z-50 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-950 px-2.5 py-1.5 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 dark:bg-white dark:text-slate-950"
                                    >
                                        {option.label}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
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
                    <button
                        type="button"
                        onClick={canRestoreDefault ? onRestoreDefault : onAdjustToSinglePage}
                        className={smartPageButtonClass}
                    >
                        <LayoutTemplate className="w-4 h-4" />
                        {canRestoreDefault ? '恢复默认' : '智能一页'}
                    </button>
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
                        title={exportButtonTitle}
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
