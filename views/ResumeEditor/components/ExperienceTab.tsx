import React from 'react';
import {
    ArrowLeft,
    Award,
    Briefcase,
    CheckCircle2,
    Edit3,
    FolderKanban,
    Plus,
    Trash2,
    Wrench,
} from 'lucide-react';
import MonthPicker from '../../../components/MonthPicker';
import type {
    CertificationEditDraft,
    CertificationView,
    ExperienceEditDraft,
    ResumeExperienceView,
    SkillDraftContext,
    SkillEditDraft,
    SkillGroupView,
    SkillItemView,
    StarFieldKey,
} from '../../../types/resume';
import {
    ADD_CERTIFICATION_LABEL,
    ADD_PROJECT_EXPERIENCE_LABEL,
    ADD_SKILL_TAG_LABEL,
    ADD_SKILL_TYPE_LABEL,
    ADD_WORK_EXPERIENCE_LABEL,
    DELETE_SKILL_CATEGORY_LABEL,
} from '../constants';
import { MatchBadge, StaleBadge } from './Badges';

type ExperienceActions = {
    editingExpId: string | null;
    editingDraft: ExperienceEditDraft | null;
    syncToMaster: boolean;
    setSyncToMaster: React.Dispatch<React.SetStateAction<boolean>>;
    isSavingExperience: boolean;
    isAddingExperience: boolean;
    deletingExperienceIds: Set<string>;
    handleAddExperience: (category: ResumeExperienceView['category']) => Promise<void>;
    startEditingExperience: (id: string) => void;
    cancelEditingExperience: () => void;
    updateEditingStar: (field: StarFieldKey, value: string) => void;
    updateEditingMeta: (field: 'company' | 'title', value: string) => void;
    updateEditingDate: (field: 'startDate' | 'endDate', value: string) => void;
    handleSaveExperience: () => Promise<void>;
    requestDeleteExperience: (id: string) => void;
};

type CertificationActions = {
    editingCertificationId: string | null;
    certificationDraft: CertificationEditDraft | null;
    isSavingCertification: boolean;
    deletingCertificationIds: Set<string>;
    beginCreateCertification: () => void;
    beginEditCertification: (id: string) => void;
    cancelCertificationEdit: () => void;
    updateCertificationDraft: (field: keyof CertificationEditDraft, value: string) => void;
    handleSaveCertification: () => Promise<void>;
    requestDeleteCertification: (id: string) => void;
};

type SkillActions = {
    editingSkillId: string | null;
    skillDraft: SkillEditDraft | null;
    skillDraftContext: SkillDraftContext | null;
    isSavingSkill: boolean;
    deletingSkillIds: Set<string>;
    deletingSkillCategories: Set<string>;
    renamingCategoryTarget: string | null;
    renamingCategoryDraft: string;
    setRenamingCategoryTarget: React.Dispatch<React.SetStateAction<string | null>>;
    setRenamingCategoryDraft: React.Dispatch<React.SetStateAction<string>>;
    beginCreateSkillType: () => void;
    beginCreateSkillInGroup: (groupName: string) => void;
    beginEditSkill: (id: string) => void;
    cancelSkillEdit: () => void;
    updateSkillDraft: (field: keyof SkillEditDraft, value: string) => void;
    handleSaveSkill: () => Promise<void>;
    handleRenameCategory: (oldName: string, newName: string) => Promise<void>;
    requestDeleteSkill: (id: string) => void;
    requestDeleteSkillCategory: (categoryName: string) => void;
};

type SelectionActions = {
    toggleExperienceSelection: (id: string) => void;
    toggleCertificationSelection: (id: string) => void;
    toggleSkillSelection: (id: string) => void;
};

type ExperienceTabProps = {
    experience: ExperienceActions;
    certification: CertificationActions;
    skill: SkillActions;
    selection: SelectionActions;
    workItems: ResumeExperienceView[];
    projectItems: ResumeExperienceView[];
    selectedExpIds: Set<string>;
    staleExperienceIds: Set<string>;
    sortedCertifications: CertificationView[];
    selectedCertIds: Set<string>;
    certificationMatchScores: Map<string, number>;
    skillGroups: SkillGroupView[];
    selectedSkillIds: Set<string>;
    skillMatchScores: Map<string, number>;
    onResetRenamingCategory: () => void;
};

const resolveCertificationMatchRate = (
    cert: CertificationView,
    matchScores: Map<string, number>
) => {
    const score = matchScores.get(cert.id);
    return typeof score === 'number' ? score : cert.matchRate;
};

const ExperienceTab: React.FC<ExperienceTabProps> = ({
    experience,
    certification,
    skill,
    selection,
    workItems,
    projectItems,
    selectedExpIds,
    staleExperienceIds,
    sortedCertifications,
    selectedCertIds,
    certificationMatchScores,
    skillGroups,
    selectedSkillIds,
    skillMatchScores,
    onResetRenamingCategory,
}) => {
    if (experience.editingExpId) {
        return (
            <div className="space-y-4 animate-in slide-in-from-right-4 duration-300">
                <button
                    onClick={experience.cancelEditingExperience}
                    className="flex items-center gap-2 text-xs font-bold text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white mb-2"
                >
                    <ArrowLeft className="w-3 h-3" /> 返回列表
                </button>
                <ExperienceEditor experience={experience} />
            </div>
        );
    }

    return (
        <div className="space-y-3 animate-in fade-in slide-in-from-left-4 duration-300">
            <p className="text-xs text-gray-400 px-1 flex items-center gap-2">
                <CheckCircle2 className="w-3 h-3" /> 勾选以添加到简历
            </p>
            <ExperienceListSection
                title="工作经历"
                items={workItems}
                selectedIds={selectedExpIds}
                icon={<Briefcase className="w-3.5 h-3.5 text-primary" />}
                theme="primary"
                actionLabel={ADD_WORK_EXPERIENCE_LABEL}
                onToggleSelection={selection.toggleExperienceSelection}
                onAddItem={() => experience.handleAddExperience('work')}
                onEditItem={experience.startEditingExperience}
                onDeleteItem={experience.requestDeleteExperience}
                deletingIds={experience.deletingExperienceIds}
                staleExperienceIds={staleExperienceIds}
                isAdding={experience.isAddingExperience}
            />
            <ExperienceListSection
                title="项目经历"
                items={projectItems}
                selectedIds={selectedExpIds}
                icon={<FolderKanban className="w-3.5 h-3.5 text-indigo-500" />}
                theme="project"
                actionLabel={ADD_PROJECT_EXPERIENCE_LABEL}
                onToggleSelection={selection.toggleExperienceSelection}
                onAddItem={() => experience.handleAddExperience('project')}
                onEditItem={experience.startEditingExperience}
                onDeleteItem={experience.requestDeleteExperience}
                deletingIds={experience.deletingExperienceIds}
                staleExperienceIds={staleExperienceIds}
                isAdding={experience.isAddingExperience}
            />
            <CertificationListSection
                title="证书资质"
                items={sortedCertifications}
                selectedIds={selectedCertIds}
                matchScores={certificationMatchScores}
                onToggleSelection={selection.toggleCertificationSelection}
                onBeginCreate={certification.beginCreateCertification}
                onBeginEdit={certification.beginEditCertification}
                onCancelEdit={certification.cancelCertificationEdit}
                onSave={certification.handleSaveCertification}
                onDelete={certification.requestDeleteCertification}
                onUpdateDraft={certification.updateCertificationDraft}
                draft={certification.certificationDraft}
                editingId={certification.editingCertificationId}
                deletingIds={certification.deletingCertificationIds}
                isSaving={certification.isSavingCertification}
            />
            <SkillListSection
                title="专业技能"
                groups={skillGroups}
                selectedIds={selectedSkillIds}
                matchScores={skillMatchScores}
                skill={skill}
                onToggleSelection={selection.toggleSkillSelection}
                onResetRenamingCategory={onResetRenamingCategory}
            />
        </div>
    );
};

type ExperienceEditorProps = {
    experience: ExperienceActions;
};

const ExperienceEditor: React.FC<ExperienceEditorProps> = ({ experience }) => (
    <>
        <div className="bg-white dark:bg-gray-800 p-3 rounded-lg border border-gray-200 dark:border-gray-700 mb-2">
            <div className="grid grid-cols-2 gap-2">
                <input
                    className="text-sm font-bold text-gray-900 dark:text-white bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1 focus:ring-1 focus:ring-primary focus:border-primary"
                    value={experience.editingDraft?.company || ''}
                    onChange={(event) => experience.updateEditingMeta('company', event.target.value)}
                    placeholder="公司 / 项目名称"
                />
                <div className="h-9">
                    <MonthPicker
                        value={experience.editingDraft?.startDate || ''}
                        onChange={(val) => experience.updateEditingDate('startDate', val)}
                        placeholder="开始时间"
                        className="h-full"
                    />
                </div>
                <input
                    className="text-xs text-gray-500 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1 focus:ring-1 focus:ring-primary focus:border-primary"
                    value={experience.editingDraft?.title || ''}
                    onChange={(event) => experience.updateEditingMeta('title', event.target.value)}
                    placeholder="职位 / 角色"
                />
                <div className="h-9">
                    <MonthPicker
                        value={experience.editingDraft?.endDate || ''}
                        onChange={(val) => experience.updateEditingDate('endDate', val)}
                        placeholder="结束时间"
                        allowPresent
                        className="h-full"
                        minDate={experience.editingDraft?.startDate || ''}
                    />
                </div>
            </div>
        </div>

        {(['s', 't', 'a', 'r'] as StarFieldKey[]).map((key) => {
            const labelMap: Record<StarFieldKey, string> = {
                s: 'Situation (情境)',
                t: 'Task (任务)',
                a: 'Action (行动)',
                r: 'Result (结果)',
            };
            const colorMap: Record<StarFieldKey, string> = {
                s: 'text-blue-600',
                t: 'text-orange-600',
                a: 'text-amber-600',
                r: 'text-emerald-600',
            };
            const heightClass = key === 'a' ? 'h-40' : 'h-24';
            return (
                <div key={key} className="space-y-1">
                    <label className={`text-[10px] font-bold uppercase tracking-wider ${colorMap[key]} pl-1`}>
                        {labelMap[key]}
                    </label>
                    <textarea
                        className={`w-full text-sm p-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all ${heightClass} resize-none leading-relaxed`}
                        value={experience.editingDraft?.star?.[key] || ''}
                        onChange={(event) => experience.updateEditingStar(key, event.target.value)}
                        placeholder={`Enter ${key.toUpperCase()}...`}
                    />
                </div>
            );
        })}
        <div className="bg-white dark:bg-gray-800 p-3 rounded-lg border border-gray-200 dark:border-gray-700 space-y-2">
            {experience.editingDraft?.isDraft ? (
                <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                        <input
                            type="checkbox"
                            checked
                            disabled
                            className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary opacity-60 cursor-not-allowed"
                        />
                        同步修改个人经历库
                    </label>
                    <span className="text-[10px] text-gray-400">新增默认同步</span>
                </div>
            ) : (
                <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                        <input
                            type="checkbox"
                            checked={experience.syncToMaster}
                            onChange={(event) => experience.setSyncToMaster(event.target.checked)}
                            className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                        />
                        同步修改个人经历库
                    </label>
                    <span className="text-[10px] text-gray-400">关闭后仅对当前简历生效</span>
                </div>
            )}
            <div className="flex items-center justify-end gap-2">
                <button
                    onClick={experience.cancelEditingExperience}
                    className="text-xs font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white px-3 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    disabled={experience.isSavingExperience}
                >
                    取消
                </button>
                <button
                    onClick={experience.handleSaveExperience}
                    className="text-xs font-semibold text-white bg-primary hover:bg-primary-dark px-4 py-1.5 rounded-md transition-colors disabled:opacity-60"
                    disabled={experience.isSavingExperience}
                >
                    {experience.isSavingExperience ? '保存中...' : '保存'}
                </button>
            </div>
        </div>
    </>
);

type ExperienceListSectionProps = {
    title: string;
    items: ResumeExperienceView[];
    selectedIds: Set<string>;
    icon?: React.ReactNode;
    theme: 'primary' | 'project';
    actionLabel: string;
    onToggleSelection: (id: string) => void;
    onAddItem: () => void;
    onEditItem: (id: string) => void;
    onDeleteItem: (id: string) => void;
    deletingIds: Set<string>;
    staleExperienceIds: Set<string>;
    isAdding: boolean;
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
    const themeStyles = {
        primary: {
            borderSelected: 'border-primary',
            ringSelected: 'ring-primary/10',
            checkboxtext: 'text-primary',
            checkboxFocus: 'focus:ring-primary',
            editHoverData: 'hover:text-primary hover:bg-primary/5',
            titleSelected: 'text-gray-900 dark:text-white',
        },
        project: {
            borderSelected: 'border-indigo-500',
            ringSelected: 'ring-indigo-500/10',
            checkboxtext: 'text-indigo-600',
            checkboxFocus: 'focus:ring-indigo-500',
            editHoverData: 'hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/10',
            titleSelected: 'text-gray-900 dark:text-white',
        },
    }[theme];

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

type ExperienceSectionHeaderProps = {
    title: string;
    icon?: React.ReactNode;
    onAddItem: () => void;
    actionLabel: string;
    isAdding: boolean;
};

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

type ExperienceCardProps = {
    item: ResumeExperienceView;
    isSelected: boolean;
    themeStyles: {
        borderSelected: string;
        ringSelected: string;
        checkboxtext: string;
        checkboxFocus: string;
        editHoverData: string;
        titleSelected: string;
    };
    onToggleSelection: (id: string) => void;
    onDelete: (id: string) => void;
    onEdit: (id: string) => void;
    deletingIds: Set<string>;
    staleExperienceIds: Set<string>;
};

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
                    className={`w-4 h-4 rounded border-gray-300 ${themeStyles.checkboxtext} ${themeStyles.checkboxFocus} cursor-pointer`}
                />
            </div>
            <div className="flex-1">
                <div className="flex justify-between items-start">
                    <div>
                        <h4 className={`font-bold text-sm ${isSelected ? themeStyles.titleSelected : 'text-gray-500'}`}>
                            {item.company}
                        </h4>
                        <p className="text-xs text-gray-500">{item.title}</p>
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            className="p-1.5 text-gray-300 rounded transition-colors hover:text-red-500 hover:bg-red-50"
                            onClick={(event) => {
                                event.stopPropagation();
                                onDelete(item.id);
                            }}
                            disabled={deletingIds.has(item.id)}
                            title="删除经历"
                            aria-label="删除经历"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                        <button
                            className={`p-1.5 text-gray-300 rounded transition-colors ${themeStyles.editHoverData}`}
                            onClick={(event) => {
                                event.stopPropagation();
                                onEdit(item.id);
                            }}
                            title="编辑经历"
                            aria-label="编辑经历"
                        >
                            <Edit3 className="w-4 h-4" />
                        </button>
                    </div>
                </div>
                <div className="flex items-center justify-between mt-2">
                    <p className="text-[10px] text-gray-400 font-mono">{item.date}</p>
                    {typeof item.matchScore === 'number' ? (
                        <MatchBadge score={item.matchScore} />
                    ) : staleExperienceIds.has(item.id) ? (
                        <StaleBadge />
                    ) : null}
                </div>
            </div>
        </div>
    </div>
);

type CertificationListSectionProps = {
    title: string;
    items: CertificationView[];
    selectedIds: Set<string>;
    matchScores: Map<string, number>;
    onToggleSelection: (id: string) => void;
    onBeginCreate: () => void;
    onBeginEdit: (id: string) => void;
    onCancelEdit: () => void;
    onSave: () => void;
    onDelete: (id: string) => void;
    onUpdateDraft: (field: keyof CertificationEditDraft, value: string) => void;
    draft: CertificationEditDraft | null;
    editingId: string | null;
    deletingIds: Set<string>;
    isSaving: boolean;
};

const CertificationListSection: React.FC<CertificationListSectionProps> = ({
    title,
    items,
    selectedIds,
    matchScores,
    onToggleSelection,
    onBeginCreate,
    onBeginEdit,
    onCancelEdit,
    onSave,
    onDelete,
    onUpdateDraft,
    draft,
    editingId,
    deletingIds,
    isSaving,
}) => {
    if (!items.length) {
        return (
            <div className="space-y-3">
                <CertificationHeader title={title} onCreate={onBeginCreate} />
                <p className="text-xs text-gray-400">暂无证书</p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <CertificationHeader title={title} onCreate={onBeginCreate} />
            {items.map((cert) => {
                const isSelected = selectedIds.has(cert.id);
                const matchRate = resolveCertificationMatchRate(cert, matchScores);
                const isEditing = editingId === cert.id && !!draft;
                if (isEditing) {
                    return (
                        <div
                            key={cert.id}
                            className="bg-white dark:bg-gray-800 rounded-lg border border-amber-200/60 dark:border-amber-800/40 p-3 space-y-2"
                        >
                            {draft ? (
                                <CertificationForm draft={draft} onUpdate={onUpdateDraft} />
                            ) : null}
                            <div className="flex items-center justify-end gap-2">
                                <button
                                    onClick={onCancelEdit}
                                    className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded"
                                    disabled={isSaving}
                                >
                                    取消
                                </button>
                                <button
                                    onClick={onSave}
                                    className="text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 px-3 py-1 rounded disabled:opacity-60"
                                    disabled={isSaving}
                                >
                                    {isSaving ? '保存中...' : '保存'}
                                </button>
                            </div>
                        </div>
                    );
                }
                return (
                    <div
                        key={cert.id}
                        className={`bg-white dark:bg-gray-800 rounded-xl border p-3 shadow-sm transition-all group relative cursor-pointer ${isSelected
                            ? 'border-amber-500 ring-1 ring-amber-500/20'
                            : 'border-amber-500/30 hover:shadow-md'
                            }`}
                        onClick={() => onToggleSelection(cert.id)}
                    >
                        <div className="flex items-start gap-3">
                            <div className="pt-1">
                                <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => onToggleSelection(cert.id)}
                                    className="w-4 h-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500 cursor-pointer"
                                    onClick={(event) => event.stopPropagation()}
                                />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex justify-between items-start mb-1">
                                    <h4 className={`font-bold text-sm truncate ${isSelected ? 'text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-200'}`}>
                                        {cert.name}
                                    </h4>
                                    <div className="flex items-center gap-1 shrink-0 ml-2">
                                        <button
                                            className="p-1 text-gray-300 rounded hover:text-red-500 hover:bg-red-50"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                onDelete(cert.id);
                                            }}
                                            disabled={deletingIds.has(cert.id)}
                                            title="删除证书"
                                            aria-label="删除证书"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                            className="p-1 text-gray-300 rounded hover:text-amber-600 hover:bg-amber-50"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                onBeginEdit(cert.id);
                                            }}
                                            title="编辑证书"
                                            aria-label="编辑证书"
                                        >
                                            <Edit3 className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>
                                {cert.issuer && (
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 truncate">{cert.issuer}</p>
                                )}
                                <div className="flex items-center justify-between mt-2">
                                    <p className="text-[10px] text-gray-400 font-mono">{cert.date}</p>
                                    {typeof matchRate === 'number' && matchRate > 0 ? (
                                        <MatchBadge score={matchRate} />
                                    ) : null}
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

type CertificationHeaderProps = {
    title: string;
    onCreate: () => void;
};

const CertificationHeader: React.FC<CertificationHeaderProps> = ({ title, onCreate }) => (
    <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
            <Award className="w-3.5 h-3.5 text-amber-500" />
            <h4 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{title}</h4>
        </div>
        <button
            onClick={onCreate}
            title={ADD_CERTIFICATION_LABEL}
            aria-label={ADD_CERTIFICATION_LABEL}
            className="flex items-center justify-center text-gray-500 hover:text-amber-600 p-1 rounded-md hover:bg-amber-50"
        >
            <Plus className="w-3.5 h-3.5" />
        </button>
    </div>
);

type CertificationFormProps = {
    draft: CertificationEditDraft;
    onUpdate: (field: keyof CertificationEditDraft, value: string) => void;
};

const CertificationForm: React.FC<CertificationFormProps> = ({ draft, onUpdate }) => (
    <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
            <div>
                <label className="text-[10px] text-gray-400">证书名称</label>
                <input
                    className="w-full text-xs mt-0.5 p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-1 focus:ring-amber-400 focus:border-amber-400"
                    value={draft.name}
                    onChange={(event) => onUpdate('name', event.target.value)}
                />
            </div>
            <div>
                <label className="text-[10px] text-gray-400">颁发机构</label>
                <input
                    className="w-full text-xs mt-0.5 p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-1 focus:ring-amber-400 focus:border-amber-400"
                    value={draft.issuer}
                    onChange={(event) => onUpdate('issuer', event.target.value)}
                />
            </div>
        </div>
        <div>
            <label className="text-[10px] text-gray-400">取得时间 (YYYY-MM)</label>
            <input
                className="w-full text-xs mt-0.5 p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-1 focus:ring-amber-400 focus:border-amber-400"
                value={draft.issueDate}
                onChange={(event) => onUpdate('issueDate', event.target.value)}
                placeholder="2026-07"
            />
        </div>
    </div>
);

type SkillListSectionProps = {
    title: string;
    groups: SkillGroupView[];
    selectedIds: Set<string>;
    matchScores: Map<string, number>;
    skill: SkillActions;
    onToggleSelection: (id: string) => void;
    onResetRenamingCategory: () => void;
};

const SkillListSection: React.FC<SkillListSectionProps> = ({
    title,
    groups,
    selectedIds,
    matchScores,
    skill,
    onToggleSelection,
    onResetRenamingCategory,
}) => {
    const draftGroupName = (() => {
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
    })();
    const hasDraftGroup = draftGroupName
        ? groups.some((group) => group.name === draftGroupName)
        : false;
    const shouldShowTypeEditor = !!skill.skillDraft
        && (skill.skillDraftContext?.mode === 'type' || (draftGroupName && !hasDraftGroup));

    return (
        <div className="space-y-4">
            <SkillHeader title={title} onCreateType={skill.beginCreateSkillType} />
            {shouldShowTypeEditor ? (
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
            ) : null}
            {groups.map((group) => (
                <SkillGroupCard
                    key={group.name}
                    group={group}
                    skill={skill}
                    selectedIds={selectedIds}
                    matchScores={matchScores}
                    onToggleSelection={onToggleSelection}
                    onResetRenamingCategory={onResetRenamingCategory}
                />
            ))}
        </div>
    );
};

type SkillHeaderProps = {
    title: string;
    onCreateType: () => void;
};

const SkillHeader: React.FC<SkillHeaderProps> = ({ title, onCreateType }) => (
    <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
            <Wrench className="w-3.5 h-3.5 text-rose-500" />
            <h4 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{title}</h4>
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

type SkillGroupCardProps = {
    group: SkillGroupView;
    skill: SkillActions;
    selectedIds: Set<string>;
    matchScores: Map<string, number>;
    onToggleSelection: (id: string) => void;
    onResetRenamingCategory: () => void;
};

const SkillGroupCard: React.FC<SkillGroupCardProps> = ({
    group,
    skill,
    selectedIds,
    matchScores,
    onToggleSelection,
    onResetRenamingCategory,
}) => (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-rose-500/30 shadow-sm hover:shadow-md transition-all overflow-hidden">
        <div className="bg-rose-50/50 dark:bg-rose-900/10 px-3 py-2 border-b border-rose-100 dark:border-rose-800/30 flex items-center justify-between">
            {skill.renamingCategoryTarget === group.name ? (
                <input
                    autoFocus
                    className="text-xs font-bold text-rose-700 dark:text-rose-400 bg-transparent border-b border-rose-300 outline-none w-32"
                    value={skill.renamingCategoryDraft}
                    onChange={(event) => skill.setRenamingCategoryDraft(event.target.value)}
                    onBlur={() => {
                        skill.handleRenameCategory(group.name, skill.renamingCategoryDraft);
                        onResetRenamingCategory();
                    }}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            skill.handleRenameCategory(group.name, skill.renamingCategoryDraft);
                            onResetRenamingCategory();
                        } else if (event.key === 'Escape') {
                            onResetRenamingCategory();
                        }
                    }}
                />
            ) : (
                <div className="flex items-center gap-2 group/title">
                    <h5 className="text-xs font-bold text-rose-700 dark:text-rose-400">{group.name}</h5>
                    <button
                        onClick={() => {
                            skill.setRenamingCategoryTarget(group.name);
                            skill.setRenamingCategoryDraft(group.name);
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
                    onClick={() => skill.requestDeleteSkillCategory(group.name)}
                    title={DELETE_SKILL_CATEGORY_LABEL}
                    aria-label={DELETE_SKILL_CATEGORY_LABEL}
                    className="p-0.5 text-rose-300 hover:text-red-500 transition-all rounded hover:bg-red-50"
                    disabled={skill.deletingSkillCategories.has(group.name)}
                >
                    <Trash2 className="w-3 h-3" />
                </button>
                <button
                    type="button"
                    onClick={() => skill.beginCreateSkillInGroup(group.name)}
                    title={ADD_SKILL_TAG_LABEL}
                    aria-label={ADD_SKILL_TAG_LABEL}
                    className="hidden"
                >
                    <Plus className="w-3 h-3" />
                    {ADD_SKILL_TAG_LABEL}
                </button>
            </div>
        </div>
        <div className="p-3 bg-white dark:bg-gray-800/50">
            {skill.skillDraftContext?.mode === 'edit' ? (
                <div className="mb-2">
                    <SkillEditor
                        draft={skill.skillDraft}
                        onUpdate={skill.updateSkillDraft}
                        onCancel={skill.cancelSkillEdit}
                        onSave={skill.handleSaveSkill}
                        isSaving={skill.isSavingSkill}
                        className="border-rose-200/50 bg-rose-50/40 dark:bg-rose-900/10"
                    />
                </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
                {group.skills.map((item) => (
                    <SkillTag
                        key={item.id}
                        skill={item}
                        isSelected={selectedIds.has(item.id)}
                        isEditing={skill.editingSkillId === item.id}
                        matchScore={matchScores.get(item.id)}
                        onToggleSelection={onToggleSelection}
                        onDelete={skill.requestDeleteSkill}
                        onEdit={skill.beginEditSkill}
                        deletingIds={skill.deletingSkillIds}
                        draftName={skill.skillDraft?.name || ''}
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
    </div>
);

type SkillEditorProps = {
    draft: SkillEditDraft | null;
    onUpdate: (field: keyof SkillEditDraft, value: string) => void;
    onCancel: () => void;
    onSave: () => void;
    isSaving: boolean;
    className?: string;
};

const SkillEditor: React.FC<SkillEditorProps> = ({
    draft,
    onUpdate,
    onCancel,
    onSave,
    isSaving,
    className,
}) => {
    if (!draft) {
        return null;
    }
    return (
        <div
            className={`bg-white dark:bg-gray-800 rounded-lg border border-rose-200/60 dark:border-rose-800/40 p-3 space-y-2 ${className || ''}`.trim()}
        >
            <div className="grid grid-cols-2 gap-2">
                <div>
                    <label className="text-[10px] text-gray-400">技能名称</label>
                    <input
                        className="w-full text-xs mt-0.5 p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-1 focus:ring-rose-400 focus:border-rose-400"
                        value={draft.name}
                        onChange={(event) => onUpdate('name', event.target.value)}
                    />
                </div>
                <div>
                    <label className="text-[10px] text-gray-400">技能分类</label>
                    <input
                        className="w-full text-xs mt-0.5 p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-1 focus:ring-rose-400 focus:border-rose-400 disabled:bg-gray-100 dark:disabled:bg-gray-900/40"
                        value={draft.category}
                        onChange={(event) => onUpdate('category', event.target.value)}
                    />
                </div>
            </div>
            <div className="flex items-center justify-end gap-2">
                <button
                    onClick={onCancel}
                    className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded"
                    disabled={isSaving}
                >
                    取消
                </button>
                <button
                    onClick={onSave}
                    className="text-xs font-semibold text-white bg-rose-500 hover:bg-rose-600 px-3 py-1 rounded disabled:opacity-60"
                    disabled={isSaving}
                >
                    {isSaving ? '保存中...' : '保存'}
                </button>
            </div>
        </div>
    );
};

type SkillTagProps = {
    skill: SkillItemView;
    isSelected: boolean;
    isEditing: boolean;
    matchScore?: number;
    onToggleSelection: (id: string) => void;
    onDelete: (id: string) => void;
    onEdit: (id: string) => void;
    deletingIds: Set<string>;
    draftName: string;
};

const SkillTag: React.FC<SkillTagProps> = ({
    skill,
    isSelected,
    isEditing,
    matchScore,
    onToggleSelection,
    onDelete,
    onEdit,
    deletingIds,
    draftName,
}) => (
    <label
        className={`group flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer transition-all select-none ${isSelected || isEditing
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
        {isSelected && <CheckCircle2 className="w-3 h-3 text-white" />}
        <span>{isEditing ? (draftName || skill.name) : skill.name}</span>
        {typeof matchScore === 'number' && matchScore > 0 ? (
            <MatchBadge score={matchScore} />
        ) : null}
        <span className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
                type="button"
                className="p-1 text-gray-300 rounded hover:text-red-500 hover:bg-red-50"
                onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onDelete(skill.id);
                }}
                disabled={deletingIds.has(skill.id)}
                title="删除技能"
                aria-label="删除技能"
            >
                <Trash2 className="w-3 h-3" />
            </button>
            <button
                type="button"
                className="p-1 text-gray-300 rounded hover:text-rose-600 hover:bg-rose-50"
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
);

export default ExperienceTab;
