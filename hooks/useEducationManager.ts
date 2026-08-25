import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type Dispatch,
    type MutableRefObject,
    type SetStateAction,
} from 'react';
import { experienceService, type ExperienceListItem } from '../services/experienceService';
import {
    assertAuthCacheKey,
    AuthContextChangedError,
    isAuthContextChangedError,
    type AuthOwnerOptions,
} from '../services/apiClient';
import { getTodayLocalISODate, parseYearMonthValue } from '../utils/dateUtils';
import {
    buildEduCardData,
    buildEduVersionPayload,
    buildEducationDateLabel,
    cloneEduCardData,
    createEmptyEduCardData,
    EDU_TOAST_MESSAGES,
    EDUCATION_DEFAULTS,
    normalizeEduData,
    type EduCardData,
} from '../utils/educationUtils';

const EDU_CATEGORY = 'education';
const EDU_COLLAPSE_DURATION_MS = 300;
const EDU_SCROLL_COLLAPSE_DELAY_MS = 50;
const EDU_SCROLL_EXPAND_DELAY_MS = 100;
const EDU_TOAST_DURATION_MS = 3000;

export type EducationToastApi = {
    success: (message: string, duration?: number) => string;
    error: (message: string, duration?: number) => string;
    loading: (message: string) => string;
    updateToast: (
        id: string,
        updates: { message?: string; type?: 'success' | 'error' | 'loading' | 'ai_thinking'; duration?: number }
    ) => void;
    closeToast?: (id: string) => void;
};

type EducationGuestOptions = {
    authUserKey: string | null;
    isAuthenticated: boolean;
    onRequireAuth: () => void | Promise<void>;
};

export type EducationManager = {
    educations: ExperienceListItem[];
    sortedEducations: ExperienceListItem[];
    isLoading: boolean;
    isCreating: boolean;
    eduData: Map<string, EduCardData>;
    modifiedEduCards: Set<string>;
    expandedEduCards: Set<string>;
    collapsingEduCards: Set<string>;
    savingEduIds: Set<string>;
    deletingEduId: string | null;
    getEduCardData: (item: ExperienceListItem) => EduCardData;
    buildDateLabel: (data: EduCardData) => string;
    setCardRef: (eduId: string, element: HTMLDivElement | null) => void;
    updateEduField: (eduId: string, field: keyof EduCardData, value: string) => void;
    toggleEduCard: (eduId: string) => void;
    handleAddEdu: () => Promise<void>;
    handleSaveEdu: (eduId: string) => Promise<void>;
    handleCancelEditEdu: (eduId: string) => void;
    requestDeleteEdu: (eduId: string) => void;
    handleConfirmDelete: () => Promise<void>;
    handleCancelDelete: () => void;
    refreshEducation: (options?: AuthOwnerOptions) => Promise<ExperienceListItem[]>;
    focusEduCard: (eduId: string) => void;
};

const addToSet = (prev: Set<string>, id: string) => {
    const next = new Set(prev);
    next.add(id);
    return next;
};

const removeFromSet = (prev: Set<string>, id: string) => {
    const next = new Set(prev);
    next.delete(id);
    return next;
};

const setMapEntry = <K, V>(prev: Map<K, V>, key: K, value: V) => {
    const next = new Map(prev);
    next.set(key, value);
    return next;
};

const deleteMapEntry = <K, V>(prev: Map<K, V>, key: K) => {
    const next = new Map(prev);
    next.delete(key);
    return next;
};

type EducationOwnerOperation = {
    expectedAuthCacheKey: string;
    ownerGeneration: number;
    requestGeneration?: number;
    requestGenerationRef?: MutableRefObject<number>;
};

type EducationOwnerGuard = {
    authUserKey: string | null;
    beginOperation: (
        expectedAuthCacheKey?: string | null,
        requestGenerationRef?: MutableRefObject<number>,
    ) => Promise<EducationOwnerOperation>;
    assertOperationCurrent: (operation: EducationOwnerOperation) => Promise<void>;
    isOperationCurrent: (operation: EducationOwnerOperation) => boolean;
};

const useEducationOwnerGuard = (authUserKey: string | null): EducationOwnerGuard => {
    const ownerGenerationRef = useRef(0);
    const committedOwnerKeyRef = useRef<string | null>(authUserKey);
    useLayoutEffect(() => {
        if (committedOwnerKeyRef.current !== authUserKey) {
            committedOwnerKeyRef.current = authUserKey;
            ownerGenerationRef.current += 1;
        }
    }, [authUserKey]);

    useEffect(() => () => {
        ownerGenerationRef.current += 1;
    }, []);

    const isOperationCurrent = useCallback((operation: EducationOwnerOperation) => (
        ownerGenerationRef.current === operation.ownerGeneration
        && committedOwnerKeyRef.current === operation.expectedAuthCacheKey
        && (
            !operation.requestGenerationRef
            || operation.requestGenerationRef.current === operation.requestGeneration
        )
    ), []);

    const assertOperationCurrent = useCallback(async (operation: EducationOwnerOperation) => {
        if (!isOperationCurrent(operation)) {
            throw new AuthContextChangedError();
        }
        await assertAuthCacheKey(operation.expectedAuthCacheKey);
        if (!isOperationCurrent(operation)) {
            throw new AuthContextChangedError();
        }
    }, [isOperationCurrent]);

    const beginOperation = useCallback(async (
        expectedAuthCacheKey: string | null | undefined = authUserKey,
        requestGenerationRef?: MutableRefObject<number>,
    ) => {
        if (
            !expectedAuthCacheKey
            || expectedAuthCacheKey === 'anonymous'
            || expectedAuthCacheKey !== authUserKey
            || committedOwnerKeyRef.current !== expectedAuthCacheKey
        ) {
            throw new AuthContextChangedError();
        }
        const requestGeneration = requestGenerationRef
            ? requestGenerationRef.current + 1
            : undefined;
        if (requestGenerationRef && requestGeneration !== undefined) {
            requestGenerationRef.current = requestGeneration;
        }
        const operation: EducationOwnerOperation = {
            expectedAuthCacheKey,
            ownerGeneration: ownerGenerationRef.current,
            requestGeneration,
            requestGenerationRef,
        };
        await assertOperationCurrent(operation);
        return operation;
    }, [assertOperationCurrent, authUserKey]);

    return useMemo(() => ({
        authUserKey,
        beginOperation,
        assertOperationCurrent,
        isOperationCurrent,
    }), [authUserKey, beginOperation, assertOperationCurrent, isOperationCurrent]);
};

const shouldCancelEducationOperation = (
    error: unknown,
    operation: EducationOwnerOperation | null,
    ownerGuard: EducationOwnerGuard,
) => (
    isAuthContextChangedError(error)
    || Boolean(operation && !ownerGuard.isOperationCurrent(operation))
);

const buildSortedEducations = (educations: ExperienceListItem[]) => {
    return [...educations].sort((a, b) => {
        const dateA = a.latest_version?.start_date;
        const dateB = b.latest_version?.start_date;
        const valA = parseYearMonthValue(dateA) ?? -1;
        const valB = parseYearMonthValue(dateB) ?? -1;
        return valB - valA;
    });
};

const updateEducationVersion = (
    items: ExperienceListItem[],
    eduId: string,
    payload: ReturnType<typeof buildEduVersionPayload>
) => {
    return items.map((item) => {
        if (item.master.id !== eduId) {
            return item;
        }
        return {
            ...item,
            latest_version: {
                ...(item.latest_version || {}),
                title: payload.title,
                org: payload.org,
                start_date: payload.start_date,
                end_date: payload.end_date,
                star: payload.star,
            } as any,
        };
    });
};

const useEducationList = (
    isAuthenticated: boolean,
    ownerGuard: EducationOwnerGuard,
    authUserKey?: string | null,
) => {
    const initialEducationRef = useRef<ExperienceListItem[] | null>(
        isAuthenticated && authUserKey
            ? experienceService.peekList(EDU_CATEGORY, { expectedAuthCacheKey: authUserKey })
            : null
    );
    const [educations, setEducations] = useState<ExperienceListItem[]>(
        () => initialEducationRef.current ?? []
    );
    const [isLoading, setIsLoading] = useState(
        () => isAuthenticated && !initialEducationRef.current
    );
    const [listOwnerKey, setListOwnerKey] = useState<string | null>(authUserKey ?? null);
    const refreshInFlightRef = useRef<{
        ownerKey: string;
        promise: Promise<ExperienceListItem[]>;
    } | null>(null);
    const hasLoadedRef = useRef(false);
    const renderedOwnerKeyRef = useRef<string | null>(authUserKey ?? null);
    const isOwnerResolved = isAuthenticated && !!authUserKey && authUserKey !== 'anonymous';
    const visibleEducations = listOwnerKey === authUserKey ? educations : [];
    const visibleIsLoading = isOwnerResolved && listOwnerKey !== authUserKey
        ? true
        : isLoading;

    const refreshEducation = useCallback(async (options?: AuthOwnerOptions) => {
        if (!isOwnerResolved) {
            setEducations([]);
            setIsLoading(false);
            return [];
        }
        const expectedAuthCacheKey = options?.expectedAuthCacheKey ?? authUserKey;
        const operation = await ownerGuard.beginOperation(expectedAuthCacheKey);
        const existingRefresh = refreshInFlightRef.current;
        if (existingRefresh?.ownerKey === operation.expectedAuthCacheKey) {
            return existingRefresh.promise;
        }
        const refreshPromise = (async () => {
            await ownerGuard.assertOperationCurrent(operation);
            const data = await experienceService.list(EDU_CATEGORY, {
                force: true,
                expectedAuthCacheKey: operation.expectedAuthCacheKey,
            });
            await ownerGuard.assertOperationCurrent(operation);
            setEducations(data);
            setListOwnerKey(operation.expectedAuthCacheKey);
            return data;
        })();
        const refreshEntry = {
            ownerKey: operation.expectedAuthCacheKey,
            promise: refreshPromise,
        };
        refreshInFlightRef.current = refreshEntry;
        try {
            return await refreshPromise;
        } finally {
            if (refreshInFlightRef.current === refreshEntry) {
                refreshInFlightRef.current = null;
            }
        }
    }, [authUserKey, isOwnerResolved, ownerGuard]);

    useEffect(() => {
        if (!isOwnerResolved) {
            hasLoadedRef.current = false;
            renderedOwnerKeyRef.current = null;
            initialEducationRef.current = null;
            setEducations([]);
            setListOwnerKey(null);
            setIsLoading(false);
            return;
        }
        const expectedAuthCacheKey = authUserKey;
        let cancelled = false;
        if (renderedOwnerKeyRef.current !== expectedAuthCacheKey) {
            renderedOwnerKeyRef.current = expectedAuthCacheKey;
            hasLoadedRef.current = false;
            initialEducationRef.current = experienceService.peekList(EDU_CATEGORY, {
                expectedAuthCacheKey,
            });
            setEducations(initialEducationRef.current ?? []);
            setListOwnerKey(expectedAuthCacheKey);
        }
        const loadEducationExperiences = async () => {
            if (hasLoadedRef.current) return;
            let operation: EducationOwnerOperation | null = null;
            try {
                operation = await ownerGuard.beginOperation(expectedAuthCacheKey);
                if (!initialEducationRef.current?.length) {
                    setIsLoading(true);
                }
                hasLoadedRef.current = true;
                await ownerGuard.assertOperationCurrent(operation);
                const data = await experienceService.list(EDU_CATEGORY, {
                    expectedAuthCacheKey,
                });
                await ownerGuard.assertOperationCurrent(operation);
                if (cancelled) return;
                setEducations(data);
                setListOwnerKey(expectedAuthCacheKey);
            } catch (error) {
                if (shouldCancelEducationOperation(error, operation, ownerGuard)) {
                    return;
                }
                console.error('[EducationManager] 加载教育经历失败:', error);
                hasLoadedRef.current = false;
            } finally {
                if (!cancelled && operation && ownerGuard.isOperationCurrent(operation)) {
                    setIsLoading(false);
                }
            }
        };
        void loadEducationExperiences();
        return () => {
            cancelled = true;
        };
    }, [authUserKey, isOwnerResolved, ownerGuard]);

    return {
        educations: visibleEducations,
        setEducations,
        isLoading: visibleIsLoading,
        refreshEducation,
    };
};

const CARD_HIGHLIGHT_CLASS = 'card-highlight';
const CARD_HIGHLIGHT_DURATION_MS = 900;

const useEducationCardRefs = () => {
    const eduCardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

    const setCardRef = useCallback((eduId: string, element: HTMLDivElement | null) => {
        if (element) {
            eduCardRefs.current.set(eduId, element);
        } else {
            eduCardRefs.current.delete(eduId);
        }
    }, []);

    /** 展开时滚动到卡片（无闪动） */
    const scrollToCard = useCallback((eduId: string, delay: number) => {
        setTimeout(() => {
            eduCardRefs.current.get(eduId)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, delay);
    }, []);

    /**
     * 折叠后：先滚动到卡片位置，再触发高亮脉冲动画，帮助用户确认位置。
     */
    const highlightCard = useCallback((eduId: string, delay: number) => {
        setTimeout(() => {
            const element = eduCardRefs.current.get(eduId);
            if (!element) return;
            element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            element.classList.remove(CARD_HIGHLIGHT_CLASS);
            void element.offsetWidth;
            element.classList.add(CARD_HIGHLIGHT_CLASS);
            setTimeout(() => {
                element.classList.remove(CARD_HIGHLIGHT_CLASS);
            }, CARD_HIGHLIGHT_DURATION_MS);
        }, delay);
    }, []);

    return { setCardRef, scrollToCard, highlightCard };
};

const useEducationStore = () => {
    const [eduData, setEduData] = useState<Map<string, EduCardData>>(new Map());
    const [originalEduData, setOriginalEduData] = useState<Map<string, EduCardData>>(new Map());
    const [modifiedEduCards, setModifiedEduCards] = useState<Set<string>>(new Set());
    return { eduData, setEduData, originalEduData, setOriginalEduData, modifiedEduCards, setModifiedEduCards };
};

const useEducationInitializer = (
    educations: ExperienceListItem[],
    setEduData: Dispatch<SetStateAction<Map<string, EduCardData>>>,
    setOriginalEduData: Dispatch<SetStateAction<Map<string, EduCardData>>>
) => {
    const ensureEduCardState = useCallback(
        (eduId: string, seedData?: EduCardData) => {
            const item = seedData ? null : educations.find((edu) => edu.master.id === eduId);
            const data = seedData || (item ? buildEduCardData(item) : createEmptyEduCardData());
            setEduData((prev) => (prev.has(eduId) ? prev : setMapEntry(prev, eduId, data)));
            setOriginalEduData((prev) => (prev.has(eduId) ? prev : setMapEntry(prev, eduId, cloneEduCardData(data))));
        },
        [educations, setEduData, setOriginalEduData]
    );

    return { ensureEduCardState };
};

const useEducationEditors = (
    originalEduData: Map<string, EduCardData>,
    setEduData: Dispatch<SetStateAction<Map<string, EduCardData>>>,
    setModifiedEduCards: Dispatch<SetStateAction<Set<string>>>
) => {
    const updateModifiedState = useCallback(
        (eduId: string, current: EduCardData) => {
            const original = originalEduData.get(eduId);
            const isModified = original ? JSON.stringify(current) !== JSON.stringify(original) : true;
            setModifiedEduCards((prev) => (isModified ? addToSet(prev, eduId) : removeFromSet(prev, eduId)));
        },
        [originalEduData, setModifiedEduCards]
    );

    const updateEduField = useCallback(
        (eduId: string, field: keyof EduCardData, value: string) => {
            setEduData((prev) => {
                const current = prev.get(eduId) || createEmptyEduCardData();
                const nextData = { ...current, [field]: value };
                updateModifiedState(eduId, nextData);
                return setMapEntry(prev, eduId, nextData);
            });
        },
        [setEduData, updateModifiedState]
    );

    const resetEduCard = useCallback(
        (eduId: string) => {
            const original = originalEduData.get(eduId);
            if (original) {
                setEduData((prev) => setMapEntry(prev, eduId, cloneEduCardData(original)));
            }
            setModifiedEduCards((prev) => removeFromSet(prev, eduId));
        },
        [originalEduData, setEduData, setModifiedEduCards]
    );

    return { updateEduField, resetEduCard };
};

const useEducationExpansion = (
    ensureEduCardState: (eduId: string, seedData?: EduCardData) => void,
    scrollToCard: (eduId: string, delay: number) => void,
    highlightCard: (eduId: string, delay: number) => void
) => {
    const [expandedEduCards, setExpandedEduCards] = useState<Set<string>>(new Set());
    const [collapsingEduCards, setCollapsingEduCards] = useState<Set<string>>(new Set());

    const toggleEduCard = useCallback(
        (eduId: string, seedData?: EduCardData) => {
            setExpandedEduCards((prev) => {
                const next = new Set(prev);
                if (next.has(eduId)) {
                    setCollapsingEduCards((collapsing) => addToSet(collapsing, eduId));
                    next.delete(eduId);
                    // 收起动画结束后滚动+高亮闪动
                    setTimeout(() => {
                        setCollapsingEduCards((current) => removeFromSet(current, eduId));
                        highlightCard(eduId, EDU_SCROLL_COLLAPSE_DELAY_MS);
                    }, EDU_COLLAPSE_DURATION_MS);
                } else {
                    // 展开：只滚动，不高亮
                    next.add(eduId);
                    ensureEduCardState(eduId, seedData);
                    scrollToCard(eduId, EDU_SCROLL_EXPAND_DELAY_MS);
                }
                return next;
            });
        },
        [ensureEduCardState, highlightCard, scrollToCard]
    );

    const removeEduExpansion = useCallback((eduId: string) => {
        setExpandedEduCards((prev) => removeFromSet(prev, eduId));
        setCollapsingEduCards((prev) => removeFromSet(prev, eduId));
    }, []);

    const focusEduCard = useCallback((eduId: string) => {
        setExpandedEduCards((prev) => addToSet(prev, eduId));
        ensureEduCardState(eduId);
        scrollToCard(eduId, EDU_SCROLL_EXPAND_DELAY_MS);
        highlightCard(eduId, EDU_SCROLL_EXPAND_DELAY_MS + 250);
    }, [ensureEduCardState, highlightCard, scrollToCard]);

    return { expandedEduCards, collapsingEduCards, toggleEduCard, removeEduExpansion, focusEduCard };
};

const useEducationCreate = (
    toast: EducationToastApi,
    ownerGuard: EducationOwnerGuard,
    refreshEducation: (options?: AuthOwnerOptions) => Promise<ExperienceListItem[]>,
    setEducations: Dispatch<SetStateAction<ExperienceListItem[]>>,
    setEduData: Dispatch<SetStateAction<Map<string, EduCardData>>>,
    setOriginalEduData: Dispatch<SetStateAction<Map<string, EduCardData>>>,
    setModifiedEduCards: Dispatch<SetStateAction<Set<string>>>,
    toggleEduCard: (eduId: string, seedData?: EduCardData) => void
) => {
    const [creatingOwnerKey, setCreatingOwnerKey] = useState<string | null>(null);
    const createRequestGenerationRef = useRef(0);
    const isCreating = creatingOwnerKey === ownerGuard.authUserKey;

    const handleAddEdu = useCallback(async () => {
        if (isCreating) {
            return;
        }
        let toastId: string | null = null;
        let operation: EducationOwnerOperation | null = null;
        try {
            operation = await ownerGuard.beginOperation(
                ownerGuard.authUserKey,
                createRequestGenerationRef,
            );
            setCreatingOwnerKey(operation.expectedAuthCacheKey);
            toastId = toast.loading(EDU_TOAST_MESSAGES.createLoading);
            await ownerGuard.assertOperationCurrent(operation);
            const newEducation = await experienceService.create({
                category: EDU_CATEGORY,
                version: {
                    title: EDUCATION_DEFAULTS.title,
                    org: EDUCATION_DEFAULTS.org,
                    start_date: getTodayLocalISODate(),
                    star: {},
                },
            }, { expectedAuthCacheKey: operation.expectedAuthCacheKey });
            await ownerGuard.assertOperationCurrent(operation);

            const initialData = buildEduCardData(newEducation);
            setEducations((prev) => [newEducation, ...prev]);
            setEduData((prev) => setMapEntry(prev, newEducation.master.id, initialData));
            setOriginalEduData((prev) => setMapEntry(prev, newEducation.master.id, cloneEduCardData(initialData)));
            setModifiedEduCards((prev) => removeFromSet(prev, newEducation.master.id));
            toggleEduCard(newEducation.master.id, initialData);

            if (toastId) {
                toast.updateToast(toastId, { message: EDU_TOAST_MESSAGES.createSuccess, type: 'success', duration: EDU_TOAST_DURATION_MS });
            } else {
                toast.success(EDU_TOAST_MESSAGES.createSuccess);
            }
            refreshEducation({ expectedAuthCacheKey: operation.expectedAuthCacheKey }).catch((err) => {
                if (!isAuthContextChangedError(err)) {
                    console.error('[EducationManager] 刷新教育经历失败:', err);
                }
            });
        } catch (err) {
            if (shouldCancelEducationOperation(err, operation, ownerGuard)) {
                return;
            }
            console.error('[EducationManager] 创建教育经历失败:', err);
            if (toastId) {
                toast.updateToast(toastId, { message: EDU_TOAST_MESSAGES.createError, type: 'error', duration: EDU_TOAST_DURATION_MS });
            } else {
                toast.error(EDU_TOAST_MESSAGES.createError);
            }
        } finally {
            if (operation && ownerGuard.isOperationCurrent(operation)) {
                setCreatingOwnerKey((current) => (
                    current === operation?.expectedAuthCacheKey ? null : current
                ));
            }
        }
    }, [
        isCreating,
        ownerGuard,
        refreshEducation,
        setEducations,
        setEduData,
        setModifiedEduCards,
        setOriginalEduData,
        toast,
        toggleEduCard,
    ]);

    return { isCreating, handleAddEdu };
};

const useEducationSave = (
    toast: EducationToastApi,
    ownerGuard: EducationOwnerGuard,
    refreshEducation: (options?: AuthOwnerOptions) => Promise<ExperienceListItem[]>,
    eduData: Map<string, EduCardData>,
    setEducations: Dispatch<SetStateAction<ExperienceListItem[]>>,
    setEduData: Dispatch<SetStateAction<Map<string, EduCardData>>>,
    setOriginalEduData: Dispatch<SetStateAction<Map<string, EduCardData>>>,
    setModifiedEduCards: Dispatch<SetStateAction<Set<string>>>,
    toggleEduCard: (eduId: string) => void
) => {
    const [savingState, setSavingState] = useState<{
        ownerKey: string | null;
        ids: Set<string>;
    }>({ ownerKey: null, ids: new Set() });
    const saveRequestGenerationRefs = useRef<Map<string, MutableRefObject<number>>>(new Map());
    const savingEduIds = savingState.ownerKey === ownerGuard.authUserKey
        ? savingState.ids
        : new Set<string>();

    const handleSaveEdu = useCallback(async (eduId: string) => {
        const data = eduData.get(eduId);
        if (!data || savingEduIds.has(eduId)) {
            return;
        }
        let toastId: string | null = null;
        let operation: EducationOwnerOperation | null = null;
        try {
            let requestGenerationRef = saveRequestGenerationRefs.current.get(eduId);
            if (!requestGenerationRef) {
                requestGenerationRef = { current: 0 };
                saveRequestGenerationRefs.current.set(eduId, requestGenerationRef);
            }
            operation = await ownerGuard.beginOperation(
                ownerGuard.authUserKey,
                requestGenerationRef,
            );
            const normalized = normalizeEduData(data);
            if (!normalized.school || !normalized.major) {
                toast.error('学校和专业不能为空');
                return;
            }
            setSavingState((current) => ({
                ownerKey: operation?.expectedAuthCacheKey ?? current.ownerKey,
                ids: current.ownerKey === operation?.expectedAuthCacheKey
                    ? addToSet(current.ids, eduId)
                    : new Set([eduId]),
            }));
            toastId = toast.loading(EDU_TOAST_MESSAGES.saveLoading);
            const versionPayload = buildEduVersionPayload(normalized);
            await ownerGuard.assertOperationCurrent(operation);
            await experienceService.update(
                eduId,
                { version: versionPayload },
                { expectedAuthCacheKey: operation.expectedAuthCacheKey },
            );
            await ownerGuard.assertOperationCurrent(operation);

            setEduData((prev) => setMapEntry(prev, eduId, normalized));
            setOriginalEduData((prev) => setMapEntry(prev, eduId, cloneEduCardData(normalized)));
            setModifiedEduCards((prev) => removeFromSet(prev, eduId));
            setEducations((prev) => updateEducationVersion(prev, eduId, versionPayload));

            if (toastId) {
                toast.updateToast(toastId, { message: EDU_TOAST_MESSAGES.saveSuccess, type: 'success', duration: EDU_TOAST_DURATION_MS });
            } else {
                toast.success(EDU_TOAST_MESSAGES.saveSuccess);
            }

            toggleEduCard(eduId);
            refreshEducation({ expectedAuthCacheKey: operation.expectedAuthCacheKey }).catch((err) => {
                if (!isAuthContextChangedError(err)) {
                    console.error('[EducationManager] 刷新教育经历失败:', err);
                }
            });
        } catch (err) {
            if (shouldCancelEducationOperation(err, operation, ownerGuard)) {
                return;
            }
            console.error('[EducationManager] 保存教育经历失败:', err);
            if (toastId) {
                toast.updateToast(toastId, { message: EDU_TOAST_MESSAGES.saveError, type: 'error', duration: EDU_TOAST_DURATION_MS });
            } else {
                toast.error(EDU_TOAST_MESSAGES.saveError);
            }
        } finally {
            if (operation && ownerGuard.isOperationCurrent(operation)) {
                setSavingState((current) => (
                    current.ownerKey === operation?.expectedAuthCacheKey
                        ? { ...current, ids: removeFromSet(current.ids, eduId) }
                        : current
                ));
            }
        }
    }, [
        eduData,
        ownerGuard,
        refreshEducation,
        savingEduIds,
        setEducations,
        setEduData,
        setModifiedEduCards,
        setOriginalEduData,
        savingState,
        toast,
        toggleEduCard,
    ]);

    return { savingEduIds, handleSaveEdu };
};

const useEducationDelete = (
    toast: EducationToastApi,
    ownerGuard: EducationOwnerGuard,
    refreshEducation: (options?: AuthOwnerOptions) => Promise<ExperienceListItem[]>,
    savingEduIds: Set<string>,
    setEducations: Dispatch<SetStateAction<ExperienceListItem[]>>,
    setEduData: Dispatch<SetStateAction<Map<string, EduCardData>>>,
    setOriginalEduData: Dispatch<SetStateAction<Map<string, EduCardData>>>,
    setModifiedEduCards: Dispatch<SetStateAction<Set<string>>>,
    removeEduExpansion: (eduId: string) => void,
    /** 删除请求时高亮提示卡片位置，替代 scrollToCard */
    highlightCard: (eduId: string, delay: number) => void
) => {
    const [deleteTarget, setDeleteTarget] = useState<{
        ownerKey: string | null;
        eduId: string | null;
    }>({ ownerKey: null, eduId: null });
    const deleteRequestGenerationRef = useRef(0);
    const deletingEduId = deleteTarget.ownerKey === ownerGuard.authUserKey
        ? deleteTarget.eduId
        : null;

    const requestDeleteEdu = useCallback((eduId: string) => {
        setDeleteTarget({ ownerKey: ownerGuard.authUserKey, eduId });
        highlightCard(eduId, 0);
    }, [highlightCard, ownerGuard.authUserKey]);

    const handleConfirmDelete = useCallback(async () => {
        if (!deletingEduId || savingEduIds.has(deletingEduId)) {
            return;
        }
        let toastId: string | null = null;
        const eduId = deletingEduId;
        let operation: EducationOwnerOperation | null = null;
        try {
            operation = await ownerGuard.beginOperation(
                ownerGuard.authUserKey,
                deleteRequestGenerationRef,
            );
            toastId = toast.loading(EDU_TOAST_MESSAGES.deleteLoading);
            setDeleteTarget({ ownerKey: operation.expectedAuthCacheKey, eduId: null });
            setEducations((prev) => prev.filter((edu) => edu.master.id !== eduId));
            setEduData((prev) => deleteMapEntry(prev, eduId));
            setOriginalEduData((prev) => deleteMapEntry(prev, eduId));
            setModifiedEduCards((prev) => removeFromSet(prev, eduId));
            removeEduExpansion(eduId);

            await ownerGuard.assertOperationCurrent(operation);
            await experienceService.delete(eduId, {
                expectedAuthCacheKey: operation.expectedAuthCacheKey,
            });
            await ownerGuard.assertOperationCurrent(operation);
            if (toastId) {
                toast.updateToast(toastId, { message: EDU_TOAST_MESSAGES.deleteSuccess, type: 'success', duration: EDU_TOAST_DURATION_MS });
            } else {
                toast.success(EDU_TOAST_MESSAGES.deleteSuccess);
            }
            refreshEducation({ expectedAuthCacheKey: operation.expectedAuthCacheKey }).catch((err) => {
                if (!isAuthContextChangedError(err)) {
                    console.error('[EducationManager] 刷新教育经历失败:', err);
                }
            });
        } catch (err) {
            if (shouldCancelEducationOperation(err, operation, ownerGuard)) {
                return;
            }
            console.error('[EducationManager] 删除教育经历失败:', err);
            if (toastId) {
                toast.updateToast(toastId, { message: EDU_TOAST_MESSAGES.deleteError, type: 'error', duration: EDU_TOAST_DURATION_MS });
            } else {
                toast.error(EDU_TOAST_MESSAGES.deleteError);
            }
            const expectedAuthCacheKey = operation?.expectedAuthCacheKey;
            refreshEducation(expectedAuthCacheKey ? { expectedAuthCacheKey } : undefined).catch((err2) => {
                if (!isAuthContextChangedError(err2)) {
                    console.error('[EducationManager] 恢复教育经历失败:', err2);
                }
            });
        }
    }, [
        deletingEduId,
        ownerGuard,
        refreshEducation,
        removeEduExpansion,
        savingEduIds,
        setEducations,
        setEduData,
        setModifiedEduCards,
        setOriginalEduData,
        toast,
    ]);

    const handleCancelDelete = useCallback(() => {
        setDeleteTarget({ ownerKey: ownerGuard.authUserKey, eduId: null });
    }, [ownerGuard.authUserKey]);

    return { deletingEduId, requestDeleteEdu, handleConfirmDelete, handleCancelDelete };
};

/**
 * 统一管理教育经历的列表与编辑状态，避免 ExperienceBank 内部堆积状态与副作用。
 */
export const useEducationManager = (
    toast: EducationToastApi,
    {
        authUserKey = null,
        isAuthenticated = true,
        onRequireAuth = () => undefined,
    }: Partial<EducationGuestOptions> = {}
): EducationManager => {
    const activeLoadingToastIdsRef = useRef<Set<string>>(new Set());
    const trackedToast = useMemo<EducationToastApi>(() => ({
        ...toast,
        loading: (message) => {
            const id = toast.loading(message);
            activeLoadingToastIdsRef.current.add(id);
            return id;
        },
        updateToast: (id, updates) => {
            if (updates.type && updates.type !== 'loading' && updates.type !== 'ai_thinking') {
                activeLoadingToastIdsRef.current.delete(id);
            }
            toast.updateToast(id, updates);
        },
        closeToast: (id) => {
            activeLoadingToastIdsRef.current.delete(id);
            toast.closeToast?.(id);
        },
    }), [toast]);

    useLayoutEffect(() => {
        for (const id of activeLoadingToastIdsRef.current) {
            toast.closeToast?.(id);
        }
        activeLoadingToastIdsRef.current.clear();
    }, [authUserKey, toast]);

    useEffect(() => () => {
        for (const id of activeLoadingToastIdsRef.current) {
            toast.closeToast?.(id);
        }
        activeLoadingToastIdsRef.current.clear();
    }, [toast]);

    const ownerGuard = useEducationOwnerGuard(authUserKey);
    const { educations, setEducations, isLoading, refreshEducation } = useEducationList(
        isAuthenticated,
        ownerGuard,
        authUserKey,
    );
    const { setCardRef, scrollToCard, highlightCard } = useEducationCardRefs();
    const store = useEducationStore();
    const { ensureEduCardState } = useEducationInitializer(
        educations,
        store.setEduData,
        store.setOriginalEduData
    );
    const editors = useEducationEditors(
        store.originalEduData,
        store.setEduData,
        store.setModifiedEduCards
    );
    const expansion = useEducationExpansion(ensureEduCardState, scrollToCard, highlightCard);
    const createActions = useEducationCreate(
        trackedToast,
        ownerGuard,
        refreshEducation,
        setEducations,
        store.setEduData,
        store.setOriginalEduData,
        store.setModifiedEduCards,
        expansion.toggleEduCard
    );
    const saveActions = useEducationSave(
        trackedToast,
        ownerGuard,
        refreshEducation,
        store.eduData,
        setEducations,
        store.setEduData,
        store.setOriginalEduData,
        store.setModifiedEduCards,
        expansion.toggleEduCard
    );
    const deleteActions = useEducationDelete(
        trackedToast,
        ownerGuard,
        refreshEducation,
        saveActions.savingEduIds,
        setEducations,
        store.setEduData,
        store.setOriginalEduData,
        store.setModifiedEduCards,
        expansion.removeEduExpansion,
        highlightCard
    );

    const sortedEducations = useMemo(
        () => buildSortedEducations(educations),
        [educations]
    );

    const requireAuth = useCallback(async () => {
        if (!isAuthenticated) {
            await onRequireAuth();
            return true;
        }
        return false;
    }, [isAuthenticated, onRequireAuth]);

    const updateEduField = useCallback((eduId: string, field: keyof EduCardData, value: string) => {
        if (!isAuthenticated) {
            void onRequireAuth();
            return;
        }
        editors.updateEduField(eduId, field, value);
    }, [editors, isAuthenticated, onRequireAuth]);

    const handleAddEdu = useCallback(async () => {
        if (await requireAuth()) {
            return;
        }
        await createActions.handleAddEdu();
    }, [createActions, requireAuth]);

    const handleSaveEdu = useCallback(async (eduId: string) => {
        if (await requireAuth()) {
            return;
        }
        await saveActions.handleSaveEdu(eduId);
    }, [requireAuth, saveActions]);

    const requestDeleteEdu = useCallback((eduId: string) => {
        if (!isAuthenticated) {
            void onRequireAuth();
            return;
        }
        deleteActions.requestDeleteEdu(eduId);
    }, [deleteActions, isAuthenticated, onRequireAuth]);

    const handleConfirmDelete = useCallback(async () => {
        if (await requireAuth()) {
            return;
        }
        await deleteActions.handleConfirmDelete();
    }, [deleteActions, requireAuth]);

    const getEduCardData = useCallback(
        (item: ExperienceListItem) => (
            store.eduData.get(item.master.id) || buildEduCardData(item)
        ),
        [store.eduData]
    );

    return {
        educations,
        sortedEducations,
        isLoading,
        isCreating: createActions.isCreating,
        eduData: store.eduData,
        modifiedEduCards: store.modifiedEduCards,
        expandedEduCards: expansion.expandedEduCards,
        collapsingEduCards: expansion.collapsingEduCards,
        savingEduIds: saveActions.savingEduIds,
        deletingEduId: deleteActions.deletingEduId,
        getEduCardData,
        buildDateLabel: buildEducationDateLabel,
        setCardRef,
        updateEduField,
        toggleEduCard: expansion.toggleEduCard,
        handleAddEdu,
        handleSaveEdu,
        handleCancelEditEdu: editors.resetEduCard,
        requestDeleteEdu,
        handleConfirmDelete,
        handleCancelDelete: deleteActions.handleCancelDelete,
        refreshEducation,
        focusEduCard: expansion.focusEduCard,
    };
};
