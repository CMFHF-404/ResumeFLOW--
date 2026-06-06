import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type Dispatch,
    type MutableRefObject,
    type SetStateAction,
} from 'react';
import { useDebounce } from '../components/hooks/useDebounce';
import { resolveAuthUserKeyFromActiveSession } from '../services/apiClient';
import { certificationsService, Certification as CertificationRecord } from '../services/certificationsService';
import { experienceService, ExperienceListItem } from '../services/experienceService';
import { profileService, Profile } from '../services/profileService';
import {
    loadJDAnalysisCache,
    normalizeJDAnalysisPersistence,
    selectPreferredPersistedJDAnalysis,
} from '../views/jdAnalysisStorage';
import {
    resumeService,
    ResumeDetail,
    ResumeExperienceItem,
    Resume,
} from '../services/resumeService';
import { skillsService, UserSkill } from '../services/skillsService';
import { UNTITLED_RESUME_TITLE } from '../constants/resumeConstants';
import {
    buildPreferredResumeCreateConfig,
    syncResumeTemplatePresetsFromProfile,
} from '../views/resumeTemplateStorage';
import {
    useCertificationStateApplier,
    useEducationStateApplier,
    useExperienceStateApplier,
    useResumeConfigApplier,
    useSkillStateApplier,
} from './useResumeDataAppliers';
import type {
    ActiveResumeContext,
    CachedResumeResolveResult,
    ProfileSyncMode,
    ResumeEditorConfig,
    ResumeEditorProfile,
    ResumeExperienceView,
    EducationView,
    CertificationView,
    SkillGroupView,
} from '../types/resume';
import { clearActiveResumeId, getActiveResumeId, setActiveResumeId } from '../views/resumeStorage';

type ExperienceBuilder = (item: ExperienceListItem, resumeItem?: ResumeExperienceItem) => ResumeExperienceView;
type EducationBuilder = (item: ExperienceListItem) => EducationView;
type CertificationBuilder = (item: CertificationRecord) => CertificationView;
type SkillGroupBuilder = (skills: UserSkill[]) => SkillGroupView[];
type SelectionResolver = (ids?: string[]) => Set<string>;
type SectionOrderNormalizer = (order?: string[]) => string[];
type ProfileSyncResolver = (config?: ResumeEditorConfig, profile?: Profile | null) => ProfileSyncMode;
type ProfileSnapshotResolver = (config?: ResumeEditorConfig, profile?: Profile | null) => ResumeEditorProfile;
type ReloadedResumeContext = {
    profile: ResumeEditorProfile;
    profileSyncMode: ProfileSyncMode;
};
type ReloadResumeContextSuccessResult = {
    status: 'success';
    resumeId: string;
    context: ReloadedResumeContext;
};
type ReloadResumeContextFailureResult = {
    status: 'failed';
    reason: 'missing_active_resume' | 'load_error';
    requestedId: string | null;
    error?: unknown;
};
type ReloadResumeContextResult = ReloadResumeContextSuccessResult | ReloadResumeContextFailureResult;

type UseResumeDataOptions = {
    configSnapshot: ResumeEditorConfig;
    persistedJDAnalysisSnapshot?: ResumeEditorConfig['jdAnalysis'] | null;
    autoSaveDelayMs: number;
    isAutoSavePaused?: boolean;
    authUserKey?: string | null;
    setProfile: Dispatch<SetStateAction<ResumeEditorProfile>>;
    setPersonalSummary: Dispatch<SetStateAction<string>>;
    setHasPersonalSummaryOverride: Dispatch<SetStateAction<boolean>>;
    setProfileSyncMode: Dispatch<SetStateAction<ProfileSyncMode>>;
    setProfileSocialLinks: Dispatch<SetStateAction<Record<string, any>>>;
    setSectionOrder: Dispatch<SetStateAction<string[]>>;
    setDensity: Dispatch<SetStateAction<'compact' | 'standard' | 'spacious'>>;
    setIsSummaryVisible: Dispatch<SetStateAction<boolean>>;
    applyLayoutConfig: (config: ResumeEditorConfig) => void;
    setExperienceItems: Dispatch<SetStateAction<ResumeExperienceView[]>>;
    setSelectedExpIds: Dispatch<SetStateAction<Set<string>>>;
    setEducations: Dispatch<SetStateAction<EducationView[]>>;
    setEducationSourceMap: Dispatch<SetStateAction<Map<string, ExperienceListItem>>>;
    setSelectedEduIds: Dispatch<SetStateAction<Set<string>>>;
    setCertifications: Dispatch<SetStateAction<CertificationView[]>>;
    setCertificationSourceMap: Dispatch<SetStateAction<Map<string, CertificationRecord>>>;
    setSelectedCertIds: Dispatch<SetStateAction<Set<string>>>;
    setSkillGroups: Dispatch<SetStateAction<SkillGroupView[]>>;
    setSelectedSkillIds: Dispatch<SetStateAction<Set<string>>>;
    buildResumeExperienceMap: (detail: ResumeDetail | null) => Map<string, ResumeExperienceItem>;
    buildSourceMap: (items: ExperienceListItem[]) => Map<string, ExperienceListItem>;
    buildResumeExperienceView: ExperienceBuilder;
    buildEducationView: EducationBuilder;
    buildCertificationView: CertificationBuilder;
    buildSkillGroups: SkillGroupBuilder;
    resolveSelectionSet: SelectionResolver;
    normalizeSectionOrder: SectionOrderNormalizer;
    resolveProfileSyncMode: ProfileSyncResolver;
    resolveProfileSnapshot: ProfileSnapshotResolver;
    sortByCategory: (
        items: ResumeExperienceView[],
        compare: (a: ResumeExperienceView, b: ResumeExperienceView) => number
    ) => ResumeExperienceView[];
    compareByDateDesc: (a: ResumeExperienceView, b: ResumeExperienceView) => number;
    compareCertificationByDateDesc: (a: CertificationView, b: CertificationView) => number;
};

type UseResumeDataResult = {
    resumeId: string | null;
    resumeDetail: ResumeDetail | null;
    resumeExperienceMap: Map<string, ResumeExperienceItem>;
    experienceSourceMap: Map<string, ExperienceListItem>;
    setResumeExperienceMap: Dispatch<SetStateAction<Map<string, ResumeExperienceItem>>>;
    setExperienceSourceMap: Dispatch<SetStateAction<Map<string, ExperienceListItem>>>;
    isLoadingResume: boolean;
    isLoadingExperiences: boolean;
    saveState: 'idle' | 'dirty' | 'saving' | 'saved' | 'error';
    lastSavedAt: string | null;
    applyResumeDetail: (detail: ResumeDetail | null) => void;
    flushResumeConfig: (configOverride?: ResumeEditorConfig) => Promise<void>;
    reloadResumeContext: (resumeId?: string | null) => Promise<ReloadResumeContextResult>;
    suppressAutoSaveForConfig: (config: ResumeEditorConfig) => void;
    clearSuppressedAutoSave: () => void;
};

type ResumeState = {
    resumeId: string | null;
    setResumeId: Dispatch<SetStateAction<string | null>>;
    resumeDetail: ResumeDetail | null;
    setResumeDetail: Dispatch<SetStateAction<ResumeDetail | null>>;
    resumeExperienceMap: Map<string, ResumeExperienceItem>;
    setResumeExperienceMap: Dispatch<SetStateAction<Map<string, ResumeExperienceItem>>>;
    experienceSourceMap: Map<string, ExperienceListItem>;
    setExperienceSourceMap: Dispatch<SetStateAction<Map<string, ExperienceListItem>>>;
    isLoadingResume: boolean;
    setIsLoadingResume: Dispatch<SetStateAction<boolean>>;
    isLoadingExperiences: boolean;
    setIsLoadingExperiences: Dispatch<SetStateAction<boolean>>;
    saveState: 'idle' | 'dirty' | 'saving' | 'saved' | 'error';
    setSaveState: Dispatch<SetStateAction<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>>;
    lastSavedAt: string | null;
    setLastSavedAt: Dispatch<SetStateAction<string | null>>;
    latestSaveStateRef: MutableRefObject<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>;
    latestLastSavedAtRef: MutableRefObject<string | null>;
    lastSavedConfigRef: MutableRefObject<string | null>;
    hasHydratedConfigRef: MutableRefObject<boolean>;
    shouldWaitForDebouncedConfigRef: MutableRefObject<boolean>;
    suppressedAutoSaveSignatureRef: MutableRefObject<string | null>;
};

const resolveCachedResume = async (cachedId: string): Promise<CachedResumeResolveResult> => {
    try {
        const detail = await resumeService.get(cachedId);
        return { status: 'ok', detail };
    } catch (error) {
        const status =
            typeof error === 'object' && error
                ? (error as { response?: { status?: number } }).response?.status
                : undefined;
        if (status === 404) {
            return { status: 'missing' };
        }
        return { status: 'error' };
    }
};

const ensureActiveResumeId = async (
    resumes: Resume[],
    authUserKey?: string | null
): Promise<string> => {
    if (resumes.length > 0) {
        setActiveResumeId(resumes[0].id);
        return resumes[0].id;
    }
    const profile = await profileService.getProfile().catch(() => profileService.peekProfileForCurrentUser());
    const ownerId = profile?.user_id ?? authUserKey ?? await resolveAuthUserKeyFromActiveSession();
    const created = await resumeService.create({
        title: UNTITLED_RESUME_TITLE,
        config: buildPreferredResumeCreateConfig(
            profile?.extra_json,
            ownerId
        ),
    });
    setActiveResumeId(created.id);
    return created.id;
};

const resolveActiveResumeContext = async (
    authUserKey?: string | null
): Promise<ActiveResumeContext> => {
    const cachedId = getActiveResumeId();
    if (cachedId) {
        const cached = await resolveCachedResume(cachedId);
        if (cached.status === 'ok') {
            return { id: cachedId, detail: cached.detail };
        }
        if (cached.status === 'missing') {
            clearActiveResumeId();
            const resumes = await resumeService.list({ force: true });
            const id = await ensureActiveResumeId(resumes, authUserKey);
            return { id, detail: null };
        }
        return { id: cachedId, detail: null };
    }
    const resumes = await resumeService.list();
    const id = await ensureActiveResumeId(resumes, authUserKey);
    return { id, detail: null };
};

const resolveRequestedResumeContext = async (
    requestedId?: string | null,
    authUserKey?: string | null
): Promise<ActiveResumeContext> => {
    if (requestedId) {
        return { id: requestedId, detail: null };
    }
    return resolveActiveResumeContext(authUserKey);
};

const fetchExperiences = async () => {
    const [workItems, projectItems] = await Promise.all([
        experienceService.list('work'),
        experienceService.list('project'),
    ]);
    return [...workItems, ...projectItems];
};

const fetchEducationExperiences = async () => experienceService.list('education');
const fetchCertifications = async () => certificationsService.list();
const fetchSkills = async () => skillsService.list();

const readCachedExperiences = async () => {
    const cachedAll = await experienceService.peekListForCurrentUser(undefined, { allowStale: true });
    if (cachedAll !== null) {
        return cachedAll;
    }
    const [cachedWork, cachedProject] = await Promise.all([
        experienceService.peekListForCurrentUser('work', { allowStale: true }),
        experienceService.peekListForCurrentUser('project', { allowStale: true }),
    ]);
    if (cachedWork === null || cachedProject === null) {
        return null;
    }
    return [
        ...cachedWork,
        ...cachedProject,
    ];
};

const readCachedEducationExperiences = async () => (
    experienceService.peekListForCurrentUser('education', { allowStale: true })
);

const readCachedCertifications = async () => (
    certificationsService.peekListForCurrentUser({ allowStale: true })
);

const readCachedSkills = async () => (
    skillsService.peekListForCurrentUser({ allowStale: true })
);

const loadWithFallback = async <T,>(
    label: string,
    loader: () => Promise<T>,
    fallback: () => Promise<T | null> | T | null
): Promise<T> => {
    try {
        return await loader();
    } catch (error) {
        const cached = await fallback();
        if (cached !== null) {
            console.error(`[ResumeEditor] 加载${label}失败，使用缓存兜底:`, error);
            return cached;
        }
        throw error;
    }
};

const updateLastSavedRef = (
    signatureRef: MutableRefObject<string | null>,
    signature: string
) => {
    signatureRef.current = signature;
};

const mergeResumeRecordIntoDetail = (
    detail: ResumeDetail | null,
    updatedResume: Resume
) => {
    if (!detail || detail.resume.id !== updatedResume.id) {
        return detail;
    }
    return {
        ...detail,
        resume: {
            ...detail.resume,
            ...updatedResume,
        },
    };
};

const buildEffectiveConfigSnapshot = (
    configSnapshot: ResumeEditorConfig,
    persistedJDAnalysisSnapshot: ResumeEditorConfig['jdAnalysis'] | null | undefined,
    resumeId: string | null,
    resumeDetail: ResumeDetail | null
): ResumeEditorConfig => {
    if (persistedJDAnalysisSnapshot !== undefined) {
        return configSnapshot;
    }
    const backendPersistedJDAnalysis = normalizeJDAnalysisPersistence(
        (resumeDetail?.resume?.config as ResumeEditorConfig | undefined)?.jdAnalysis
    );
    const selectedPersistedJDAnalysis = selectPreferredPersistedJDAnalysis(
        backendPersistedJDAnalysis,
        resumeId ? loadJDAnalysisCache(resumeId) : null
    )?.payload;
    if (!selectedPersistedJDAnalysis) {
        return configSnapshot;
    }
    return {
        ...configSnapshot,
        jdAnalysis: selectedPersistedJDAnalysis,
    };
};

const useResumeContextLoader = (
    state: ResumeState,
    applyResumeConfig: (config: ResumeEditorConfig, profileData?: Profile | null) => void,
    applyExperienceState: (detail: ResumeDetail | null, items: ExperienceListItem[], config: ResumeEditorConfig) => void,
    applyEducationState: (items: ExperienceListItem[], config: ResumeEditorConfig) => void,
    applyCertificationState: (items: CertificationRecord[], config: ResumeEditorConfig) => void,
    applySkillState: (items: UserSkill[], config: ResumeEditorConfig) => void,
    resolveProfileSyncMode: ProfileSyncResolver,
    resolveProfileSnapshot: ProfileSnapshotResolver,
    authUserKey?: string | null
) => {
    const {
        setIsLoadingResume,
        setIsLoadingExperiences,
        setResumeId,
        setSaveState,
        setLastSavedAt,
        latestSaveStateRef,
        latestLastSavedAtRef,
        hasHydratedConfigRef,
        lastSavedConfigRef,
        shouldWaitForDebouncedConfigRef,
    } = state;
    const reloadQueueRef = useRef<Promise<void>>(Promise.resolve());
    const performReloadResumeContext = useCallback(
        async (requestedId?: string | null): Promise<ReloadResumeContextResult> => {
            const previousHydrated = hasHydratedConfigRef.current;
            const previousSaveState = latestSaveStateRef.current;
            const previousLastSavedAt = latestLastSavedAtRef.current;
            setIsLoadingResume(true);
            setIsLoadingExperiences(true);
            hasHydratedConfigRef.current = false;
            shouldWaitForDebouncedConfigRef.current = true;
            setSaveState('idle');
            setLastSavedAt(null);
            try {
                const { id: activeId, detail: cachedDetail } = await resolveRequestedResumeContext(
                    requestedId,
                    authUserKey
                );
                if (!activeId) {
                    return {
                        status: 'failed',
                        reason: 'missing_active_resume',
                        requestedId: requestedId ?? null,
                    };
                }
                const [
                    detail,
                    profileData,
                    experiences,
                    educationExperiences,
                    certifications,
                    skills,
                ] = await Promise.all([
                    cachedDetail ?? resumeService.get(activeId),
                    profileService.getProfile().catch(() => null),
                    loadWithFallback('经历列表', fetchExperiences, readCachedExperiences),
                    loadWithFallback('教育经历列表', fetchEducationExperiences, readCachedEducationExperiences),
                    loadWithFallback('证书列表', fetchCertifications, readCachedCertifications),
                    loadWithFallback('技能列表', fetchSkills, readCachedSkills),
                ]);
                syncResumeTemplatePresetsFromProfile(profileData?.extra_json, profileData?.user_id);
                const config = (detail?.resume?.config || {}) as ResumeEditorConfig;
                const resolvedProfileSyncMode = resolveProfileSyncMode(config, profileData || undefined);
                const resolvedProfile = resolveProfileSnapshot(config, profileData || undefined);
                applyResumeConfig(config, profileData);
                applyExperienceState(detail, experiences, config);
                applyEducationState(educationExperiences, config);
                applyCertificationState(certifications, config);
                applySkillState(skills, config);
                updateLastSavedRef(lastSavedConfigRef, JSON.stringify(config));
                setActiveResumeId(activeId);
                setResumeId(activeId);
                setSaveState('saved');
                hasHydratedConfigRef.current = true;
                return {
                    status: 'success',
                    resumeId: activeId,
                    context: {
                        profile: resolvedProfile,
                        profileSyncMode: resolvedProfileSyncMode,
                    },
                };
            } catch (error) {
                console.error('[ResumeEditor] 加载简历上下文失败:', error);
                if (previousHydrated) {
                    hasHydratedConfigRef.current = true;
                    shouldWaitForDebouncedConfigRef.current = false;
                    setSaveState(previousSaveState);
                    setLastSavedAt(previousLastSavedAt);
                } else {
                    setSaveState('error');
                }
                return {
                    status: 'failed',
                    reason: 'load_error',
                    requestedId: requestedId ?? null,
                    error,
                };
            } finally {
                setIsLoadingResume(false);
                setIsLoadingExperiences(false);
            }
        },
        [
            authUserKey,
            applyCertificationState,
            applyEducationState,
            applyExperienceState,
            applyResumeConfig,
            applySkillState,
            hasHydratedConfigRef,
            lastSavedConfigRef,
            latestLastSavedAtRef,
            latestSaveStateRef,
            resolveProfileSnapshot,
            resolveProfileSyncMode,
            setIsLoadingExperiences,
            setIsLoadingResume,
            setLastSavedAt,
            setResumeId,
            setSaveState,
            shouldWaitForDebouncedConfigRef,
        ]
    );
    const reloadResumeContext = useCallback(
        (requestedId?: string | null) => {
            const queuedReload = reloadQueueRef.current
                .catch(() => undefined)
                .then(() => performReloadResumeContext(requestedId));
            reloadQueueRef.current = queuedReload.then(() => undefined, () => undefined);
            return queuedReload;
        },
        [performReloadResumeContext]
    );

    useEffect(() => {
        void reloadResumeContext();
    }, [reloadResumeContext]);

    return reloadResumeContext;
};

const useResumeState = (): ResumeState => {
    const [resumeId, setResumeId] = useState<string | null>(null);
    const [resumeDetail, setResumeDetail] = useState<ResumeDetail | null>(null);
    const [resumeExperienceMap, setResumeExperienceMap] = useState<Map<string, ResumeExperienceItem>>(
        new Map()
    );
    const [experienceSourceMap, setExperienceSourceMap] = useState<Map<string, ExperienceListItem>>(
        new Map()
    );
    const [isLoadingExperiences, setIsLoadingExperiences] = useState(true);
    const [isLoadingResume, setIsLoadingResume] = useState(true);
    const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle');
    const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
    const latestSaveStateRef = useRef<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle');
    const latestLastSavedAtRef = useRef<string | null>(null);
    const lastSavedConfigRef = useRef<string | null>(null);
    const hasHydratedConfigRef = useRef(false);
    const shouldWaitForDebouncedConfigRef = useRef(true);
    const suppressedAutoSaveSignatureRef = useRef<string | null>(null);

    return {
        resumeId,
        setResumeId,
        resumeDetail,
        setResumeDetail,
        resumeExperienceMap,
        setResumeExperienceMap,
        experienceSourceMap,
        setExperienceSourceMap,
        isLoadingResume,
        setIsLoadingResume,
        isLoadingExperiences,
        setIsLoadingExperiences,
        saveState,
        setSaveState,
        lastSavedAt,
        setLastSavedAt,
        latestSaveStateRef,
        latestLastSavedAtRef,
        lastSavedConfigRef,
        hasHydratedConfigRef,
        shouldWaitForDebouncedConfigRef,
        suppressedAutoSaveSignatureRef,
    };
};

const useResumeAutoSave = (
    resumeId: string | null,
    configSnapshot: ResumeEditorConfig,
    autoSaveDelayMs: number,
    isAutoSavePaused: boolean,
    saveState: ResumeState['saveState'],
    setSaveState: ResumeState['setSaveState'],
    setLastSavedAt: ResumeState['setLastSavedAt'],
    setResumeDetail: ResumeState['setResumeDetail'],
    lastSavedConfigRef: MutableRefObject<string | null>,
    hasHydratedConfigRef: MutableRefObject<boolean>,
    shouldWaitForDebouncedConfigRef: MutableRefObject<boolean>,
    suppressedAutoSaveSignatureRef: MutableRefObject<string | null>
) => {
    const debouncedConfig = useDebounce(configSnapshot, autoSaveDelayMs);
    const debouncedConfigSignature = useMemo(
        () => JSON.stringify(debouncedConfig),
        [debouncedConfig]
    );
    const configSignature = useMemo(
        () => JSON.stringify(configSnapshot),
        [configSnapshot]
    );
    const saveSessionRef = useRef(0);

    useEffect(() => {
        saveSessionRef.current += 1;
    }, [resumeId]);

    useEffect(() => {
        if (
            suppressedAutoSaveSignatureRef.current
            && configSignature !== suppressedAutoSaveSignatureRef.current
        ) {
            suppressedAutoSaveSignatureRef.current = null;
        }
        if (!hasHydratedConfigRef.current || isAutoSavePaused) {
            return;
        }
        if (lastSavedConfigRef.current === null) {
            updateLastSavedRef(lastSavedConfigRef, configSignature);
            setSaveState('saved');
        } else if (configSignature !== lastSavedConfigRef.current && saveState !== 'saving') {
            setSaveState('dirty');
        } else if (configSignature === lastSavedConfigRef.current && saveState !== 'saving') {
            setSaveState('saved');
        }
    }, [
        configSignature,
        saveState,
        lastSavedConfigRef,
        setSaveState,
        hasHydratedConfigRef,
        isAutoSavePaused,
        suppressedAutoSaveSignatureRef,
    ]);

    useEffect(() => {
        if (!resumeId || !hasHydratedConfigRef.current) {
            return;
        }
        if (shouldWaitForDebouncedConfigRef.current) {
            if (debouncedConfigSignature !== configSignature) {
                return;
            }
            shouldWaitForDebouncedConfigRef.current = false;
        }
        if (debouncedConfigSignature === suppressedAutoSaveSignatureRef.current) {
            return;
        }
        if (debouncedConfigSignature === lastSavedConfigRef.current) {
            return;
        }
        const sessionId = saveSessionRef.current;
        setSaveState('saving');
        resumeService
            .update(resumeId, { config: debouncedConfig })
            .then((updatedResume) => {
                if (sessionId !== saveSessionRef.current) {
                    return;
                }
                setResumeDetail((prev) => mergeResumeRecordIntoDetail(prev, updatedResume));
                updateLastSavedRef(lastSavedConfigRef, debouncedConfigSignature);
                setSaveState('saved');
                setLastSavedAt(new Date().toLocaleTimeString());
            })
            .catch((error) => {
                if (sessionId !== saveSessionRef.current) {
                    return;
                }
                console.error('[ResumeEditor] 自动保存失败:', error);
                setSaveState('error');
            });
    }, [
        debouncedConfig,
        debouncedConfigSignature,
        resumeId,
        setLastSavedAt,
        setResumeDetail,
        setSaveState,
        lastSavedConfigRef,
        hasHydratedConfigRef,
        isAutoSavePaused,
        configSignature,
        shouldWaitForDebouncedConfigRef,
        suppressedAutoSaveSignatureRef,
    ]);
};

const useResumeConfigFlusher = (
    resumeId: string | null,
    configSnapshot: ResumeEditorConfig,
    setSaveState: ResumeState['setSaveState'],
    setLastSavedAt: ResumeState['setLastSavedAt'],
    setResumeDetail: ResumeState['setResumeDetail'],
    lastSavedConfigRef: MutableRefObject<string | null>,
    hasHydratedConfigRef: MutableRefObject<boolean>
) => {
    return useCallback(async (configOverride?: ResumeEditorConfig) => {
        if (!resumeId || !hasHydratedConfigRef.current) {
            return;
        }
        const nextConfig = configOverride ?? configSnapshot;
        const configSignature = JSON.stringify(nextConfig);
        if (configSignature === lastSavedConfigRef.current) {
            return;
        }
        setSaveState('saving');
        try {
            const updatedResume = await resumeService.update(resumeId, { config: nextConfig });
            setResumeDetail((prev) => mergeResumeRecordIntoDetail(prev, updatedResume));
            updateLastSavedRef(lastSavedConfigRef, configSignature);
            setSaveState('saved');
            setLastSavedAt(new Date().toLocaleTimeString());
        } catch (error) {
            console.error('[ResumeEditor] 手动保存当前简历失败:', error);
            setSaveState('error');
            throw error;
        }
    }, [
        configSnapshot,
        hasHydratedConfigRef,
        lastSavedConfigRef,
        resumeId,
        setLastSavedAt,
        setResumeDetail,
        setSaveState,
    ]);
};


export const useResumeData = (options: UseResumeDataOptions): UseResumeDataResult => {
    const state = useResumeState();
    useEffect(() => {
        state.latestSaveStateRef.current = state.saveState;
        state.latestLastSavedAtRef.current = state.lastSavedAt;
    }, [state.lastSavedAt, state.latestLastSavedAtRef, state.latestSaveStateRef, state.saveState]);
    const applyResumeDetail = useCallback(
        (detail: ResumeDetail | null) => {
            state.setResumeDetail(detail);
            state.setResumeExperienceMap(options.buildResumeExperienceMap(detail));
        },
        [
            options.buildResumeExperienceMap,
            state.setResumeDetail,
            state.setResumeExperienceMap,
        ]
    );

    const applyResumeConfig = useResumeConfigApplier(options);
    const applyExperienceState = useExperienceStateApplier(options, state, applyResumeDetail);
    const applyEducationState = useEducationStateApplier(options);
    const applyCertificationState = useCertificationStateApplier(options);
    const applySkillState = useSkillStateApplier(options);
    const reloadResumeContext = useResumeContextLoader(
        state,
        applyResumeConfig,
        applyExperienceState,
        applyEducationState,
        applyCertificationState,
        applySkillState,
        options.resolveProfileSyncMode,
        options.resolveProfileSnapshot,
        options.authUserKey
    );
    const effectiveConfigSnapshot = useMemo(
        () => buildEffectiveConfigSnapshot(
            options.configSnapshot,
            options.persistedJDAnalysisSnapshot,
            state.resumeId,
            state.resumeDetail
        ),
        [
            options.configSnapshot,
            options.persistedJDAnalysisSnapshot,
            state.resumeId,
            state.resumeDetail,
        ]
    );
    useResumeAutoSave(
        state.resumeId,
        effectiveConfigSnapshot,
        options.autoSaveDelayMs,
        options.isAutoSavePaused ?? false,
        state.saveState,
        state.setSaveState,
        state.setLastSavedAt,
        state.setResumeDetail,
        state.lastSavedConfigRef,
        state.hasHydratedConfigRef,
        state.shouldWaitForDebouncedConfigRef,
        state.suppressedAutoSaveSignatureRef
    );
    const flushResumeConfig = useResumeConfigFlusher(
        state.resumeId,
        effectiveConfigSnapshot,
        state.setSaveState,
        state.setLastSavedAt,
        state.setResumeDetail,
        state.lastSavedConfigRef,
        state.hasHydratedConfigRef
    );
    const suppressAutoSaveForConfig = useCallback((config: ResumeEditorConfig) => {
        state.suppressedAutoSaveSignatureRef.current = JSON.stringify(config);
    }, [state.suppressedAutoSaveSignatureRef]);
    const clearSuppressedAutoSave = useCallback(() => {
        state.suppressedAutoSaveSignatureRef.current = null;
    }, [state.suppressedAutoSaveSignatureRef]);

    return {
        resumeId: state.resumeId,
        resumeDetail: state.resumeDetail,
        resumeExperienceMap: state.resumeExperienceMap,
        experienceSourceMap: state.experienceSourceMap,
        setResumeExperienceMap: state.setResumeExperienceMap,
        setExperienceSourceMap: state.setExperienceSourceMap,
        isLoadingResume: state.isLoadingResume,
        isLoadingExperiences: state.isLoadingExperiences,
        saveState: state.saveState,
        lastSavedAt: state.lastSavedAt,
        applyResumeDetail,
        flushResumeConfig,
        reloadResumeContext,
        suppressAutoSaveForConfig,
        clearSuppressedAutoSave,
    };
};

