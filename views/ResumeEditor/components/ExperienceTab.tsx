import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Briefcase, CheckCircle2, FolderKanban, Wand2 } from 'lucide-react';
import MonthPicker from '../../../components/MonthPicker';
import RichTextEditor from '../../../components/RichTextEditor';
import type { ExperienceActions, ExperienceTabProps, StarFieldKey } from '../../../types/resume';
import { ADD_PROJECT_EXPERIENCE_LABEL, ADD_WORK_EXPERIENCE_LABEL } from '../constants';
import MatchScoreFilter from './MatchScoreFilter';
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
const DEFAULT_MATCH_SCORE_FILTER = 70;

const clampMatchScoreFilter = (value: number) => Math.min(100, Math.max(0, value));

const buildFilterHiddenMessage = (
    label: string,
    unit: string,
    hiddenCount: number,
    matchScoreFilter: number
) => {
    if (hiddenCount <= 0) {
        return `暂无${label}`;
    }
    return `当前有 ${hiddenCount}${unit}${label}因最低匹配度 ≥ ${matchScoreFilter}% 被隐藏`;
};

const formatHiddenSummary = (
    segments: Array<{ label: string; count: number }>
) => segments
    .filter((segment) => segment.count > 0)
    .map((segment) => `${segment.count}${segment.label}`)
    .join('、');

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
    isAutoAssembling,
    onAutoAssemble,
    onResetRenamingCategory,
    onPolishExperience,
    onResetWorkSort,
    onResetProjectSort,
    onResetCertificationSort,
}) => {
    const [matchScoreFilter, setMatchScoreFilter] = useState(DEFAULT_MATCH_SCORE_FILTER);
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

    const handlePolishExperienceFromList = useCallback((id: string) => {
        recordListScroll();
        onPolishExperience(id);
    }, [onPolishExperience, recordListScroll]);

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

    const filteredWorkItems = useMemo(() => {
        const hasJDAnalysis = workItems.some((item) => item.matchScore !== undefined);
        if (!hasJDAnalysis) {
            return workItems;
        }

        return workItems.filter((item) => item.matchScore === undefined || item.matchScore >= matchScoreFilter);
    }, [workItems, matchScoreFilter]);

    const filteredProjectItems = useMemo(() => {
        const hasJDAnalysis = projectItems.some((item) => item.matchScore !== undefined);
        if (!hasJDAnalysis) {
            return projectItems;
        }

        return projectItems.filter((item) => item.matchScore === undefined || item.matchScore >= matchScoreFilter);
    }, [projectItems, matchScoreFilter]);

    const filteredCertifications = useMemo(() => {
        if (certificationMatchScores.size === 0) {
            return sortedCertifications;
        }
        return sortedCertifications.filter((cert) => {
            const score = certificationMatchScores.get(cert.id);
            return (
                cert.id === certification.editingCertificationId
                || score === undefined
                || score >= matchScoreFilter
            );
        });
    }, [
        sortedCertifications,
        certificationMatchScores,
        matchScoreFilter,
        certification.editingCertificationId,
    ]);

    const filteredSkillGroups = useMemo(() => {
        if (skillMatchScores.size === 0) {
            return skillGroups;
        }
        const activeDraftGroupName = skill.skillDraftContext?.mode === 'group'
            ? skill.skillDraftContext.groupName ?? null
            : null;
        return skillGroups
            .map((group) => {
                const filteredSkills = group.skills.filter((item) => {
                    const score = skillMatchScores.get(item.id);
                    return (
                        item.id === skill.editingSkillId
                        || score === undefined
                        || score >= matchScoreFilter
                    );
                });
                const shouldKeepGroup = (
                    group.name === skill.renamingCategoryTarget
                    || group.name === activeDraftGroupName
                );
                return {
                    group: {
                        ...group,
                        skills: filteredSkills,
                    },
                    shouldKeepGroup,
                };
            })
            .filter(({ group, shouldKeepGroup }) => shouldKeepGroup || group.skills.length > 0)
            .map(({ group }) => group);
    }, [
        skillGroups,
        skillMatchScores,
        matchScoreFilter,
        skill.editingSkillId,
        skill.renamingCategoryTarget,
        skill.skillDraftContext,
    ]);

    const hiddenSummary = useMemo(() => {
        const workHidden = Math.max(0, workItems.length - filteredWorkItems.length);
        const projectHidden = Math.max(0, projectItems.length - filteredProjectItems.length);
        const certificationHidden = Math.max(
            0,
            sortedCertifications.length - filteredCertifications.length
        );
        const totalSkillCount = skillGroups.reduce((sum, group) => sum + group.skills.length, 0);
        const filteredSkillCount = filteredSkillGroups.reduce(
            (sum, group) => sum + group.skills.length,
            0
        );
        const skillHidden = Math.max(0, totalSkillCount - filteredSkillCount);
        const segments = [
            { label: '条工作经历', count: workHidden },
            { label: '条项目经历', count: projectHidden },
            { label: '项证书', count: certificationHidden },
            { label: '项技能', count: skillHidden },
        ];
        const hiddenTotal = segments.reduce((sum, segment) => sum + segment.count, 0);
        return {
            workHidden,
            projectHidden,
            certificationHidden,
            skillHidden,
            hiddenTotal,
            text: formatHiddenSummary(segments),
        };
    }, [
        filteredCertifications.length,
        filteredProjectItems.length,
        filteredSkillGroups,
        filteredWorkItems.length,
        projectItems.length,
        skillGroups,
        sortedCertifications.length,
        workItems.length,
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
            <div className="px-1 flex items-center justify-between gap-3">
                <p className="text-xs text-gray-400 flex items-center gap-2">
                    <CheckCircle2 className="w-3 h-3" /> 勾选以添加到简历
                </p>
                <div className="flex items-center gap-2">
                    <MatchScoreFilter 
                        value={matchScoreFilter}
                        onChange={setMatchScoreFilter}
                    />
                    <button
                        type="button"
                        onClick={onAutoAssemble}
                        disabled={isAutoAssembling}
                        className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        <Wand2 className={`w-3 h-3 ${isAutoAssembling ? 'animate-spin' : ''}`} />
                        {isAutoAssembling ? '组装中...' : '一键组装'}
                    </button>
                </div>
            </div>
            {matchScoreFilter > 0 && hiddenSummary.hiddenTotal > 0 ? (
                <div className="mx-1 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-[11px] leading-5 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
                    <div className="flex items-start justify-between gap-3">
                        <span>
                            当前已按最低匹配度 ≥ {matchScoreFilter}% 进行筛选，已隐藏
                            {hiddenSummary.text ? ` ${hiddenSummary.text}` : '部分内容'}。
                        </span>
                        <button
                            type="button"
                            onClick={() => setMatchScoreFilter(0)}
                            className="shrink-0 rounded-md border border-amber-300 px-2 py-0.5 font-semibold text-amber-700 transition-colors hover:bg-amber-100 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-900/30"
                        >
                            显示全部
                        </button>
                    </div>
                </div>
            ) : null}
            <ExperienceListSection
                title="工作经历"
                items={filteredWorkItems}
                emptyMessage={buildFilterHiddenMessage('工作经历', '条', hiddenSummary.workHidden, matchScoreFilter)}
                selectedIds={selectedExpIds}
                icon={<Briefcase className="w-3.5 h-3.5 text-primary" />}
                theme="primary"
                actionLabel={ADD_WORK_EXPERIENCE_LABEL}
                onToggleSelection={selection.toggleExperienceSelection}
                onAddItem={() => experience.handleAddExperience('work')}
                onEditItem={handleEditExperienceFromList}
                onPolishItem={handlePolishExperienceFromList}
                onDeleteItem={experience.requestDeleteExperience}
                deletingIds={experience.deletingExperienceIds}
                staleExperienceIds={staleExperienceIds}
                isAdding={experience.isAddingExperience}
                isPolishing={experience.isPolishing}
                onResetSort={onResetWorkSort}
            />
            <ExperienceListSection
                title="项目经历"
                items={filteredProjectItems}
                emptyMessage={buildFilterHiddenMessage('项目经历', '条', hiddenSummary.projectHidden, matchScoreFilter)}
                selectedIds={selectedExpIds}
                icon={<FolderKanban className="w-3.5 h-3.5 text-indigo-500" />}
                theme="project"
                actionLabel={ADD_PROJECT_EXPERIENCE_LABEL}
                onToggleSelection={selection.toggleExperienceSelection}
                onAddItem={() => experience.handleAddExperience('project')}
                onEditItem={handleEditExperienceFromList}
                onPolishItem={handlePolishExperienceFromList}
                onDeleteItem={experience.requestDeleteExperience}
                deletingIds={experience.deletingExperienceIds}
                staleExperienceIds={staleExperienceIds}
                isAdding={experience.isAddingExperience}
                isPolishing={experience.isPolishing}
                onResetSort={onResetProjectSort}
            />
            <CertificationListSection
                title="证书资质"
                items={filteredCertifications}
                emptyMessage={buildFilterHiddenMessage('证书', '项', hiddenSummary.certificationHidden, matchScoreFilter)}
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
                groups={filteredSkillGroups}
                emptyMessage={buildFilterHiddenMessage('技能', '项', hiddenSummary.skillHidden, matchScoreFilter)}
                selectedIds={selectedSkillIds}
                matchScores={skillMatchScores}
                matchTrends={skillMatchTrends}
                skill={skill}
                onToggleSelection={selection.toggleSkillSelection}
                onToggleGroupSelection={selection.toggleSkillGroupSelection}
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
