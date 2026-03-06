import React, { useEffect, useState } from 'react';
import { ChevronDown, Edit3, Sparkles, Trash2 } from 'lucide-react';
import type { ExperienceCardProps } from '../../../../types/resume';
import { MatchBadge, StaleBadge } from '../Badges';

type ThemeStyles = ExperienceCardProps['themeStyles'];
type ExperienceItem = ExperienceCardProps['item'];

type ExperienceCardActionsProps = {
    itemId: string;
    deleting: boolean;
    isPolishing: boolean;
    onDelete: (id: string) => void;
    onEdit: (id: string) => void;
    onPolish: (id: string) => void;
    themeStyles: ThemeStyles;
};

const ExperienceCardActions: React.FC<ExperienceCardActionsProps> = ({
    itemId,
    deleting,
    isPolishing,
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

    return (
        <div className="flex items-center gap-1 shrink-0 ml-2">
            <button
                className="p-1 text-gray-300 rounded hover:text-red-500 hover:bg-red-50"
                onClick={handleDelete}
                disabled={deleting}
                title="删除"
                aria-label="删除"
            >
                <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button
                className={`p-1 text-gray-300 rounded ${themeStyles.editHoverData}`}
                onClick={handleEdit}
                title="编辑"
                aria-label="编辑"
            >
                <Edit3 className="w-3.5 h-3.5" />
            </button>
            <button
                className={`p-1 text-gray-300 rounded ${themeStyles.editHoverData}`}
                onClick={handlePolish}
                disabled={isPolishing}
                title="基于 JD 润色（默认仅保存到当前简历）"
                aria-label="基于 JD 润色（默认仅保存到当前简历）"
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
    isReasonOpen,
    staleExperienceIds,
    onToggleReason,
}) => {
    // 处理徽章点击的包装函数
    const handleBadgeClick = (e: React.MouseEvent<HTMLDivElement>) => {
        // 如果有理由，点击整个徽章都可以切换
        if (hasReason) {
            e.stopPropagation();
            onToggleReason(e);
        }
    };

    return (
        <div className="flex items-center justify-between mt-2">
            <p className="text-[10px] text-gray-400 font-mono">{item.date || '未填写时间'}</p>
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
}) => {
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
            onClick={() => onToggleSelection(item.id)}
            className={`bg-white dark:bg-gray-800 border rounded-xl p-3 shadow-sm transition-all group relative cursor-pointer ${isSelected ? `${themeStyles.borderSelected} ring-1 ${themeStyles.ringSelected}` : 'border-gray-200 dark:border-gray-700 opacity-70 hover:opacity-100'}`}
        >
            <div className="flex items-start gap-3">
                <div className="pt-1">
                    <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleSelection(item.id)}
                        onClick={(event) => event.stopPropagation()}
                        className={`w-4 h-4 rounded border-gray-300 ${themeStyles.checkboxText} ${themeStyles.checkboxFocus} cursor-pointer`}
                    />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start mb-1">
                        <h5
                            className={`text-sm font-semibold truncate ${isSelected ? themeStyles.titleSelected : 'text-gray-700 dark:text-gray-200'}`}
                        >
                            {item.title || '未填写职位'}
                        </h5>
                        <ExperienceCardActions
                            itemId={item.id}
                            deleting={deletingIds.has(item.id)}
                            isPolishing={isPolishing}
                            onDelete={onDelete}
                            onEdit={onEdit}
                            onPolish={onPolish}
                            themeStyles={themeStyles}
                        />
                    </div>
                    {item.company ? (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 truncate">
                            {item.company}
                        </p>
                    ) : null}
                    <ExperienceCardFooter
                        item={item}
                        hasReason={hasReason}
                        isReasonOpen={isReasonOpen}
                        staleExperienceIds={staleExperienceIds}
                        onToggleReason={handleToggleReason}
                    />
                </div>
            </div>
            {hasReason && isReasonOpen ? (
                <div>
                    <ExperienceReasonPanel reason={item.matchReason ?? ''} onClick={handleReasonAreaClick} />
                </div>
            ) : null}
        </div>
    );
};

export default ExperienceCard;
