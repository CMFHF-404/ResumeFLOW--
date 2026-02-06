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

type UseResumeDataOptions = {
    configSnapshot: ResumeEditorConfig;
    autoSaveDelayMs: number;
    setProfile: Dispatch<SetStateAction<ResumeEditorProfile>>;
    setProfileSyncMode: Dispatch<SetStateAction<ProfileSyncMode>>;
    setProfileSocialLinks: Dispatch<SetStateAction<Record<string, any>>>;
    setSectionOrder: Dispatch<SetStateAction<string[]>>;
    setDensity: Dispatch<SetStateAction<'compact' | 'standard' | 'spacious'>>;
    setIsSummaryVisible: Dispatch<SetStateAction<boolean>>;
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
    lastSavedConfigRef: MutableRefObject<string | null>;
    hasHydratedConfigRef: MutableRefObject<boolean>;
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
        setProfile(resolveProfileSnapshot(config, profileData || undefined));
        setSectionOrder(normalizeSectionOrder(config.layout?.sectionOrder));
        setIsSummaryVisible(config.layout?.isSummaryVisible ?? false);
        if (config.layout?.density) {
            setDensity(config.layout.density);
        }
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
    resolveSelectionSet: UseResumeDataOptions['resolveSelectionSet'],
    compareCertificationByDateDesc: UseResumeDataOptions['compareCertificationByDateDesc']
) => {
    return (items: CertificationRecord[], config: ResumeEditorConfig) => {
        const views = items
            .map(buildCertificationView)
            .sort(compareCertificationByDateDesc);
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
        compareCertificationByDateDesc,
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
        compareCertificationByDateDesc,
    } = options;
    return useCallback(
        createApplyCertificationState(
            setCertifications,
            setCertificationSourceMap,
            setSelectedCertIds,
            buildCertificationView,
            resolveSelectionSet,
            compareCertificationByDateDesc
        ),
        [
            buildCertificationView,
            resolveSelectionSet,
            setCertifications,
            setCertificationSourceMap,
            setSelectedCertIds,
            compareCertificationByDateDesc,
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
    applySkillState: (items: UserSkill[], config: ResumeEditorConfig) => void
) => {
    const {
        setIsLoadingResume,
        setIsLoadingExperiences,
        setResumeId,
        hasHydratedConfigRef,
    } = state;
    useEffect(() => {
        let cancelled = false;
        const loadResumeContext = async () => {
            setIsLoadingResume(true);
            setIsLoadingExperiences(true);
            try {
                const { id: activeId, detail: cachedDetail } = await resolveActiveResumeContext();
                if (!activeId || cancelled) {
                    return;
                }
                setResumeId(activeId);
                const [
                    detail,
                    profileData,
                    experiences,
                    educationExperiences,
                    certifications,
                    skills,
                ] = await Promise.all([
                    cachedDetail ?? resumeService.get(activeId).catch(() => null),
                    profileService.getProfile().catch(() => null),
                    fetchExperiences(),
                    fetchEducationExperiences(),
                    fetchCertifications(),
                    fetchSkills(),
                ]);
                if (cancelled) {
                    return;
                }
                const config = (detail?.resume?.config || {}) as ResumeEditorConfig;
                applyResumeConfig(config, profileData);
                applyExperienceState(detail, experiences, config);
                applyEducationState(educationExperiences, config);
                applyCertificationState(certifications, config);
                applySkillState(skills, config);
                hasHydratedConfigRef.current = true;
            } catch (error) {
                console.error('[ResumeEditor] 加载简历上下文失败:', error);
            } finally {
                if (!cancelled) {
                    setIsLoadingResume(false);
                    setIsLoadingExperiences(false);
                }
            }
        };
        loadResumeContext();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // 只在组件挂载时加载一次简历上下文，避免依赖项变化导致的死循环
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
    const lastSavedConfigRef = useRef<string | null>(null);
    const hasHydratedConfigRef = useRef(false);

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
        lastSavedConfigRef,
        hasHydratedConfigRef,
    };
};

const useResumeAutoSave = (
    resumeId: string | null,
    configSnapshot: ResumeEditorConfig,
    autoSaveDelayMs: number,
    saveState: ResumeState['saveState'],
    setSaveState: ResumeState['setSaveState'],
    setLastSavedAt: ResumeState['setLastSavedAt'],
    lastSavedConfigRef: MutableRefObject<string | null>,
    hasHydratedConfigRef: MutableRefObject<boolean>
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

    useEffect(() => {
        if (!hasHydratedConfigRef.current) {
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
    }, [configSignature, saveState, lastSavedConfigRef, setSaveState, hasHydratedConfigRef]);

    useEffect(() => {
        if (!resumeId || !hasHydratedConfigRef.current) {
            return;
        }
        if (debouncedConfigSignature === lastSavedConfigRef.current) {
            return;
        }
        setSaveState('saving');
        resumeService
            .update(resumeId, { config: debouncedConfig })
            .then(() => {
                updateLastSavedRef(lastSavedConfigRef, debouncedConfigSignature);
                setSaveState('saved');
                setLastSavedAt(new Date().toLocaleTimeString());
            })
            .catch((error) => {
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
    ]);
};


export const useResumeData = (options: UseResumeDataOptions): UseResumeDataResult => {
    const state = useResumeState();
    const applyResumeDetail = useCallback(
        (detail: ResumeDetail | null) => {
            state.setResumeDetail(detail);
            state.setResumeExperienceMap(options.buildResumeExperienceMap(detail));
        },
        [options.buildResumeExperienceMap, state]
    );

    const applyResumeConfig = useResumeConfigApplier(options);
    const applyExperienceState = useExperienceStateApplier(options, state, applyResumeDetail);
    const applyEducationState = useEducationStateApplier(options);
    const applyCertificationState = useCertificationStateApplier(options);
    const applySkillState = useSkillStateApplier(options);
    useResumeContextLoader(
        state,
        applyResumeConfig,
        applyExperienceState,
        applyEducationState,
        applyCertificationState,
        applySkillState
    );
    useResumeAutoSave(
        state.resumeId,
        options.configSnapshot,
        options.autoSaveDelayMs,
        state.saveState,
        state.setSaveState,
        state.setLastSavedAt,
        state.lastSavedConfigRef,
        state.hasHydratedConfigRef
    );

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
    };
};
