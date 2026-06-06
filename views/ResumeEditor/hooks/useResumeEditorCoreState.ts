import { useMemo, useRef, useState } from 'react';
import type { Certification as CertificationRecord } from '../../../services/certificationsService';
import type { ExperienceListItem } from '../../../services/experienceService';
import type {
    CertificationView,
    EducationView,
    ProfileSyncMode,
    ResumeBossGreeting,
    ResumeEditorProfile,
    ResumeExperienceListMarkerStyle,
    ResumeExperienceView,
    ResumeJDAnalysis,
    ResumeLayoutOrders,
    SectionSpacingKey,
    SkillGroupView,
} from '../../../types/resume';
import { UNTITLED_RESUME_TITLE } from '../../../constants/resumeConstants';
import {
    DEFAULT_PROFILE,
    DEFAULT_SECTION_ORDER,
    FONT_SIZE_DEFAULT,
    LINE_HEIGHT_DEFAULT,
    PROFILE_SYNC_MODES,
} from '../constants';
import {
    areLayoutValuesEqual,
    buildDefaultSmartPageLayout,
    resolveDefaultItemSpacingEm,
    resolveDefaultSectionSpacingKey,
    resolveDefaultTopPaddingPx,
    type LayoutSnapshot,
    type SmartPageLayout,
} from '../layoutUtils';
import {
    buildLayoutSnapshot,
    type ManualSelectionSnapshot,
} from '../autoAssemblyUtils';
import type { PendingPersistedBossGreeting } from '../snapshotUtils';
import {
    DEFAULT_RESUME_EXPERIENCE_LIST_MARKER_STYLE,
    DEFAULT_RESUME_SKILL_TAG_SEPARATOR,
} from '../../../utils/resumeCustomization';
import {
    DEFAULT_RESUME_TEMPLATE_ID,
    resolveDefaultResumeThemeColorPresetId,
    type ResumeTemplateId,
    type ResumeThemeColorPresetId,
} from '../../../constants/resumeTemplates';

export function useResumeEditorCoreState() {
    const [lineHeight, setLineHeight] = useState(LINE_HEIGHT_DEFAULT);
    const [fontSize, setFontSize] = useState(FONT_SIZE_DEFAULT);
    const [topPaddingPx, setTopPaddingPx] = useState(resolveDefaultTopPaddingPx());
    const [sectionSpacingKey, setSectionSpacingKey] = useState<SectionSpacingKey>(
        resolveDefaultSectionSpacingKey('standard')
    );
    const [itemSpacingEm, setItemSpacingEm] = useState(resolveDefaultItemSpacingEm('standard'));
    const [measureLayout, setMeasureLayout] = useState<SmartPageLayout>(() =>
        buildDefaultSmartPageLayout('standard')
    );
    const [isSmartPageApplied, setIsSmartPageApplied] = useState(false);
    const [isLayoutAdjustToolbarOpen, setIsLayoutAdjustToolbarOpen] = useState(false);
    const [isTemplateSelectorOpen, setIsTemplateSelectorOpen] = useState(false);
    const [isAutoSavePaused, setIsAutoSavePaused] = useState(false);
    const [isCreatingResume, setIsCreatingResume] = useState(false);
    const [resumeName, setResumeName] = useState(UNTITLED_RESUME_TITLE);

    const [profile, setProfile] = useState<ResumeEditorProfile>(DEFAULT_PROFILE);
    const [personalSummary, setPersonalSummary] = useState('');
    const [hasPersonalSummaryOverride, setHasPersonalSummaryOverride] = useState(false);
    const [profileSyncMode, setProfileSyncMode] = useState<ProfileSyncMode>(PROFILE_SYNC_MODES.global);
    const [profileSocialLinks, setProfileSocialLinks] = useState<Record<string, any>>({});
    const [isEditingProfile, setIsEditingProfile] = useState(false);
    const [isSavingProfile, setIsSavingProfile] = useState(false);
    const [originalProfile, setOriginalProfile] = useState<ResumeEditorProfile>(DEFAULT_PROFILE);
    const [originalProfileSyncMode, setOriginalProfileSyncMode] = useState<ProfileSyncMode>(
        PROFILE_SYNC_MODES.global
    );

    const [educations, setEducations] = useState<EducationView[]>([]);
    const [educationSourceMap, setEducationSourceMap] = useState<Map<string, ExperienceListItem>>(
        new Map()
    );
    const [certifications, setCertifications] = useState<CertificationView[]>([]);
    const [certificationSourceMap, setCertificationSourceMap] = useState<Map<string, CertificationRecord>>(
        new Map()
    );
    const [skillGroups, setSkillGroups] = useState<SkillGroupView[]>([]);
    const [selectedEduIds, setSelectedEduIds] = useState<Set<string>>(new Set());
    const [selectedCertIds, setSelectedCertIds] = useState<Set<string>>(new Set());
    const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(new Set());
    const [experienceItems, setExperienceItems] = useState<ResumeExperienceView[]>([]);
    const [selectedExpIds, setSelectedExpIds] = useState<Set<string>>(new Set());

    const [isAutoAssembling, setIsAutoAssembling] = useState(false);
    const [bossGreeting, setBossGreeting] = useState('');
    const [bossGreetingSignature, setBossGreetingSignature] = useState('');
    const [isBossGreetingVisible, setIsBossGreetingVisible] = useState(false);
    const [isGeneratingBossGreeting, setIsGeneratingBossGreeting] = useState(false);
    const [persistedJDAnalysisSnapshot, setPersistedJDAnalysisSnapshot] =
        useState<ResumeJDAnalysis | null | undefined>(undefined);

    const [sidebarTab, setSidebarTab] = useState<'profile' | 'experience'>('experience');
    const mobileEditorScrollContainerRef = useRef<HTMLDivElement | null>(null);
    const [density, setDensity] = useState<'compact' | 'standard' | 'spacious'>('standard');
    const previousDensityRef = useRef<'compact' | 'standard' | 'spacious'>(density);
    const manualSelectionVersionRef = useRef(0);
    const manualLayoutVersionRef = useRef(0);
    const isProgrammaticSelectionUpdateRef = useRef(false);
    const manualSelectionSnapshotRef = useRef<ManualSelectionSnapshot>({
        experienceIds: [],
        certificationIds: [],
        skillIds: [],
    });
    const latestLayoutSnapshotRef = useRef<LayoutSnapshot>(
        buildLayoutSnapshot(
            {
                topPaddingPx,
                sectionSpacingKey,
                itemSpacingEm,
                lineHeight,
                fontSize,
            },
            isSmartPageApplied
        )
    );
    const manualLayoutSnapshotRef = useRef<LayoutSnapshot>(
        buildLayoutSnapshot(
            {
                topPaddingPx,
                sectionSpacingKey,
                itemSpacingEm,
                lineHeight,
                fontSize,
            },
            isSmartPageApplied
        )
    );
    const latestResumeIdRef = useRef<string | undefined>(undefined);
    const latestBossGreetingSignatureRef = useRef('');
    const latestBossGreetingAnalysisOutdatedRef = useRef(false);
    const autoAssembleRequestIdRef = useRef(0);
    const bossGreetingRequestIdRef = useRef(0);
    const pendingPersistedBossGreetingRef = useRef<PendingPersistedBossGreeting | null>(null);
    const activeAutoAssembleToastIdRef = useRef<string | null>(null);
    const activeBossGreetingToastIdRef = useRef<string | null>(null);
    const bossGreetingUiStateRef = useRef({
        text: '',
        signature: '',
        isVisible: false,
    });

    const currentLayout = useMemo<SmartPageLayout>(() => ({
        topPaddingPx,
        sectionSpacingKey,
        itemSpacingEm,
        lineHeight,
        fontSize,
    }), [fontSize, itemSpacingEm, lineHeight, sectionSpacingKey, topPaddingPx]);
    const defaultLayout = useMemo(
        () => buildDefaultSmartPageLayout(density),
        [density]
    );
    const isLayoutModified = useMemo(
        () => !areLayoutValuesEqual(currentLayout, defaultLayout),
        [currentLayout, defaultLayout]
    );

    const [sectionOrder, setSectionOrder] = useState<string[]>(
        () => [...DEFAULT_SECTION_ORDER]
    );
    const [isSummaryVisible, setIsSummaryVisible] = useState(false);
    const previewRef = useRef<HTMLDivElement | null>(null);
    const previewContentRef = useRef<HTMLDivElement | null>(null);
    const measurePreviewRef = useRef<HTMLDivElement | null>(null);
    const measurePreviewContentRef = useRef<HTMLDivElement | null>(null);
    const a4HeightRef = useRef<number | null>(null);
    const smartPageAdjustingRef = useRef(false);
    const [isExportingPdf, setIsExportingPdf] = useState(false);
    const [resumeTemplateId, setResumeTemplateId] = useState<ResumeTemplateId>(DEFAULT_RESUME_TEMPLATE_ID);
    const [themeColorPresetId, setThemeColorPresetId] = useState<ResumeThemeColorPresetId>(
        resolveDefaultResumeThemeColorPresetId(DEFAULT_RESUME_TEMPLATE_ID)
    );
    const [experienceListMarkerStyle, setExperienceListMarkerStyle] = useState<ResumeExperienceListMarkerStyle>(
        DEFAULT_RESUME_EXPERIENCE_LIST_MARKER_STYLE
    );
    const [skillTagSeparator, setSkillTagSeparator] = useState(DEFAULT_RESUME_SKILL_TAG_SEPARATOR);

    const layoutOrders: ResumeLayoutOrders = useMemo(
        () => ({
            workExperienceIds: experienceItems.filter((item) => item.category === 'work').map((item) => item.id),
            projectExperienceIds: experienceItems.filter((item) => item.category === 'project').map((item) => item.id),
            educationIds: educations.map((item) => item.id),
            certificationIds: certifications.map((item) => item.id),
            skillGroupNames: skillGroups.map((group) => group.name),
        }),
        [certifications, educations, experienceItems, skillGroups]
    );
    const bossGreetingSnapshot = useMemo<ResumeBossGreeting | null>(() => {
        const greeting = bossGreeting.trim();
        if (!greeting) {
            return null;
        }
        return {
            greeting,
            ...(bossGreetingSignature.trim() ? { signature: bossGreetingSignature } : {}),
        };
    }, [bossGreeting, bossGreetingSignature]);

    return {
        lineHeight, setLineHeight,
        fontSize, setFontSize,
        topPaddingPx, setTopPaddingPx,
        sectionSpacingKey, setSectionSpacingKey,
        itemSpacingEm, setItemSpacingEm,
        measureLayout, setMeasureLayout,
        isSmartPageApplied, setIsSmartPageApplied,
        isLayoutAdjustToolbarOpen, setIsLayoutAdjustToolbarOpen,
        isTemplateSelectorOpen, setIsTemplateSelectorOpen,
        isAutoSavePaused, setIsAutoSavePaused,
        isCreatingResume, setIsCreatingResume,
        resumeName, setResumeName,
        profile, setProfile,
        personalSummary, setPersonalSummary,
        hasPersonalSummaryOverride, setHasPersonalSummaryOverride,
        profileSyncMode, setProfileSyncMode,
        profileSocialLinks, setProfileSocialLinks,
        isEditingProfile, setIsEditingProfile,
        isSavingProfile, setIsSavingProfile,
        originalProfile, setOriginalProfile,
        originalProfileSyncMode, setOriginalProfileSyncMode,
        educations, setEducations,
        educationSourceMap, setEducationSourceMap,
        certifications, setCertifications,
        certificationSourceMap, setCertificationSourceMap,
        skillGroups, setSkillGroups,
        selectedEduIds, setSelectedEduIds,
        selectedCertIds, setSelectedCertIds,
        selectedSkillIds, setSelectedSkillIds,
        experienceItems, setExperienceItems,
        selectedExpIds, setSelectedExpIds,
        isAutoAssembling, setIsAutoAssembling,
        bossGreeting, setBossGreeting,
        bossGreetingSignature, setBossGreetingSignature,
        isBossGreetingVisible, setIsBossGreetingVisible,
        isGeneratingBossGreeting, setIsGeneratingBossGreeting,
        persistedJDAnalysisSnapshot, setPersistedJDAnalysisSnapshot,
        sidebarTab, setSidebarTab,
        mobileEditorScrollContainerRef,
        density, setDensity,
        previousDensityRef,
        manualSelectionVersionRef,
        manualLayoutVersionRef,
        isProgrammaticSelectionUpdateRef,
        manualSelectionSnapshotRef,
        latestLayoutSnapshotRef,
        manualLayoutSnapshotRef,
        latestResumeIdRef,
        latestBossGreetingSignatureRef,
        latestBossGreetingAnalysisOutdatedRef,
        autoAssembleRequestIdRef,
        bossGreetingRequestIdRef,
        pendingPersistedBossGreetingRef,
        activeAutoAssembleToastIdRef,
        activeBossGreetingToastIdRef,
        bossGreetingUiStateRef,
        currentLayout,
        defaultLayout,
        isLayoutModified,
        sectionOrder, setSectionOrder,
        isSummaryVisible, setIsSummaryVisible,
        previewRef,
        previewContentRef,
        measurePreviewRef,
        measurePreviewContentRef,
        a4HeightRef,
        smartPageAdjustingRef,
        isExportingPdf, setIsExportingPdf,
        resumeTemplateId, setResumeTemplateId,
        themeColorPresetId, setThemeColorPresetId,
        experienceListMarkerStyle, setExperienceListMarkerStyle,
        skillTagSeparator, setSkillTagSeparator,
        layoutOrders,
        bossGreetingSnapshot,
    };
}
