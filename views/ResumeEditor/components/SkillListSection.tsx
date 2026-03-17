import React from 'react';
import { CheckCircle2, Edit3, Plus, Trash2, Wrench, X, ChevronDown } from 'lucide-react';
import type { MatchTrend } from '../../../types/analysis';
import type { SkillActions, SkillGroupView, SkillItemView } from '../../../types/resume';
import {
    ADD_SKILL_TAG_LABEL,
    ADD_SKILL_TYPE_LABEL,
    DELETE_SKILL_CATEGORY_LABEL,
} from '../constants';
import { MatchBadge } from './Badges';

type SkillListSectionProps = {
    title: string;
    groups: SkillGroupView[];
    emptyMessage?: React.ReactNode;
    selectedIds: Set<string>;
    matchScores: Map<string, number>;
    matchTrends: Map<string, MatchTrend>;
    skill: SkillActions;
    onToggleSelection: (id: string) => void;
    onToggleGroupSelection: (groupName: string, skillIds?: string[]) => void;
    onResetRenamingCategory: () => void;
};

const resolveDraftGroupName = (skill: SkillActions) => {
    if (!skill.skillDraft || !skill.skillDraftContext) {
        return null;
    }
    if (skill.skillDraftContext.mode === 'type') {
        return null;
    }
    if (skill.skillDraftContext.mode === 'group') {
        return skill.skillDraftContext.groupName ?? null;
    }
    return skill.skillDraft.category.trim() || null;
};

const SkillTypeEditor: React.FC<{
    skill: SkillActions;
}> = ({ skill }) => (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-rose-500/30 shadow-sm overflow-hidden animate-in fade-in slide-in-from-top-2">
        <div className="bg-rose-50/50 dark:bg-rose-900/10 px-3 py-2 border-b border-rose-100 dark:border-rose-800/30">
            <input
                autoFocus
                className="text-xs font-bold text-rose-700 dark:text-rose-400 bg-transparent border-none outline-none w-full placeholder-rose-300"
                placeholder="输入新分类名称..."
                value={skill.skillDraft?.category || ''}
                onChange={(event) => skill.updateSkillDraft('category', event.target.value)}
            />
        </div>
        <div className="p-3 bg-white dark:bg-gray-800/50">
            <div className="flex flex-wrap gap-2">
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-rose-500 bg-rose-500 text-white shadow-sm shadow-rose-200 dark:shadow-none text-xs">
                    <input
                        className="bg-transparent border-none text-xs text-white p-0 m-0 w-24 outline-none focus:ring-0 placeholder-rose-200"
                        placeholder="输入第一项技能..."
                        value={skill.skillDraft?.name || ''}
                        onChange={(event) => skill.updateSkillDraft('name', event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') skill.handleSaveSkill();
                            if (event.key === 'Escape') skill.cancelSkillEdit();
                        }}
                    />
                </div>
                <div className="flex items-center gap-2 ml-auto">
                    <button
                        onClick={skill.cancelSkillEdit}
                        className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1"
                    >
                        取消
                    </button>
                    <button
                        onClick={skill.handleSaveSkill}
                        className="text-xs font-semibold text-white bg-rose-500 hover:bg-rose-600 px-3 py-1 rounded"
                    >
                        保存
                    </button>
                </div>
            </div>
        </div>
    </div>
);

const SkillHeader: React.FC<{
    title: string;
    onCreateType: () => void;
    isCollapsed: boolean;
    onToggle: () => void;
}> = ({ title, onCreateType, isCollapsed, onToggle }) => (
    <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
            <button
                onClick={onToggle}
                className="p-0.5 -ml-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
            >
                <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : 'rotate-0'}`}
                />
            </button>
            <Wrench className="w-3.5 h-3.5 text-rose-500" />
            <h4
                className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer select-none"
                onClick={onToggle}
            >
                {title}
            </h4>
        </div>
        <button
            onClick={onCreateType}
            title={ADD_SKILL_TYPE_LABEL}
            aria-label={ADD_SKILL_TYPE_LABEL}
            className="flex items-center justify-center text-gray-500 hover:text-rose-600 p-1 rounded-md hover:bg-rose-50"
        >
            <Plus className="w-3.5 h-3.5" />
        </button>
    </div>
);

const SkillTag: React.FC<{
    skill: SkillItemView;
    isSelected: boolean;
    isEditing: boolean;
    matchScore?: number;
    matchTrend?: MatchTrend;
    onToggleSelection: (id: string) => void;
    onDelete: (id: string) => void;
    onEdit: (id: string) => void;
    onUpdateDraftName: (value: string) => void;
    onSaveEdit: () => void;
    onCancelEdit: () => void;
    deletingIds: Set<string>;
    draftName: string;
    isSaving: boolean;
}> = ({
    skill,
    isSelected,
    isEditing,
    matchScore,
    matchTrend,
    onToggleSelection,
    onDelete,
    onEdit,
    onUpdateDraftName,
    onSaveEdit,
    onCancelEdit,
    deletingIds,
    draftName,
    isSaving,
}) => (
        isEditing ? (
            <div
                className="group flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition-all select-none border-rose-500 bg-rose-500 text-white shadow-sm shadow-rose-200 dark:shadow-none"
            >
                {isSelected ? <CheckCircle2 className="w-3 h-3 text-white" /> : null}
                <input
                    autoFocus
                    className="bg-transparent border-none text-xs text-white p-0 m-0 w-24 outline-none focus:ring-0 placeholder-rose-200"
                    placeholder={skill.name}
                    value={draftName}
                    onChange={(event) => onUpdateDraftName(event.target.value)}
                    onBlur={() => {
                        if (!isSaving) {
                            onSaveEdit();
                        }
                    }}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            if (!isSaving) {
                                onSaveEdit();
                            }
                        } else if (event.key === 'Escape') {
                            event.preventDefault();
                            onCancelEdit();
                        }
                    }}
                    disabled={isSaving}
                />
                {typeof matchScore === 'number' ? (
                    <MatchBadge score={matchScore} trend={matchTrend} label="" />
                ) : null}
            </div>
        ) : (
            <label
                className={`group flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer transition-all select-none ${isSelected
                    ? 'border-rose-500 bg-rose-500 text-white shadow-sm shadow-rose-200 dark:shadow-none'
                    : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-rose-300 dark:hover:border-rose-700 bg-gray-50 dark:bg-gray-800'
                    }`}
            >
                <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggleSelection(skill.id)}
                    className="hidden"
                />
                {isSelected ? <CheckCircle2 className="w-3 h-3 text-white" /> : null}
                <span>{skill.name}</span>
                {typeof matchScore === 'number' ? (
                    <MatchBadge score={matchScore} trend={matchTrend} label="" />
                ) : null}
                <span className="ml-0.5 flex items-center gap-1">
                    <button
                        type="button"
                        className={`inline-flex h-4 w-4 items-center justify-center rounded-full transition-colors opacity-100 md:opacity-0 md:group-hover:opacity-100 ${isSelected
                            ? 'text-white/85 hover:bg-white/15 hover:text-white'
                            : 'text-rose-300 hover:bg-rose-50 hover:text-rose-500 dark:text-rose-400/80 dark:hover:bg-rose-900/20 dark:hover:text-rose-300'
                            }`}
                        onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onDelete(skill.id);
                        }}
                        disabled={deletingIds.has(skill.id)}
                        title="删除技能"
                        aria-label="删除技能"
                    >
                        <X className="w-3 h-3" />
                    </button>
                    <button
                        type="button"
                        className={`inline-flex h-4 w-4 items-center justify-center rounded-full transition-colors opacity-100 md:opacity-0 md:group-hover:opacity-100 ${isSelected
                            ? 'text-white/85 hover:bg-white/15 hover:text-white'
                            : 'text-rose-300 hover:bg-rose-50 hover:text-rose-600 dark:text-rose-400/80 dark:hover:bg-rose-900/20 dark:hover:text-rose-300'
                            }`}
                        onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onEdit(skill.id);
                        }}
                        title="编辑技能"
                        aria-label="编辑技能"
                    >
                        <Edit3 className="w-3 h-3" />
                    </button>
                </span>
            </label>
        )
    );

const SkillGroupHeader: React.FC<{
    groupName: string;
    skill: SkillActions;
    onResetRenamingCategory: () => void;
    isAllSelected: boolean;
    isIndeterminate: boolean;
    onToggleSelectAll: () => void;
}> = ({
    groupName,
    skill,
    onResetRenamingCategory,
    isAllSelected,
    isIndeterminate,
    onToggleSelectAll
}) => (
        <div className="bg-rose-50/50 dark:bg-rose-900/10 px-3 py-2 border-b border-rose-100 dark:border-rose-800/30 flex items-center justify-between">
            {skill.renamingCategoryTarget === groupName ? (
                <input
                    autoFocus
                    className="text-xs font-bold text-rose-700 dark:text-rose-400 bg-transparent border-b border-rose-300 outline-none w-32"
                    value={skill.renamingCategoryDraft}
                    onChange={(event) => skill.setRenamingCategoryDraft(event.target.value)}
                    onBlur={() => {
                        skill.handleRenameCategory(groupName, skill.renamingCategoryDraft);
                        onResetRenamingCategory();
                    }}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            skill.handleRenameCategory(groupName, skill.renamingCategoryDraft);
                            onResetRenamingCategory();
                        } else if (event.key === 'Escape') {
                            onResetRenamingCategory();
                        }
                    }}
                />
            ) : (
                <div className="flex items-center gap-2 group/title">
                    <div
                        className="flex items-center justify-center p-1 cursor-pointer text-gray-400 hover:text-rose-500 transition-colors"
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggleSelectAll();
                        }}
                        title={isAllSelected ? "取消全选" : "全选"}
                    >
                        <div className={`w-3.5 h-3.5 rounded-[3px] border transition-all flex items-center justify-center ${isAllSelected || isIndeterminate
                            ? 'bg-rose-500 border-rose-500'
                            : 'border-gray-300 hover:border-rose-400 dark:border-gray-600'
                            }`}>
                            {isAllSelected && <CheckCircle2 className="w-2.5 h-2.5 text-white" />}
                            {isIndeterminate && !isAllSelected && (
                                <div className="w-2 h-0.5 bg-white rounded-full" />
                            )}
                        </div>
                    </div>
                    <h5 className="text-xs font-bold text-rose-700 dark:text-rose-400">{groupName}</h5>
                    <button
                        onClick={() => {
                            skill.setRenamingCategoryTarget(groupName);
                            skill.setRenamingCategoryDraft(groupName);
                        }}
                        className="opacity-0 group-hover/title:opacity-100 p-0.5 text-rose-300 hover:text-rose-500 transition-all"
                    >
                        <Edit3 className="w-3 h-3" />
                    </button>
                </div>
            )}
            <div className="flex items-center gap-1">
                <button
                    type="button"
                    onClick={() => skill.requestDeleteSkillCategory(groupName)}
                    title={DELETE_SKILL_CATEGORY_LABEL}
                    aria-label={DELETE_SKILL_CATEGORY_LABEL}
                    className="p-0.5 text-rose-300 hover:text-red-500 transition-all rounded hover:bg-red-50"
                    disabled={skill.deletingSkillCategories.has(groupName)}
                >
                    <Trash2 className="w-3 h-3" />
                </button>
                <button
                    type="button"
                    onClick={() => skill.beginCreateSkillInGroup(groupName)}
                    title={ADD_SKILL_TAG_LABEL}
                    aria-label={ADD_SKILL_TAG_LABEL}
                    className="hidden"
                >
                    <Plus className="w-3 h-3" />
                    {ADD_SKILL_TAG_LABEL}
                </button>
            </div>
        </div>
    );

const SkillGroupBody: React.FC<{
    group: SkillGroupView;
    skill: SkillActions;
    selectedIds: Set<string>;
    matchScores: Map<string, number>;
    matchTrends: Map<string, MatchTrend>;
    onToggleSelection: (id: string) => void;
}> = ({ group, skill, selectedIds, matchScores, matchTrends, onToggleSelection }) => (
    <div className="p-3 bg-white dark:bg-gray-800/50">
        <div className="flex flex-wrap gap-2">
            {group.skills.map((item) => (
                <SkillTag
                    key={item.id}
                    skill={item}
                    isSelected={selectedIds.has(item.id)}
                    isEditing={skill.editingSkillId === item.id}
                    matchScore={matchScores.get(item.id)}
                    matchTrend={matchTrends.get(item.id)}
                    onToggleSelection={onToggleSelection}
                    onDelete={skill.requestDeleteSkill}
                    onEdit={skill.beginEditSkill}
                    onUpdateDraftName={(value) => skill.updateSkillDraft('name', value)}
                    onSaveEdit={skill.handleSaveSkill}
                    onCancelEdit={skill.cancelSkillEdit}
                    deletingIds={skill.deletingSkillIds}
                    draftName={skill.skillDraft?.name || ''}
                    isSaving={skill.isSavingSkill}
                />
            ))}
            {skill.skillDraftContext?.mode === 'group'
                && skill.skillDraftContext?.groupName === group.name ? (
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-rose-500 bg-rose-500 text-white shadow-sm shadow-rose-200 dark:shadow-none text-xs">
                    <input
                        autoFocus
                        className="bg-transparent border-none text-xs text-white p-0 m-0 w-20 outline-none focus:ring-0 placeholder-rose-200"
                        placeholder="输入技能..."
                        value={skill.skillDraft?.name || ''}
                        onChange={(event) => skill.updateSkillDraft('name', event.target.value)}
                        onBlur={skill.handleSaveSkill}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                skill.handleSaveSkill();
                            } else if (event.key === 'Escape') {
                                skill.cancelSkillEdit();
                            }
                        }}
                    />
                </div>
            ) : (
                <button
                    onClick={() => skill.beginCreateSkillInGroup(group.name)}
                    className="flex items-center justify-center p-1.5 rounded-lg border border-dashed border-gray-300 hover:border-rose-400 text-gray-400 hover:text-rose-500 hover:bg-rose-50 transition-colors"
                >
                    <Plus className="w-3.5 h-3.5" />
                </button>
            )}
        </div>
    </div>
);

const SkillGroupCard: React.FC<{
    group: SkillGroupView;
    skill: SkillActions;
    selectedIds: Set<string>;
    matchScores: Map<string, number>;
    matchTrends: Map<string, MatchTrend>;
    onToggleSelection: (id: string) => void;
    onToggleGroupSelection: (groupName: string, skillIds?: string[]) => void;
    onResetRenamingCategory: () => void;
}> = ({
    group,
    skill,
    selectedIds,
    matchScores,
    matchTrends,
    onToggleSelection,
    onToggleGroupSelection,
    onResetRenamingCategory
}) => {
        const selectedCount = group.skills.filter(s => selectedIds.has(s.id)).length;
        const totalCount = group.skills.length;
        const isAllSelected = totalCount > 0 && selectedCount === totalCount;
        const isIndeterminate = selectedCount > 0 && selectedCount < totalCount;
        const visibleSkillIds = group.skills.map((item) => item.id);

        return (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-rose-500/30 shadow-sm hover:shadow-md transition-all overflow-hidden">
                <SkillGroupHeader
                    groupName={group.name}
                    skill={skill}
                    onResetRenamingCategory={onResetRenamingCategory}
                    isAllSelected={isAllSelected}
                    isIndeterminate={isIndeterminate}
                    onToggleSelectAll={() => onToggleGroupSelection(group.name, visibleSkillIds)}
                />
                <SkillGroupBody
                    group={group}
                    skill={skill}
                    selectedIds={selectedIds}
                    matchScores={matchScores}
                    matchTrends={matchTrends}
                    onToggleSelection={onToggleSelection}
                />
            </div>
        );
    };

const SkillListSection: React.FC<SkillListSectionProps> = ({
    title,
    groups,
    emptyMessage,
    selectedIds,
    matchScores,
    matchTrends,
    skill,
    onToggleSelection,
    onToggleGroupSelection,
    onResetRenamingCategory,
}) => {
    const [isCollapsed, setIsCollapsed] = React.useState(false);
    const draftGroupName = resolveDraftGroupName(skill);
    const hasDraftGroup = draftGroupName
        ? groups.some((group) => group.name === draftGroupName)
        : false;
    const shouldShowTypeEditor = !!skill.skillDraft
        && (skill.skillDraftContext?.mode === 'type' || (draftGroupName && !hasDraftGroup));

    return (
        <div className="space-y-4">
            <SkillHeader
                title={title}
                onCreateType={skill.beginCreateSkillType}
                isCollapsed={isCollapsed}
                onToggle={() => setIsCollapsed(!isCollapsed)}
            />
            {!isCollapsed && (
                <>
                    {shouldShowTypeEditor ? <SkillTypeEditor skill={skill} /> : null}
                    {!shouldShowTypeEditor && groups.length === 0 ? (
                        <p className="text-xs text-gray-400">
                            {emptyMessage ?? '暂无技能'}
                        </p>
                    ) : null}
                    {groups.map((group) => (
                        <div key={group.name} data-rf-edit-target={`skill-group:${group.name}`}>
                            <SkillGroupCard
                                group={group}
                                skill={skill}
                                selectedIds={selectedIds}
                                matchScores={matchScores}
                                matchTrends={matchTrends}
                                onToggleSelection={onToggleSelection}
                                onToggleGroupSelection={onToggleGroupSelection}
                                onResetRenamingCategory={onResetRenamingCategory}
                            />
                        </div>
                    ))}
                </>
            )}
        </div>
    );
};

export default SkillListSection;
