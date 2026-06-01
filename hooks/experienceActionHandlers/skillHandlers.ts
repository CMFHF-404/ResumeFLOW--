import { skillsService } from '../../services/skillsService';
import type { ConfirmDialogState, SkillEditDraft } from '../../types/resume';
import { trackResumeCardChecked } from '../../utils/analyticsTracker';
import { runWithFlag, toggleInSet } from './collectionUtils';
import type {
    ConfirmCopy,
    ExperienceDefaults,
    ExperienceHelpers,
    MatchScoreDomain,
    SkillDomain,
    SkillState,
} from '../useExperienceActions';

type SkillDraftHandlers = {
    beginCreateSkillType: () => void;
    beginCreateSkillInGroup: (groupName: string) => void;
    beginEditSkill: (id: string) => void;
    cancelSkillEdit: () => void;
    updateSkillDraft: (field: keyof SkillEditDraft, value: string) => void;
};

type SkillSaveHandlers = {
    handleSaveSkill: () => Promise<void>;
};

type SkillRenameHandlers = {
    handleRenameCategory: (oldName: string, newName: string) => Promise<void>;
};

type SkillDeleteHandlers = {
    requestDeleteSkill: (id: string) => void;
    requestDeleteSkillCategory: (categoryName: string) => void;
    performDeleteSkill: (id: string) => Promise<void>;
    performDeleteSkillCategory: (categoryName: string) => Promise<void>;
};

type SkillSelectionHandlers = {
    toggleSkillSelection: (id: string) => void;
    toggleSkillGroupSelection: (groupName: string, skillIds?: string[]) => void;
};

type SkillHandlers = SkillDraftHandlers
    & SkillSaveHandlers
    & SkillRenameHandlers
    & SkillDeleteHandlers
    & SkillSelectionHandlers;

type SkillHelperContext = {
    findSkillMeta: (id: string) => { id: string; name: string; category: string } | null;
    buildSkillDraft: (meta?: { id?: string; name?: string; category?: string }) => SkillEditDraft;
    getSkillIdsByCategory: (groupName: string) => string[];
    refreshSkillState: (options?: { selectId?: string }) => Promise<void>;
    resetRenamingCategory: () => void;
};

const createSkillHelperContext = (
    domain: SkillDomain,
    helpers: ExperienceHelpers,
    state: SkillState,
    defaults: ExperienceDefaults,
    matchScore: MatchScoreDomain
): SkillHelperContext => {
    const findSkillMeta = (id: string) => {
        for (const group of domain.groups) {
            const skill = group.skills.find((item) => item.id === id);
            if (skill) {
                return {
                    id: skill.id,
                    name: skill.name,
                    category: group.name,
                };
            }
        }
        return null;
    };

    const buildSkillDraft = (meta?: { id?: string; name?: string; category?: string }): SkillEditDraft => ({
        id: meta?.id,
        name: meta?.name ?? defaults.skillName,
        category: meta?.category ?? defaults.skillCategory,
    });

    const getSkillGroupByName = (groupName: string) => (
        domain.groups.find((group) => group.name === groupName) || null
    );

    const getSkillIdsByCategory = (groupName: string) => {
        const group = getSkillGroupByName(groupName);
        return group ? group.skills.map((skill) => skill.id) : [];
    };

    const refreshSkillState = async (options?: { selectId?: string }) => {
        const items = await skillsService.list({ force: true });
        domain.setGroups(helpers.buildSkillGroups(items));
        const validIds = new Set(items.map((skill) => skill.id));
        domain.setSelectedIds((prev) => {
            const next = new Set([...prev].filter((id) => validIds.has(id)));
            if (options?.selectId) {
                next.add(options.selectId);
            }
            return next;
        });
        matchScore.setSkillMatchScores((prev) => {
            const next = new Map(prev);
            for (const key of next.keys()) {
                if (!validIds.has(key)) {
                    next.delete(key);
                }
            }
            return next;
        });
        matchScore.setSkillMatchTrends((prev) => {
            const next = new Map(prev);
            for (const key of next.keys()) {
                if (!validIds.has(key)) {
                    next.delete(key);
                }
            }
            return next;
        });
    };

    const resetRenamingCategory = () => {
        state.setRenamingCategoryTarget(null);
        state.setRenamingCategoryDraft('');
    };

    return {
        findSkillMeta,
        buildSkillDraft,
        getSkillIdsByCategory,
        refreshSkillState,
        resetRenamingCategory,
    };
};

const createSkillDraftHandlers = (
    state: SkillState,
    helperContext: SkillHelperContext
): SkillDraftHandlers => {
    const beginCreateSkillType = () => {
        state.setEditingSkillId(null);
        state.setSkillDraft(helperContext.buildSkillDraft({ name: '', category: '' }));
        state.setSkillDraftContext({ mode: 'type' });
    };

    const beginCreateSkillInGroup = (groupName: string) => {
        state.setEditingSkillId(null);
        state.setSkillDraft(helperContext.buildSkillDraft({ name: '', category: groupName }));
        state.setSkillDraftContext({ mode: 'group', groupName });
    };

    const beginEditSkill = (id: string) => {
        const meta = helperContext.findSkillMeta(id);
        if (!meta) {
            return;
        }
        state.setEditingSkillId(id);
        state.setSkillDraft(helperContext.buildSkillDraft(meta));
        state.setSkillDraftContext({ mode: 'edit', groupName: meta.category });
    };

    const cancelSkillEdit = () => {
        state.setEditingSkillId(null);
        state.setSkillDraft(null);
        state.setSkillDraftContext(null);
    };

    const updateSkillDraft = (field: keyof SkillEditDraft, value: string) => {
        state.setSkillDraft((prev) => {
            if (!prev) {
                return prev;
            }
            return {
                ...prev,
                [field]: value,
            };
        });
    };

    return {
        beginCreateSkillType,
        beginCreateSkillInGroup,
        beginEditSkill,
        cancelSkillEdit,
        updateSkillDraft,
    };
};

const createSkillSaveHandlers = (
    state: SkillState,
    defaults: ExperienceDefaults,
    helperContext: SkillHelperContext,
    draftHandlers: SkillDraftHandlers
): SkillSaveHandlers => {
    const buildSkillPayload = (draft: SkillEditDraft) => ({
        name: draft.name.trim() || defaults.skillName,
        category: draft.category.trim() || defaults.skillCategory,
    });

    const handleSaveSkill = async () => {
        if (!state.skillDraft || state.isSavingSkill) {
            return;
        }
        state.setIsSavingSkill(true);
        try {
            const payload = buildSkillPayload(state.skillDraft);
            if (state.editingSkillId) {
                await skillsService.update(state.editingSkillId, payload);
                await helperContext.refreshSkillState();
            } else {
                const record = await skillsService.create(payload);
                await helperContext.refreshSkillState({ selectId: record.id });
            }
            draftHandlers.cancelSkillEdit();
        } catch (error) {
            console.error('[ResumeEditor] 保存技能失败:', error);
        } finally {
            state.setIsSavingSkill(false);
        }
    };

    return { handleSaveSkill };
};

const createSkillRenameHandlers = (
    domain: SkillDomain,
    helperContext: SkillHelperContext
): SkillRenameHandlers => {
    const handleRenameCategory = async (oldName: string, newName: string) => {
        const trimmedNewName = newName.trim();
        if (!trimmedNewName || trimmedNewName === oldName) {
            helperContext.resetRenamingCategory();
            return;
        }

        try {
            const skillsInGroup = domain.groups.find((g) => g.name === oldName)?.skills || [];
            await Promise.all(
                skillsInGroup.map((skill) =>
                    skillsService.update(skill.id, { category: trimmedNewName })
                )
            );
            await helperContext.refreshSkillState();
        } catch (error) {
            console.error('[ResumeEditor] 重命名分类失败:', error);
        } finally {
            helperContext.resetRenamingCategory();
        }
    };

    return { handleRenameCategory };
};

const createSkillDeleteHandlers = (
    domain: SkillDomain,
    state: SkillState,
    confirmCopy: ConfirmCopy,
    openDeleteConfirm: (payload: ConfirmDialogState) => void,
    helperContext: SkillHelperContext,
    draftHandlers: SkillDraftHandlers
): SkillDeleteHandlers => {
    const requestDeleteSkill = (id: string) => {
        if (state.deletingSkillIds.has(id)) {
            return;
        }
        openDeleteConfirm({
            id,
            type: 'skill',
            title: confirmCopy.skill.title,
            description: confirmCopy.skill.description,
        });
    };

    const requestDeleteSkillCategory = (categoryName: string) => {
        if (state.deletingSkillCategories.has(categoryName)) {
            return;
        }
        openDeleteConfirm({
            id: categoryName,
            type: 'skillCategory',
            title: confirmCopy.skillCategory.title,
            description: confirmCopy.skillCategory.description,
        });
    };

    const performDeleteSkillCategory = async (categoryName: string) => {
        if (state.deletingSkillCategories.has(categoryName)) {
            return;
        }
        const skillIds = helperContext.getSkillIdsByCategory(categoryName);
        if (skillIds.length === 0) {
            return;
        }
        try {
            await runWithFlag(
                categoryName,
                state.deletingSkillCategories,
                state.setDeletingSkillCategories,
                async () => {
                    if (state.renamingCategoryTarget === categoryName) {
                        helperContext.resetRenamingCategory();
                    }
                    if (state.editingSkillId && skillIds.includes(state.editingSkillId)) {
                        draftHandlers.cancelSkillEdit();
                    }
                    if (state.skillDraftContext?.groupName === categoryName) {
                        draftHandlers.cancelSkillEdit();
                    }
                    await Promise.all(skillIds.map((id) => skillsService.delete(id)));
                    await helperContext.refreshSkillState();
                }
            );
        } catch (error) {
            console.error('[ResumeEditor] 删除技能分类失败:', error);
        }
    };

    const performDeleteSkill = async (id: string) => {
        if (state.deletingSkillIds.has(id)) {
            return;
        }
        try {
            await runWithFlag(id, state.deletingSkillIds, state.setDeletingSkillIds, async () => {
                await skillsService.delete(id);
                await helperContext.refreshSkillState();
                if (state.editingSkillId === id) {
                    draftHandlers.cancelSkillEdit();
                }
            });
        } catch (error) {
            console.error('[ResumeEditor] 删除技能失败:', error);
        }
    };

    return {
        requestDeleteSkill,
        requestDeleteSkillCategory,
        performDeleteSkill,
        performDeleteSkillCategory,
    };
};

const createSkillSelectionHandlers = (
    domain: SkillDomain,
    helperContext: SkillHelperContext
): SkillSelectionHandlers => {
    const toggleSkillSelection = (id: string) => {
        domain.setSelectedIds((prev) => {
            const wasSelected = prev.has(id);
            const next = toggleInSet(prev, id);
            if (!wasSelected) {
                trackResumeCardChecked({ cardType: 'skill', checked: true });
            }
            return next;
        });
    };

    const toggleSkillGroupSelection = (groupName: string, skillIds?: string[]) => {
        const targetSkillIds = skillIds ?? helperContext.getSkillIdsByCategory(groupName);
        if (targetSkillIds.length === 0) {
            return;
        }
        domain.setSelectedIds((prev) => {
            const next = new Set(prev);
            const allSelected = targetSkillIds.every((id) => prev.has(id));

            if (allSelected) {
                // Deselect all
                targetSkillIds.forEach((id) => next.delete(id));
            } else {
                // Select all
                targetSkillIds.forEach((id) => next.add(id));
                trackResumeCardChecked({ cardType: 'skill', checked: true });
            }
            return next;
        });
    };

    return { toggleSkillSelection, toggleSkillGroupSelection };
};

export const createSkillHandlers = (
    domain: SkillDomain,
    helpers: ExperienceHelpers,
    state: SkillState,
    defaults: ExperienceDefaults,
    confirmCopy: ConfirmCopy,
    openDeleteConfirm: (payload: ConfirmDialogState) => void,
    matchScore: MatchScoreDomain
): SkillHandlers => {
    const helperContext = createSkillHelperContext(domain, helpers, state, defaults, matchScore);
    const draftHandlers = createSkillDraftHandlers(state, helperContext);
    const saveHandlers = createSkillSaveHandlers(state, defaults, helperContext, draftHandlers);
    const renameHandlers = createSkillRenameHandlers(domain, helperContext);
    const deleteHandlers = createSkillDeleteHandlers(
        domain,
        state,
        confirmCopy,
        openDeleteConfirm,
        helperContext,
        draftHandlers
    );
    const selectionHandlers = createSkillSelectionHandlers(domain, helperContext);

    return {
        ...draftHandlers,
        ...saveHandlers,
        ...renameHandlers,
        ...deleteHandlers,
        ...selectionHandlers,
    };
};

