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

const ExperienceListSection: React.FC<ExperienceListSectionProps> = ({
    title,
    items,
    selectedIds,
    icon,
    theme,
    actionLabel,
    onToggleSelection,
    onAddItem,
    onEditItem,
    onDeleteItem,
    deletingIds,
    staleExperienceIds,
    isAdding,
}) => {
    const themeStyles = EXPERIENCE_THEME_STYLES[theme];

    if (!items.length) {
        return (
            <div className="space-y-3">
                <ExperienceSectionHeader
                    title={title}
                    icon={icon}
                    onAddItem={onAddItem}
                    actionLabel={actionLabel}
                    isAdding={isAdding}
                />
                <p className="text-xs text-gray-400">暂无{title}</p>
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
            />
            {items.map((item) => (
                <ExperienceCard
                    key={item.id}
                    item={item}
                    isSelected={selectedIds.has(item.id)}
                    themeStyles={themeStyles}
                    onToggleSelection={onToggleSelection}
                    onDelete={onDeleteItem}
                    onEdit={onEditItem}
                    deletingIds={deletingIds}
                    staleExperienceIds={staleExperienceIds}
                />
            ))}
        </div>
    );
};

export default ExperienceListSection;
