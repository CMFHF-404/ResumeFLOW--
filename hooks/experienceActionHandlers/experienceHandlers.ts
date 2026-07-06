import { aiService } from '../../services/aiService';
import type { MutableRefObject } from 'react';
import {
    experienceService,
    type ExperienceDetail,
    type ExperienceListItem,
    type ExperienceUpdatePayload,
    type ExperienceVersion,
} from '../../services/experienceService';
import {
    resumeService,
    type ResumeDetail,
    type ResumeExperienceItem,
} from '../../services/resumeService';
import type { ConfirmDialogState, DatePayloadFallback, ExperienceEditDraft, ResumeExperienceView, StarFieldKey, StarFields } from '../../types/resume';
import { normalizeAiRichText } from '../../utils/richText';
import { resolveThoughtDisplayEvent } from '../../utils/aiThought';
import {
    trackAiPolishApplied,
    trackAiPolishResult,
    trackAiPolishStart,
    trackResumeCardChecked,
} from '../../utils/analyticsTracker';
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
import { hasStarFieldsChange, resolveStarPayload } from './starPayload';
import type {
    ConfirmCopy,
    DraftPrefixes,
    ExperienceDefaults,
    ExperienceDomain,
    ExperienceHelpers,
    ExperienceState,
    ToastApi,
} from './types';

const JD_POLISH_TOAST_MESSAGES = {
    loading: '正在基于 JD 润色...',
    success: 'JD 润色完成',
    noChange: 'JD 润色完成，但未产生可用调整',
    error: 'JD 润色失败，请稍后重试',
    emptyJd: '请先填写 JD 再润色',
} as const;
const JD_POLISH_TOAST_DURATION_MS = 2500;
const JD_POLISH_TOAST_ERROR_DURATION_MS = 3000;

const advanceExperienceEditSession = (editSessionRef: MutableRefObject<number>) => {
    editSessionRef.current += 1;
    return editSessionRef.current;
};

const advanceExperienceCollectionVersion = (collectionVersionRef: MutableRefObject<number>) => {
    collectionVersionRef.current += 1;
    return collectionVersionRef.current;
};

type ExperienceEditHandlers = {
    startEditingExperience: (id: string) => void;
    cancelEditingExperience: () => void;
    updateEditingStar: (field: StarFieldKey, value: string) => void;
    updateEditingMeta: (field: 'company' | 'title', value: string) => void;
    updateEditingDate: (field: 'startDate' | 'endDate', value: string) => void;
};

type ExperienceDraftHandlers = {
    addDraftExperience: (category: ResumeExperienceView['category']) => void;
    removeDraftExperience: (draftId: string) => void;
    replaceDraftExperience: (draftId: string, detail: ExperienceDetail) => void;
};

export const createExperienceDraftLifecycleHandlers = (
    domain: ExperienceDomain,
    helpers: ExperienceHelpers,
    state: ExperienceState,
    prefixes: DraftPrefixes
): ExperienceDraftHandlers => {
    const addDraftExperience = (category: ResumeExperienceView['category']) => {
        const draftId = createDraftId(prefixes.experience);
        const draftView = helpers.buildDraftExperienceView(category, draftId);
        domain.setItems((prev) =>
            helpers.sortByCategory([...prev, draftView], helpers.compareByDateDesc)
        );
        domain.setSelectedIds((prev) => addToSet(prev, draftId));
        advanceExperienceEditSession(state.editSessionRef);
        state.setEditingExpId(draftId);
        state.setEditingDraft(helpers.buildExperienceEditDraft(draftView));
        state.setSyncToMaster(true);
    };

    const removeDraftExperience = (draftId: string) => {
        advanceExperienceCollectionVersion(state.collectionVersionRef);
        domain.setItems((prev) => prev.filter((item) => item.id !== draftId));
        domain.setSelectedIds((prev) => removeFromSet(prev, draftId));
    };

    const replaceDraftExperience = (draftId: string, detail: ExperienceDetail) => {
        advanceExperienceCollectionVersion(state.collectionVersionRef);
        const newItem: ExperienceListItem = {
            master: detail.master,
            latest_version: detail.latest_version,
        };
        domain.setSourceMap((prev) => setMapEntry(prev, detail.master.id, newItem));
        const nextView = helpers.buildResumeExperienceView(
            newItem,
            domain.resumeMap.get(detail.master.id)
        );
        domain.setItems((prev) => {
            const next = prev.filter((item) => item.id !== draftId);
            return helpers.sortByCategory([...next, nextView], helpers.compareByDateDesc);
        });
        domain.setSelectedIds((prev) => {
            const next = new Set(prev);
            next.delete(draftId);
            next.add(detail.master.id);
            return next;
        });
    };

    return {
        addDraftExperience,
        removeDraftExperience,
        replaceDraftExperience,
    };
};

const resolveEditingExperienceDraft = (
    domain: ExperienceDomain,
    helpers: ExperienceHelpers,
    id: string
) => {
    const item = domain.items.find((entry) => entry.id === id);
    if (!item) {
        return null;
    }
    const draft = helpers.buildExperienceEditDraft(item);
    const resumeItem = domain.resumeMap.get(id);
    const hasStarOverride = Boolean(
        resumeItem?.overrides_json
        && Object.prototype.hasOwnProperty.call(resumeItem.overrides_json, 'star')
    );
    const sourceStar = domain.sourceMap.get(id)?.latest_version?.star;
    const resolvedStar = resolveStarPayload(
        draft,
        sourceStar,
        helpers.mergeStarFieldsWithSource,
        { hasStarOverride }
    );
    return resolvedStar === draft.star ? draft : { ...draft, star: resolvedStar };
};

export const createExperienceEditHandlers = (
    domain: ExperienceDomain,
    helpers: ExperienceHelpers,
    state: ExperienceState,
    draftHandlers: ExperienceDraftHandlers,
    onExperienceEditDiscarded?: (masterId: string | null) => void,
): ExperienceEditHandlers => {
    const startEditingExperience = (id: string) => {
        const draft = resolveEditingExperienceDraft(domain, helpers, id);
        if (!draft) {
            return;
        }
        if (state.editingExpId && state.editingExpId !== id) {
            onExperienceEditDiscarded?.(state.editingDraft?.masterId ?? null);
        }
        advanceExperienceEditSession(state.editSessionRef);
        state.setEditingExpId(id);
        state.setEditingDraft(draft);
        state.setSyncToMaster(false);
    };

    const cancelEditingExperience = () => {
        onExperienceEditDiscarded?.(state.editingDraft?.masterId ?? null);
        if (state.editingDraft?.isDraft && state.editingDraft.masterId) {
            draftHandlers.removeDraftExperience(state.editingDraft.masterId);
        }
        advanceExperienceEditSession(state.editSessionRef);
        state.setEditingExpId(null);
        state.setEditingDraft(null);
    };

    const updateEditingStar = (field: StarFieldKey, value: string) => {
        state.setEditingDraft((prev) => {
            if (!prev) {
                return prev;
            }
            if (prev.star[field] === value) {
                return prev;
            }
            return {
                ...prev,
                star: {
                    ...prev.star,
                    [field]: value,
                },
                starTouched: true,
            };
        });
    };

    const updateEditingMeta = (field: 'company' | 'title', value: string) => {
        state.setEditingDraft((prev) => {
            if (!prev) {
                return prev;
            }
            return {
                ...prev,
                [field]: value,
            };
        });
    };

    const updateEditingDate = (field: 'startDate' | 'endDate', value: string) => {
        state.setEditingDraft((prev) => {
            if (!prev) {
                return prev;
            }
            if (field === 'endDate') {
                const nextRange = helpers.resolveSafeDateRange(prev.startDate, value);
                const resolvedEnd = helpers.isPresentLabel(value) ? value : nextRange.end;
                return {
                    ...prev,
                    endDate: resolvedEnd,
                    isCurrent: helpers.isPresentLabel(resolvedEnd),
                };
            }
            const nextRange = helpers.resolveSafeDateRange(value, prev.endDate);
            return {
                ...prev,
                startDate: nextRange.start,
                endDate: nextRange.end,
                isCurrent: nextRange.end ? prev.isCurrent : false,
            };
        });
    };

    return {
        startEditingExperience,
        cancelEditingExperience,
        updateEditingStar,
        updateEditingMeta,
        updateEditingDate,
    };
};

type ExperienceUpdateHelpers = {
    applyExperienceUpdate: (masterId: string, update: Partial<ResumeExperienceView>) => void;
    applyExperienceVersionUpdate: (
        masterId: string,
        version?: ExperienceVersion,
        fallbackStar?: StarFields
    ) => void;
};

export const createExperienceUpdateHelpers = (
    domain: ExperienceDomain,
    helpers: ExperienceHelpers
): ExperienceUpdateHelpers => {
    const applyExperienceUpdate = (masterId: string, update: Partial<ResumeExperienceView>) => {
        domain.setItems((prev) =>
            prev.map((item) => (item.id === masterId ? { ...item, ...update } : item))
        );
    };

    const applyExperienceVersionUpdate = (
        masterId: string,
        version?: ExperienceVersion,
        fallbackStar?: StarFields
    ) => {
        if (!version) {
            return;
        }
        const star = helpers.buildStarFields(version.star ?? fallbackStar);
        applyExperienceUpdate(masterId, {
            title: version.title ?? '',
            company: version.org ?? '',
            startDate: version.start_date,
            endDate: version.end_date,
            isCurrent: version.is_current,
            date: helpers.buildExperienceDate(
                version.start_date,
                version.end_date,
                version.is_current
            ),
            star,
            experienceVersionId: version.id,
        });
    };

    return {
        applyExperienceUpdate,
        applyExperienceVersionUpdate,
    };
};

const buildMasterUpdatePayload = (
    source: ExperienceListItem,
    draft: ExperienceEditDraft,
    resolveExperienceDatePayload: ExperienceHelpers['resolveExperienceDatePayload'],
    mergeStarFieldsWithSource: ExperienceHelpers['mergeStarFieldsWithSource'],
    options?: { hasStarOverride?: boolean }
) => {
    const latest = source.latest_version;
    const title = draft.title.trim() || latest?.title || '';
    const org = draft.company.trim() || latest?.org;
    const dates = resolveExperienceDatePayload(draft, latest);
    const star = resolveStarPayload(draft, latest?.star, mergeStarFieldsWithSource, options);
    return {
        title,
        org,
        location: latest?.location,
        start_date: dates.startDate,
        end_date: dates.endDate,
        is_current: dates.isCurrent,
        summary: latest?.summary,
        highlights: latest?.highlights || [],
        star,
    };
};

const syncExperienceToMaster = async (
    resumeId: string | null,
    masterId: string,
    draft: ExperienceEditDraft,
    sourceMap: ExperienceDomain['sourceMap'],
    setSourceMap: ExperienceDomain['setSourceMap'],
    updateHelpers: ExperienceUpdateHelpers,
    resolveExperienceDatePayload: ExperienceHelpers['resolveExperienceDatePayload'],
    mergeStarFieldsWithSource: ExperienceHelpers['mergeStarFieldsWithSource'],
    resumeMap: ExperienceDomain['resumeMap'],
    applyResumeDetail: (detail: ResumeDetail | null) => void
) => {
    const source = sourceMap.get(masterId);
    if (!source) {
        throw new Error('缺少经历源数据，无法同步到经历库');
    }
    const resumeItem = resumeMap.get(masterId);
    const hasStarOverride = Boolean(
        resumeItem?.overrides_json
        && Object.prototype.hasOwnProperty.call(resumeItem.overrides_json, 'star')
    );
    const resolvedTitle = draft.title.trim() || source.latest_version?.title || '';
    if (!resolvedTitle) {
        throw new Error('缺少经历标题，无法同步到经历库');
    }
    const payload = buildMasterUpdatePayload(
        source,
        draft,
        resolveExperienceDatePayload,
        mergeStarFieldsWithSource,
        { hasStarOverride }
    );
    const detail: ExperienceDetail = await experienceService.update(masterId, { version: payload });
    const updatedVersion = detail.latest_version || source.latest_version;
    const resumeLink = resumeMap.get(masterId);
    if (resumeId && resumeLink?.id && updatedVersion?.id) {
        const resumeDetail = await resumeService.updateAssembly(resumeId, {
            operations: [
                {
                    op: 'override',
                    resume_experience_id: resumeLink.id,
                    experience_version_id: updatedVersion.id,
                    clear_override_keys: [
                        'title',
                        'org',
                        'start_date',
                        'end_date',
                        'is_current',
                        'star',
                    ],
                    overrides_json: {},
                },
            ],
        });
        applyResumeDetail(resumeDetail);
    }
    setSourceMap((prev) =>
        setMapEntry(prev, masterId, {
            ...source,
            latest_version: updatedVersion,
        })
    );
    updateHelpers.applyExperienceVersionUpdate(masterId, updatedVersion, payload.star);
};

const ensureResumeLink = async (
    resumeId: string | null,
    masterId: string,
    versionId: string | undefined,
    resumeMap: ExperienceDomain['resumeMap'],
    applyResumeDetail: (detail: ResumeDetail | null) => void,
    buildResumeExperienceMap: ExperienceHelpers['buildResumeExperienceMap']
) => {
    if (!resumeId) {
        return null;
    }
    const existing = resumeMap.get(masterId);
    if (existing?.id) {
        return existing.id;
    }
    if (!versionId) {
        return null;
    }
    const detail = await resumeService.updateAssembly(resumeId, {
        operations: [
            {
                op: 'add',
                experience_version_id: versionId,
            },
        ],
    });
    applyResumeDetail(detail);
    const nextMap = buildResumeExperienceMap(detail);
    return nextMap.get(masterId)?.id ?? null;
};

const buildExperienceOverridePayload = (
    draft: ExperienceEditDraft,
    fallback: ResumeExperienceView | undefined,
    resolvedStar: StarFields,
    resolveExperienceDatePayload: ExperienceHelpers['resolveExperienceDatePayload']
) => {
    const title = draft.title.trim();
    const org = draft.company.trim();
    const dates = resolveExperienceDatePayload(
        draft,
        fallback
            ? {
                start_date: fallback.startDate,
                end_date: fallback.endDate,
                is_current: fallback.isCurrent,
            }
            : undefined
    );
    const overrides: Record<string, any> = {
        star: resolvedStar,
        is_current: dates.isCurrent,
    };
    if (dates.startDate) {
        overrides.start_date = dates.startDate;
    }
    if (dates.endDate) {
        overrides.end_date = dates.endDate;
    }
    if (title) {
        overrides.title = title;
    }
    if (org) {
        overrides.org = org;
    }
    return {
        overrides,
        resolvedTitle: title || fallback?.title || '',
        resolvedOrg: org || fallback?.company || '',
        resolvedStar,
        dates,
    };
};

const saveExperienceOverride = async (
    resumeId: string | null,
    masterId: string,
    draft: ExperienceEditDraft,
    domain: ExperienceDomain,
    helpers: ExperienceHelpers,
    applyResumeDetail: (detail: ResumeDetail | null) => void,
    updateHelpers: ExperienceUpdateHelpers
) => {
    const targetItem = domain.items.find((item) => item.id === masterId);
    const resumeItem = domain.resumeMap.get(masterId);
    const hasStarOverride = Boolean(
        resumeItem?.overrides_json
        && Object.prototype.hasOwnProperty.call(resumeItem.overrides_json, 'star')
    );
    const sourceStar = domain.sourceMap.get(masterId)?.latest_version?.star;
    const resolvedStar = resolveStarPayload(
        draft,
        sourceStar,
        helpers.mergeStarFieldsWithSource,
        { hasStarOverride }
    );
    const linkId = await ensureResumeLink(
        resumeId,
        masterId,
        targetItem?.experienceVersionId,
        domain.resumeMap,
        applyResumeDetail,
        helpers.buildResumeExperienceMap
    );
    if (!linkId || !resumeId) {
        throw new Error('无法创建简历经历关联');
    }
    const payload = buildExperienceOverridePayload(
        draft,
        targetItem,
        resolvedStar,
        helpers.resolveExperienceDatePayload
    );
    const detail = await resumeService.updateAssembly(resumeId, {
        operations: [
            {
                op: 'override',
                resume_experience_id: linkId,
                overrides_json: payload.overrides,
            },
        ],
    });
    applyResumeDetail(detail);
    updateHelpers.applyExperienceUpdate(masterId, {
        title: payload.resolvedTitle,
        company: payload.resolvedOrg,
        star: payload.resolvedStar,
        startDate: payload.dates.startDate,
        endDate: payload.dates.endDate,
        isCurrent: payload.dates.isCurrent,
        date: helpers.buildExperienceDate(
            payload.dates.startDate,
            payload.dates.endDate,
            payload.dates.isCurrent
        ),
    });
    domain.setSelectedIds((prev) => addToSet(prev, masterId));
};

type ExperienceSaveHandlers = {
    handleSaveExperience: () => Promise<void>;
    handlePolishWithJD: () => Promise<void>;
    handlePolishExperienceById: (id: string) => Promise<boolean>;
};

type ExperiencePolishOutcome = {
    status: 'applied' | 'discarded' | 'error' | 'empty_jd';
    nextDraft?: ExperienceEditDraft;
};

type ExperiencePolishOptions = {
    suppressAppliedSuccessToast?: boolean;
};

const runExperiencePolish = async (
    draft: ExperienceEditDraft,
    jdText: string,
    toast: ToastApi,
    helpers: ExperienceHelpers,
    options?: ExperiencePolishOptions
): Promise<ExperiencePolishOutcome> => {
    const trimmedJD = jdText.trim();
    if (!trimmedJD) {
        toast.error(JD_POLISH_TOAST_MESSAGES.emptyJd, JD_POLISH_TOAST_ERROR_DURATION_MS);
        return { status: 'empty_jd' };
    }
    const startTime = Date.now();
    let action: 'applied' | 'discarded' = 'discarded';
    let hasError = false;
    const toastId = toast.loading(JD_POLISH_TOAST_MESSAGES.loading);
    trackAiPolishStart({ source: 'resume_editor', field: 'all' });
    try {
        const result = await aiService.polishExperienceStream({
            content: {
                company: draft.company,
                role: draft.title,
                s: draft.star.s,
                t: draft.star.t,
                a: draft.star.a,
                r: draft.star.r,
            },
            jdText: trimmedJD,
        }, (event) => {
            const resolution = resolveThoughtDisplayEvent(event);
            if (resolution?.kind !== 'model_thought') {
                return;
            }
            toast.updateToast(toastId, {
                message: resolution.text,
                type: 'ai_thinking',
                duration: 0,
            });
        });
        const normalizedResult: Partial<StarFields> = {
            s: typeof result.s === 'string' ? normalizeAiRichText(result.s, { allowList: false }) : undefined,
            t: typeof result.t === 'string' ? normalizeAiRichText(result.t, { allowList: false }) : undefined,
            a: typeof result.a === 'string' ? normalizeAiRichText(result.a, { allowList: false }) : undefined,
            r: typeof result.r === 'string' ? normalizeAiRichText(result.r, { allowList: false }) : undefined,
        };
        const nextStar = helpers.mergeStarFields(draft.star, normalizedResult);
        action = hasStarFieldsChange(draft.star, nextStar) ? 'applied' : 'discarded';
        if (action === 'applied') {
            return {
                status: 'applied',
                nextDraft: {
                    ...draft,
                    star: nextStar,
                    starTouched: true,
                },
            };
        }
        return { status: 'discarded' };
    } catch (error) {
        console.error('[ResumeEditor] 基于 JD 润色失败:', error);
        hasError = true;
        return { status: 'error' };
    } finally {
        const shouldSkipAppliedSuccessToast = action === 'applied' && options?.suppressAppliedSuccessToast;
        const message = hasError
            ? JD_POLISH_TOAST_MESSAGES.error
            : action === 'applied'
                ? JD_POLISH_TOAST_MESSAGES.success
                : JD_POLISH_TOAST_MESSAGES.noChange;
        const nextType = hasError ? 'error' : 'success';
        const nextDuration = hasError ? JD_POLISH_TOAST_ERROR_DURATION_MS : JD_POLISH_TOAST_DURATION_MS;
        if (shouldSkipAppliedSuccessToast) {
            toast.closeToast(toastId);
        } else {
            toast.updateToast(toastId, {
                message,
                type: nextType,
                duration: nextDuration,
            });
        }
        trackAiPolishResult({
            source: 'resume_editor',
            field: 'all',
            action,
            durationMs: Date.now() - startTime,
        });
    }
};

export const createExperienceSaveHandlers = (
    resumeId: string | null,
    jdText: string,
    toast: ToastApi,
    domain: ExperienceDomain,
    helpers: ExperienceHelpers,
    defaults: ExperienceDefaults,
    state: ExperienceState,
    updateHelpers: ExperienceUpdateHelpers,
    draftHandlers: ExperienceDraftHandlers,
    applyResumeDetail: (detail: ResumeDetail | null) => void,
    onExperienceDraftPersisted?: (draftMasterId: string, savedMasterId: string) => void,
    onExperienceAiPolishPrepared?: (masterId: string) => void,
    onExperienceSaveSuccess?: (masterId: string) => Promise<void>,
): ExperienceSaveHandlers => {
    const handleSaveExperience = async () => {
        if (!state.editingDraft) {
            return;
        }
        state.setIsSavingExperience(true);
        try {
            let savedMasterId = state.editingDraft.masterId;
            if (state.editingDraft.isDraft) {
                const dates = helpers.resolveExperienceDatePayload(state.editingDraft);
                const payload = {
                    category: state.editingDraft.category,
                    version: {
                        title:
                            state.editingDraft.title.trim()
                            || defaults.experienceTitleByCategory[state.editingDraft.category],
                        org:
                            state.editingDraft.company.trim()
                            || defaults.experienceCompanyByCategory[state.editingDraft.category],
                        start_date: dates.startDate,
                        end_date: dates.endDate,
                        is_current: dates.isCurrent,
                        star: state.editingDraft.star,
                    },
                };
                const detail = await experienceService.create(payload);
                draftHandlers.replaceDraftExperience(state.editingDraft.masterId, detail);
                if (savedMasterId !== detail.master.id) {
                    onExperienceDraftPersisted?.(savedMasterId, detail.master.id);
                }
                savedMasterId = detail.master.id;
            } else if (state.syncToMaster) {
                await syncExperienceToMaster(
                    resumeId,
                    state.editingDraft.masterId,
                    state.editingDraft,
                    domain.sourceMap,
                    domain.setSourceMap,
                    updateHelpers,
                    helpers.resolveExperienceDatePayload,
                    helpers.mergeStarFieldsWithSource,
                    domain.resumeMap,
                    applyResumeDetail
                );
            } else {
                await saveExperienceOverride(
                    resumeId,
                    state.editingDraft.masterId,
                    state.editingDraft,
                    domain,
                    helpers,
                    applyResumeDetail,
                    updateHelpers
                );
            }
            await onExperienceSaveSuccess?.(savedMasterId);
            advanceExperienceEditSession(state.editSessionRef);
            state.setEditingExpId(null);
            state.setEditingDraft(null);
        } catch (error) {
            console.error('[ResumeEditor] 保存经历失败:', error);
        } finally {
            state.setIsSavingExperience(false);
        }
    };

    const handlePolishWithJD = async () => {
        if (!state.editingDraft || state.isPolishing) {
            return;
        }
        state.setIsPolishing(true);
        try {
            const outcome = await runExperiencePolish(state.editingDraft, jdText, toast, helpers);
            if (outcome.status !== 'applied' || !outcome.nextDraft) {
                return;
            }
            state.setEditingDraft((prev) => (prev ? outcome.nextDraft ?? prev : prev));
            onExperienceAiPolishPrepared?.(outcome.nextDraft.masterId);
        } finally {
            state.setIsPolishing(false);
        }
    };

    const handlePolishExperienceById = async (id: string) => {
        if (state.isPolishing) {
            return false;
        }
        const draft = resolveEditingExperienceDraft(domain, helpers, id);
        if (!draft) {
            return false;
        }
        const requestedEditSession = state.editSessionRef.current;
        const requestedCollectionVersion = state.collectionVersionRef.current;
        state.setIsPolishing(true);
        try {
            const outcome = await runExperiencePolish(draft, jdText, toast, helpers, {
                suppressAppliedSuccessToast: true,
            });
            if (outcome.status !== 'applied' || !outcome.nextDraft) {
                return false;
            }
            if (requestedCollectionVersion !== state.collectionVersionRef.current) {
                return false;
            }
            if (requestedEditSession !== state.editSessionRef.current) {
                return false;
            }
            try {
                await saveExperienceOverride(
                    resumeId,
                    id,
                    outcome.nextDraft,
                    domain,
                    helpers,
                    applyResumeDetail,
                    updateHelpers
                );
            } catch (error) {
                console.error('[ResumeEditor] 保存润色后的经历失败:', error);
                toast.error(JD_POLISH_TOAST_MESSAGES.error, JD_POLISH_TOAST_ERROR_DURATION_MS);
                return false;
            }
            trackAiPolishApplied({ source: 'resume_editor', field: 'all' });
            toast.success(JD_POLISH_TOAST_MESSAGES.success, JD_POLISH_TOAST_DURATION_MS);
            return true;
        } finally {
            state.setIsPolishing(false);
        }
    };

    return {
        handleSaveExperience,
        handlePolishWithJD,
        handlePolishExperienceById,
    };
};

type ExperienceDeleteHandlers = {
    requestDeleteExperience: (id: string) => void;
    performDeleteExperience: (id: string) => Promise<void>;
};

export const createExperienceDeleteHandlers = (
    domain: ExperienceDomain,
    state: ExperienceState,
    editHandlers: ExperienceEditHandlers,
    draftHandlers: ExperienceDraftHandlers,
    prefixes: DraftPrefixes,
    openDeleteConfirm: (payload: ConfirmDialogState) => void,
    confirmCopy: ConfirmCopy
): ExperienceDeleteHandlers => {
    const requestDeleteExperience = (id: string) => {
        if (state.deletingExperienceIds.has(id)) {
            return;
        }
        openDeleteConfirm({
            id,
            type: 'experience',
            title: confirmCopy.experience.title,
            description: confirmCopy.experience.description,
        });
    };

    const performDeleteExperience = async (id: string) => {
        if (state.deletingExperienceIds.has(id)) {
            return;
        }
        if (isDraftId(id, prefixes.experience)) {
            draftHandlers.removeDraftExperience(id);
            if (state.editingExpId === id) {
                editHandlers.cancelEditingExperience();
            }
            return;
        }
        try {
            await runWithFlag(id, state.deletingExperienceIds, state.setDeletingExperienceIds, async () => {
                await experienceService.delete(id);
                advanceExperienceCollectionVersion(state.collectionVersionRef);
                domain.setItems((prev) => prev.filter((item) => item.id !== id));
                domain.setSourceMap((prev) => deleteMapEntry(prev, id));
                domain.setResumeMap((prev) => deleteMapEntry(prev, id));
                domain.setSelectedIds((prev) => removeFromSet(prev, id));
                if (state.editingExpId === id) {
                    editHandlers.cancelEditingExperience();
                }
            });
        } catch (error) {
            console.error('[ResumeEditor] 删除经历失败:', error);
        }
    };

    return {
        requestDeleteExperience,
        performDeleteExperience,
    };
};

export const createExperienceSelectionHandlers = (domain: ExperienceDomain) => {
    const toggleExperienceSelection = (id: string) => {
        domain.setSelectedIds((prev) => {
            const wasSelected = prev.has(id);
            const next = toggleInSet(prev, id);
            if (!wasSelected) {
                const item = domain.items.find((entry) => entry.id === id);
                trackResumeCardChecked({
                    cardType: 'experience',
                    category: item?.category,
                    checked: true,
                });
            }
            return next;
        });
    };
    return { toggleExperienceSelection };
};

