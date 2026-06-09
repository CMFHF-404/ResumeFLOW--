import type {
    CertificationEditDraft,
    ConfirmDialogState,
    EducationEditDraft,
} from '../../types/resume';
import type { Certification as CertificationRecord } from '../../services/certificationsService';
import type { ExperienceDetail, ExperienceListItem } from '../../services/experienceService';
import { experienceService } from '../../services/experienceService';
import { certificationsService } from '../../services/certificationsService';
import { trackResumeCardChecked } from '../../utils/analyticsTracker';
import {
    addToSet,
    createDraftId,
    deleteMapEntry,
    isDraftId,
    removeFromSet,
    runWithFlag,
    setMapEntry,
    toggleInSet,
} from './collectionUtils';
import type {
    CertificationDomain,
    CertificationState,
    ConfirmCopy,
    DraftPrefixes,
    EducationDomain,
    EducationState,
    ExperienceHelpers,
    MatchScoreDomain,
} from './types';

type EducationDraftHandlers = {
    beginCreateEducation: () => void;
    beginEditEducation: (id: string) => void;
    cancelEducationEdit: () => void;
    updateEducationDraft: (field: keyof EducationEditDraft, value: string) => void;
    updateEducationDate: (field: 'startDate' | 'endDate', value: string) => void;
};

type EducationSaveHandlers = {
    handleSaveEducation: () => Promise<void>;
};

type EducationDeleteHandlers = {
    requestDeleteEducation: (id: string) => void;
    performDeleteEducation: (id: string) => Promise<void>;
};

type EducationSelectionHandlers = {
    toggleEducationSelection: (id: string) => void;
};

type EducationHandlers = EducationDraftHandlers & EducationSaveHandlers & EducationDeleteHandlers & EducationSelectionHandlers;

const createEducationDraftHandlers = (
    domain: EducationDomain,
    helpers: ExperienceHelpers,
    state: EducationState,
    prefixes: DraftPrefixes
): EducationDraftHandlers => {
    const beginCreateEducation = () => {
        const draftId = createDraftId(prefixes.education);
        const draft = helpers.buildEducationDraft(undefined, draftId);
        state.setEditingEducationId(draftId);
        state.setEducationDraft(draft);
        domain.setItems((prev) => [helpers.buildDraftEducationView(draftId, draft), ...prev]);
        domain.setSelectedIds((prev) => addToSet(prev, draftId));
    };

    const beginEditEducation = (id: string) => {
        const source = domain.sourceMap.get(id);
        if (!source) {
            return;
        }
        state.setEditingEducationId(id);
        state.setEducationDraft(helpers.buildEducationDraft(source));
    };

    const cancelEducationEdit = () => {
        if (state.editingEducationId && isDraftId(state.editingEducationId, prefixes.education)) {
            domain.setItems((prev) => prev.filter((item) => item.id !== state.editingEducationId));
            domain.setSelectedIds((prev) => removeFromSet(prev, state.editingEducationId as string));
        }
        state.setEditingEducationId(null);
        state.setEducationDraft(null);
    };

    const updateEducationDraft = (field: keyof EducationEditDraft, value: string) => {
        state.setEducationDraft((prev) => {
            if (!prev) {
                return prev;
            }
            return {
                ...prev,
                [field]: value,
            };
        });
    };

    const updateEducationDate = (field: 'startDate' | 'endDate', value: string) => {
        state.setEducationDraft((prev) => {
            if (!prev) {
                return prev;
            }
            const next = {
                ...prev,
                [field]: value,
            };
            const safeRange = helpers.resolveSafeDateRange(next.startDate, next.endDate);
            return {
                ...next,
                startDate: safeRange.start,
                endDate: safeRange.end,
            };
        });
    };

    return {
        beginCreateEducation,
        beginEditEducation,
        cancelEducationEdit,
        updateEducationDraft,
        updateEducationDate,
    };
};

const createEducationSaveHandlers = (
    domain: EducationDomain,
    helpers: ExperienceHelpers,
    state: EducationState,
    prefixes: DraftPrefixes,
    draftHandlers: EducationDraftHandlers
): EducationSaveHandlers => {
    const applyEducationDetail = (
        detail: ExperienceDetail,
        options: { select: boolean; replacedId?: string }
    ) => {
        const item: ExperienceListItem = {
            master: detail.master,
            latest_version: detail.latest_version,
        };
        domain.setSourceMap((prev) => setMapEntry(prev, detail.master.id, item));
        const view = helpers.buildEducationView(item);
        domain.setItems((prev) => {
            const next = prev.filter((entry) => entry.id !== options.replacedId);
            const index = next.findIndex((entry) => entry.id === detail.master.id);
            if (index >= 0) {
                next[index] = view;
                return next;
            }
            next.push(view);
            return next;
        });
        if (options.select) {
            domain.setSelectedIds((prev) => addToSet(prev, detail.master.id));
        }
        if (options.replacedId) {
            domain.setSelectedIds((prev) => removeFromSet(prev, options.replacedId as string));
        }
    };

    const handleSaveEducation = async () => {
        if (!state.educationDraft || state.isSavingEducation) {
            return;
        }
        state.setIsSavingEducation(true);
        try {
            if (state.editingEducationId && !isDraftId(state.editingEducationId, prefixes.education)) {
                const source = domain.sourceMap.get(state.editingEducationId);
                if (!source) {
                    throw new Error('缺少教育经历源数据');
                }
                const payload = helpers.buildEducationVersionPayload(source, state.educationDraft);
                const detail = await experienceService.update(state.editingEducationId, { version: payload });
                applyEducationDetail(detail, { select: false });
            } else {
                const payload = helpers.buildEducationVersionPayload(null, state.educationDraft);
                const detail = await experienceService.create({
                    category: 'education',
                    version: payload,
                });
                const shouldSelect = state.editingEducationId
                    ? domain.selectedIds.has(state.editingEducationId)
                    : true;
                applyEducationDetail(detail, {
                    select: shouldSelect,
                    replacedId: state.editingEducationId ?? undefined,
                });
            }
            draftHandlers.cancelEducationEdit();
        } catch (error) {
            console.error('[ResumeEditor] 保存教育经历失败:', error);
        } finally {
            state.setIsSavingEducation(false);
        }
    };

    return { handleSaveEducation };
};

const createEducationDeleteHandlers = (
    domain: EducationDomain,
    state: EducationState,
    prefixes: DraftPrefixes,
    confirmCopy: ConfirmCopy,
    openDeleteConfirm: (payload: ConfirmDialogState) => void,
    draftHandlers: EducationDraftHandlers
): EducationDeleteHandlers => {
    const requestDeleteEducation = (id: string) => {
        if (state.deletingEducationIds.has(id)) {
            return;
        }
        openDeleteConfirm({
            id,
            type: 'education',
            title: confirmCopy.education.title,
            description: confirmCopy.education.description,
        });
    };

    const performDeleteEducation = async (id: string) => {
        if (state.deletingEducationIds.has(id)) {
            return;
        }
        if (isDraftId(id, prefixes.education)) {
            domain.setItems((prev) => prev.filter((item) => item.id !== id));
            domain.setSelectedIds((prev) => removeFromSet(prev, id));
            if (state.editingEducationId === id) {
                state.setEditingEducationId(null);
                state.setEducationDraft(null);
            }
            return;
        }
        try {
            await runWithFlag(id, state.deletingEducationIds, state.setDeletingEducationIds, async () => {
                await experienceService.delete(id);
                domain.setItems((prev) => prev.filter((item) => item.id !== id));
                domain.setSourceMap((prev) => deleteMapEntry(prev, id));
                domain.setSelectedIds((prev) => removeFromSet(prev, id));
                if (state.editingEducationId === id) {
                    draftHandlers.cancelEducationEdit();
                }
            });
        } catch (error) {
            console.error('[ResumeEditor] 删除教育经历失败:', error);
        }
    };

    return { requestDeleteEducation, performDeleteEducation };
};

const createEducationSelectionHandlers = (domain: EducationDomain): EducationSelectionHandlers => {
    const toggleEducationSelection = (id: string) => {
        domain.setSelectedIds((prev) => {
            const wasSelected = prev.has(id);
            const next = toggleInSet(prev, id);
            if (!wasSelected) {
                trackResumeCardChecked({ cardType: 'education', checked: true });
            }
            return next;
        });
    };
    return { toggleEducationSelection };
};

export const createEducationHandlers = (
    domain: EducationDomain,
    helpers: ExperienceHelpers,
    state: EducationState,
    prefixes: DraftPrefixes,
    confirmCopy: ConfirmCopy,
    openDeleteConfirm: (payload: ConfirmDialogState) => void
): EducationHandlers => {
    const draftHandlers = createEducationDraftHandlers(domain, helpers, state, prefixes);
    const saveHandlers = createEducationSaveHandlers(domain, helpers, state, prefixes, draftHandlers);
    const deleteHandlers = createEducationDeleteHandlers(
        domain,
        state,
        prefixes,
        confirmCopy,
        openDeleteConfirm,
        draftHandlers
    );
    const selectionHandlers = createEducationSelectionHandlers(domain);

    return {
        ...draftHandlers,
        ...saveHandlers,
        ...deleteHandlers,
        ...selectionHandlers,
    };
};

type CertificationDraftHandlers = {
    beginCreateCertification: () => void;
    beginEditCertification: (id: string) => void;
    cancelCertificationEdit: () => void;
    updateCertificationDraft: (field: keyof CertificationEditDraft, value: string) => void;
};

type CertificationSaveHandlers = {
    handleSaveCertification: () => Promise<void>;
};

type CertificationDeleteHandlers = {
    requestDeleteCertification: (id: string) => void;
    performDeleteCertification: (id: string) => Promise<void>;
};

type CertificationSelectionHandlers = {
    toggleCertificationSelection: (id: string) => void;
};

type CertificationHandlers = CertificationDraftHandlers
    & CertificationSaveHandlers
    & CertificationDeleteHandlers
    & CertificationSelectionHandlers;

const createCertificationDraftHandlers = (
    domain: CertificationDomain,
    helpers: ExperienceHelpers,
    state: CertificationState,
    prefixes: DraftPrefixes
): CertificationDraftHandlers => {
    const beginCreateCertification = () => {
        const draftId = createDraftId(prefixes.certification);
        const draft = helpers.buildCertificationDraft();
        state.setEditingCertificationId(draftId);
        state.setCertificationDraft(draft);
        domain.setItems((prev) => [helpers.buildDraftCertificationView(draftId, draft), ...prev]);
    };

    const beginEditCertification = (id: string) => {
        const source = domain.sourceMap.get(id);
        if (!source) {
            return;
        }
        if (state.editingCertificationId && isDraftId(state.editingCertificationId, prefixes.certification)) {
            cancelCertificationEdit();
        }
        state.setEditingCertificationId(id);
        state.setCertificationDraft(helpers.buildCertificationDraft(source));
    };

    const cancelCertificationEdit = () => {
        if (state.editingCertificationId && isDraftId(state.editingCertificationId, prefixes.certification)) {
            domain.setItems((prev) => prev.filter((item) => item.id !== state.editingCertificationId));
        }
        state.setEditingCertificationId(null);
        state.setCertificationDraft(null);
    };

    const updateCertificationDraft = (field: keyof CertificationEditDraft, value: string) => {
        state.setCertificationDraft((prev) => {
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
        beginCreateCertification,
        beginEditCertification,
        cancelCertificationEdit,
        updateCertificationDraft,
    };
};

const createCertificationSaveHandlers = (
    domain: CertificationDomain,
    helpers: ExperienceHelpers,
    state: CertificationState,
    prefixes: DraftPrefixes,
    draftHandlers: CertificationDraftHandlers
): CertificationSaveHandlers => {
    const applyCertificationUpdate = (
        record: CertificationRecord,
        options?: { select?: boolean; replacedId?: string }
    ) => {
        const shouldSelect = options?.select ?? false;
        domain.setSourceMap((prev) => setMapEntry(prev, record.id, record));
        const view = helpers.buildCertificationView(record);
        domain.setItems((prev) => {
            const next = [...prev];
            const replacedIndex = options?.replacedId
                ? next.findIndex((entry) => entry.id === options.replacedId)
                : -1;
            if (replacedIndex >= 0) {
                next[replacedIndex] = view;
                return next;
            }
            const index = next.findIndex((entry) => entry.id === record.id);
            if (index >= 0) {
                next[index] = view;
                return next;
            }
            next.push(view);
            return next;
        });
        if (shouldSelect) {
            domain.setSelectedIds((prev) => addToSet(prev, record.id));
        }
    };

    const handleSaveCertification = async () => {
        if (!state.certificationDraft || state.isSavingCertification) {
            return;
        }
        state.setIsSavingCertification(true);
        try {
            const payload = helpers.buildCertificationPayload(state.certificationDraft);
            const isDraft = state.editingCertificationId
                ? isDraftId(state.editingCertificationId, prefixes.certification)
                : true;
            if (state.editingCertificationId && !isDraft) {
                const record = await certificationsService.update(state.editingCertificationId, payload);
                applyCertificationUpdate(record, { select: false });
            } else {
                const record = await certificationsService.create(payload);
                applyCertificationUpdate(record, {
                    select: true,
                    replacedId: isDraft ? state.editingCertificationId ?? undefined : undefined,
                });
            }
            draftHandlers.cancelCertificationEdit();
        } catch (error) {
            console.error('[ResumeEditor] 保存证书失败:', error);
        } finally {
            state.setIsSavingCertification(false);
        }
    };

    return { handleSaveCertification };
};

const createCertificationDeleteHandlers = (
    domain: CertificationDomain,
    state: CertificationState,
    confirmCopy: ConfirmCopy,
    openDeleteConfirm: (payload: ConfirmDialogState) => void,
    matchScore: MatchScoreDomain,
    draftHandlers: CertificationDraftHandlers
): CertificationDeleteHandlers => {
    const requestDeleteCertification = (id: string) => {
        if (state.deletingCertificationIds.has(id)) {
            return;
        }
        openDeleteConfirm({
            id,
            type: 'certification',
            title: confirmCopy.certification.title,
            description: confirmCopy.certification.description,
        });
    };

    const performDeleteCertification = async (id: string) => {
        if (state.deletingCertificationIds.has(id)) {
            return;
        }
        try {
            await runWithFlag(id, state.deletingCertificationIds, state.setDeletingCertificationIds, async () => {
                await certificationsService.delete(id);
                domain.setItems((prev) => prev.filter((item) => item.id !== id));
                domain.setSourceMap((prev) => deleteMapEntry(prev, id));
                domain.setSelectedIds((prev) => removeFromSet(prev, id));
                matchScore.setCertificationMatchScores((prev) => {
                    const next = new Map(prev);
                    next.delete(id);
                    return next;
                });
                matchScore.setCertificationMatchTrends((prev) => {
                    const next = new Map(prev);
                    next.delete(id);
                    return next;
                });
                if (state.editingCertificationId === id) {
                    draftHandlers.cancelCertificationEdit();
                }
            });
        } catch (error) {
            console.error('[ResumeEditor] 删除证书失败:', error);
        }
    };

    return { requestDeleteCertification, performDeleteCertification };
};

const createCertificationSelectionHandlers = (domain: CertificationDomain): CertificationSelectionHandlers => {
    const toggleCertificationSelection = (id: string) => {
        domain.setSelectedIds((prev) => {
            const wasSelected = prev.has(id);
            const next = toggleInSet(prev, id);
            if (!wasSelected) {
                trackResumeCardChecked({ cardType: 'certification', checked: true });
            }
            return next;
        });
    };
    return { toggleCertificationSelection };
};

export const createCertificationHandlers = (
    domain: CertificationDomain,
    helpers: ExperienceHelpers,
    state: CertificationState,
    prefixes: DraftPrefixes,
    confirmCopy: ConfirmCopy,
    openDeleteConfirm: (payload: ConfirmDialogState) => void,
    matchScore: MatchScoreDomain
): CertificationHandlers => {
    const draftHandlers = createCertificationDraftHandlers(domain, helpers, state, prefixes);
    const saveHandlers = createCertificationSaveHandlers(domain, helpers, state, prefixes, draftHandlers);
    const deleteHandlers = createCertificationDeleteHandlers(
        domain,
        state,
        confirmCopy,
        openDeleteConfirm,
        matchScore,
        draftHandlers
    );
    const selectionHandlers = createCertificationSelectionHandlers(domain);

    return {
        ...draftHandlers,
        ...saveHandlers,
        ...deleteHandlers,
        ...selectionHandlers,
    };
};

