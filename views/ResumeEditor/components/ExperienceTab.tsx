import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Briefcase, CheckCircle2, FolderKanban, Sparkles, Wand2, X } from 'lucide-react';
import MonthPicker from '../../../components/MonthPicker';
import RichTextEditor from '../../../components/RichTextEditor';
import type { ExperienceActions, ExperienceTabProps, StarFieldKey } from '../../../types/resume';
import { ADD_PROJECT_EXPERIENCE_LABEL, ADD_WORK_EXPERIENCE_LABEL } from '../constants';
import MatchScoreFilter from './MatchScoreFilter';
import CertificationListSection from './CertificationListSection';
import ExperienceListSection from './ExperienceList/ListSection';
import PersonalSummaryPanel from './PersonalSummaryPanel';
import SkillListSection from './SkillListSection';

const SCROLL_TARGET_ATTR = 'data-rf-edit-target';
const SCROLL_BEHAVIOR: ScrollBehavior = 'smooth';
const SCROLL_BLOCK: ScrollLogicalPosition = 'center';
const SCROLL_TARGET_PREFIX = {
    certification: 'certification',
    skillGroup: 'skill-group',
} as const;
const buildFilterHiddenMessage = (
    label: string,
    unit: string,
    hiddenCount: number,
    matchScoreFilter: number
) => {
    if (hiddenCount <= 0) {
        return `暂无${label}`;
    }
    return `当前有${hiddenCount}${unit}${label}未满足 ${matchScoreFilter}% 分数要求`;
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
    layoutMode = 'inline',
    experience,
    certification,
    skill,
    selection,
    personalSummary,
    isSummaryVisible,
    isGeneratingPersonalSummary,
    canGeneratePersonalSummary,
    onPersonalSummaryChange,
    onSummaryVisibilityChange,
    onGeneratePersonalSummary,
    matchScoreFilter,
    onMatchScoreFilterChange,
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
    selectedExperienceCount,
    canBatchPolish,
    isBatchPolishing,
    isAutoAssembling,
    onBatchPolish,
    onAutoAssemble,
    onResetRenamingCategory,
    onPolishExperience,
    activePolishExperienceId,
    hasBlockingPolishState,
    isEditingExperiencePolishPreviewing = false,
    polishToolbar,
    batchPolishToolbar,
    onClosePolishExperienceToolbar,
    onDismissPolishExperienceToolbar,
    onCloseBatchPolishToolbar,
    onDismissBatchPolishToolbar,
    onResetWorkSort,
    onResetProjectSort,
    onResetCertificationSort,
}) => {
    const isDrawerLayout = layoutMode === 'drawer';
    const listScrollSnapshotRef = useRef<number | null>(null);
    const shouldRestoreScrollRef = useRef(false);
    const prevEditingExpIdRef = useRef<string | null>(experience.editingExpId);

    const recordListScroll = useCallback(() => {
        const container = scrollContainerRef?.current;
        listScrollSnapshotRef.current = container ? container.scrollTop : null;
        shouldRestoreScrollRef.current = true;
    }, [scrollContainerRef]);

    const dismissBlockingPolishUi = useCallback(() => {
        if (batchPolishToolbar) {
            onDismissBatchPolishToolbar?.();
            return;
        }
        onDismissPolishExperienceToolbar?.();
    }, [batchPolishToolbar, onDismissBatchPolishToolbar, onDismissPolishExperienceToolbar]);

    const handleEditExperienceFromList = useCallback((id: string) => {
        if (hasBlockingPolishState) {
            dismissBlockingPolishUi();
            return;
        }
        recordListScroll();
        experience.startEditingExperience(id);
    }, [
        dismissBlockingPolishUi,
        experience.startEditingExperience,
        hasBlockingPolishState,
        recordListScroll,
    ]);

    const handlePolishExperienceFromList = useCallback((id: string) => {
        recordListScroll();
        onPolishExperience(id);
    }, [onPolishExperience, recordListScroll]);

    const guardBlockedSidebarAction = useCallback(() => {
        if (!hasBlockingPolishState) {
            return false;
        }
        dismissBlockingPolishUi();
        return true;
    }, [dismissBlockingPolishUi, hasBlockingPolishState]);

    const handleBatchPolishClick = useCallback(() => {
        if (guardBlockedSidebarAction()) {
            return;
        }
        onBatchPolish();
    }, [guardBlockedSidebarAction, onBatchPolish]);

    const handleAutoAssembleClick = useCallback(() => {
        if (guardBlockedSidebarAction()) {
            return;
        }
        onAutoAssemble();
    }, [guardBlockedSidebarAction, onAutoAssemble]);

    const handleAddWorkExperience = useCallback(() => {
        if (guardBlockedSidebarAction()) {
            return;
        }
        void experience.handleAddExperience('work');
    }, [experience, guardBlockedSidebarAction]);

    const handleAddProjectExperience = useCallback(() => {
        if (guardBlockedSidebarAction()) {
            return;
        }
        void experience.handleAddExperience('project');
    }, [experience, guardBlockedSidebarAction]);

    const handleBeginCreateCertification = useCallback(() => {
        if (guardBlockedSidebarAction()) {
            return;
        }
        certification.beginCreateCertification();
    }, [certification, guardBlockedSidebarAction]);

    const handleBeginEditCertification = useCallback((id: string) => {
        if (guardBlockedSidebarAction()) {
            return;
        }
        certification.beginEditCertification(id);
    }, [certification, guardBlockedSidebarAction]);

    const handleToggleCertificationSelection = useCallback((id: string) => {
        if (guardBlockedSidebarAction()) {
            return;
        }
        selection.toggleCertificationSelection(id);
    }, [guardBlockedSidebarAction, selection]);

    const handleDeleteCertification = useCallback((id: string) => {
        if (guardBlockedSidebarAction()) {
            return;
        }
        certification.requestDeleteCertification(id);
    }, [certification, guardBlockedSidebarAction]);

    const handleResetCertificationSort = useCallback(() => {
        if (guardBlockedSidebarAction()) {
            return;
        }
        onResetCertificationSort?.();
    }, [guardBlockedSidebarAction, onResetCertificationSort]);

    const handleToggleSkillSelection = useCallback((id: string) => {
        if (guardBlockedSidebarAction()) {
            return;
        }
        selection.toggleSkillSelection(id);
    }, [guardBlockedSidebarAction, selection]);

    const handleToggleSkillGroupSelection = useCallback((groupName: string, skillIds?: string[]) => {
        if (guardBlockedSidebarAction()) {
            return;
        }
        selection.toggleSkillGroupSelection(groupName, skillIds);
    }, [guardBlockedSidebarAction, selection]);

    const guardedSkill = useMemo(() => ({
        ...skill,
        beginCreateSkillType: () => {
            if (guardBlockedSidebarAction()) {
                return;
            }
            skill.beginCreateSkillType();
        },
        beginCreateSkillInGroup: (groupName: string) => {
            if (guardBlockedSidebarAction()) {
                return;
            }
            skill.beginCreateSkillInGroup(groupName);
        },
        beginEditSkill: (id: string) => {
            if (guardBlockedSidebarAction()) {
                return;
            }
            skill.beginEditSkill(id);
        },
        cancelSkillEdit: () => {
            if (guardBlockedSidebarAction()) {
                return;
            }
            skill.cancelSkillEdit();
        },
        handleSaveSkill: async () => {
            if (guardBlockedSidebarAction()) {
                return;
            }
            await skill.handleSaveSkill();
        },
        handleRenameCategory: async (oldName: string, newName: string) => {
            if (guardBlockedSidebarAction()) {
                return;
            }
            await skill.handleRenameCategory(oldName, newName);
        },
        requestDeleteSkill: (id: string) => {
            if (guardBlockedSidebarAction()) {
                return;
            }
            skill.requestDeleteSkill(id);
        },
        requestDeleteSkillCategory: (categoryName: string) => {
            if (guardBlockedSidebarAction()) {
                return;
            }
            skill.requestDeleteSkillCategory(categoryName);
        },
        setRenamingCategoryTarget: (value: React.SetStateAction<string | null>) => {
            if (guardBlockedSidebarAction()) {
                return;
            }
            skill.setRenamingCategoryTarget(value);
        },
        setRenamingCategoryDraft: (value: React.SetStateAction<string>) => {
            if (guardBlockedSidebarAction()) {
                return;
            }
            skill.setRenamingCategoryDraft(value);
        },
    }), [guardBlockedSidebarAction, skill]);

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
            { label: '工作经历', count: workHidden },
            { label: '项目经历', count: projectHidden },
            { label: '证书', count: certificationHidden },
            { label: '技能', count: skillHidden },
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
                <ExperienceEditor
                    experience={experience}
                    isPolishPreviewing={isEditingExperiencePolishPreviewing}
                />
            </div>
        );
    }

    const desktopBatchPolishOverlay = batchPolishToolbar && !isDrawerLayout ? (
        <>
            <div
                className="fixed inset-0 z-[55] bg-slate-950/18 md:hidden"
                onClick={(event) => {
                    event.stopPropagation();
                    onDismissBatchPolishToolbar?.();
                }}
            />
            <div
                className="fixed inset-x-4 top-[max(16px,env(safe-area-inset-top))] bottom-[max(16px,env(safe-area-inset-bottom))] z-[60] flex items-center justify-center md:absolute md:inset-x-auto md:left-auto md:right-0 md:top-[calc(100%+12px)] md:bottom-auto md:z-30 md:mt-0 md:block md:w-[560px] md:max-h-[48vh]"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex max-h-full w-full max-w-[36rem] flex-col overflow-hidden rounded-[26px] border border-slate-200/90 bg-white shadow-[0_28px_80px_rgba(15,23,42,0.18)] md:max-h-[48vh]">
                    <div className="flex items-start justify-between gap-3 border-b border-slate-200/80 bg-[linear-gradient(135deg,rgba(240,253,250,0.95),rgba(255,255,255,0.98))] px-4 py-3">
                        <div className="min-w-0">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-700">
                                AI 批量润色
                            </div>
                            <div className="mt-1 text-sm font-semibold text-slate-900">
                                当前已选 {selectedExperienceCount} 条经历
                            </div>
                            <div className="mt-0.5 text-xs text-slate-500">
                                结果会先同步到简历预览，确认后统一保存到当前简历。
                            </div>
                        </div>
                        {onCloseBatchPolishToolbar ? (
                            <button
                                type="button"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onCloseBatchPolishToolbar();
                                }}
                                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
                                title="关闭批量润色弹窗"
                                aria-label="关闭批量润色弹窗"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        ) : null}
                    </div>
                    <div className="min-h-0 flex flex-1 flex-col overflow-hidden p-3">
                        {batchPolishToolbar}
                    </div>
                </div>
            </div>
        </>
    ) : null;

    return (
        <div className="space-y-3 animate-in fade-in slide-in-from-left-4 duration-300">
            <div className="relative z-20 px-1">
                <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-gray-400 flex items-center gap-2">
                        <CheckCircle2 className="w-3 h-3" /> 当前可选添加经历项
                    </p>
                    <div className="flex items-center gap-2">
                        <MatchScoreFilter
                            value={matchScoreFilter}
                            onChange={onMatchScoreFilterChange}
                            disabled={hasBlockingPolishState}
                        />
                        {!isDrawerLayout ? (
                            <>
                                <button
                                    type="button"
                                    onClick={handleBatchPolishClick}
                                    disabled={!canBatchPolish || isBatchPolishing || hasBlockingPolishState}
                                    className="inline-flex items-center gap-1.5 rounded-md border border-violet-500 bg-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-violet-400 dark:bg-violet-500 dark:hover:bg-violet-400"
                                    title={
                                        hasBlockingPolishState
                                            ? '请先确认或撤销当前润色结果'
                                            : canBatchPolish
                                            ? `批量润色当前已选中的 ${selectedExperienceCount} 条经历`
                                            : '请先填写 JD 并至少选中一条经历'
                                    }
                                >
                                    <Sparkles className={`w-3 h-3 ${isBatchPolishing ? 'animate-spin' : ''}`} />
                                    {isBatchPolishing ? '润色中…' : '一键润色'}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleAutoAssembleClick}
                                    disabled={isAutoAssembling || hasBlockingPolishState}
                                    className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                                    title={hasBlockingPolishState ? '请先确认或撤销当前润色结果' : '一键组装当前简历'}
                                >
                                    <Wand2 className={`w-3 h-3 ${isAutoAssembling ? 'animate-spin' : ''}`} />
                                    {isAutoAssembling ? '正在生成…' : '一键组装'}
                                </button>
                            </>
                        ) : null}
                    </div>
                </div>
                {desktopBatchPolishOverlay}
            </div>
            <PersonalSummaryPanel
                value={personalSummary}
                isVisible={isSummaryVisible}
                isGenerating={isGeneratingPersonalSummary}
                canGenerate={canGeneratePersonalSummary}
                disabled={hasBlockingPolishState}
                onChange={onPersonalSummaryChange}
                onVisibilityChange={onSummaryVisibilityChange}
                onGenerate={onGeneratePersonalSummary}
            />
            {matchScoreFilter > 0 && hiddenSummary.hiddenTotal > 0 ? (
                <div className="mx-1 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-[11px] leading-5 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
                    <div className="flex items-start justify-between gap-3">
                        <span>
                            当前匹配分数低于 {matchScoreFilter}% 的项不满足筛选条件
                            {hiddenSummary.text ? ` ${hiddenSummary.text}` : '全部内容'}
                    </span>
                        <button
                            type="button"
                            onClick={() => {
                                if (hasBlockingPolishState) {
                                    dismissBlockingPolishUi();
                                    return;
                                }
                                onMatchScoreFilterChange(0);
                            }}
                            disabled={hasBlockingPolishState}
                            className="shrink-0 rounded-md border border-amber-300 px-2 py-0.5 font-semibold text-amber-700 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-900/30"
                            title={hasBlockingPolishState ? '请先确认或撤销当前润色结果' : '显示全部'}
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
                onAddItem={handleAddWorkExperience}
                onEditItem={handleEditExperienceFromList}
                onPolishItem={handlePolishExperienceFromList}
                onDeleteItem={experience.requestDeleteExperience}
                deletingIds={experience.deletingExperienceIds}
                staleExperienceIds={staleExperienceIds}
                isAdding={experience.isAddingExperience}
                isPolishing={experience.isPolishing}
                activePolishItemId={activePolishExperienceId}
                hasBlockingPolishState={hasBlockingPolishState}
                polishToolbar={polishToolbar}
                onClosePolishToolbar={onClosePolishExperienceToolbar}
                onDismissPolishToolbar={onDismissPolishExperienceToolbar}
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
                onAddItem={handleAddProjectExperience}
                onEditItem={handleEditExperienceFromList}
                onPolishItem={handlePolishExperienceFromList}
                onDeleteItem={experience.requestDeleteExperience}
                deletingIds={experience.deletingExperienceIds}
                staleExperienceIds={staleExperienceIds}
                isAdding={experience.isAddingExperience}
                isPolishing={experience.isPolishing}
                activePolishItemId={activePolishExperienceId}
                hasBlockingPolishState={hasBlockingPolishState}
                polishToolbar={polishToolbar}
                onClosePolishToolbar={onClosePolishExperienceToolbar}
                onDismissPolishToolbar={onDismissPolishExperienceToolbar}
                onResetSort={onResetProjectSort}
            />
            <CertificationListSection
                title="证书资质"
                items={filteredCertifications}
                emptyMessage={buildFilterHiddenMessage('证书', '项', hiddenSummary.certificationHidden, matchScoreFilter)}
                selectedIds={selectedCertIds}
                matchScores={certificationMatchScores}
                matchTrends={certificationMatchTrends}
                onToggleSelection={handleToggleCertificationSelection}
                onBeginCreate={handleBeginCreateCertification}
                onBeginEdit={handleBeginEditCertification}
                onCancelEdit={certification.cancelCertificationEdit}
                onSave={certification.handleSaveCertification}
                onDelete={handleDeleteCertification}
                onUpdateDraft={certification.updateCertificationDraft}
                draft={certification.certificationDraft}
                editingId={certification.editingCertificationId}
                deletingIds={certification.deletingCertificationIds}
                isSaving={certification.isSavingCertification}
                onResetSort={handleResetCertificationSort}
                disabled={hasBlockingPolishState}
            />
            <SkillListSection
                title="专业技能"
                groups={filteredSkillGroups}
                emptyMessage={buildFilterHiddenMessage('技能', '项', hiddenSummary.skillHidden, matchScoreFilter)}
                selectedIds={selectedSkillIds}
                matchScores={skillMatchScores}
                matchTrends={skillMatchTrends}
                skill={guardedSkill}
                onToggleSelection={handleToggleSkillSelection}
                onToggleGroupSelection={handleToggleSkillGroupSelection}
                onResetRenamingCategory={onResetRenamingCategory}
                disabled={hasBlockingPolishState}
            />
        </div>
    );
};

type ExperienceEditorProps = {
    experience: ExperienceActions;
    /** 当前是否有润色预览未确认，用于禁用保存按钮 */
    isPolishPreviewing: boolean;
};

const ExperienceEditor: React.FC<ExperienceEditorProps> = ({ experience, isPolishPreviewing }) => (
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
                    disabled={experience.isSavingExperience || isPolishPreviewing}
                    title={isPolishPreviewing ? '请先确认或撤销当前润色预览' : undefined}
                >
                    {experience.isSavingExperience ? '保存中...' : '保存'}
                </button>
            </div>
        </div>
    </>
);

export default ExperienceTab;
