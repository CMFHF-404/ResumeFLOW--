import React, { useEffect, useState } from 'react';
import { Edit3, MoreHorizontal, Sparkles, Trash2, X } from 'lucide-react';
import type { ExperienceCardProps } from '../../../../types/resume';
import { MatchBadge, StaleBadge } from '../Badges';

type ThemeStyles = ExperienceCardProps['themeStyles'];
type ExperienceItem = ExperienceCardProps['item'];

type ExperienceCardActionsProps = {
    moreOpen: boolean;
    setMoreOpen: React.Dispatch<React.SetStateAction<boolean>>;
    compact?: boolean;
    itemId: string;
    deleting: boolean;
    isPolishing: boolean;
    isPolishActionLocked?: boolean;
    isDeleteLocked?: boolean;
    onDelete: (id: string) => void;
    onEdit: (id: string) => void;
    onPolish: (id: string) => void;
    themeStyles: ThemeStyles;
};

const ExperienceCardActions: React.FC<ExperienceCardActionsProps> = ({
    moreOpen,
    setMoreOpen,
    compact = false,
    itemId,
    deleting,
    isPolishing,
    isPolishActionLocked,
    isDeleteLocked,
    onDelete,
    onEdit,
    onPolish,
    themeStyles,
}) => {
    const handleDelete = (event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onDelete(itemId);
    };

    const handleEdit = (event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onEdit(itemId);
    };

    const handlePolish = (event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onPolish(itemId);
    };

    if (compact) return <div className="relative flex shrink-0 items-center" onClick={event => event.stopPropagation()}>
        <button type="button" onClick={handleEdit} aria-label="编辑" className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-primary"><Edit3 className="h-4 w-4" /></button>
        <button type="button" onClick={() => setMoreOpen(current => !current)} aria-label="更多经历操作" aria-expanded={moreOpen} className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-gray-500"><MoreHorizontal className="h-4 w-4" /></button>
        {moreOpen ? <div className="absolute right-0 top-11 z-30 w-40 rounded-xl border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-900" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setMoreOpen(false); } }}>
            <button type="button" onClick={event => { setMoreOpen(false); handlePolish(event); }} disabled={isPolishing || isPolishActionLocked} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-sm text-gray-700 disabled:opacity-50 dark:text-gray-200"><Sparkles className="h-4 w-4" />AI 润色</button>
            <button type="button" onClick={event => { setMoreOpen(false); handleDelete(event); }} disabled={deleting || isDeleteLocked} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-sm text-red-600 disabled:opacity-50"><Trash2 className="h-4 w-4" />删除</button>
        </div> : null}
    </div>;

    const actionButtonBaseClass = 'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors';

    return (
        <div className="flex items-center gap-1 shrink-0 ml-2">
            <button
                className={`${actionButtonBaseClass} bg-rose-50 text-rose-500 hover:bg-rose-100 md:bg-transparent md:text-gray-500 md:hover:bg-red-50 md:hover:text-red-500`}
                onClick={handleDelete}
                disabled={deleting || isDeleteLocked}
                title="删除"
                aria-label="删除"
            >
                <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button
                className={`${actionButtonBaseClass} bg-slate-100 text-slate-600 hover:bg-slate-200 md:bg-transparent md:text-gray-500 ${themeStyles.editHoverData}`}
                onClick={handleEdit}
                title="编辑"
                aria-label="编辑"
            >
                <Edit3 className="w-3.5 h-3.5" />
            </button>
            <button
                className={`${actionButtonBaseClass} bg-amber-50 text-amber-600 hover:bg-amber-100 md:bg-transparent md:text-gray-400 ${themeStyles.editHoverData}`}
                onClick={handlePolish}
                disabled={isPolishing || isPolishActionLocked}
                title="打开 AI 润色工具栏"
                aria-label="打开 AI 润色工具栏"
            >
                <Sparkles className="w-3.5 h-3.5" />
            </button>
        </div>
    );
};

type ExperienceReasonPanelProps = {
    reason: string;
    onClick: (event: React.MouseEvent<HTMLDivElement>) => void;
};

const ExperienceReasonPanel: React.FC<ExperienceReasonPanelProps> = ({
    reason,
    onClick,
}) => (
    <div
        className="mt-2 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-2 animate-in slide-in-from-top-1 fade-in duration-200"
        onClick={onClick}
    >
        <p className="text-[11px] text-emerald-800 dark:text-emerald-300/80 leading-relaxed">
            {reason}
        </p>
    </div>
);

type ExperienceCardFooterProps = {
    item: ExperienceItem;
    hasReason: boolean;
    isReasonOpen: boolean;
    staleExperienceIds: Set<string>;
    onToggleReason: (event: React.MouseEvent<HTMLButtonElement> | React.MouseEvent<HTMLDivElement>) => void;
};

const ExperienceCardFooter: React.FC<ExperienceCardFooterProps> = ({
    item,
    hasReason,
    staleExperienceIds,
}) => {
    return (
        <div className="mt-1 flex min-w-0 items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
                <p className="min-w-0 truncate text-xs leading-5 text-gray-500 dark:text-gray-400" title={item.title}>
                    {item.title || '未填写身份'}
                </p>
                <span className="whitespace-nowrap border-l border-gray-300 pl-2 text-[10px] leading-5 text-gray-400 font-mono dark:border-gray-600">{item.date || '未填写时间'}</span>
            </div>
            <div className="flex items-center gap-1">
                {staleExperienceIds.has(item.id) ? <StaleBadge /> : null}
                {item.matchScore !== undefined ? (
                    <div
                        className={hasReason ? "transition-opacity hover:opacity-80" : ""}
                    >
                        <MatchBadge score={item.matchScore} trend={item.matchTrend} />
                    </div>
                ) : null}
            </div>
        </div>
    );
};

const ExperienceCard: React.FC<ExperienceCardProps> = ({
    compact = false,
    item,
    isSelected,
    themeStyles,
    onToggleSelection,
    onDelete,
    onEdit,
    onPolish,
    deletingIds,
    staleExperienceIds,
    isPolishing,
    isPolishToolbarOpen,
    isSelectionLocked,
    isPolishActionLocked,
    isDeleteLocked,
    polishToolbar,
    onClosePolishToolbar,
    onDismissPolishToolbar,
}) => {
    const isProject = item.category === 'project';
    const [moreOpen, setMoreOpen] = useState(false);
    const [retainedToolbar, setRetainedToolbar] = useState<React.ReactNode>(null);
    const toolbarVisible = Boolean(isPolishToolbarOpen && polishToolbar);
    useEffect(() => {
        if (toolbarVisible) {
            setRetainedToolbar(polishToolbar);
            return;
        }
        const timer = window.setTimeout(() => setRetainedToolbar(null), 160);
        return () => window.clearTimeout(timer);
    }, [toolbarVisible, polishToolbar]);
    const renderedToolbar = toolbarVisible ? polishToolbar : retainedToolbar;
    const hasReason = Boolean(item.matchReason?.trim());
    const [isReasonOpen, setIsReasonOpen] = useState(true);

    useEffect(() => {
        if (!hasReason) {
            setIsReasonOpen(false);
        } else {
            setIsReasonOpen(true);
        }
    }, [hasReason]);

    const handleToggleReason = (event: React.MouseEvent<HTMLButtonElement> | React.MouseEvent<HTMLDivElement>) => {
        event.stopPropagation();
        if (!hasReason) {
            return;
        }
        setIsReasonOpen((prev) => !prev);
    };

    const handleReasonAreaClick = (event: React.MouseEvent<HTMLDivElement>) => {
        event.stopPropagation();
    };

    return (
        <div
            style={compact && moreOpen ? { zIndex: 30, opacity: 1 } : undefined}
            onClick={() => {
                if (compact) { onEdit(item.id); return; }
                if (isSelectionLocked) {
                    return;
                }
                onToggleSelection(item.id);
            }}
            className={`bg-white dark:bg-gray-800 border rounded-xl p-3 shadow-sm transition-all group relative cursor-pointer ${isSelected ? `${themeStyles.borderSelected} ring-1 ${themeStyles.ringSelected}` : 'border-gray-200 dark:border-gray-700 opacity-70 hover:opacity-100'} ${renderedToolbar ? 'z-20 opacity-100 shadow-[0_18px_50px_rgba(15,23,42,0.12)]' : ''}`}
        >
            <div className={`absolute right-2 ${compact ? 'top-0' : 'top-2'}`}>
                <ExperienceCardActions
                    moreOpen={moreOpen}
                    setMoreOpen={setMoreOpen}
                    compact={compact}
                    itemId={item.id}
                    deleting={deletingIds.has(item.id)}
                    isPolishing={isPolishing}
                    isPolishActionLocked={isPolishActionLocked}
                    isDeleteLocked={isDeleteLocked}
                    onDelete={onDelete}
                    onEdit={onEdit}
                    onPolish={onPolish}
                    themeStyles={themeStyles}
                />
            </div>
            <div className="flex items-start gap-3">
                <label className="relative flex h-5 w-5 shrink-0 items-center justify-center before:absolute before:-inset-3" onClick={event => event.stopPropagation()}>
                    <input
                        aria-label={`选择经历：${item.company || item.title}`}
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {
                            if (isSelectionLocked) {
                                return;
                            }
                            onToggleSelection(item.id);
                        }}
                        disabled={isSelectionLocked}
                        onClick={(event) => event.stopPropagation()}
                        className={`relative z-10 w-4 h-4 rounded border-gray-300 ${themeStyles.checkboxText} ${themeStyles.checkboxFocus} ${isSelectionLocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                    />
                </label>
                <div className="flex-1 min-w-0">
                    <h5
                        className={`min-w-0 truncate pr-24 text-sm font-semibold leading-5 ${isSelected ? themeStyles.titleSelected : 'text-gray-700 dark:text-gray-200'}`}
                        title={item.company}
                    >
                        {item.company || (isProject ? '未填写项目名称' : '未填写公司名称')}
                    </h5>
                    <ExperienceCardFooter
                        item={item}
                        hasReason={hasReason}
                        isReasonOpen={isReasonOpen}
                        staleExperienceIds={staleExperienceIds}
                        onToggleReason={handleToggleReason}
                    />
                </div>
            </div>
            {!compact && hasReason && isReasonOpen ? (
                <div>
                    <ExperienceReasonPanel reason={item.matchReason ?? ''} onClick={handleReasonAreaClick} />
                </div>
            ) : null}
            {renderedToolbar ? (
                <>
                    <div
                        aria-hidden="true"
                        className={`fixed inset-0 z-[55] bg-slate-950/18 backdrop-blur-[1px] transition-opacity duration-150 motion-reduce:transition-none md:hidden ${toolbarVisible ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
                        onClick={(event) => {
                            event.stopPropagation();
                            onDismissPolishToolbar?.();
                        }}
                    />
                    <div
                        aria-hidden={!toolbarVisible}
                        inert={!toolbarVisible ? true : undefined}
                        className="fixed inset-x-4 top-[max(16px,env(safe-area-inset-top))] bottom-[max(16px,env(safe-area-inset-bottom))] z-[60] flex items-center justify-center md:absolute md:inset-x-auto md:right-3 md:top-12 md:bottom-auto md:z-30 md:mt-0 md:block md:w-[calc(100%-24px)] md:max-w-[560px] md:max-h-[48vh]"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className={`flex max-h-full w-full max-w-[36rem] origin-top flex-col overflow-hidden rounded-[26px] border border-slate-200/90 bg-white/95 shadow-[0_28px_80px_rgba(15,23,42,0.18)] backdrop-blur md:max-h-[48vh] ${toolbarVisible ? 'rf-polish-panel-enter' : 'rf-polish-panel-exit'}`}>
                            <div className="flex items-start justify-between gap-3 border-b border-slate-200/80 bg-[linear-gradient(135deg,rgba(240,253,250,0.95),rgba(255,255,255,0.98))] px-4 py-3">
                                <div className="min-w-0">
                                    <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-700">
                                        AI润色
                                    </div>
                                    <div className="mt-1 truncate text-sm font-semibold text-slate-900">
                                        {item.title || '未填写职位'}
                                    </div>
                                    {item.company ? (
                                        <div className="mt-0.5 truncate text-xs text-slate-500">
                                            {item.company}
                                        </div>
                                    ) : null}
                                </div>
                                {onClosePolishToolbar ? (
                                    <button
                                        type="button"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onClosePolishToolbar();
                                        }}
                                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
                                        title="关闭润色工具栏"
                                        aria-label="关闭润色工具栏"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                ) : null}
                            </div>
                            <div className="min-h-0 flex flex-1 flex-col overflow-hidden p-3">
                                {renderedToolbar}
                            </div>
                        </div>
                    </div>
                </>
            ) : null}
        </div>
    );
};

export default ExperienceCard;
