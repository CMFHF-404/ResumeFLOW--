import React from 'react';
import { Plus, ArrowUpDown, ChevronDown } from 'lucide-react';
import type { ExperienceSectionHeaderProps } from '../../../../types/resume';

const ExperienceSectionHeader: React.FC<ExperienceSectionHeaderProps> = ({
    title,
    icon,
    onAddItem,
    actionLabel,
    isAdding,
    onResetSort,
    isCollapsed,
    onToggle,
}) => (
    <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
            {onToggle && (
                <button
                    onClick={onToggle}
                    className="p-0.5 -ml-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                >
                    <ChevronDown
                        className={`w-3.5 h-3.5 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : 'rotate-0'}`}
                    />
                </button>
            )}
            {icon}
            <h4
                className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer"
                onClick={onToggle}
            >
                {title}
            </h4>
        </div>
        <div className="flex items-center gap-1">
            {onResetSort && (
                <button
                    onClick={onResetSort}
                    title="重置为时间倒序"
                    aria-label="重置排序"
                    className="flex items-center justify-center text-gray-500 hover:text-primary p-1 rounded-md hover:bg-primary/5"
                >
                    <ArrowUpDown className="w-3.5 h-3.5" />
                </button>
            )}
            <button
                onClick={onAddItem}
                disabled={isAdding}
                title={actionLabel}
                aria-label={actionLabel}
                className="flex items-center justify-center text-gray-500 hover:text-primary p-1 rounded-md hover:bg-primary/5 disabled:opacity-60"
            >
                <Plus className="w-3.5 h-3.5" />
            </button>
        </div>
    </div>
);

export default ExperienceSectionHeader;
