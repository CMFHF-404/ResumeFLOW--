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
import { certificationsService, Certification as CertificationRecord } from '../services/certificationsService';
import { experienceService, ExperienceListItem } from '../services/experienceService';
import { profileService, Profile } from '../services/profileService';
import {
    resumeService,
    ResumeDetail,
    ResumeExperienceItem,
    Resume,
} from '../services/resumeService';
import { skillsService, UserSkill } from '../services/skillsService';
import { DEFAULT_RESUME_TITLE } from '../constants/resumeConstants';
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
import { parseYearMonthValue } from '../views/experienceUtils';

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

type UseResumeDataOptions = {
    configSnapshot: ResumeEditorConfig;
    autoSaveDelayMs: number;
    isAutoSavePaused?: boolean;
    setProfile: Dispatch<SetStateAction<ResumeEditorProfile>>;
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
    reloadResumeContext: (resumeId?: string | null) => Promise<ReloadedResumeContext | null>;
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

const ensureActiveResumeId = async (resumes: Resume[]): Promise<string> => {
    if (resumes.length > 0) {
        setActiveResumeId(resumes[0].id);
        return resumes[0].id;
    }
    const created = await resumeService.create({ title: DEFAULT_RESUME_TITLE });
    setActiveResumeId(created.id);
    return created.id;
};

const resolveActiveResumeContext = async (): Promise<ActiveResumeContext> => {
    const cachedId = getActiveResumeId();
    if (cachedId) {
        const cached = await resolveCachedResume(cachedId);
        if (cached.status === 'ok') {
            return { id: cachedId, detail: cached.detail };
        }
        if (cached.status === 'missing') {
            clearActiveResumeId();
            const resumes = await resumeService.list({ force: true });
            const id = await ensureActiveResumeId(resumes);
            return { id, detail: null };
        }
        return { id: cachedId, detail: null };
    }
    const resumes = await resumeService.list();
    const id = await ensureActiveResumeId(resumes);
    return { id, detail: null };
};

const resolveRequestedResumeContext = async (
    requestedId?: string | null
): Promise<ActiveResumeContext> => {
    if (requestedId) {
        return { id: requestedId, detail: null };
    }
    return resolveActiveResumeContext();
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

const createApplyResumeConfig = (
    setProfile: UseResumeDataOptions['setProfile'],
    setProfileSyncMode: UseResumeDataOptions['setProfileSyncMode'],
    setProfileSocialLinks: UseResumeDataOptions['setProfileSocialLinks'],
    setSectionOrder: UseResumeDataOptions['setSectionOrder'],
    setDensity: UseResumeDataOptions['setDensity'],
    setIsSummaryVisible: UseResumeDataOptions['setIsSummaryVisible'],
    applyLayoutConfig: UseResumeDataOptions['applyLayoutConfig'],
    normalizeSectionOrder: UseResumeDataOptions['normalizeSectionOrder'],
    resolveProfileSyncMode: UseResumeDataOptions['resolveProfileSyncMode'],
    resolveProfileSnapshot: UseResumeDataOptions['resolveProfileSnapshot']
) => {
    return (config: ResumeEditorConfig, profileData?: Profile | null) => {
        const syncMode = resolveProfileSyncMode(config, profileData || undefined);
        setProfileSyncMode(syncMode);
        if (profileData) {
            setProfileSocialLinks({ ...(profileData.social_links || {}) });
        }
        const resolvedDensity = config.layout?.density ?? 'standard';
        setProfile(resolveProfileSnapshot(config, profileData || undefined));
        setSectionOrder(normalizeSectionOrder(config.layout?.sectionOrder));
        setIsSummaryVisible(config.layout?.isSummaryVisible ?? false);
        setDensity(resolvedDensity);
        applyLayoutConfig({
            ...config,
            layout: {
                ...config.layout,
                density: resolvedDensity,
            },
        });
    };
};

const applyExplicitOrder = <T,>(
    items: T[],
    getId: (item: T) => string,
    orderedIds?: string[]
) => {
    if (!orderedIds || orderedIds.length === 0 || items.length <= 1) {
        return items;
    }
    const index = new Map(items.map((item) => [getId(item), item]));
    const used = new Set<string>();
    const next: T[] = [];

    orderedIds.forEach((id) => {
        const resolved = index.get(id);
        if (!resolved || used.has(id)) {
            return;
        }
        used.add(id);
        next.push(resolved);
    });

    items.forEach((item) => {
        const id = getId(item);
        if (used.has(id)) {
            return;
        }
        next.push(item);
    });

    return next;
};

const createApplyExperienceState = (
    applyResumeDetail: (detail: ResumeDetail | null) => void,
    setExperienceSourceMap: ResumeState['setExperienceSourceMap'],
    setExperienceItems: UseResumeDataOptions['setExperienceItems'],
    setSelectedExpIds: UseResumeDataOptions['setSelectedExpIds'],
    buildSourceMap: UseResumeDataOptions['buildSourceMap'],
    buildResumeExperienceMap: UseResumeDataOptions['buildResumeExperienceMap'],
    buildResumeExperienceView: UseResumeDataOptions['buildResumeExperienceView'],
    sortByCategory: UseResumeDataOptions['sortByCategory'],
    compareByDateDesc: UseResumeDataOptions['compareByDateDesc'],
    resolveSelectionSet: UseResumeDataOptions['resolveSelectionSet']
) => {
    return (detail: ResumeDetail | null, experiences: ExperienceListItem[], config: ResumeEditorConfig) => {
        applyResumeDetail(detail);
        setExperienceSourceMap(buildSourceMap(experiences));
        const resumeMap = buildResumeExperienceMap(detail);
        const views = sortByCategory(
            experiences.map((item) => buildResumeExperienceView(item, resumeMap.get(item.master.id))),
            compareByDateDesc
        );
        const workViews = views.filter((item) => item.category === 'work');
        const projectViews = views.filter((item) => item.category === 'project');
        const orders = config.layout?.orders;
        const ordered = [
            ...applyExplicitOrder(workViews, (item) => item.id, orders?.workExperienceIds),
            ...applyExplicitOrder(projectViews, (item) => item.id, orders?.projectExperienceIds),
        ];
        setExperienceItems(ordered);
        const configSelection = resolveSelectionSet(config.selection?.experienceIds);
        if (configSelection.size > 0) {
            setSelectedExpIds(configSelection);
        } else if (resumeMap.size > 0) {
            setSelectedExpIds(new Set(resumeMap.keys()));
        } else {
            setSelectedExpIds(new Set(views.map((item) => item.id)));
        }
    };
};

const createApplyEducationState = (
    setEducations: UseResumeDataOptions['setEducations'],
    setEducationSourceMap: UseResumeDataOptions['setEducationSourceMap'],
    setSelectedEduIds: UseResumeDataOptions['setSelectedEduIds'],
    buildEducationView: UseResumeDataOptions['buildEducationView'],
    buildSourceMap: UseResumeDataOptions['buildSourceMap'],
    resolveSelectionSet: UseResumeDataOptions['resolveSelectionSet']
) => {
    return (items: ExperienceListItem[], config: ResumeEditorConfig) => {
        const views = items.map(buildEducationView);
        const ordered = applyExplicitOrder(views, (item) => item.id, config.layout?.orders?.educationIds);
        setEducations(ordered);
        setEducationSourceMap(buildSourceMap(items));
        const selection = resolveSelectionSet(config.selection?.educationIds);
        const validIds = new Set(views.map((item) => item.id));
        const normalized = new Set([...selection].filter((id) => validIds.has(id)));
        setSelectedEduIds(normalized.size ? normalized : new Set(validIds));
    };
};

const createApplyCertificationState = (
    setCertifications: UseResumeDataOptions['setCertifications'],
    setCertificationSourceMap: UseResumeDataOptions['setCertificationSourceMap'],
    setSelectedCertIds: UseResumeDataOptions['setSelectedCertIds'],
    buildCertificationView: UseResumeDataOptions['buildCertificationView'],
    resolveSelectionSet: UseResumeDataOptions['resolveSelectionSet']
) => {
    return (items: CertificationRecord[], config: ResumeEditorConfig) => {
        const views = items
            .map(buildCertificationView)
            .sort((a, b) => (parseYearMonthValue(b.date) ?? -1) - (parseYearMonthValue(a.date) ?? -1));
        const ordered = applyExplicitOrder(views, (item) => item.id, config.layout?.orders?.certificationIds);
        setCertifications(ordered);
        setCertificationSourceMap(new Map(items.map((item) => [item.id, item])));
        const selection = resolveSelectionSet(config.selection?.certificationIds);
        const validIds = new Set(views.map((item) => item.id));
        const normalized = new Set([...selection].filter((id) => validIds.has(id)));
        setSelectedCertIds(normalized.size ? normalized : new Set(validIds));
    };
};

const createApplySkillState = (
    setSkillGroups: UseResumeDataOptions['setSkillGroups'],
    setSelectedSkillIds: UseResumeDataOptions['setSelectedSkillIds'],
    buildSkillGroups: UseResumeDataOptions['buildSkillGroups'],
    resolveSelectionSet: UseResumeDataOptions['resolveSelectionSet']
) => {
    return (items: UserSkill[], config: ResumeEditorConfig) => {
        const groups = buildSkillGroups(items);
        const ordered = applyExplicitOrder(
            groups,
            (group) => group.name,
            config.layout?.orders?.skillGroupNames
        );
        setSkillGroups(ordered);
        const selection = resolveSelectionSet(config.selection?.skillIds);
        const validIds = new Set(items.map((skill) => skill.id));
        const normalized = new Set([...selection].filter((id) => validIds.has(id)));
        setSelectedSkillIds(normalized.size ? normalized : new Set(validIds));
    };
};

const useResumeConfigApplier = (options: UseResumeDataOptions) => {
    const {
        setProfile,
        setProfileSyncMode,
        setProfileSocialLinks,
        setSectionOrder,
        setDensity,
        setIsSummaryVisible,
        applyLayoutConfig,
        normalizeSectionOrder,
        resolveProfileSyncMode,
        resolveProfileSnapshot,
    } = options;
    return useCallback(
        createApplyResumeConfig(
            setProfile,
            setProfileSyncMode,
            setProfileSocialLinks,
            setSectionOrder,
            setDensity,
            setIsSummaryVisible,
            applyLayoutConfig,
            normalizeSectionOrder,
            resolveProfileSyncMode,
            resolveProfileSnapshot
        ),
        [
            normalizeSectionOrder,
            resolveProfileSnapshot,
            resolveProfileSyncMode,
            setDensity,
            setIsSummaryVisible,
            applyLayoutConfig,
            setProfile,
            setProfileSocialLinks,
            setProfileSyncMode,
            setSectionOrder,
        ]
    );
};

const useExperienceStateApplier = (
    options: UseResumeDataOptions,
    state: ResumeState,
    applyResumeDetail: (detail: ResumeDetail | null) => void
) => {
    const {
        setExperienceItems,
        setSelectedExpIds,
        buildResumeExperienceMap,
        buildSourceMap,
        buildResumeExperienceView,
        sortByCategory,
        compareByDateDesc,
        resolveSelectionSet,
    } = options;
    return useCallback(
        createApplyExperienceState(
            applyResumeDetail,
            state.setExperienceSourceMap,
            setExperienceItems,
            setSelectedExpIds,
            buildSourceMap,
            buildResumeExperienceMap,
            buildResumeExperienceView,
            sortByCategory,
            compareByDateDesc,
            resolveSelectionSet
        ),
        [
            applyResumeDetail,
            buildResumeExperienceMap,
            buildResumeExperienceView,
            buildSourceMap,
            compareByDateDesc,
            resolveSelectionSet,
            setExperienceItems,
            setSelectedExpIds,
            sortByCategory,
            state.setExperienceSourceMap,
        ]
    );
};

const useEducationStateApplier = (options: UseResumeDataOptions) => {
    const {
        setEducations,
        setEducationSourceMap,
        setSelectedEduIds,
        buildEducationView,
        buildSourceMap,
        resolveSelectionSet,
    } = options;
    return useCallback(
        createApplyEducationState(
            setEducations,
            setEducationSourceMap,
            setSelectedEduIds,
            buildEducationView,
            buildSourceMap,
            resolveSelectionSet
        ),
        [
            buildEducationView,
            buildSourceMap,
            resolveSelectionSet,
            setEducations,
            setEducationSourceMap,
            setSelectedEduIds,
        ]
    );
};

const useCertificationStateApplier = (options: UseResumeDataOptions) => {
    const {
        setCertifications,
        setCertificationSourceMap,
        setSelectedCertIds,
        buildCertificationView,
        resolveSelectionSet,
    } = options;
    return useCallback(
        createApplyCertificationState(
            setCertifications,
            setCertificationSourceMap,
            setSelectedCertIds,
            buildCertificationView,
            resolveSelectionSet
        ),
        [
            buildCertificationView,
            resolveSelectionSet,
            setCertifications,
            setCertificationSourceMap,
            setSelectedCertIds,
        ]
    );
};

const useSkillStateApplier = (options: UseResumeDataOptions) => {
    const {
        setSkillGroups,
        setSelectedSkillIds,
        buildSkillGroups,
        resolveSelectionSet,
    } = options;
    return useCallback(
        createApplySkillState(
            setSkillGroups,
            setSelectedSkillIds,
            buildSkillGroups,
            resolveSelectionSet
        ),
        [buildSkillGroups, resolveSelectionSet, setSelectedSkillIds, setSkillGroups]
    );
};

const useResumeContextLoader = (
    state: ResumeState,
    applyResumeConfig: (config: ResumeEditorConfig, profileData?: Profile | null) => void,
    applyExperienceState: (detail: ResumeDetail | null, items: ExperienceListItem[], config: ResumeEditorConfig) => void,
    applyEducationState: (items: ExperienceListItem[], config: ResumeEditorConfig) => void,
    applyCertificationState: (items: CertificationRecord[], config: ResumeEditorConfig) => void,
    applySkillState: (items: UserSkill[], config: ResumeEditorConfig) => void,
    resolveProfileSyncMode: ProfileSyncResolver,
    resolveProfileSnapshot: ProfileSnapshotResolver
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
    const reloadResumeContext = useCallback(
        async (requestedId?: string | null) => {
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
                const { id: activeId, detail: cachedDetail } = await resolveRequestedResumeContext(requestedId);
                if (!activeId) {
                    return;
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
                    profile: resolvedProfile,
                    profileSyncMode: resolvedProfileSyncMode,
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
                return null;
            } finally {
                setIsLoadingResume(false);
                setIsLoadingExperiences(false);
            }
        },
        [
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
            .then(() => {
                if (sessionId !== saveSessionRef.current) {
                    return;
                }
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
            await resumeService.update(resumeId, { config: nextConfig });
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
        options.resolveProfileSnapshot
    );
    useResumeAutoSave(
        state.resumeId,
        options.configSnapshot,
        options.autoSaveDelayMs,
        options.isAutoSavePaused ?? false,
        state.saveState,
        state.setSaveState,
        state.setLastSavedAt,
        state.lastSavedConfigRef,
        state.hasHydratedConfigRef,
        state.shouldWaitForDebouncedConfigRef,
        state.suppressedAutoSaveSignatureRef
    );
    const flushResumeConfig = useResumeConfigFlusher(
        state.resumeId,
        options.configSnapshot,
        state.setSaveState,
        state.setLastSavedAt,
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

