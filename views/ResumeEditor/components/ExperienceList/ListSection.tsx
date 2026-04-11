import React from 'react';
import type {
    ExperienceListSectionProps,
    ExperienceListThemeStyles,
} from '../../../../types/resume';
import ExperienceCard from './ExperienceCard';
import ExperienceSectionHeader from './SectionHeader';

const EXPERIENCE_THEME_STYLES: Record<
    ExperienceListSectionProps['theme'],
    ExperienceListThemeStyles
> = {
    primary: {
        borderSelected: 'border-primary',
        ringSelected: 'ring-primary/10',
        checkboxText: 'text-primary',
        checkboxFocus: 'focus:ring-primary',
        editHoverData: 'hover:text-primary hover:bg-primary/5',
        titleSelected: 'text-gray-900 dark:text-white',
    },
    project: {
        borderSelected: 'border-indigo-500',
        ringSelected: 'ring-indigo-500/10',
        checkboxText: 'text-indigo-600',
        checkboxFocus: 'focus:ring-indigo-500',
        editHoverData: 'hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/10',
        titleSelected: 'text-gray-900 dark:text-white',
    },
};

import { useState } from 'react';

const ExperienceListSection: React.FC<ExperienceListSectionProps> = ({
    title,
    items,
    selectedIds,
    emptyMessage,
    icon,
    theme,
    actionLabel,
    onToggleSelection,
    onAddItem,
    onEditItem,
    onPolishItem,
    onDeleteItem,
    deletingIds,
    staleExperienceIds,
    isAdding,
    isPolishing,
    activePolishItemId,
    hasBlockingPolishState,
    polishToolbar,
    onClosePolishToolbar,
    onResetSort,
}) => {
    const themeStyles = EXPERIENCE_THEME_STYLES[theme];
    const [isCollapsed, setIsCollapsed] = useState(false);

    const toggleCollapse = () => setIsCollapsed(!isCollapsed);

    if (!items.length) {
        return (
            <div className="space-y-3">
                <ExperienceSectionHeader
                    title={title}
                    icon={icon}
                    onAddItem={onAddItem}
                    actionLabel={actionLabel}
                    isAdding={isAdding}
                    onResetSort={onResetSort}
                    isCollapsed={isCollapsed}
                    onToggle={toggleCollapse}
                />
                {!isCollapsed && (
                    <p className="text-xs text-gray-400">
                        {emptyMessage ?? `暂无${title}`}
                    </p>
                )}
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <ExperienceSectionHeader
                title={title}
                icon={icon}
                onAddItem={onAddItem}
                actionLabel={actionLabel}
                isAdding={isAdding}
                onResetSort={onResetSort}
                isCollapsed={isCollapsed}
                onToggle={toggleCollapse}
            />
            {!isCollapsed && items.map((item) => (
                <ExperienceCard
                    key={item.id}
                    item={item}
                    isSelected={selectedIds.has(item.id)}
                    themeStyles={themeStyles}
                    onToggleSelection={onToggleSelection}
                    onDelete={onDeleteItem}
                    onEdit={onEditItem}
                    onPolish={onPolishItem}
                    deletingIds={deletingIds}
                    staleExperienceIds={staleExperienceIds}
                    isPolishing={isPolishing}
                    isPolishToolbarOpen={activePolishItemId === item.id}
                    isSelectionLocked={hasBlockingPolishState && activePolishItemId === item.id}
                    isPolishActionLocked={hasBlockingPolishState}
                    isDeleteLocked={hasBlockingPolishState && activePolishItemId === item.id}
                    polishToolbar={activePolishItemId === item.id ? polishToolbar : undefined}
                    onClosePolishToolbar={activePolishItemId === item.id ? onClosePolishToolbar : undefined}
                />
            ))}
        </div>
    );
};

export default ExperienceListSection;
