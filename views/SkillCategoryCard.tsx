import React, { useCallback } from 'react';
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { SKILL_TAGS } from '../data/skillTags';
import TagInput from './TagInput';
import { resolveCardMotionClass } from './experienceUtils';

export type SkillCategoryCardData = {
    name: string;
    skills: string[];
};

type SkillCategoryCardProps = {
    data: SkillCategoryCardData;
    isExpanded: boolean;
    isCollapsing: boolean;
    isModified: boolean;
    isSaving: boolean;
    onToggle: () => void;
    onDelete: () => void;
    onSave: () => void;
    onCancel: () => void;
    onNameChange: (value: string) => void;
    onSkillsChange: (value: string[]) => void;
};

const CollapsedSkillCard: React.FC<{
    data: SkillCategoryCardData;
    onToggle: () => void;
    onDelete: () => void;
}> = ({ data, onToggle, onDelete }) => {
    const handleDelete = useCallback(
        (event: React.MouseEvent<HTMLButtonElement>) => {
            event.stopPropagation();
            onDelete();
        },
        [onDelete]
    );

    return (
        <div
            className="p-5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
            onClick={onToggle}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => event.key === 'Enter' && onToggle()}
        >
            <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                        <h3 className="font-bold text-gray-900 dark:text-white truncate">
                            {data.name || '未命名分类'}
                        </h3>
                        <span className="text-gray-300 dark:text-gray-600">|</span>
                        <span className="text-gray-500 dark:text-gray-400 text-sm">
                            {data.skills.length} 个技能
                        </span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                        {data.skills.slice(0, 8).map((skill, idx) => (
                            <span key={idx} className="text-xs text-gray-500 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded">
                                {skill}
                            </span>
                        ))}
                        {data.skills.length > 8 && (
                            <span className="text-xs text-gray-400 px-1">...</span>
                        )}
                    </div>
                </div>
                <div className="text-right shrink-0 flex items-center gap-2">
                    <button
                        onClick={handleDelete}
                        className="text-gray-400 hover:text-red-500 transition-colors p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                        title="删除"
                        type="button"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                    <ChevronDown className="w-5 h-5 text-gray-400" />
                </div>
            </div>
        </div>
    );
};

const ExpandedSkillCard: React.FC<{
    data: SkillCategoryCardData;
    isCollapsing: boolean;
    isModified: boolean;
    isSaving: boolean;
    onToggle: () => void;
    onDelete: () => void;
    onSave: () => void;
    onCancel: () => void;
    onNameChange: (value: string) => void;
    onSkillsChange: (value: string[]) => void;
}> = ({
    data,
    isCollapsing,
    isModified,
    isSaving,
    onToggle,
    onDelete,
    onSave,
    onCancel,
    onNameChange,
    onSkillsChange,
}) => (
        <div className={resolveCardMotionClass(isCollapsing)}>
            <div className="p-6 border-b border-gray-50 dark:border-gray-800/50">
                <div className="space-y-4">
                    <div>
                        <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">
                            分类名称
                        </label>
                        <input
                            className="fluid-input text-lg font-bold text-gray-900 dark:text-white placeholder-gray-300 w-full"
                            placeholder="例如: 前端开发"
                            value={data.name}
                            onChange={(e) => onNameChange(e.target.value)}
                        />
                    </div>

                    <div>
                        <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">
                            技能列表
                        </label>
                        <TagInput
                            value={data.skills}
                            suggestions={SKILL_TAGS}
                            onChange={onSkillsChange}
                            themeColor="rose"
                            placeholder="添加技能..."
                        />
                    </div>
                </div>
            </div>

            <div className="bg-gray-50 dark:bg-gray-800/50 px-6 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-end">
                <div className="flex items-center gap-2">
                    <button
                        onClick={onDelete}
                        className="text-gray-400 hover:text-red-500 transition-colors p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg mr-2"
                        title="删除"
                        type="button"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>

                    {isModified ? (
                        <>
                            <button
                                onClick={onCancel}
                                className="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                                disabled={isSaving}
                                type="button"
                            >
                                取消
                            </button>
                            <button
                                onClick={onSave}
                                className="flex items-center gap-2 text-sm font-medium text-white bg-rose-500 hover:bg-rose-600 px-6 py-2 rounded-lg transition-colors shadow-sm shadow-rose-500/20 disabled:opacity-50"
                                disabled={isSaving}
                                type="button"
                            >
                                {isSaving ? '保存中...' : '保存'}
                            </button>
                        </>
                    ) : (
                        <button
                            onClick={onToggle}
                            className="flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white px-4 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                            type="button"
                        >
                            折叠
                            <ChevronUp className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );

const SkillCategoryCard: React.FC<SkillCategoryCardProps> = ({
    data,
    isExpanded,
    isCollapsing,
    isModified,
    isSaving,
    onToggle,
    onDelete,
    onSave,
    onCancel,
    onNameChange,
    onSkillsChange,
}) => {
    const showExpanded = isExpanded || isCollapsing;

    return (
        <div className="bg-white dark:bg-surface-dark rounded-xl border border-rose-500/30 shadow-sm hover:shadow-md transition-all duration-300 overflow-hidden">
            {!showExpanded ? (
                <CollapsedSkillCard
                    data={data}
                    onToggle={onToggle}
                    onDelete={onDelete}
                />
            ) : (
                <ExpandedSkillCard
                    data={data}
                    isCollapsing={isCollapsing}
                    isModified={isModified}
                    isSaving={isSaving}
                    onToggle={onToggle}
                    onDelete={onDelete}
                    onSave={onSave}
                    onCancel={onCancel}
                    onNameChange={onNameChange}
                    onSkillsChange={onSkillsChange}
                />
            )}
        </div>
    );
};

export default SkillCategoryCard;
