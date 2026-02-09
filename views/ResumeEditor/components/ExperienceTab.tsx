import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { ArrowLeft, Briefcase, CheckCircle2, FolderKanban } from 'lucide-react';
import MonthPicker from '../../../components/MonthPicker';
import RichTextEditor from '../../../components/RichTextEditor';
import type { ExperienceActions, ExperienceTabProps, StarFieldKey } from '../../../types/resume';
import { ADD_PROJECT_EXPERIENCE_LABEL, ADD_WORK_EXPERIENCE_LABEL } from '../constants';
import CertificationListSection from './CertificationListSection';
import ExperienceListSection from './ExperienceList/ListSection';
import SkillListSection from './SkillListSection';

const SCROLL_TARGET_ATTR = 'data-rf-edit-target';
const SCROLL_BEHAVIOR: ScrollBehavior = 'smooth';
const SCROLL_BLOCK: ScrollLogicalPosition = 'center';
const SCROLL_TARGET_PREFIX = {
    certification: 'certification',
    skillGroup: 'skill-group',
} as const;

const escapeSelectorValue = (value: string) => {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
        return CSS.escape(value);
    }
    return value.replace(/"/g, '\\"');
};

const buildScrollSelector = (target: string) => (
    `[${SCROLL_TARGET_ATTR}="${escapeSelectorValue(target)}"]`
);

const scrollToTarget = (target: string) => {
    if (typeof document === 'undefined') {
        return;
    }
    const element = document.querySelector(buildScrollSelector(target));
    if (element instanceof HTMLElement) {
        element.scrollIntoView({ behavior: SCROLL_BEHAVIOR, block: SCROLL_BLOCK });
    }
};

const resolveSkillGroupTarget = (
    skillId: string,
    groups: ExperienceTabProps['skillGroups']
) => {
    const group = groups.find((item) => item.skills.some((skill) => skill.id === skillId));
    return group ? `${SCROLL_TARGET_PREFIX.skillGroup}:${group.name}` : null;
};

const ExperienceTab: React.FC<ExperienceTabProps> = ({
    experience,
    certification,
    skill,
    selection,
    scrollContainerRef,
    workItems,
    projectItems,
    selectedExpIds,
    staleExperienceIds,
    sortedCertifications,
    selectedCertIds,
    certificationMatchScores,
    certificationMatchTrends,
    skillGroups,
    selectedSkillIds,
    skillMatchScores,
    skillMatchTrends,
    onResetRenamingCategory,
    onResetWorkSort,
    onResetProjectSort,
    onResetCertificationSort,
}) => {
    const listScrollSnapshotRef = useRef<number | null>(null);
    const shouldRestoreScrollRef = useRef(false);
    const prevEditingExpIdRef = useRef<string | null>(experience.editingExpId);

    const recordListScroll = useCallback(() => {
        const container = scrollContainerRef?.current;
        listScrollSnapshotRef.current = container ? container.scrollTop : null;
        shouldRestoreScrollRef.current = true;
    }, [scrollContainerRef]);

    const handleEditExperienceFromList = useCallback((id: string) => {
        recordListScroll();
        experience.startEditingExperience(id);
    }, [experience.startEditingExperience, recordListScroll]);

    const scrollTarget = useMemo(() => {
        if (experience.editingExpId) {
            return null;
        }
        if (certification.editingCertificationId) {
            return `${SCROLL_TARGET_PREFIX.certification}:${certification.editingCertificationId}`;
        }
        if (skill.editingSkillId) {
            return resolveSkillGroupTarget(skill.editingSkillId, skillGroups);
        }
        return null;
    }, [
        experience.editingExpId,
        certification.editingCertificationId,
        skill.editingSkillId,
        skillGroups,
    ]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }
        const prevEditingExpId = prevEditingExpIdRef.current;
        prevEditingExpIdRef.current = experience.editingExpId;
        if (!prevEditingExpId || experience.editingExpId) {
            return;
        }
        if (!shouldRestoreScrollRef.current) {
            return;
        }
        shouldRestoreScrollRef.current = false;
        if (scrollTarget) {
            return;
        }
        const container = scrollContainerRef?.current;
        const scrollTop = listScrollSnapshotRef.current;
        if (!container || scrollTop === null) {
            return;
        }
        const frameId = window.requestAnimationFrame(() => {
            container.scrollTop = scrollTop;
        });
        return () => window.cancelAnimationFrame(frameId);
    }, [experience.editingExpId, scrollContainerRef, scrollTarget]);

    useEffect(() => {
        if (!scrollTarget || typeof window === 'undefined') {
            return;
        }
        const frameId = window.requestAnimationFrame(() => {
            scrollToTarget(scrollTarget);
        });
        return () => window.cancelAnimationFrame(frameId);
    }, [scrollTarget]);

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
                onEditItem={handleEditExperienceFromList}
                onDeleteItem={experience.requestDeleteExperience}
                deletingIds={experience.deletingExperienceIds}
                staleExperienceIds={staleExperienceIds}
                isAdding={experience.isAddingExperience}
                onResetSort={onResetWorkSort}
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
                onEditItem={handleEditExperienceFromList}
                onDeleteItem={experience.requestDeleteExperience}
                deletingIds={experience.deletingExperienceIds}
                staleExperienceIds={staleExperienceIds}
                isAdding={experience.isAddingExperience}
                onResetSort={onResetProjectSort}
            />
            <CertificationListSection
                title="证书资质"
                items={sortedCertifications}
                selectedIds={selectedCertIds}
                matchScores={certificationMatchScores}
                matchTrends={certificationMatchTrends}
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
                onResetSort={onResetCertificationSort}
            />
            <SkillListSection
                title="专业技能"
                groups={skillGroups}
                selectedIds={selectedSkillIds}
                matchScores={skillMatchScores}
                matchTrends={skillMatchTrends}
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
                    <RichTextEditor
                        className={`w-full text-sm p-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all ${heightClass} resize-none leading-relaxed`}
                        value={experience.editingDraft?.star?.[key] || ''}
                        onChange={(nextValue) => experience.updateEditingStar(key, nextValue)}
                        placeholder={`Enter ${key.toUpperCase()}...`}
                        ariaLabel={`${labelMap[key]} 输入`}
                        enableList={false}
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

export default ExperienceTab;
