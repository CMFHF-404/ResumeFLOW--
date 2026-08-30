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
import { useDebounce } from './useDebounce';
import { isAuthContextChangedError } from '../services/apiClient';
import { certificationsService, Certification as CertificationRecord } from '../services/certificationsService';
import { experienceService, ExperienceListItem } from '../services/experienceService';
import { profileService, Profile } from '../services/profileService';
import {
    loadJDAnalysisCache,
    normalizeJDAnalysisPersistence,
    selectPreferredPersistedJDAnalysis,
} from '../services/jdAnalysisStorage';
import {
    resumeService,
    ResumeDetail,
    ResumeExperienceItem,
    Resume,
    ResumeAuthContextChangedError,
    assertResumeAuthContext,
    captureResumeAuthCacheKey,
    subscribeToResumeVersionConflicts,
    waitForResumeMutations,
} from '../services/resumeService';
import { skillsService, UserSkill } from '../services/skillsService';
import { UNTITLED_RESUME_TITLE } from '../constants/resumeConstants';
import {
    buildPreferredResumeCreateConfig,
    syncResumeTemplatePresetsFromProfile,
} from '../services/resumeTemplateStorage';
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
import { clearActiveResumeId, getActiveResumeId, setActiveResumeId } from '../services/resumeStorage';
import { readAuthSessionSnapshot } from '../services/authTokenProvider';
import {
    createResumeConfigSaveCoordinator,
    type ResumeConfigSaveOptions,
} from './resumeConfigSaveCoordinator';
import { mergeResumeSaveResultIntoDetail } from './resumeSaveResultUtils';

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
    hasResumeVersionConflict: boolean;
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
    activeResumeIdRef: MutableRefObject<string | null>;
    resumeUpdatedAtRef: MutableRefObject<string | undefined>;
};

type SaveResumeConfig = (
    config: ResumeEditorConfig,
    options?: ResumeConfigSaveOptions
) => Promise<void>;

const resolveCachedResume = async (
    cachedId: string,
    expectedAuthCacheKey: string
): Promise<CachedResumeResolveResult> => {
    try {
        const detail = await resumeService.get(cachedId, { expectedAuthCacheKey });
        await assertResumeAuthContext(expectedAuthCacheKey);
        return { status: 'ok', detail };
    } catch (error) {
        if (error instanceof ResumeAuthContextChangedError || isAuthContextChangedError(error)) {
            throw error;
        }
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
    expectedAuthCacheKey: string
): Promise<string> => {
    await assertResumeAuthContext(expectedAuthCacheKey);
    if (resumes.length > 0) {
        setActiveResumeId(expectedAuthCacheKey, resumes[0].id);
        return resumes[0].id;
    }
    let profile: Profile | null = null;
    try {
        profile = await profileService.getProfile({
            expectedAuthCacheKey,
        });
    } catch (error) {
        await assertResumeAuthContext(expectedAuthCacheKey);
        profile = await profileService.peekProfileForCurrentUser({ expectedAuthCacheKey });
        await assertResumeAuthContext(expectedAuthCacheKey);
    }
    const createPayload = {
        title: UNTITLED_RESUME_TITLE,
        config: buildPreferredResumeCreateConfig(
            profile?.extra_json,
            profile?.user_id ?? expectedAuthCacheKey
        ),
    };
    await assertResumeAuthContext(expectedAuthCacheKey);
    const created = await resumeService.create(createPayload, { expectedAuthCacheKey });
    await assertResumeAuthContext(expectedAuthCacheKey);
    setActiveResumeId(expectedAuthCacheKey, created.id);
    return created.id;
};

const resolveActiveResumeContext = async (
    authUserKey?: string | null
): Promise<ActiveResumeContext> => {
    const expectedAuthCacheKey = await captureResumeAuthCacheKey(authUserKey);
    const cachedId = getActiveResumeId(expectedAuthCacheKey);
    if (cachedId) {
        const cached = await resolveCachedResume(cachedId, expectedAuthCacheKey);
        if (cached.status === 'ok') {
            return { id: cachedId, detail: cached.detail };
        }
        if (cached.status === 'missing') {
            await assertResumeAuthContext(expectedAuthCacheKey);
            clearActiveResumeId(expectedAuthCacheKey);
            const resumes = await resumeService.list({
                force: true,
                expectedAuthCacheKey,
            });
            await assertResumeAuthContext(expectedAuthCacheKey);
            const id = await ensureActiveResumeId(resumes, expectedAuthCacheKey);
            return { id, detail: null };
        }
        return { id: cachedId, detail: null };
    }
    const resumes = await resumeService.list({ expectedAuthCacheKey });
    await assertResumeAuthContext(expectedAuthCacheKey);
    const id = await ensureActiveResumeId(resumes, expectedAuthCacheKey);
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

const fetchExperiences = async (expectedAuthCacheKey: string) => {
    const [workItems, projectItems] = await Promise.all([
        experienceService.listAll('work', { expectedAuthCacheKey }),
        experienceService.listAll('project', { expectedAuthCacheKey }),
    ]);
    return [...workItems, ...projectItems];
};

const fetchEducationExperiences = async (expectedAuthCacheKey: string) => (
    experienceService.listAll('education', { expectedAuthCacheKey })
);
const fetchCertifications = async (expectedAuthCacheKey: string) => (
    certificationsService.list({ expectedAuthCacheKey })
);
const fetchSkills = async (expectedAuthCacheKey: string) => (
    skillsService.list({ expectedAuthCacheKey })
);

const readCachedExperiences = async (expectedAuthCacheKey: string) => {
    const cachedAll = await experienceService.peekCompleteListForCurrentUser(undefined, {
        allowStale: true,
        expectedAuthCacheKey,
    });
    if (cachedAll !== null) {
        return cachedAll;
    }
    const [cachedWork, cachedProject] = await Promise.all([
        experienceService.peekCompleteListForCurrentUser('work', { allowStale: true, expectedAuthCacheKey }),
        experienceService.peekCompleteListForCurrentUser('project', { allowStale: true, expectedAuthCacheKey }),
    ]);
    if (cachedWork === null || cachedProject === null) {
        return null;
    }
    return [
        ...cachedWork,
        ...cachedProject,
    ];
};

const readCachedEducationExperiences = async (expectedAuthCacheKey: string) => (
    experienceService.peekCompleteListForCurrentUser('education', { allowStale: true, expectedAuthCacheKey })
);

const readCachedCertifications = async (expectedAuthCacheKey: string) => (
    certificationsService.peekListForCurrentUser({ allowStale: true, expectedAuthCacheKey })
);

const readCachedSkills = async (expectedAuthCacheKey: string) => (
    skillsService.peekListForCurrentUser({ allowStale: true, expectedAuthCacheKey })
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

const buildEffectiveConfigSnapshot = (
    configSnapshot: ResumeEditorConfig,
    persistedJDAnalysisSnapshot: ResumeEditorConfig['jdAnalysis'] | null | undefined,
    resumeId: string | null,
    resumeDetail: ResumeDetail | null,
    authUserKey?: string | null,
): ResumeEditorConfig => {
    if (persistedJDAnalysisSnapshot !== undefined) {
        return configSnapshot;
    }
    const backendPersistedJDAnalysis = normalizeJDAnalysisPersistence(
        (resumeDetail?.resume?.config as ResumeEditorConfig | undefined)?.jdAnalysis
    );
    const selectedPersistedJDAnalysis = selectPreferredPersistedJDAnalysis(
        backendPersistedJDAnalysis,
        resumeId ? loadJDAnalysisCache(authUserKey, resumeId) : null
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
    waitForPendingResumeSaves: () => Promise<void>,
    automaticReloadBlockedRef: MutableRefObject<boolean>,
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
            let expectedAuthCacheKey: string;
            try {
                expectedAuthCacheKey = await captureResumeAuthCacheKey(authUserKey);
            } catch (error) {
                setIsLoadingResume(false);
                setIsLoadingExperiences(false);
                return {
                    status: 'failed',
                    reason: 'load_error',
                    requestedId: requestedId ?? null,
                    error,
                };
            }
            const previousHydrated = hasHydratedConfigRef.current;
            const previousSaveState = latestSaveStateRef.current;
            const previousLastSavedAt = latestLastSavedAtRef.current;
            let authContextChanged = false;
            setIsLoadingResume(true);
            setIsLoadingExperiences(true);
            hasHydratedConfigRef.current = false;
            shouldWaitForDebouncedConfigRef.current = true;
            setSaveState('idle');
            setLastSavedAt(null);
            try {
                await waitForPendingResumeSaves();
                await assertResumeAuthContext(expectedAuthCacheKey);
                const { id: activeId, detail: cachedDetail } = await resolveRequestedResumeContext(
                    requestedId,
                    expectedAuthCacheKey
                );
                await assertResumeAuthContext(expectedAuthCacheKey);
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
                    cachedDetail ?? resumeService.get(activeId, { expectedAuthCacheKey }),
                    profileService.getProfile({ expectedAuthCacheKey }).catch(async () => {
                        await assertResumeAuthContext(expectedAuthCacheKey);
                        return null;
                    }),
                    loadWithFallback(
                        '经历列表',
                        () => fetchExperiences(expectedAuthCacheKey),
                        () => readCachedExperiences(expectedAuthCacheKey)
                    ),
                    loadWithFallback(
                        '教育经历列表',
                        () => fetchEducationExperiences(expectedAuthCacheKey),
                        () => readCachedEducationExperiences(expectedAuthCacheKey)
                    ),
                    loadWithFallback(
                        '证书列表',
                        () => fetchCertifications(expectedAuthCacheKey),
                        () => readCachedCertifications(expectedAuthCacheKey)
                    ),
                    loadWithFallback(
                        '技能列表',
                        () => fetchSkills(expectedAuthCacheKey),
                        () => readCachedSkills(expectedAuthCacheKey)
                    ),
                ]);
                await assertResumeAuthContext(expectedAuthCacheKey);
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
                setActiveResumeId(expectedAuthCacheKey, activeId);
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
                authContextChanged = error instanceof ResumeAuthContextChangedError
                    || isAuthContextChangedError(error);
                if (!authContextChanged && previousHydrated) {
                    hasHydratedConfigRef.current = true;
                    shouldWaitForDebouncedConfigRef.current = false;
                    setSaveState(previousSaveState);
                    setLastSavedAt(previousLastSavedAt);
                } else if (!authContextChanged) {
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
            waitForPendingResumeSaves,
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
        if (automaticReloadBlockedRef.current) {
            return;
        }
        void reloadResumeContext();
    }, [automaticReloadBlockedRef, reloadResumeContext]);

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
    const activeResumeIdRef = useRef<string | null>(null);
    const resumeUpdatedAtRef = useRef<string | undefined>(undefined);

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
        activeResumeIdRef,
        resumeUpdatedAtRef,
    };
};

const useResumeAutoSave = (
    resumeId: string | null,
    configSnapshot: ResumeEditorConfig,
    autoSaveDelayMs: number,
    isAutoSavePaused: boolean,
    saveState: ResumeState['saveState'],
    setSaveState: ResumeState['setSaveState'],
    saveResumeConfig: SaveResumeConfig,
    lastSavedConfigRef: MutableRefObject<string | null>,
    hasHydratedConfigRef: MutableRefObject<boolean>,
    shouldWaitForDebouncedConfigRef: MutableRefObject<boolean>,
    suppressedAutoSaveSignatureRef: MutableRefObject<string | null>,
    hasResumeVersionConflict: boolean,
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
        if (hasResumeVersionConflict) {
            return;
        }
        if (
            suppressedAutoSaveSignatureRef.current
            && configSignature !== suppressedAutoSaveSignatureRef.current
        ) {
            suppressedAutoSaveSignatureRef.current = null;
            shouldWaitForDebouncedConfigRef.current = true;
        }
        if (!hasHydratedConfigRef.current || isAutoSavePaused) {
            return;
        }
        if (
            saveState === 'error'
            && configSignature === suppressedAutoSaveSignatureRef.current
        ) {
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
        hasResumeVersionConflict,
    ]);

    useEffect(() => {
        if (!resumeId || !hasHydratedConfigRef.current || hasResumeVersionConflict) {
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
        saveResumeConfig(debouncedConfig)
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
        saveResumeConfig,
        setSaveState,
        lastSavedConfigRef,
        hasHydratedConfigRef,
        isAutoSavePaused,
        configSignature,
        shouldWaitForDebouncedConfigRef,
        suppressedAutoSaveSignatureRef,
        hasResumeVersionConflict,
    ]);
};

const useResumeConfigFlusher = (
    configSnapshot: ResumeEditorConfig,
    saveResumeConfig: SaveResumeConfig,
    setSaveState: ResumeState['setSaveState'],
    resumeVersionConflictRef: MutableRefObject<boolean>
) => {
    return useCallback(async (configOverride?: ResumeEditorConfig) => {
        if (resumeVersionConflictRef.current) {
            setSaveState('error');
            throw new Error('Resume version conflict requires an explicit reload.');
        }
        const nextConfig = configOverride ?? configSnapshot;
        try {
            await saveResumeConfig(nextConfig, { forceVersionCheck: true });
        } catch (error) {
            console.error('[ResumeEditor] 手动保存当前简历失败:', error);
            setSaveState('error');
            throw error;
        }
    }, [
        configSnapshot,
        resumeVersionConflictRef,
        saveResumeConfig,
        setSaveState,
    ]);
};


export const useResumeData = (options: UseResumeDataOptions): UseResumeDataResult => {
    const state = useResumeState();
    const [hasResumeVersionConflict, setHasResumeVersionConflict] = useState(false);
    const resumeVersionConflictRef = useRef(false);
    const resumeVersionConflictEpochRef = useRef(0);
    const pendingResumeSaveDrainRef = useRef<() => Promise<void>>(() => Promise.resolve());
    const waitForPendingResumeSaves = useCallback(
        async () => {
            await pendingResumeSaveDrainRef.current();
            await waitForResumeMutations(state.activeResumeIdRef.current);
        },
        [state.activeResumeIdRef]
    );
    useLayoutEffect(() => {
        state.activeResumeIdRef.current = state.resumeId;
        state.resumeUpdatedAtRef.current = state.resumeDetail?.resume.updated_at;
    }, [state.activeResumeIdRef, state.resumeDetail, state.resumeId, state.resumeUpdatedAtRef]);
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
    const reloadResumeContextBase = useResumeContextLoader(
        state,
        applyResumeConfig,
        applyExperienceState,
        applyEducationState,
        applyCertificationState,
        applySkillState,
        options.resolveProfileSyncMode,
        options.resolveProfileSnapshot,
        waitForPendingResumeSaves,
        resumeVersionConflictRef,
        options.authUserKey
    );
    const reloadResumeContext = useCallback(async (requestedId?: string | null) => {
        const conflictEpochAtStart = resumeVersionConflictEpochRef.current;
        const result = await reloadResumeContextBase(requestedId);
        if (
            result.status === 'success'
            && resumeVersionConflictEpochRef.current === conflictEpochAtStart
        ) {
            resumeVersionConflictRef.current = false;
            setHasResumeVersionConflict(false);
        }
        return result;
    }, [reloadResumeContextBase]);
    const effectiveConfigSnapshot = useMemo(
        () => buildEffectiveConfigSnapshot(
            options.configSnapshot,
            options.persistedJDAnalysisSnapshot,
            state.resumeId,
            state.resumeDetail,
            options.authUserKey,
        ),
        [
            options.configSnapshot,
            options.persistedJDAnalysisSnapshot,
            state.resumeId,
            state.resumeDetail,
            options.authUserKey,
        ]
    );
    const latestEffectiveConfigSnapshotRef = useRef(effectiveConfigSnapshot);
    useLayoutEffect(() => {
        latestEffectiveConfigSnapshotRef.current = effectiveConfigSnapshot;
    }, [effectiveConfigSnapshot]);
    useEffect(() => {
        if (hasResumeVersionConflict) {
            state.suppressedAutoSaveSignatureRef.current = JSON.stringify(
                latestEffectiveConfigSnapshotRef.current
            );
        }
    }, [
        effectiveConfigSnapshot,
        hasResumeVersionConflict,
        state.suppressedAutoSaveSignatureRef,
    ]);
    useEffect(() => {
        if (!state.resumeId) {
            return;
        }
        return subscribeToResumeVersionConflicts(state.resumeId, () => {
            const conflictedDraft = latestEffectiveConfigSnapshotRef.current;
            const conflictedDraftSignature = JSON.stringify(conflictedDraft);
            resumeVersionConflictEpochRef.current += 1;
            resumeVersionConflictRef.current = true;
            setHasResumeVersionConflict(true);
            state.suppressedAutoSaveSignatureRef.current = conflictedDraftSignature;
            state.setSaveState('error');
        });
    }, [state.resumeId, state.setSaveState, state.suppressedAutoSaveSignatureRef]);
    const saveCoordinator = useMemo(
        () => {
            const expectedAuthCacheKey = options.authUserKey;
            const assertSaveOwnerCurrent = () => {
                if (
                    !expectedAuthCacheKey
                    || readAuthSessionSnapshot().ownerKey !== expectedAuthCacheKey
                ) {
                    throw new ResumeAuthContextChangedError();
                }
            };
            return createResumeConfigSaveCoordinator<ResumeEditorConfig, Resume>({
            getResumeId: () => state.activeResumeIdRef.current,
            getExpectedUpdatedAt: () => state.resumeUpdatedAtRef.current,
            getLastSavedSignature: () => state.lastSavedConfigRef.current,
            isHydrated: () => state.hasHydratedConfigRef.current,
            assertCanPersist: () => {
                assertSaveOwnerCurrent();
                if (resumeVersionConflictRef.current) {
                    throw new Error('Resume version conflict requires an explicit reload.');
                }
            },
            persist: (resumeId, config, expectedUpdatedAt) => resumeService.update(
                resumeId,
                {
                    config,
                    expected_updated_at: expectedUpdatedAt,
                },
                { expectedAuthCacheKey: expectedAuthCacheKey ?? undefined },
            ),
            onSaveStart: () => state.setSaveState('saving'),
            onSaveSuccess: (_resumeId, updatedResume, configSignature) => {
                assertSaveOwnerCurrent();
                const pendingJDAnalysisCache = loadJDAnalysisCache(options.authUserKey, _resumeId);
                const savedJDAnalysis = normalizeJDAnalysisPersistence(
                    (updatedResume.config as ResumeEditorConfig | undefined)?.jdAnalysis
                );
                const latestConfigSignature = JSON.stringify(
                    latestEffectiveConfigSnapshotRef.current
                );
                state.resumeUpdatedAtRef.current = updatedResume.updated_at;
                state.setResumeDetail((prev) => mergeResumeSaveResultIntoDetail(
                    prev,
                    updatedResume,
                    {
                        savedConfigSignature: configSignature,
                        latestConfigSignature,
                        pendingJDAnalysisCache,
                        savedJDAnalysis,
                    }
                ));
                updateLastSavedRef(state.lastSavedConfigRef, configSignature);
                state.setSaveState('saved');
                state.setLastSavedAt(new Date().toLocaleTimeString());
            },
            });
        },
        [
            options.authUserKey,
            state.activeResumeIdRef,
            state.hasHydratedConfigRef,
            state.lastSavedConfigRef,
            state.resumeUpdatedAtRef,
            state.setLastSavedAt,
            state.setResumeDetail,
            state.setSaveState,
        ]
    );
    useLayoutEffect(() => {
        pendingResumeSaveDrainRef.current = saveCoordinator.drain;
    }, [saveCoordinator]);
    const saveResumeConfig = saveCoordinator.save;
    useResumeAutoSave(
        state.resumeId,
        effectiveConfigSnapshot,
        options.autoSaveDelayMs,
        options.isAutoSavePaused ?? false,
        state.saveState,
        state.setSaveState,
        saveResumeConfig,
        state.lastSavedConfigRef,
        state.hasHydratedConfigRef,
        state.shouldWaitForDebouncedConfigRef,
        state.suppressedAutoSaveSignatureRef,
        hasResumeVersionConflict,
    );
    const flushResumeConfig = useResumeConfigFlusher(
        effectiveConfigSnapshot,
        saveResumeConfig,
        state.setSaveState,
        resumeVersionConflictRef
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
        hasResumeVersionConflict,
        applyResumeDetail,
        flushResumeConfig,
        reloadResumeContext,
        suppressAutoSaveForConfig,
        clearSuppressedAutoSave,
    };
};

