import React from 'react';
import { Plus } from 'lucide-react';
import type { ExperienceSectionHeaderProps } from '../../../../types/resume';

const ExperienceSectionHeader: React.FC<ExperienceSectionHeaderProps> = ({
    title,
    icon,
    onAddItem,
    actionLabel,
    isAdding,
}) => (
    <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
            {icon}
            <h4 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                {title}
            </h4>
        </div>
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
);

export default ExperienceSectionHeader;
