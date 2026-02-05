import React from 'react';
import { CheckCircle2, Edit3, Trash2 } from 'lucide-react';
import type { ExperienceCardProps } from '../../../../types/resume';
import { MatchBadge, StaleBadge } from '../Badges';

const ExperienceCard: React.FC<ExperienceCardProps> = ({
    item,
    isSelected,
    themeStyles,
    onToggleSelection,
    onDelete,
    onEdit,
    deletingIds,
    staleExperienceIds,
}) => (
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
            <div className="flex-1 space-y-1">
                <div className="flex items-center justify-between gap-3">
                    <h5
                        className={`text-sm font-semibold truncate ${isSelected ? themeStyles.titleSelected : 'text-gray-700 dark:text-gray-200'}`}
                    >
                        {item.title || '未填写职位'}
                    </h5>
                    <div className="flex items-center gap-1">
                        {staleExperienceIds.has(item.id) ? <StaleBadge /> : null}
                        {item.matchScore && item.matchScore > 0 ? (
                            <MatchBadge score={item.matchScore} />
                        ) : null}
                    </div>
                </div>
                <p className="text-xs text-gray-500 truncate">{item.company || '未填写公司'}</p>
                <p className="text-[10px] text-gray-400 truncate">{item.date || '未填写时间'}</p>
            </div>
            <div className="opacity-0 group-hover:opacity-100 flex flex-col gap-1 transition-opacity">
                <button
                    onClick={(event) => {
                        event.stopPropagation();
                        onEdit(item.id);
                    }}
                    className={`p-1 rounded ${themeStyles.editHoverData} transition-colors`}
                    title="编辑"
                    aria-label="编辑"
                >
                    <Edit3 className="w-3 h-3" />
                </button>
                <button
                    onClick={(event) => {
                        event.stopPropagation();
                        onDelete(item.id);
                    }}
                    className="p-1 rounded hover:text-red-500 hover:bg-red-50 transition-colors"
                    title="删除"
                    aria-label="删除"
                    disabled={deletingIds.has(item.id)}
                >
                    <Trash2 className="w-3 h-3" />
                </button>
            </div>
        </div>
    </div>
);

export default ExperienceCard;
