import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type Dispatch,
    type SetStateAction,
} from 'react';
import { experienceService, type ExperienceListItem } from '../services/experienceService';
import { getTodayLocalISODate, parseYearMonthValue, runDedupedRefresh } from '../views/experienceUtils';
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
        updates: { message?: string; type?: 'success' | 'error' | 'loading'; duration?: number }
    ) => void;
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
    refreshEducation: () => Promise<ExperienceListItem[]>;
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

const useEducationList = () => {
    const initialEducationRef = useRef<ExperienceListItem[] | null>(
        experienceService.peekList(EDU_CATEGORY)
    );
    const [educations, setEducations] = useState<ExperienceListItem[]>(
        () => initialEducationRef.current ?? []
    );
    const [isLoading, setIsLoading] = useState(
        () => !initialEducationRef.current
    );
    const refreshInFlightRef = useRef<Promise<ExperienceListItem[]> | null>(null);
    const hasLoadedRef = useRef(false);

    const refreshEducation = useCallback(async () => {
        return runDedupedRefresh(refreshInFlightRef, async () => {
            const data = await experienceService.list(EDU_CATEGORY, { force: true });
            setEducations(data);
            return data;
        });
    }, []);

    useEffect(() => {
        const loadEducationExperiences = async () => {
            if (hasLoadedRef.current) return;
            try {
                if (!initialEducationRef.current?.length) {
                    setIsLoading(true);
                }
                hasLoadedRef.current = true;
                const data = await experienceService.list(EDU_CATEGORY);
                setEducations(data);
            } catch (error) {
                console.error('[EducationManager] 加载教育经历失败:', error);
                hasLoadedRef.current = false;
            } finally {
                setIsLoading(false);
            }
        };
        loadEducationExperiences();
    }, []);

    return { educations, setEducations, isLoading, refreshEducation };
};

const useEducationCardRefs = () => {
    const eduCardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

    const setCardRef = useCallback((eduId: string, element: HTMLDivElement | null) => {
        if (element) {
            eduCardRefs.current.set(eduId, element);
        } else {
            eduCardRefs.current.delete(eduId);
        }
    }, []);

    const scrollToCard = useCallback((eduId: string, delay: number) => {
        setTimeout(() => {
            const element = eduCardRefs.current.get(eduId);
            if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, delay);
    }, []);

    return { setCardRef, scrollToCard };
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
    scrollToCard: (eduId: string, delay: number) => void
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
                    // 收起动画结束后再滚动，避免位置跳动。
                    setTimeout(() => {
                        setCollapsingEduCards((current) => removeFromSet(current, eduId));
                        scrollToCard(eduId, EDU_SCROLL_COLLAPSE_DELAY_MS);
                    }, EDU_COLLAPSE_DURATION_MS);
                } else {
                    next.add(eduId);
                    ensureEduCardState(eduId, seedData);
                    scrollToCard(eduId, EDU_SCROLL_EXPAND_DELAY_MS);
                }
                return next;
            });
        },
        [ensureEduCardState, scrollToCard]
    );

    const removeEduExpansion = useCallback((eduId: string) => {
        setExpandedEduCards((prev) => removeFromSet(prev, eduId));
        setCollapsingEduCards((prev) => removeFromSet(prev, eduId));
    }, []);

    return { expandedEduCards, collapsingEduCards, toggleEduCard, removeEduExpansion };
};

const useEducationCreate = (
    toast: EducationToastApi,
    refreshEducation: () => Promise<ExperienceListItem[]>,
    setEducations: Dispatch<SetStateAction<ExperienceListItem[]>>,
    setEduData: Dispatch<SetStateAction<Map<string, EduCardData>>>,
    setOriginalEduData: Dispatch<SetStateAction<Map<string, EduCardData>>>,
    setModifiedEduCards: Dispatch<SetStateAction<Set<string>>>,
    toggleEduCard: (eduId: string, seedData?: EduCardData) => void
) => {
    const [isCreating, setIsCreating] = useState(false);

    const handleAddEdu = useCallback(async () => {
        if (isCreating) {
            return;
        }
        let toastId: string | null = null;
        try {
            setIsCreating(true);
            toastId = toast.loading(EDU_TOAST_MESSAGES.createLoading);
            const newEducation = await experienceService.create({
                category: EDU_CATEGORY,
                version: {
                    title: EDUCATION_DEFAULTS.title,
                    org: EDUCATION_DEFAULTS.org,
                    start_date: getTodayLocalISODate(),
                    star: {},
                },
            });

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
            refreshEducation().catch((err) => {
                console.error('[EducationManager] 刷新教育经历失败:', err);
            });
        } catch (err) {
            console.error('[EducationManager] 创建教育经历失败:', err);
            if (toastId) {
                toast.updateToast(toastId, { message: EDU_TOAST_MESSAGES.createError, type: 'error', duration: EDU_TOAST_DURATION_MS });
            } else {
                toast.error(EDU_TOAST_MESSAGES.createError);
            }
        } finally {
            setIsCreating(false);
        }
    }, [
        isCreating,
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
    refreshEducation: () => Promise<ExperienceListItem[]>,
    eduData: Map<string, EduCardData>,
    setEducations: Dispatch<SetStateAction<ExperienceListItem[]>>,
    setEduData: Dispatch<SetStateAction<Map<string, EduCardData>>>,
    setOriginalEduData: Dispatch<SetStateAction<Map<string, EduCardData>>>,
    setModifiedEduCards: Dispatch<SetStateAction<Set<string>>>,
    toggleEduCard: (eduId: string) => void
) => {
    const [savingEduIds, setSavingEduIds] = useState<Set<string>>(new Set());

    const handleSaveEdu = useCallback(async (eduId: string) => {
        const data = eduData.get(eduId);
        if (!data || savingEduIds.has(eduId)) {
            return;
        }
        const normalized = normalizeEduData(data);
        if (!normalized.school || !normalized.major) {
            toast.error('学校和专业不能为空');
            return;
        }

        let toastId: string | null = null;
        try {
            setSavingEduIds((prev) => addToSet(prev, eduId));
            toastId = toast.loading(EDU_TOAST_MESSAGES.saveLoading);
            const versionPayload = buildEduVersionPayload(normalized);
            await experienceService.update(eduId, { version: versionPayload });

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
            refreshEducation().catch((err) => {
                console.error('[EducationManager] 刷新教育经历失败:', err);
            });
        } catch (err) {
            console.error('[EducationManager] 保存教育经历失败:', err);
            if (toastId) {
                toast.updateToast(toastId, { message: EDU_TOAST_MESSAGES.saveError, type: 'error', duration: EDU_TOAST_DURATION_MS });
            } else {
                toast.error(EDU_TOAST_MESSAGES.saveError);
            }
        } finally {
            setSavingEduIds((prev) => removeFromSet(prev, eduId));
        }
    }, [
        eduData,
        refreshEducation,
        savingEduIds,
        setEducations,
        setEduData,
        setModifiedEduCards,
        setOriginalEduData,
        toast,
        toggleEduCard,
    ]);

    return { savingEduIds, handleSaveEdu };
};

const useEducationDelete = (
    toast: EducationToastApi,
    refreshEducation: () => Promise<ExperienceListItem[]>,
    savingEduIds: Set<string>,
    setEducations: Dispatch<SetStateAction<ExperienceListItem[]>>,
    setEduData: Dispatch<SetStateAction<Map<string, EduCardData>>>,
    setOriginalEduData: Dispatch<SetStateAction<Map<string, EduCardData>>>,
    setModifiedEduCards: Dispatch<SetStateAction<Set<string>>>,
    removeEduExpansion: (eduId: string) => void,
    scrollToCard: (eduId: string, delay: number) => void
) => {
    const [deletingEduId, setDeletingEduId] = useState<string | null>(null);

    const requestDeleteEdu = useCallback((eduId: string) => {
        setDeletingEduId(eduId);
        scrollToCard(eduId, 0);
    }, [scrollToCard]);

    const handleConfirmDelete = useCallback(async () => {
        if (!deletingEduId || savingEduIds.has(deletingEduId)) {
            return;
        }
        let toastId: string | null = null;
        const eduId = deletingEduId;
        try {
            toastId = toast.loading(EDU_TOAST_MESSAGES.deleteLoading);
            setDeletingEduId(null);
            setEducations((prev) => prev.filter((edu) => edu.master.id !== eduId));
            setEduData((prev) => deleteMapEntry(prev, eduId));
            setOriginalEduData((prev) => deleteMapEntry(prev, eduId));
            setModifiedEduCards((prev) => removeFromSet(prev, eduId));
            removeEduExpansion(eduId);

            await experienceService.delete(eduId);
            if (toastId) {
                toast.updateToast(toastId, { message: EDU_TOAST_MESSAGES.deleteSuccess, type: 'success', duration: EDU_TOAST_DURATION_MS });
            } else {
                toast.success(EDU_TOAST_MESSAGES.deleteSuccess);
            }
            refreshEducation().catch((err) => {
                console.error('[EducationManager] 刷新教育经历失败:', err);
            });
        } catch (err) {
            console.error('[EducationManager] 删除教育经历失败:', err);
            if (toastId) {
                toast.updateToast(toastId, { message: EDU_TOAST_MESSAGES.deleteError, type: 'error', duration: EDU_TOAST_DURATION_MS });
            } else {
                toast.error(EDU_TOAST_MESSAGES.deleteError);
            }
            refreshEducation().catch((err2) => {
                console.error('[EducationManager] 恢复教育经历失败:', err2);
            });
        }
    }, [
        deletingEduId,
        refreshEducation,
        removeEduExpansion,
        savingEduIds,
        setEducations,
        setEduData,
        setModifiedEduCards,
        setOriginalEduData,
        toast,
    ]);

    const handleCancelDelete = useCallback(() => setDeletingEduId(null), []);

    return { deletingEduId, requestDeleteEdu, handleConfirmDelete, handleCancelDelete };
};

/**
 * 统一管理教育经历的列表与编辑状态，避免 ExperienceBank 内部堆积状态与副作用。
 */
export const useEducationManager = (toast: EducationToastApi): EducationManager => {
    const { educations, setEducations, isLoading, refreshEducation } = useEducationList();
    const { setCardRef, scrollToCard } = useEducationCardRefs();
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
    const expansion = useEducationExpansion(ensureEduCardState, scrollToCard);
    const createActions = useEducationCreate(
        toast,
        refreshEducation,
        setEducations,
        store.setEduData,
        store.setOriginalEduData,
        store.setModifiedEduCards,
        expansion.toggleEduCard
    );
    const saveActions = useEducationSave(
        toast,
        refreshEducation,
        store.eduData,
        setEducations,
        store.setEduData,
        store.setOriginalEduData,
        store.setModifiedEduCards,
        expansion.toggleEduCard
    );
    const deleteActions = useEducationDelete(
        toast,
        refreshEducation,
        saveActions.savingEduIds,
        setEducations,
        store.setEduData,
        store.setOriginalEduData,
        store.setModifiedEduCards,
        expansion.removeEduExpansion,
        scrollToCard
    );

    const sortedEducations = useMemo(
        () => buildSortedEducations(educations),
        [educations]
    );

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
        updateEduField: editors.updateEduField,
        toggleEduCard: expansion.toggleEduCard,
        handleAddEdu: createActions.handleAddEdu,
        handleSaveEdu: saveActions.handleSaveEdu,
        handleCancelEditEdu: editors.resetEduCard,
        requestDeleteEdu: deleteActions.requestDeleteEdu,
        handleConfirmDelete: deleteActions.handleConfirmDelete,
        handleCancelDelete: deleteActions.handleCancelDelete,
        refreshEducation,
    };
};
