import {
    useCallback,
    type Dispatch,
    type SetStateAction,
} from 'react';
import type { Certification as CertificationRecord } from '../services/certificationsService';
import type { ExperienceListItem } from '../services/experienceService';
import type { Profile } from '../services/profileService';
import type {
    ResumeDetail,
    ResumeExperienceItem,
} from '../services/resumeService';
import type { UserSkill } from '../services/skillsService';
import type {
    CertificationView,
    EducationView,
    ProfileSyncMode,
    ResumeEditorConfig,
    ResumeEditorProfile,
    ResumeExperienceView,
    SkillGroupView,
} from '../types/resume';
import { parseYearMonthValue } from '../utils/dateUtils';

type ExperienceBuilder = (item: ExperienceListItem, resumeItem?: ResumeExperienceItem) => ResumeExperienceView;
type EducationBuilder = (item: ExperienceListItem) => EducationView;
type CertificationBuilder = (item: CertificationRecord) => CertificationView;
type SkillGroupBuilder = (skills: UserSkill[]) => SkillGroupView[];
type SelectionResolver = (ids?: string[]) => Set<string>;
type SectionOrderNormalizer = (order?: string[]) => string[];
type ProfileSyncResolver = (config?: ResumeEditorConfig, profile?: Profile | null) => ProfileSyncMode;
type ProfileSnapshotResolver = (config?: ResumeEditorConfig, profile?: Profile | null) => ResumeEditorProfile;

export type ResumeDataApplierOptions = {
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
};

export type ResumeDataApplierState = {
    setExperienceSourceMap: Dispatch<SetStateAction<Map<string, ExperienceListItem>>>;
};

export const applyExplicitOrder = <T,>(
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

const resolvePersistedSelection = (
    ids: string[] | undefined,
    validIds: Set<string>,
    resolveSelectionSet: SelectionResolver
) => {
    const selection = resolveSelectionSet(ids);
    const normalized = new Set([...selection].filter((id) => validIds.has(id)));
    if (Array.isArray(ids) && ids.length === 0) {
        return normalized;
    }
    return normalized.size ? normalized : new Set(validIds);
};

export const createApplyResumeConfig = (
    setProfile: ResumeDataApplierOptions['setProfile'],
    setPersonalSummary: ResumeDataApplierOptions['setPersonalSummary'],
    setHasPersonalSummaryOverride: ResumeDataApplierOptions['setHasPersonalSummaryOverride'],
    setProfileSyncMode: ResumeDataApplierOptions['setProfileSyncMode'],
    setProfileSocialLinks: ResumeDataApplierOptions['setProfileSocialLinks'],
    setSectionOrder: ResumeDataApplierOptions['setSectionOrder'],
    setDensity: ResumeDataApplierOptions['setDensity'],
    setIsSummaryVisible: ResumeDataApplierOptions['setIsSummaryVisible'],
    applyLayoutConfig: ResumeDataApplierOptions['applyLayoutConfig'],
    normalizeSectionOrder: ResumeDataApplierOptions['normalizeSectionOrder'],
    resolveProfileSyncMode: ResumeDataApplierOptions['resolveProfileSyncMode'],
    resolveProfileSnapshot: ResumeDataApplierOptions['resolveProfileSnapshot']
) => {
    return (config: ResumeEditorConfig, profileData?: Profile | null) => {
        const syncMode = resolveProfileSyncMode(config, profileData || undefined);
        setProfileSyncMode(syncMode);
        if (profileData) {
            setProfileSocialLinks({ ...(profileData.social_links || {}) });
        }
        const resolvedDensity = config.layout?.density ?? 'standard';
        const resolvedProfile = resolveProfileSnapshot(config, profileData || undefined);
        const hasPersonalSummaryOverride = typeof config.personalSummary === 'string';
        const resolvedPersonalSummary = hasPersonalSummaryOverride ? config.personalSummary : '';
        const storedSummaryVisibility = config.layout?.isSummaryVisible;
        const legacySummaryVisibilityFallback = hasPersonalSummaryOverride
            ? Boolean(resolvedPersonalSummary.trim())
            : Boolean(resolvedProfile.summary?.trim());

        setProfile(resolvedProfile);
        setPersonalSummary(resolvedPersonalSummary);
        setHasPersonalSummaryOverride(hasPersonalSummaryOverride);
        setSectionOrder(normalizeSectionOrder(config.layout?.sectionOrder));
        setIsSummaryVisible(storedSummaryVisibility ?? legacySummaryVisibilityFallback);
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

export const createApplyExperienceState = (
    applyResumeDetail: (detail: ResumeDetail | null) => void,
    setExperienceSourceMap: ResumeDataApplierState['setExperienceSourceMap'],
    setExperienceItems: ResumeDataApplierOptions['setExperienceItems'],
    setSelectedExpIds: ResumeDataApplierOptions['setSelectedExpIds'],
    buildSourceMap: ResumeDataApplierOptions['buildSourceMap'],
    buildResumeExperienceMap: ResumeDataApplierOptions['buildResumeExperienceMap'],
    buildResumeExperienceView: ResumeDataApplierOptions['buildResumeExperienceView'],
    sortByCategory: ResumeDataApplierOptions['sortByCategory'],
    compareByDateDesc: ResumeDataApplierOptions['compareByDateDesc'],
    resolveSelectionSet: ResumeDataApplierOptions['resolveSelectionSet']
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

export const createApplyEducationState = (
    setEducations: ResumeDataApplierOptions['setEducations'],
    setEducationSourceMap: ResumeDataApplierOptions['setEducationSourceMap'],
    setSelectedEduIds: ResumeDataApplierOptions['setSelectedEduIds'],
    buildEducationView: ResumeDataApplierOptions['buildEducationView'],
    buildSourceMap: ResumeDataApplierOptions['buildSourceMap'],
    resolveSelectionSet: ResumeDataApplierOptions['resolveSelectionSet']
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

export const createApplyCertificationState = (
    setCertifications: ResumeDataApplierOptions['setCertifications'],
    setCertificationSourceMap: ResumeDataApplierOptions['setCertificationSourceMap'],
    setSelectedCertIds: ResumeDataApplierOptions['setSelectedCertIds'],
    buildCertificationView: ResumeDataApplierOptions['buildCertificationView'],
    resolveSelectionSet: ResumeDataApplierOptions['resolveSelectionSet']
) => {
    return (items: CertificationRecord[], config: ResumeEditorConfig) => {
        const views = items
            .map(buildCertificationView)
            .sort((a, b) => (parseYearMonthValue(b.date) ?? -1) - (parseYearMonthValue(a.date) ?? -1));
        const ordered = applyExplicitOrder(views, (item) => item.id, config.layout?.orders?.certificationIds);
        setCertifications(ordered);
        setCertificationSourceMap(new Map(items.map((item) => [item.id, item])));
        const validIds = new Set(views.map((item) => item.id));
        setSelectedCertIds(resolvePersistedSelection(
            config.selection?.certificationIds,
            validIds,
            resolveSelectionSet
        ));
    };
};

export const createApplySkillState = (
    setSkillGroups: ResumeDataApplierOptions['setSkillGroups'],
    setSelectedSkillIds: ResumeDataApplierOptions['setSelectedSkillIds'],
    buildSkillGroups: ResumeDataApplierOptions['buildSkillGroups'],
    resolveSelectionSet: ResumeDataApplierOptions['resolveSelectionSet']
) => {
    return (items: UserSkill[], config: ResumeEditorConfig) => {
        const groups = buildSkillGroups(items);
        const ordered = applyExplicitOrder(
            groups,
            (group) => group.name,
            config.layout?.orders?.skillGroupNames
        );
        setSkillGroups(ordered);
        const validIds = new Set(items.map((skill) => skill.id));
        setSelectedSkillIds(resolvePersistedSelection(
            config.selection?.skillIds,
            validIds,
            resolveSelectionSet
        ));
    };
};

export const useResumeConfigApplier = (options: ResumeDataApplierOptions) => {
    const {
        setProfile,
        setPersonalSummary,
        setHasPersonalSummaryOverride,
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
            setPersonalSummary,
            setHasPersonalSummaryOverride,
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
            setPersonalSummary,
            setHasPersonalSummaryOverride,
            setProfileSocialLinks,
            setProfileSyncMode,
            setSectionOrder,
        ]
    );
};

export const useExperienceStateApplier = (
    options: ResumeDataApplierOptions,
    state: ResumeDataApplierState,
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

export const useEducationStateApplier = (options: ResumeDataApplierOptions) => {
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

export const useCertificationStateApplier = (options: ResumeDataApplierOptions) => {
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

export const useSkillStateApplier = (options: ResumeDataApplierOptions) => {
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
