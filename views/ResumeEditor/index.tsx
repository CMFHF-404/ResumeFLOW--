import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Database } from 'lucide-react';
import ConfirmDialog from '../../components/ConfirmDialog';
import { ToastContainer, useToast } from '../../components/Toast';
import { useExperienceActions } from '../../hooks/useExperienceActions';
import { useJDAnalysis } from '../../hooks/useJDAnalysis';
import { useResumeData } from '../../hooks/useResumeData';
import { type PolishMode } from '../../services/aiService';
import type { Certification as CertificationRecord } from '../../services/certificationsService';
import { experienceService, type ExperienceListItem } from '../../services/experienceService';
import type {
    CertificationView,
    EducationView,
    ExperienceEditDraft,
    PolishPreviewState,
    ProfileSyncMode,
    ResumeBossGreeting,
    ResumeEditorProfile,
    ResumeExperienceListMarkerStyle,
    ResumeJDAnalysis,
    ResumeLayoutOrders,
    ResumeExperienceView,
    SectionSpacingKey,
    SkillGroupView,
} from '../../types/resume';
import type { Resume as DashboardResume } from '../../types';
import { buildExperienceDate } from '../../utils/dateUtils';
import {
    buildResumeAISnapshot,
    buildStarFields,
    mergeStarFieldsWithSource,
} from '../../utils/resumeHelpers';
import {
    clearPendingAssistantManualSaveDraft,
    type PendingAssistantManualSaveDraft,
    readPendingAssistantManualSaveDrafts,
} from '../assistantManualSaveStorage';
import { buildJDCapabilityContext, buildJDPolishContext } from '../../utils/assistantResumeContext';
import { buildSmartCompleteAssistantPrompt } from '../../utils/assistantSmartCompletePrompt';
import { normalizeAssistantDraftCard } from '../../utils/assistantDraft';
import {
    trackAiPolishResult,
    trackAiPolishStart,
    trackAiPolishUndone,
    trackLayoutModeChange,
} from '../../utils/analyticsTracker';
import { resolveResumeDisplayTitle, UNTITLED_RESUME_TITLE } from '../../constants/resumeConstants';
import {
    AUTO_SAVE_DELAY_MS,
    CERTIFICATION_DRAFT_PREFIX,
    CONFIRM_DELETE_CERTIFICATION_TEXT,
    CONFIRM_DELETE_CERTIFICATION_TITLE,
    CONFIRM_DELETE_EDUCATION_TEXT,
    CONFIRM_DELETE_EDUCATION_TITLE,
    CONFIRM_DELETE_EXPERIENCE_TEXT,
    CONFIRM_DELETE_EXPERIENCE_TITLE,
    CONFIRM_DELETE_SKILL_CATEGORY_TEXT,
    CONFIRM_DELETE_SKILL_CATEGORY_TITLE,
    CONFIRM_DELETE_SKILL_TEXT,
    CONFIRM_DELETE_SKILL_TITLE,
    DEFAULT_PROFILE,
    DEFAULT_EXPERIENCE_TITLE_BY_CATEGORY,
    DEFAULT_EXPERIENCE_COMPANY_BY_CATEGORY,
    DEFAULT_SECTION_ORDER,
    DEFAULT_SKILL_CATEGORY,
    DEFAULT_SKILL_NAME,
    EDUCATION_DRAFT_PREFIX,
    EXPERIENCE_DRAFT_PREFIX,
    FONT_SIZE_DEFAULT,
    FONT_SIZE_MAX,
    FONT_SIZE_MIN,
    FONT_SIZE_STEP,
    LINE_HEIGHT_DEFAULT,
    LINE_HEIGHT_MAX,
    LINE_HEIGHT_MIN,
    LINE_HEIGHT_STEP,
    LIST_SPACING_BY_DENSITY,
    PROFILE_SYNC_MODES,
    SIDEBAR_WIDTH_CLASS,
    SMART_PAGE_ITEM_SPACING_MIN,
    SMART_PAGE_ITEM_SPACING_STEP,
    SMART_PAGE_TOP_PADDING_STEP_PX,
} from './constants';
import { buildDragItemKey } from './dragKeys';
import {
    buildCertificationDraft,
    buildCertificationPayload,
    buildCertificationView,
    buildDraftCertificationView,
    buildDraftEducationView,
    buildDraftExperienceView,
    buildEducationDraft,
    buildEducationVersionPayload,
    buildEducationView,
    buildExperienceEditDraft,
    buildResumeConfigSnapshot,
    buildResumeExperienceMap,
    buildResumeExperienceView,
    buildSkillGroups,
    buildSourceMap,
    compareByDateDesc,
    compareCertificationByDateDesc,
    isPresentLabel,
    mergeStarFields,
    normalizeSectionOrder,
    resolveEducationDatePayload,
    resolveExperienceDatePayload,
    resolveProfileSnapshot,
    resolveProfileSyncMode,
    resolveSafeDateRange,
    resolveSelectionSet,
    sortByCategory,
} from './helpers';
import {
    FONT_SIZE_OPTIONS,
    ITEM_SPACING_SELECT_OPTIONS,
    LINE_HEIGHT_OPTIONS,
    MAX_ITEM_SPACING_EM,
    SECTION_SPACING_OPTIONS,
    TOP_PADDING_MIN_PX,
    TOP_PADDING_SELECT_OPTIONS,
    TOP_PADDING_SLIDER_MAX,
    areLayoutValuesEqual,
    buildDefaultSmartPageLayout,
    buildSpacingValue,
    resolveDefaultItemSpacingEm,
    resolveDefaultSectionSpacingKey,
    resolveDefaultTopPaddingPx,
    resolveSectionSpacingClass,
    type LayoutSnapshot,
    type SmartPageLayout,
} from './layoutUtils';
import {
    buildLayoutSnapshot,
    type ManualSelectionSnapshot,
} from './autoAssemblyUtils';
import {
    normalizeResumeTitle,
} from './autoNameUtils';
import {
    applyAssistantExperienceDraftToEditingDraft,
    buildPendingAssistantManualSaveDraftKey,
} from './assistantDraftApplyUtils';
import { applyAssistantExperienceDraftToDraft } from './assistantApplyUtils';
import {
    buildSmartCompletionPromptState,
    type SmartCompletionPromptState,
} from './smartCompletionUtils';
import {
    buildExperiencePolishPayloadContent,
    buildPolishedExperienceDraft,
    resolveExperiencePolishCustomPrompt,
    shouldAskBeforeSmartCompletionRewrite,
} from './experiencePolishUtils';
import {
    buildBossGreetingSignature,
    buildPersonalSummarySignature,
    buildStableResumeSnapshotText,
    waitForNextFrame,
    type PendingPersistedBossGreeting,
} from './snapshotUtils';
import {
    buildPersonalSummaryContext,
    hasMeaningfulPersonalSummary,
    resolveEditablePersonalSummary,
    resolveEffectivePersonalSummary,
} from './personalSummaryUtils';
import {
    DEFAULT_RESUME_EXPERIENCE_LIST_MARKER_STYLE,
    DEFAULT_RESUME_SKILL_TAG_SEPARATOR,
} from '../../utils/resumeCustomization';
import {
    DEFAULT_RESUME_TEMPLATE_ID,
    RESUME_THEME_COLOR_PRESETS,
    resolveDefaultResumeThemeColorPresetId,
    type ResumeTemplateId,
    type ResumeThemeColorPresetId,
} from '../../constants/resumeTemplates';
import {
    buildPreferredResumeCreateConfig,
} from '../resumeTemplateStorage';
import EditorSidebar from './components/EditorSidebar';
import EditorToolbar from './components/EditorToolbar';
import LayoutAdjustToolbar from './components/LayoutAdjustToolbar';
import MobileEditorHeader from './components/MobileEditorHeader';
import TemplateSelectorModal from './components/TemplateSelectorModal';
import ResumePreview from './components/ResumePreview';
import buildExperiencePolishToolbars from './components/ExperiencePolishToolbars';
import type { AssistantLaunchRequest } from '../AIAssistant/types';
import { useMobileEditorDrawer } from './hooks/useMobileEditorDrawer';
import { useResumePdfExport } from './hooks/useResumePdfExport';
import { useResumeEditorNavigationHandlers } from './hooks/useResumeEditorNavigationHandlers';
import { useDashboardResumeSync } from './hooks/useDashboardResumeSync';
import { useCreateResumeFlow } from './hooks/useCreateResumeFlow';
import { useTemplatePresetSync } from './hooks/useTemplatePresetSync';
import { usePersonalSummaryGeneration } from './hooks/usePersonalSummaryGeneration';
import { useBossGreetingActions } from './hooks/useBossGreetingActions';
import { useSmartPageLayoutControls } from './hooks/useSmartPageLayoutControls';
import { useAutoAssemblySelectionRunner } from './hooks/useAutoAssemblySelectionRunner';
import { useAutoAssembleAction } from './hooks/useAutoAssembleAction';
import { useResumeEditorJdPanelState } from './hooks/useResumeEditorJdPanelState';
import { useResumeAssistantDraftApply } from './hooks/useResumeAssistantDraftApply';
import { useResumePreviewMeasurement } from './hooks/useResumePreviewMeasurement';
import { useResumeEditorReorder } from './hooks/useResumeEditorReorder';
import { useResumeNameUpdate } from './hooks/useResumeNameUpdate';
import { useJdAnalyzeWithToast } from './hooks/useJdAnalyzeWithToast';
import { useTrackedResumeSelection } from './hooks/useTrackedResumeSelection';
import { useSmartPageExecution } from './hooks/useSmartPageExecution';
import { useTemplatePresetActions } from './hooks/useTemplatePresetActions';
import { useAutoAssemblySelection } from './hooks/useAutoAssemblySelection';
import { usePendingExperienceApplyState } from './hooks/usePendingExperienceApplyState';
import { useProfileEditActions } from './hooks/useProfileEditActions';
import { useApplyResumeLayoutConfig } from './hooks/useApplyResumeLayoutConfig';
import { useEditorThemeState } from './hooks/useEditorThemeState';
import { usePersistedBossGreetingSync } from './hooks/usePersistedBossGreetingSync';
import { useCommittedResumeConfigSnapshot } from './hooks/useCommittedResumeConfigSnapshot';
import { useEditingExperiencePolishActions } from './hooks/useEditingExperiencePolishActions';
import { useFloatingExperiencePolishSession } from './hooks/useFloatingExperiencePolishSession';
import { useFloatingExperiencePolishActions } from './hooks/useFloatingExperiencePolishActions';
import { useFloatingExperiencePolishConfirmActions } from './hooks/useFloatingExperiencePolishConfirmActions';
import { useFloatingPolishResumePersistence } from './hooks/useFloatingPolishResumePersistence';
type ResumeEditorProps = {
    cachedResumes?: DashboardResume[];
    cachedResumesOwnerKey?: string | null;
    authUserKey?: string | null;
    onResumesUpdate?: (resumes: DashboardResume[]) => void;
    onLaunchAssistant?: (request: AssistantLaunchRequest) => void;
    onOpenAgentPluginConfig?: () => void;
    mobileDrawerOpenRequest?: number;
    onMobileDrawerOpenRequestConsumed?: () => void;
};

type ResumePolishMode = Exclude<PolishMode, 'assistant'>;
const DEFAULT_RESUME_POLISH_MODE: ResumePolishMode = 'default';
const SMART_RESUME_POLISH_MODES: ResumePolishMode[] = [
    'default',
    'highlight',
    'custom',
];
const BATCH_RESUME_POLISH_MODES: ResumePolishMode[] = [
    'default',
    'highlight',
    'custom',
];

const ResumeEditor: React.FC<ResumeEditorProps> = ({
    cachedResumes = [],
    cachedResumesOwnerKey = null,
    authUserKey = null,
    onResumesUpdate,
    onLaunchAssistant,
    onOpenAgentPluginConfig,
    mobileDrawerOpenRequest = 0,
    onMobileDrawerOpenRequestConsumed,
}) => {
    const { isDarkMode, toggleTheme } = useEditorThemeState();
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
    // 1. Profile State
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
    // 教育背景状态
    const [educations, setEducations] = useState<EducationView[]>([]);
    const [educationSourceMap, setEducationSourceMap] = useState<Map<string, ExperienceListItem>>(
        new Map()
    );
    // 证书与技能状态
    const [certifications, setCertifications] = useState<CertificationView[]>([]);
    const [certificationSourceMap, setCertificationSourceMap] = useState<Map<string, CertificationRecord>>(
        new Map()
    );
    const [skillGroups, setSkillGroups] = useState<SkillGroupView[]>([]);
    const isCacheOwnerMatched = Boolean(
        cachedResumesOwnerKey && authUserKey && cachedResumesOwnerKey === authUserKey
    );
    // 教育背景/证书/技能选择状态
    const [selectedEduIds, setSelectedEduIds] = useState<Set<string>>(new Set());
    const [selectedCertIds, setSelectedCertIds] = useState<Set<string>>(new Set());
    const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(new Set());
    // 2. Experience State
    const [experienceItems, setExperienceItems] = useState<ResumeExperienceView[]>([]);
    const [selectedExpIds, setSelectedExpIds] = useState<Set<string>>(new Set());
    const [isAutoAssembling, setIsAutoAssembling] = useState(false);
    const [bossGreeting, setBossGreeting] = useState('');
    const [bossGreetingSignature, setBossGreetingSignature] = useState('');
    const [isBossGreetingVisible, setIsBossGreetingVisible] = useState(false);
    const [isGeneratingBossGreeting, setIsGeneratingBossGreeting] = useState(false);
    const [persistedJDAnalysisSnapshot, setPersistedJDAnalysisSnapshot] =
        useState<ResumeJDAnalysis | null | undefined>(undefined);
    // 3. UI State
    const [sidebarTab, setSidebarTab] = useState<'profile' | 'experience'>('experience');
    const mobileEditorScrollContainerRef = useRef<HTMLDivElement | null>(null);
    const mobileEditorDrawer = useMobileEditorDrawer({
        mobileDrawerOpenRequest,
        onMobileDrawerOpenRequestConsumed,
        scrollContainerRef: mobileEditorScrollContainerRef,
        setSidebarTab,
    });
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
    // resumeId 在 useResumeData() 之后才声明，此处不能直接引用，初始化为 undefined。
    // 在 useEffect 中同步更新，确保 ref 始终持有最新值。
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
    const {
        toasts,
        success: showToastSuccess,
        error: showToastError,
        info: showToastInfo,
        loading: showToastLoading,
        updateToast,
        closeToast,
    } = useToast();
    const {
        templatePresetMap,
        setTemplatePresetMap,
        isTemplatePresetMapReady,
        isTemplatePresetFallbackAvailable,
        templatePresetFallbackOwnerKey,
        handleOpenTemplateSelector,
        unlockTemplatePresetMapWithLocalFallback,
    } = useTemplatePresetSync(authUserKey, setIsTemplateSelectorOpen);
    useEffect(() => {
        if (previousDensityRef.current !== density) {
            trackLayoutModeChange({
                from: previousDensityRef.current,
                to: density,
            });
            previousDensityRef.current = density;
        }
    }, [density]);
    useEffect(() => {
        if (smartPageAdjustingRef.current || isSmartPageApplied) {
            return;
        }
        setSectionSpacingKey(resolveDefaultSectionSpacingKey(density));
        setItemSpacingEm(resolveDefaultItemSpacingEm(density));
    }, [density, isSmartPageApplied]);
    useEffect(() => {
        latestLayoutSnapshotRef.current = buildLayoutSnapshot(
            {
                topPaddingPx,
                sectionSpacingKey,
                itemSpacingEm,
                lineHeight,
                fontSize,
            },
            isSmartPageApplied
        );
        if (!isAutoAssembling && !smartPageAdjustingRef.current) {
            manualLayoutSnapshotRef.current = latestLayoutSnapshotRef.current;
        }
    }, [
        fontSize,
        isAutoAssembling,
        isSmartPageApplied,
        itemSpacingEm,
        lineHeight,
        sectionSpacingKey,
        topPaddingPx,
    ]);
    // Section Order State (for draggable resume sections)
    const [sectionOrder, setSectionOrder] = useState<string[]>(
        () => [...DEFAULT_SECTION_ORDER]
    );
    const [isSummaryVisible, setIsSummaryVisible] = useState(false);
    const previewRef = useRef<HTMLDivElement | null>(null);
    const previewContentRef = useRef<HTMLDivElement | null>(null);
    const measurePreviewRef = useRef<HTMLDivElement | null>(null);
    const measurePreviewContentRef = useRef<HTMLDivElement | null>(null);
    const a4HeightRef = useRef<number | null>(null);
    const {
        isDragging,
        draggedItemKey,
        draggedSectionId,
        startItemReorder,
        handleDragStart,
        clearDragState,
        finishDragInteraction,
        cancelTouchDragInteraction,
        handleItemDragHover,
        handleItemDrop,
        handleResetSort,
        handleResetCertificationSort,
        startSectionReorder,
        handleSectionDragStart,
        handleSectionDragHover,
        handleSectionDrop,
    } = useResumeEditorReorder({
        authUserKey,
        experienceItems,
        setExperienceItems,
        educations,
        setEducations,
        certifications,
        setCertifications,
        skillGroups,
        setSkillGroups,
        sectionOrder,
        setSectionOrder,
    });
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

    const resumeConfigSnapshot = useMemo(
        () =>
            buildResumeConfigSnapshot(
                profile,
                personalSummary,
                hasPersonalSummaryOverride,
                bossGreetingSnapshot,
                profileSyncMode,
                selectedExpIds,
                selectedEduIds,
                selectedCertIds,
                selectedSkillIds,
                sectionOrder,
                density,
                topPaddingPx,
                sectionSpacingKey,
                itemSpacingEm,
                lineHeight,
                fontSize,
                isSmartPageApplied,
                isSummaryVisible,
                layoutOrders,
                resumeTemplateId,
                themeColorPresetId,
                experienceListMarkerStyle,
                skillTagSeparator,
                persistedJDAnalysisSnapshot
            ),
        [
            density,
            bossGreetingSnapshot,
            fontSize,
            isSmartPageApplied,
            isSummaryVisible,
            lineHeight,
            itemSpacingEm,
            layoutOrders,
            persistedJDAnalysisSnapshot,
            hasPersonalSummaryOverride,
            personalSummary,
            profile,
            profileSyncMode,
            resumeTemplateId,
            themeColorPresetId,
            experienceListMarkerStyle,
            sectionOrder,
            sectionSpacingKey,
            selectedCertIds,
            selectedEduIds,
            selectedExpIds,
            topPaddingPx,
            selectedSkillIds,
            skillTagSeparator,
        ]
    );
    const applyLayoutConfig = useApplyResumeLayoutConfig({
        setTopPaddingPx,
        setSectionSpacingKey,
        setItemSpacingEm,
        setLineHeight,
        setFontSize,
        setMeasureLayout,
        setIsSmartPageApplied,
        setResumeTemplateId,
        setThemeColorPresetId,
        setExperienceListMarkerStyle,
        setSkillTagSeparator,
    });
    const {
        resumeId,
        resumeDetail,
        resumeExperienceMap,
        experienceSourceMap,
        setResumeExperienceMap,
        setExperienceSourceMap,
        isLoadingResume,
        isLoadingExperiences,
        saveState,
        lastSavedAt,
        applyResumeDetail,
        flushResumeConfig,
        reloadResumeContext,
        suppressAutoSaveForConfig,
        clearSuppressedAutoSave,
    } = useResumeData({
        configSnapshot: resumeConfigSnapshot,
        persistedJDAnalysisSnapshot,
        autoSaveDelayMs: AUTO_SAVE_DELAY_MS,
        isAutoSavePaused,
        authUserKey,
        setProfile,
        setPersonalSummary,
        setHasPersonalSummaryOverride,
        setProfileSyncMode,
        setProfileSocialLinks,
        setSectionOrder,
        setDensity,
        setIsSummaryVisible,
        applyLayoutConfig,
        setExperienceItems,
        setSelectedExpIds,
        setEducations,
        setEducationSourceMap,
        setSelectedEduIds,
        setCertifications,
        setCertificationSourceMap,
        setSelectedCertIds,
        setSkillGroups,
        setSelectedSkillIds,
        buildResumeExperienceMap,
        buildSourceMap,
        buildResumeExperienceView,
        buildEducationView,
        buildCertificationView,
        buildSkillGroups,
        resolveSelectionSet,
        normalizeSectionOrder,
        resolveProfileSyncMode,
        resolveProfileSnapshot,
        sortByCategory,
        compareByDateDesc,
        compareCertificationByDateDesc,
    });
    useEffect(() => {
        setIsLayoutAdjustToolbarOpen(false);
    }, [resumeId]);
    const {
        handleSelectTemplate,
        handleSaveTemplatePreset,
    } = useTemplatePresetActions({
        isTemplatePresetMapReady,
        templatePresetMap,
        resumeTemplateId,
        themeColorPresetId,
        experienceListMarkerStyle,
        skillTagSeparator,
        sectionOrder,
        setResumeTemplateId,
        setThemeColorPresetId,
        setExperienceListMarkerStyle,
        setSkillTagSeparator,
        setSectionOrder,
        setIsTemplateSelectorOpen,
        setTemplatePresetMap,
        showToastInfo,
        showToastSuccess,
        showToastError,
    });
    usePersistedBossGreetingSync({
        resumeId,
        persistedConfigBossGreeting: resumeDetail?.resume?.config?.bossGreeting,
        pendingPersistedBossGreetingRef,
        bossGreetingUiStateRef,
        setBossGreeting,
        setBossGreetingSignature,
        setIsBossGreetingVisible,
    });
    const buildCommittedResumeConfigSnapshot = useCommittedResumeConfigSnapshot({
        resumeId,
        resumeDetail,
        persistedJDAnalysisSnapshot,
        isEditingProfile,
        originalProfile,
        profile,
        originalProfileSyncMode,
        profileSyncMode,
        personalSummary,
        hasPersonalSummaryOverride,
        bossGreetingSnapshot,
        selectedExpIds,
        selectedEduIds,
        selectedCertIds,
        selectedSkillIds,
        sectionOrder,
        density,
        topPaddingPx,
        sectionSpacingKey,
        itemSpacingEm,
        lineHeight,
        fontSize,
        isSmartPageApplied,
        isSummaryVisible,
        layoutOrders,
        resumeTemplateId,
        themeColorPresetId,
        experienceListMarkerStyle,
        skillTagSeparator,
    });
    // 将 resumeId 同步到 ref，供不可在 render 阶段读取的异步回调使用。
    useEffect(() => {
        latestResumeIdRef.current = resumeId;
    }, [resumeId]);
    useEffect(() => {
        setPersistedJDAnalysisSnapshot(undefined);
    }, [resumeId]);
    const {
        jdText,
        setJdText,
        jdFile,
        setJdFile,
        analysisResult,
        isAnalyzing,
        isJDCollapsed,
        setIsJDCollapsed,
        staleExperienceIds,
        certificationMatchScores,
        certificationMatchTrends,
        setCertificationMatchScores,
        setCertificationMatchTrends,
        skillMatchScores,
        skillMatchTrends,
        setSkillMatchScores,
        setSkillMatchTrends,
        handleAnalyze,
        hasMissingAttachmentContext,
        debugInfo,
        isOutdated,
    } = useJDAnalysis({
        resumeId,
        experienceItems,
        setExperienceItems,
        certifications,
        skillGroups,
        persistedJDAnalysis: resumeDetail?.resume?.config?.jdAnalysis,
        onPersistedJDAnalysisChange: setPersistedJDAnalysisSnapshot,
        isLoadingResume,
        isLoadingExperiences,
        authUserKey,
    });
    const jdPolishContext = useMemo(
        () => buildJDPolishContext(jdText, analysisResult, isOutdated),
        [analysisResult, isOutdated, jdText]
    );
    const jdCapabilityPolishContext = useMemo(
        () => buildJDCapabilityContext(analysisResult, isOutdated),
        [analysisResult, isOutdated]
    );
    const {
        activeManualSaveDraftRef,
        appliedManualSaveDraftKeyRef,
        clearPendingExperienceState,
        handleExperienceSaveSuccess,
        markPendingExperienceAiPolishApply,
        movePendingExperienceAiPolishApply,
        movePendingExperienceAssistantApply,
        pendingAiPolishApplyRef,
        pendingAssistantApplyRef,
        trackedPendingAssistantApplyRef,
    } = usePendingExperienceApplyState({
        resumeId,
        showToastError,
    });
    const {
        confirmDialog,
        handleConfirmDelete,
        handleCancelDelete,
        experience,
        education,
        certification,
        skill,
        selection,
    } = useExperienceActions({
        resumeId,
        jdText: jdPolishContext,
        toast: {
            success: showToastSuccess,
            error: showToastError,
            loading: showToastLoading,
            updateToast,
            closeToast,
        },
        applyResumeDetail,
        onExperienceDraftPersisted: (draftMasterId, savedMasterId) => {
            movePendingExperienceAssistantApply(draftMasterId, savedMasterId);
            movePendingExperienceAiPolishApply(draftMasterId, savedMasterId);
        },
        onExperienceAiPolishPrepared: markPendingExperienceAiPolishApply,
        onExperienceSaveSuccess: handleExperienceSaveSuccess,
        onExperienceEditDiscarded: clearPendingExperienceState,
        experience: {
            items: experienceItems,
            setItems: setExperienceItems,
            selectedIds: selectedExpIds,
            setSelectedIds: setSelectedExpIds,
            resumeMap: resumeExperienceMap,
            setResumeMap: setResumeExperienceMap,
            sourceMap: experienceSourceMap,
            setSourceMap: setExperienceSourceMap,
        },
        education: {
            items: educations,
            setItems: setEducations,
            selectedIds: selectedEduIds,
            setSelectedIds: setSelectedEduIds,
            sourceMap: educationSourceMap,
            setSourceMap: setEducationSourceMap,
        },
        certification: {
            items: certifications,
            setItems: setCertifications,
            selectedIds: selectedCertIds,
            setSelectedIds: setSelectedCertIds,
            sourceMap: certificationSourceMap,
            setSourceMap: setCertificationSourceMap,
        },
        skill: {
            groups: skillGroups,
            setGroups: setSkillGroups,
            selectedIds: selectedSkillIds,
            setSelectedIds: setSelectedSkillIds,
        },
        jdMatch: {
            setCertificationMatchScores,
            setCertificationMatchTrends,
            setSkillMatchScores,
            setSkillMatchTrends,
        },
        helpers: {
            buildResumeExperienceView,
            buildDraftExperienceView,
            buildExperienceEditDraft,
            buildResumeExperienceMap,
            buildExperienceDate,
            buildStarFields,
            mergeStarFieldsWithSource,
            mergeStarFields,
            resolveExperienceDatePayload,
            resolveEducationDatePayload,
            resolveSafeDateRange,
            isPresentLabel,
            sortByCategory,
            compareByDateDesc,
            compareCertificationByDateDesc,
            buildEducationDraft,
            buildDraftEducationView,
            buildEducationView,
            buildEducationVersionPayload,
            buildCertificationDraft,
            buildDraftCertificationView,
            buildCertificationView,
            buildCertificationPayload,
            buildSkillGroups,
        },
        defaults: {
            experienceTitleByCategory: DEFAULT_EXPERIENCE_TITLE_BY_CATEGORY,
            experienceCompanyByCategory: DEFAULT_EXPERIENCE_COMPANY_BY_CATEGORY,
            skillName: DEFAULT_SKILL_NAME,
            skillCategory: DEFAULT_SKILL_CATEGORY,
        },
        confirmCopy: {
            experience: {
                title: CONFIRM_DELETE_EXPERIENCE_TITLE,
                description: CONFIRM_DELETE_EXPERIENCE_TEXT,
            },
            education: {
                title: CONFIRM_DELETE_EDUCATION_TITLE,
                description: CONFIRM_DELETE_EDUCATION_TEXT,
            },
            certification: {
                title: CONFIRM_DELETE_CERTIFICATION_TITLE,
                description: CONFIRM_DELETE_CERTIFICATION_TEXT,
            },
            skill: {
                title: CONFIRM_DELETE_SKILL_TITLE,
                description: CONFIRM_DELETE_SKILL_TEXT,
            },
            skillCategory: {
                title: CONFIRM_DELETE_SKILL_CATEGORY_TITLE,
                description: CONFIRM_DELETE_SKILL_CATEGORY_TEXT,
            },
        },
        draftPrefixes: {
            experience: EXPERIENCE_DRAFT_PREFIX,
            education: EDUCATION_DRAFT_PREFIX,
            certification: CERTIFICATION_DRAFT_PREFIX,
        },
    });
    useEffect(() => {
        if (!resumeId) {
            return;
        }
        if (isLoadingExperiences) {
            return;
        }
        const pendingManualSaveDrafts = readPendingAssistantManualSaveDrafts({ resumeId })
            .filter((draft) => draft.source === 'resume_editor');
        if (pendingManualSaveDrafts.length === 0) {
            activeManualSaveDraftRef.current = null;
            appliedManualSaveDraftKeyRef.current = null;
            return;
        }
        const [pendingManualSaveDraft, staleManualSaveDrafts] = pendingManualSaveDrafts.reduce<
            [PendingAssistantManualSaveDraft | null, PendingAssistantManualSaveDraft[]]
        >((result, draft) => {
            const [currentDraft, staleDrafts] = result;
            const targetExists = experienceItems.some((item) => item.id === draft.masterId);
            if (targetExists) {
                return currentDraft ? result : [draft, staleDrafts];
            }
            staleDrafts.push(draft);
            return [currentDraft, staleDrafts];
        }, [null, []]);
        staleManualSaveDrafts.forEach((draft) => {
            clearPendingAssistantManualSaveDraft({
                sessionId: draft.sessionId,
                messageId: draft.messageId,
            });
        });
        if (!pendingManualSaveDraft) {
            activeManualSaveDraftRef.current = null;
            appliedManualSaveDraftKeyRef.current = null;
            return;
        }
        const draftKey = buildPendingAssistantManualSaveDraftKey(pendingManualSaveDraft);
        activeManualSaveDraftRef.current = pendingManualSaveDraft;
        if (experience.editingExpId !== pendingManualSaveDraft.masterId) {
            if (appliedManualSaveDraftKeyRef.current === draftKey) {
                return;
            }
            experience.startEditingExperience(pendingManualSaveDraft.masterId);
            return;
        }
        if (!experience.editingDraft || experience.editingDraft.masterId !== pendingManualSaveDraft.masterId) {
            return;
        }
        if (appliedManualSaveDraftKeyRef.current === draftKey) {
            return;
        }
        appliedManualSaveDraftKeyRef.current = draftKey;
        experience.setEditingDraft((prev) => {
            if (!prev || prev.masterId !== pendingManualSaveDraft.masterId) {
                return prev;
            }
            return applyAssistantExperienceDraftToEditingDraft(prev, pendingManualSaveDraft.draft);
        });
    }, [experience, experienceItems, isLoadingExperiences, resumeId]);
    const [experiencePolishMode, setExperiencePolishMode] = useState<ResumePolishMode>(DEFAULT_RESUME_POLISH_MODE);
    const [experienceCustomPrompt, setExperienceCustomPrompt] = useState('');
    const [experienceSmartCompletionPrompt, setExperienceSmartCompletionPrompt] = useState<SmartCompletionPromptState | null>(null);
    const [experiencePolishPreview, setExperiencePolishPreview] = useState<PolishPreviewState<ExperienceEditDraft> | null>(null);
    const [isEditingExperiencePolishRunning, setIsEditingExperiencePolishRunning] = useState(false);
    const editingExperiencePolishRunningRef = useRef(false);
    const [floatingPolishMode, setFloatingPolishMode] = useState<ResumePolishMode>(DEFAULT_RESUME_POLISH_MODE);
    const [floatingPolishCustomPrompt, setFloatingPolishCustomPrompt] = useState('');
    const [pendingPolishAutoAnalyzeSeq, setPendingPolishAutoAnalyzeSeq] = useState(0);

    useEffect(() => {
        setExperiencePolishMode(DEFAULT_RESUME_POLISH_MODE);
        setExperienceCustomPrompt('');
        setExperienceSmartCompletionPrompt(null);
        setExperiencePolishPreview(null);
        setIsEditingExperiencePolishRunning(false);
        editingExperiencePolishRunningRef.current = false;
    }, [experience.editingExpId]);

    const {
        handleRunEditingExperiencePolish,
        handleUndoEditingExperiencePolish,
        handleConfirmEditingExperiencePolish,
    } = useEditingExperiencePolishActions({
        editingDraft: experience.editingDraft,
        setEditingDraft: experience.setEditingDraft,
        polishMode: experiencePolishMode,
        customPrompt: experienceCustomPrompt,
        smartCompletionPrompt: experienceSmartCompletionPrompt,
        setSmartCompletionPrompt: setExperienceSmartCompletionPrompt,
        polishPreview: experiencePolishPreview,
        setPolishPreview: setExperiencePolishPreview,
        isRunningRef: editingExperiencePolishRunningRef,
        setIsRunning: setIsEditingExperiencePolishRunning,
        pendingAiPolishApplyRef,
        jdPolishContext,
        jdCapabilityPolishContext,
        showToastError,
        showToastLoading,
        updateToast,
    });

    const buildExperienceViewFromDraft = useCallback((
        baseItem: ResumeExperienceView,
        draft: ExperienceEditDraft
    ): ResumeExperienceView => {
        const safeDates = resolveSafeDateRange(
            draft.startDate,
            draft.isCurrent ? '' : draft.endDate
        );
        const nextIsCurrent = draft.isCurrent ?? isPresentLabel(draft.endDate);
        return {
            ...baseItem,
            title: draft.title.trim() || baseItem.title,
            company: draft.company.trim() || baseItem.company,
            startDate: safeDates.start,
            endDate: nextIsCurrent ? '' : safeDates.end,
            isCurrent: nextIsCurrent,
            date: buildExperienceDate(
                safeDates.start,
                nextIsCurrent ? '' : safeDates.end,
                nextIsCurrent
            ),
            star: {
                s: draft.star.s,
                t: draft.star.t,
                a: draft.star.a,
                r: draft.star.r,
            },
        };
    }, []);

    const {
        activeFloatingPolishExperienceId,
        setActiveFloatingPolishExperienceId,
        isBatchPolishToolbarOpen,
        setIsBatchPolishToolbarOpen,
        floatingSmartCompletionPrompt,
        setFloatingSmartCompletionPrompt,
        floatingPolishSession,
        setFloatingPolishSession,
        isFloatingExperiencePolishRunning,
        setIsFloatingExperiencePolishRunning,
        floatingExperiencePolishRunningRef,
        singleFloatingPolishPreview,
        batchFloatingPolishPreview,
        buildFloatingPolishSessionItem,
        applyFloatingPolishPreview,
        restoreFloatingPolishSessionItems,
        handleCloseFloatingPolishToolbar,
        handleDismissFloatingPolishToolbar,
        handleCloseBatchPolishToolbar,
        handleDismissBatchPolishToolbar,
        handlePolishExperienceFromCard,
    } = useFloatingExperiencePolishSession({
        editingExperienceId: experience.editingExpId,
        experienceItems,
        selectedExpIds,
        setExperienceItems,
        setSelectedExpIds,
        setSidebarTab,
        showToastError,
        buildExperienceViewFromDraft,
    });

    const {
        handleRunFloatingExperiencePolish,
        handleRunBatchExperiencePolish,
    } = useFloatingExperiencePolishActions({
        activeFloatingPolishExperienceId,
        experienceItems,
        selectedExpIds,
        jdPolishContext,
        jdCapabilityPolishContext,
        floatingPolishMode,
        setFloatingPolishMode,
        defaultFloatingPolishMode: DEFAULT_RESUME_POLISH_MODE,
        floatingPolishCustomPrompt,
        floatingSmartCompletionPrompt,
        setFloatingSmartCompletionPrompt,
        floatingExperiencePolishRunningRef,
        setIsFloatingExperiencePolishRunning,
        buildFloatingPolishSessionItem,
        applyFloatingPolishPreview,
        showToastError,
        showToastLoading,
        updateToast,
    });

    const handleUndoFloatingExperiencePolish = useCallback(() => {
        if (!singleFloatingPolishPreview || !floatingPolishSession || floatingPolishSession.mode !== 'single') {
            return;
        }
        restoreFloatingPolishSessionItems(floatingPolishSession);
        setFloatingPolishSession(null);
        setActiveFloatingPolishExperienceId(null);
        trackAiPolishUndone({ source: 'resume_editor', field: 'all' });
    }, [floatingPolishSession, restoreFloatingPolishSessionItems, singleFloatingPolishPreview]);

    const {
        ensureFloatingPolishResumeLink,
        ensureFloatingPolishResumeLinks,
        rollbackFloatingPolishResumeLinks,
        buildExperiencePolishOverrideOperation,
    } = useFloatingPolishResumePersistence({
        resumeId,
        resumeExperienceMap,
        experienceSourceMap,
        applyResumeDetail,
        setResumeExperienceMap,
    });

    const {
        handleConfirmFloatingExperiencePolish,
        handleConfirmBatchExperiencePolish,
    } = useFloatingExperiencePolishConfirmActions({
        resumeId,
        singleFloatingPolishPreview,
        batchFloatingPolishPreview,
        floatingExperiencePolishRunningRef,
        setIsFloatingExperiencePolishRunning,
        ensureFloatingPolishResumeLinks,
        rollbackFloatingPolishResumeLinks,
        buildExperiencePolishOverrideOperation,
        applyResumeDetail,
        setResumeExperienceMap,
        setSelectedExpIds,
        setFloatingPolishSession,
        setActiveFloatingPolishExperienceId,
        setIsBatchPolishToolbarOpen,
        setPendingPolishAutoAnalyzeSeq,
        showToastLoading,
        updateToast,
    });

    const handleOpenBatchPolishToolbar = useCallback(() => {
        if (isFloatingExperiencePolishRunning) {
            showToastError('请等待当前润色完成后再继续操作');
            return;
        }
        if (floatingPolishSession) {
            showToastError('请先确认或撤销当前润色结果');
            return;
        }
        if (activeFloatingPolishExperienceId) {
            showToastError('请先关闭当前润色工具栏');
            return;
        }
        setSidebarTab('experience');
        setFloatingSmartCompletionPrompt(null);
        if (floatingPolishMode === 'smart_complete') {
            setFloatingPolishMode(DEFAULT_RESUME_POLISH_MODE);
        }
        setIsBatchPolishToolbarOpen(true);
    }, [
        activeFloatingPolishExperienceId,
        floatingPolishSession,
        floatingPolishMode,
        isFloatingExperiencePolishRunning,
        showToastError,
    ]);

    const handleUndoBatchExperiencePolish = useCallback(() => {
        if (!batchFloatingPolishPreview) {
            return;
        }
        restoreFloatingPolishSessionItems(batchFloatingPolishPreview);
        setFloatingPolishSession(null);
        setIsBatchPolishToolbarOpen(false);
        trackAiPolishUndone({ source: 'resume_editor', field: 'all' });
    }, [batchFloatingPolishPreview, restoreFloatingPolishSessionItems]);

    const handleOpenExperienceAssistant = useCallback(() => {
        if (!experience.editingDraft || !onLaunchAssistant) {
            return;
        }
        const draft = experience.editingDraft;
        onLaunchAssistant({
            context: {
                mode: 'experience',
                entrySource: 'resume_editor',
                title: `${draft.company || '未命名经历'} · 智能补全`,
                contextJson: {
                    resumeId,
                    masterId: draft.masterId,
                    category: draft.category,
                    company: draft.company,
                    title: draft.title,
                    startDate: draft.startDate,
                    endDate: draft.endDate,
                    isCurrent: draft.isCurrent,
                    star: draft.star,
                    jdText: jdPolishContext,
                },
            },
            initialSkillId: 'experience_completion',
            initialUserMessage: buildSmartCompleteAssistantPrompt({
                jdText: jdPolishContext,
                org: draft.company,
                title: draft.title,
                startDate: draft.startDate,
                endDate: draft.endDate,
                isCurrent: draft.isCurrent,
                star: draft.star,
            }),
            applyDraftHandler: async (draftCard, meta) => {
                const normalizedDraftCard = normalizeAssistantDraftCard(draftCard);
                if (normalizedDraftCard.type !== 'experience') {
                    return false;
                }
                pendingAssistantApplyRef.current.set(draft.masterId, meta.persistApplied);
                trackedPendingAssistantApplyRef.current.delete(draft.masterId);
                experience.setEditingDraft((prev) => {
                    if (!prev) {
                        return prev;
                    }
                    return applyAssistantExperienceDraftToDraft(prev, normalizedDraftCard.data);
                });
                setExperiencePolishPreview(null);
                return true;
            },
            callbackOnly: true,
        });
    }, [experience, jdPolishContext, onLaunchAssistant, resumeId]);

    const handleOpenFloatingExperienceAssistant = useCallback(() => {
        if (!activeFloatingPolishExperienceId || !onLaunchAssistant) {
            return;
        }
        const currentItem = experienceItems.find((item) => item.id === activeFloatingPolishExperienceId);
        if (!currentItem) {
            return;
        }
        const draft = buildExperienceEditDraft(currentItem);
        onLaunchAssistant({
            context: {
                mode: 'experience',
                entrySource: 'resume_editor',
                title: `${draft.company || '未命名经历'} · 智能补全`,
                contextJson: {
                    resumeId,
                    masterId: draft.masterId,
                    category: draft.category,
                    company: draft.company,
                    title: draft.title,
                    startDate: draft.startDate,
                    endDate: draft.endDate,
                    isCurrent: draft.isCurrent,
                    star: draft.star,
                    jdText: jdPolishContext,
                },
            },
            initialSkillId: 'experience_completion',
            initialUserMessage: buildSmartCompleteAssistantPrompt({
                jdText: jdPolishContext,
                org: draft.company,
                title: draft.title,
                startDate: draft.startDate,
                endDate: draft.endDate,
                isCurrent: draft.isCurrent,
                star: draft.star,
            }),
            applyDraftHandler: async (draftCard) => {
                const normalizedDraftCard = normalizeAssistantDraftCard(draftCard);
                if (normalizedDraftCard.type !== 'experience') {
                    return false;
                }
                const nextDraft = applyAssistantExperienceDraftToDraft(draft, normalizedDraftCard.data);
                if (!activeFloatingPolishExperienceId) {
                    return false;
                }
                const currentItem = experienceItems.find((item) => item.id === activeFloatingPolishExperienceId);
                if (!currentItem) {
                    return false;
                }
                const sessionItem = buildFloatingPolishSessionItem(currentItem, nextDraft, draft);
                return sessionItem ? applyFloatingPolishPreview('single', [sessionItem]) : false;
            },
            callbackOnly: true,
        });
    }, [
        activeFloatingPolishExperienceId,
        applyFloatingPolishPreview,
        buildFloatingPolishSessionItem,
        experienceItems,
        jdPolishContext,
        onLaunchAssistant,
        resumeId,
    ]);

    const commitLayoutSnapshot = useCallback((
        snapshot: LayoutSnapshot,
        options?: { incrementVersion?: boolean }
    ) => {
        if (options?.incrementVersion) {
            manualLayoutVersionRef.current += 1;
        }
        manualLayoutSnapshotRef.current = snapshot;
    }, []);
    const trackedSelection = useTrackedResumeSelection({
        selection,
        skillGroups,
        selectedExpIds,
        selectedCertIds,
        selectedSkillIds,
        manualSelectionVersionRef,
        manualSelectionSnapshotRef,
        isProgrammaticSelectionUpdateRef,
    });
    const {
        refreshDashboardResumesFromServer,
        updateDashboardCache,
    } = useDashboardResumeSync({
        cachedResumes,
        isCacheOwnerMatched,
        onResumesUpdate,
    });
    const {
        applyResumeNameUpdate,
        canAutoNameResume,
        handleResumeNameChange,
    } = useResumeNameUpdate({
        resumeId,
        resumeName,
        resumeDetail,
        setResumeName,
        applyResumeDetail,
        updateDashboardCache,
        showToastError,
        showToastSuccess,
    });
    useEffect(() => {
        if (!resumeDetail?.resume) {
            return;
        }
        const nextTitle = normalizeResumeTitle(resumeDetail.resume.title || UNTITLED_RESUME_TITLE);
        setResumeName(nextTitle || UNTITLED_RESUME_TITLE);
    }, [resumeDetail]);
    const {
        handleAnalyzeWithAutoName,
        runJdAnalyzeWithToast,
    } = useJdAnalyzeWithToast({
        handleAnalyze,
        isAnalyzing,
        hasMissingAttachmentContext,
        jdFile,
        jdText,
        resumeName,
        pendingPolishAutoAnalyzeSeq,
        applyResumeNameUpdate,
        canAutoNameResume,
        showToastError,
        showToastLoading,
        showToastSuccess,
        updateToast,
    });
    const {
        beginProfileEdit,
        cancelProfileEdit,
        handleSaveProfile,
        isProfileReadOnly,
    } = useProfileEditActions({
        profile,
        setProfile,
        originalProfile,
        setOriginalProfile,
        profileSyncMode,
        setProfileSyncMode,
        originalProfileSyncMode,
        setOriginalProfileSyncMode,
        profileSocialLinks,
        setProfileSocialLinks,
        isEditingProfile,
        setIsEditingProfile,
        isSavingProfile,
        setIsSavingProfile,
    });
    const resetRenamingCategory = () => {
        skill.setRenamingCategoryTarget(null);
        skill.setRenamingCategoryDraft('');
    };
    const {
        applyLayoutSnapshot,
        applyVisibleLayout,
        executeSmartPageAdjustment,
        resolveA4Height,
        resolveDefaultLayoutParams,
        restoreDefaultLayout,
        waitForPreviewUpdate,
        waitForSmartPageIdle,
    } = useSmartPageExecution({
        density,
        a4HeightRef,
        smartPageAdjustingRef,
        measurePreviewRef,
        measurePreviewContentRef,
        setTopPaddingPx,
        setSectionSpacingKey,
        setItemSpacingEm,
        setLineHeight,
        setFontSize,
        setMeasureLayout,
        setIsSmartPageApplied,
        setIsAutoSavePaused,
        buildDefaultSmartPageLayout,
        showToastInfo,
    });
    const {
        adjustToSinglePage,
        restoreDefault,
        handleToggleLayoutAdjustToolbar,
        handleLineHeightChange,
        handleFontSizeChange,
        handleTopPaddingChange,
        handleSectionSpacingChange,
        handleItemSpacingChange,
    } = useSmartPageLayoutControls({
        currentLayout,
        executeSmartPageAdjustment,
        commitLayoutSnapshot,
        applyVisibleLayout,
        restoreDefaultLayout,
        resolveDefaultLayoutParams,
        resolveA4Height,
        setIsSmartPageApplied,
        setIsLayoutAdjustToolbarOpen,
        showToastInfo,
        showToastSuccess,
        showToastError,
    });
    const resetEditorTransientState = useCallback((
        nextProfile: ResumeEditorProfile,
        nextProfileSyncMode: ProfileSyncMode
    ) => {
        handleCancelDelete();
        setOriginalProfile({ ...nextProfile });
        setOriginalProfileSyncMode(nextProfileSyncMode);
        setIsEditingProfile(false);
        experience.cancelEditingExperience();
        education.cancelEducationEdit();
        certification.cancelCertificationEdit();
        skill.cancelSkillEdit();
        skill.setRenamingCategoryTarget(null);
        skill.setRenamingCategoryDraft('');
    }, [
        certification.cancelCertificationEdit,
        education.cancelEducationEdit,
        experience.cancelEditingExperience,
        handleCancelDelete,
        setIsEditingProfile,
        setOriginalProfile,
        setOriginalProfileSyncMode,
        skill.cancelSkillEdit,
        skill.setRenamingCategoryDraft,
        skill.setRenamingCategoryTarget,
    ]);
    const handleCreateResume = useCreateResumeFlow({
        authUserKey,
        resumeId,
        isCreatingResume,
        isLoadingResume,
        buildCommittedResumeConfigSnapshot,
        clearSuppressedAutoSave,
        flushResumeConfig,
        refreshDashboardResumesFromServer,
        reloadResumeContext,
        resetEditorTransientState,
        setIsCreatingResume,
        setResumeName,
        showToastError,
        showToastInfo,
        showToastLoading,
        suppressAutoSaveForConfig,
        updateToast,
    });

    const handleExperiencePolishModeChange = (mode: ResumePolishMode) => {
        setExperiencePolishMode(mode);
        if (mode !== 'smart_complete') {
            setExperienceSmartCompletionPrompt(null);
        }
    };
    const handleFloatingPolishModeChange = (mode: ResumePolishMode) => {
        setFloatingPolishMode(mode);
        if (mode !== 'smart_complete') {
            setFloatingSmartCompletionPrompt(null);
        }
    };
    const editingItem = experienceItems.find((item) => item.id === experience.editingExpId);
    const {
        editingSuggestionToolbar,
        floatingPolishToolbar,
        batchPolishToolbar,
    } = buildExperiencePolishToolbars({
        hasEditingItem: Boolean(editingItem),
        isEditingRunning: isEditingExperiencePolishRunning,
        editingMode: experiencePolishMode,
        editingModeOptions: SMART_RESUME_POLISH_MODES,
        editingCustomPrompt: experienceCustomPrompt,
        editingSmartCompletionPrompt: experienceSmartCompletionPrompt,
        isEditingAssistantDisabled: !jdPolishContext.trim(),
        onEditingModeChange: handleExperiencePolishModeChange,
        onEditingCustomPromptChange: setExperienceCustomPrompt,
        onEditingSmartCompletionAnswerChange: (value) => setExperienceSmartCompletionPrompt((prev) => (
            prev ? { ...prev, answer: value } : prev
        )),
        onRunEditing: () => void handleRunEditingExperiencePolish(),
        onUndoEditing: handleUndoEditingExperiencePolish,
        onConfirmEditing: handleConfirmEditingExperiencePolish,
        onOpenEditingAssistant: handleOpenExperienceAssistant,
        hasActiveFloatingPolishExperience: Boolean(activeFloatingPolishExperienceId),
        isFloatingRunning: isFloatingExperiencePolishRunning,
        floatingMode: floatingPolishMode,
        floatingModeOptions: SMART_RESUME_POLISH_MODES,
        floatingCustomPrompt: floatingPolishCustomPrompt,
        floatingSmartCompletionPrompt,
        isFloatingAssistantDisabled: !jdPolishContext.trim(),
        singlePreviewDraft: singleFloatingPolishPreview?.afterDraft ?? null,
        onFloatingModeChange: handleFloatingPolishModeChange,
        onFloatingCustomPromptChange: setFloatingPolishCustomPrompt,
        onFloatingSmartCompletionAnswerChange: (value) => setFloatingSmartCompletionPrompt((prev) => (
            prev ? { ...prev, answer: value } : prev
        )),
        onRunFloating: () => void handleRunFloatingExperiencePolish(),
        onUndoFloating: handleUndoFloatingExperiencePolish,
        onConfirmFloating: () => void handleConfirmFloatingExperiencePolish(),
        onOpenFloatingAssistant: handleOpenFloatingExperienceAssistant,
        isBatchOpen: isBatchPolishToolbarOpen,
        batchActiveMode: floatingPolishMode === 'smart_complete' ? DEFAULT_RESUME_POLISH_MODE : floatingPolishMode,
        batchModeOptions: BATCH_RESUME_POLISH_MODES,
        batchPreviewItemCount: batchFloatingPolishPreview?.items.length ?? null,
        batchPreviewFailedCount: batchFloatingPolishPreview?.failedIds.length ?? 0,
        onRunBatch: () => void handleRunBatchExperiencePolish(),
        onUndoBatch: handleUndoBatchExperiencePolish,
        onConfirmBatch: () => void handleConfirmBatchExperiencePolish(),
    });
    const floatingPolishHighlightItemIds = useMemo(
        () => new Set(
            (floatingPolishSession?.items ?? []).map((item) => buildDragItemKey('experience', item.targetId))
        ),
        [floatingPolishSession]
    );
    const isPreviewInteractionLocked = Boolean(floatingPolishSession)
        || isFloatingExperiencePolishRunning
        || isBatchPolishToolbarOpen;
    const listSpacingValue = useMemo(() => {
        return buildSpacingValue(itemSpacingEm, lineHeight);
    }, [itemSpacingEm, lineHeight]);
    const bulletSpacingValue = useMemo(
        () => buildSpacingValue(LIST_SPACING_BY_DENSITY.compact, lineHeight),
        [lineHeight]
    );
    const sectionSpacingClass = useMemo(
        () => resolveSectionSpacingClass(sectionSpacingKey),
        [sectionSpacingKey]
    );
    const measureListSpacingValue = useMemo(
        () => buildSpacingValue(measureLayout.itemSpacingEm, measureLayout.lineHeight),
        [measureLayout.itemSpacingEm, measureLayout.lineHeight]
    );
    const measureBulletSpacingValue = useMemo(
        () => buildSpacingValue(LIST_SPACING_BY_DENSITY.compact, measureLayout.lineHeight),
        [measureLayout.lineHeight]
    );
    const measureSectionSpacingClass = useMemo(
        () => resolveSectionSpacingClass(measureLayout.sectionSpacingKey),
        [measureLayout.sectionSpacingKey]
    );
    const listSpacingClass = 'space-y-[var(--rf-list-spacing)]';
    const workItems = useMemo(
        () => experienceItems.filter((item) => item.category === 'work'),
        [experienceItems]
    );
    const projectItems = useMemo(
        () => experienceItems.filter((item) => item.category === 'project'),
        [experienceItems]
    );
    const selectedWorkItems = useMemo(
        () => workItems.filter((item) => selectedExpIds.has(item.id)),
        [selectedExpIds, workItems]
    );
    const selectedProjectItems = useMemo(
        () => projectItems.filter((item) => selectedExpIds.has(item.id)),
        [projectItems, selectedExpIds]
    );
    const selectedExperienceCount = selectedWorkItems.length + selectedProjectItems.length;
    const canBatchPolish = Boolean(
        jdPolishContext.trim()
        && selectedExperienceCount > 0
        && !isFloatingExperiencePolishRunning
        && !floatingPolishSession
    );
    const selectedEducations = useMemo(
        () => educations.filter((item) => selectedEduIds.has(item.id)),
        [educations, selectedEduIds]
    );
    const sortedCertifications = certifications;
    const selectedSkillGroups = useMemo(() => {
        return skillGroups
            .map((group) => ({
                name: group.name,
                skills: group.skills.filter((skill) => selectedSkillIds.has(skill.id)),
            }))
            .filter((group) => group.skills.length > 0);
    }, [skillGroups, selectedSkillIds]);
    const selectedCertifications = useMemo(
        () => sortedCertifications.filter((item) => selectedCertIds.has(item.id)),
        [selectedCertIds, sortedCertifications]
    );
    const selectedResumeSnapshot = useMemo(
        () => buildResumeAISnapshot(
            [...selectedWorkItems, ...selectedProjectItems],
            selectedCertifications,
            selectedSkillGroups,
            selectedEducations,
        ),
        [selectedCertifications, selectedEducations, selectedProjectItems, selectedSkillGroups, selectedWorkItems]
    );
    const selectedResumeSnapshotText = useMemo(
        () => buildStableResumeSnapshotText(selectedResumeSnapshot),
        [selectedResumeSnapshot]
    );
    const handleApplyResumeAssistantDraft = useResumeAssistantDraftApply({
        resumeId,
        educationSourceMap,
        setEducationSourceMap,
        setEducations,
        setSelectedEduIds,
        setCertifications,
        setCertificationSourceMap,
        setSelectedCertIds,
        setSkillGroups,
        setSelectedSkillIds,
        setSelectedExpIds,
        setResumeExperienceMap,
        applyResumeDetail,
        ensureFloatingPolishResumeLink,
    });
    const handleLaunchResumeAssistant = useCallback(() => {
        if (!resumeId || !onLaunchAssistant) {
            return;
        }
        onLaunchAssistant({
            context: {
                mode: 'general',
                entrySource: 'resume_editor',
                title: `${resumeName || '未命名简历'} · AI 助理`,
                contextJson: {
                    resumeId,
                },
            },
            prefillResume: {
                resumeId,
                resumeName: resumeName || '未命名简历',
                snapshot: selectedResumeSnapshot,
                ...(jdPolishContext ? { jdContext: jdPolishContext } : {}),
            },
            applyDraftHandler: handleApplyResumeAssistantDraft,
        });
    }, [handleApplyResumeAssistantDraft, jdPolishContext, onLaunchAssistant, resumeId, resumeName, selectedResumeSnapshot]);
    const editablePersonalSummary = useMemo(
        () => resolveEditablePersonalSummary({
            personalSummary,
            hasPersonalSummaryOverride,
            profileSummary: profile.summary,
        }),
        [hasPersonalSummaryOverride, personalSummary, profile.summary]
    );
    const hasEditablePersonalSummary = useMemo(
        () => hasMeaningfulPersonalSummary(editablePersonalSummary),
        [editablePersonalSummary]
    );
    const effectivePersonalSummary = useMemo(
        () => resolveEffectivePersonalSummary({
            isSummaryVisible,
            personalSummary,
            hasPersonalSummaryOverride,
            profileSummary: profile.summary,
        }),
        [hasPersonalSummaryOverride, isSummaryVisible, personalSummary, profile.summary]
    );
    const previewProfile = useMemo(
        () => ({
            ...profile,
            summary: effectivePersonalSummary,
        }),
        [effectivePersonalSummary, profile]
    );
    const {
        isPreviewOverflowing,
        overflowingSectionIds,
    } = useResumePreviewMeasurement({
        pageRef: measurePreviewRef,
        contentRef: measurePreviewContentRef,
        waitForPreviewUpdate,
        measurementDeps: [
            measureLayout,
            previewProfile,
            resumeTemplateId,
            themeColorPresetId,
            sectionOrder,
            selectedWorkItems,
            selectedProjectItems,
            educations,
            selectedEduIds,
            sortedCertifications,
            selectedCertIds,
            selectedSkillGroups,
        ],
    });
    const personalSummaryContext = useMemo(
        () => buildPersonalSummaryContext({
            profile,
            selectedWorkItems,
            selectedProjectItems,
            selectedEducations,
            selectedCertifications,
            selectedSkillGroups,
        }),
        [
            profile,
            selectedCertifications,
            selectedEducations,
            selectedProjectItems,
            selectedSkillGroups,
            selectedWorkItems,
        ]
    );
    const personalSummaryCurrentSignature = useMemo(
        () => buildPersonalSummarySignature({
            jdText: jdPolishContext,
            context: personalSummaryContext,
        }),
        [jdPolishContext, personalSummaryContext]
    );
    const bossGreetingCurrentSignature = useMemo(
        () => buildBossGreetingSignature({
            jdText: jdPolishContext,
            summary: analysisResult?.summary ?? '',
            jobTitle: analysisResult?.jobTitle,
            company: analysisResult?.company,
            resumeText: selectedResumeSnapshotText,
        }),
        [analysisResult?.company, analysisResult?.jobTitle, analysisResult?.summary, jdPolishContext, selectedResumeSnapshotText]
    );
    const isBossGreetingOutdated = Boolean(
        bossGreeting && bossGreetingSignature !== bossGreetingCurrentSignature
    );
    latestResumeIdRef.current = resumeId;
    latestBossGreetingSignatureRef.current = bossGreetingCurrentSignature;
    latestBossGreetingAnalysisOutdatedRef.current = isOutdated;
    bossGreetingUiStateRef.current = {
        text: bossGreeting,
        signature: bossGreetingSignature,
        isVisible: isBossGreetingVisible,
    };
    const {
        isGeneratingPersonalSummary,
        isPersonalSummaryOverwriteDialogOpen,
        handlePersonalSummaryChange,
        handleGeneratePersonalSummary,
        confirmPersonalSummaryOverwrite,
        cancelPersonalSummaryOverwrite,
    } = usePersonalSummaryGeneration({
        resumeId,
        jdPolishContext,
        personalSummaryContext,
        personalSummaryCurrentSignature,
        hasEditablePersonalSummary,
        isSummaryVisible,
        closeToast,
        showToastError,
        showToastLoading,
        updateToast,
        setIsSummaryVisible,
        setPersonalSummary,
        setHasPersonalSummaryOverride,
    });

    const {
        applyAssemblySelection,
        buildAutoAssemblySelection,
    } = useAutoAssemblySelection({
        workItems,
        projectItems,
        sortedCertifications,
        skillGroups,
        setSelectedExpIds,
        setSelectedCertIds,
        setSelectedSkillIds,
        isProgrammaticSelectionUpdateRef,
        waitForPreviewUpdate,
    });

    const runAutoAssemblySelection = useAutoAssemblySelectionRunner({
        latestResumeIdRef,
        manualSelectionVersionRef,
        manualLayoutVersionRef,
        manualSelectionSnapshotRef,
        manualLayoutSnapshotRef,
        smartPageAdjustingRef,
        applyAssemblySelection,
        applyLayoutSnapshot,
        waitForSmartPageIdle,
        executeSmartPageAdjustment,
        fallbackLayout: {
            topPaddingPx,
            sectionSpacingKey,
            itemSpacingEm,
            lineHeight,
            fontSize,
        },
    });

    const {
        matchScoreFilter,
        setMatchScoreFilter,
        setMatchScoreFilterSource,
        handleToggleJdCollapse,
        handleMatchScoreFilterChange,
        handleJdTextChange,
        showDebugInfo,
    } = useResumeEditorJdPanelState({
        resumeId,
        analysisResult,
        isOutdated,
        jdText,
        resumeName,
        setJdText,
        setIsJDCollapsed,
        applyResumeNameUpdate,
    });

    const handleAutoAssemble = useAutoAssembleAction({
        resumeId,
        analysisResult,
        isOutdated,
        isAutoAssembling,
        isFloatingExperiencePolishRunning,
        floatingPolishSession,
        isBatchPolishToolbarOpen,
        hasMissingAttachmentContext,
        jdFile,
        jdText,
        isSmartPageApplied,
        currentLayout,
        selectedExpIds,
        selectedCertIds,
        selectedSkillIds,
        latestResumeIdRef,
        autoAssembleRequestIdRef,
        activeAutoAssembleToastIdRef,
        manualSelectionVersionRef,
        manualLayoutVersionRef,
        latestLayoutSnapshotRef,
        setIsAutoAssembling,
        setMatchScoreFilter,
        setMatchScoreFilterSource,
        buildAutoAssemblySelection,
        handleAnalyzeWithAutoName,
        runAutoAssemblySelection,
        waitForPreviewUpdate,
        commitLayoutSnapshot,
        closeToast,
        showToastError,
        showToastLoading,
        updateToast,
    });

    const {
        handleGenerateBossGreeting,
        handleRefreshBossGreeting,
        handleCollapseBossGreeting,
        handleCopyBossGreeting,
    } = useBossGreetingActions({
        resumeId,
        analysisResult,
        bossGreeting,
        isBossGreetingVisible,
        isBossGreetingOutdated,
        isGeneratingBossGreeting,
        isOutdated,
        jdFile,
        jdText,
        jdPolishContext,
        hasMissingAttachmentContext,
        selectedResumeSnapshotText,
        latestResumeIdRef,
        latestBossGreetingSignatureRef,
        latestBossGreetingAnalysisOutdatedRef,
        bossGreetingRequestIdRef,
        pendingPersistedBossGreetingRef,
        activeBossGreetingToastIdRef,
        bossGreetingUiStateRef,
        setBossGreeting,
        setBossGreetingSignature,
        setIsBossGreetingVisible,
        setIsGeneratingBossGreeting,
        handleAnalyzeWithAutoName,
        closeToast,
        showToastError,
        showToastLoading,
        showToastSuccess,
        updateToast,
    });

    useEffect(() => {
        autoAssembleRequestIdRef.current += 1;
        bossGreetingRequestIdRef.current += 1;
        if (activeAutoAssembleToastIdRef.current) {
            closeToast(activeAutoAssembleToastIdRef.current);
            activeAutoAssembleToastIdRef.current = null;
        }
        if (activeBossGreetingToastIdRef.current) {
            closeToast(activeBossGreetingToastIdRef.current);
            activeBossGreetingToastIdRef.current = null;
        }
        setIsAutoAssembling(false);
        setIsGeneratingBossGreeting(false);
        pendingPersistedBossGreetingRef.current = null;
        setBossGreeting('');
        setBossGreetingSignature('');
        setIsBossGreetingVisible(false);
    }, [closeToast, resumeId]);

    const handleExportPdf = useResumePdfExport({
        authUserKey,
        isExportingPdf,
        setIsExportingPdf,
        showToastLoading,
        updateToast,
        resumeName,
        profile: previewProfile,
        lineHeight,
        fontSize,
        listSpacingValue,
        bulletSpacingValue,
        topPaddingPx,
        sectionSpacingClass,
        listSpacingClass,
        sectionOrder,
        selectedWorkItems,
        selectedProjectItems,
        educations,
        selectedEduIds,
        sortedCertifications,
        selectedCertIds,
        selectedSkillGroups,
        templateId: resumeTemplateId,
        themeColorPresetId,
        experienceListMarkerStyle,
        skillTagSeparator,
    });

    const hasFloatingPolishBlockingState = useCallback(() => {
        if (isFloatingExperiencePolishRunning) {
            showToastError('请等待当前润色完成后再继续操作');
            return true;
        }
        if (floatingPolishSession) {
            showToastError('请先确认或撤销当前润色结果');
            return true;
        }
        if (isBatchPolishToolbarOpen) {
            showToastError('请先关闭当前批量润色弹窗');
            return true;
        }
        return false;
    }, [floatingPolishSession, isBatchPolishToolbarOpen, isFloatingExperiencePolishRunning, showToastError]);

    const {
        handleBeginCreateEducation,
        handleBeginEditEducation,
        handleBeginProfileEdit,
        handleEditCertification,
        handleEditExperience,
        handleEditSkill,
        handlePreviewNavigateTab,
        handleProfileTabSelected,
        handleSidebarTabSelect,
    } = useResumeEditorNavigationHandlers({
        hasBlockingState: hasFloatingPolishBlockingState,
        setSidebarTab,
        openMobileDrawer: mobileEditorDrawer.open,
        beginProfileEdit,
        cancelEditingExperience: experience.cancelEditingExperience,
        startEditingExperience: experience.startEditingExperience,
        beginEditCertification: certification.beginEditCertification,
        beginEditSkill: skill.beginEditSkill,
        beginCreateEducation: education.beginCreateEducation,
        beginEditEducation: education.beginEditEducation,
    });

    const canCreateResume = !isLoadingResume;
    const isEditorBusy = isLoadingResume || isCreatingResume;
    return (
        <div
            ref={mobileEditorScrollContainerRef}
            className="relative flex min-h-full flex-1 flex-col overflow-y-auto bg-background-light dark:bg-background-dark md:h-full md:overflow-hidden"
            aria-busy={isEditorBusy}
        >
            <div className="hidden md:block">
                <EditorToolbar
                    isDarkMode={isDarkMode}
                    saveState={saveState}
                    lastSavedAt={lastSavedAt}
                    onToggleTheme={toggleTheme}
                    isLayoutModified={isLayoutModified}
                    isSmartPageApplied={isSmartPageApplied}
                    isLayoutAdjustToolbarOpen={isLayoutAdjustToolbarOpen}
                    onToggleLayoutAdjustToolbar={handleToggleLayoutAdjustToolbar}
                    onAdjustToSinglePage={adjustToSinglePage}
                    onRestoreDefault={restoreDefault}
                    canCreateResume={canCreateResume}
                    isCreatingResume={isCreatingResume}
                    onCreateResume={handleCreateResume}
                    resumeName={resumeName}
                    onResumeNameChange={handleResumeNameChange}
                    onExportPdf={handleExportPdf}
                    isExportingPdf={isExportingPdf}
                    isPreviewOverflowing={isPreviewOverflowing}
                    onOpenTemplateSelector={handleOpenTemplateSelector}
                    onLaunchAssistant={handleLaunchResumeAssistant}
                    canLaunchAssistant={Boolean(resumeId && !isLoadingResume)}
                />
            </div>
            <div className="md:hidden">
                    <MobileEditorHeader
                        resumeId={resumeId}
                        resumeName={resumeName}
                        onResumeNameChange={handleResumeNameChange}
                    analysisResult={analysisResult}
                    isOutdated={isOutdated}
                    isAnalyzing={isAnalyzing}
                    onAnalyze={handleAnalyzeWithAutoName}
                    onExportPdf={handleExportPdf}
                    isExportingPdf={isExportingPdf}
                    isPreviewOverflowing={isPreviewOverflowing}
                    canBatchPolish={canBatchPolish}
                    selectedExperienceCount={selectedExperienceCount}
                    isBatchPolishing={isFloatingExperiencePolishRunning}
                    hasBlockingPolishState={Boolean(floatingPolishSession) || isFloatingExperiencePolishRunning || isBatchPolishToolbarOpen}
                    batchPolishToolbar={batchPolishToolbar}
                    onBatchPolish={handleOpenBatchPolishToolbar}
                    onCloseBatchPolishToolbar={handleCloseBatchPolishToolbar}
                    onOpenTemplateSelector={handleOpenTemplateSelector}
                    onAutoAssemble={handleAutoAssemble}
                    isAutoAssembling={isAutoAssembling}
                    onCreateResume={handleCreateResume}
                    canCreateResume={canCreateResume}
                    isCreatingResume={isCreatingResume}
                    isLayoutModified={isLayoutModified}
                    isSmartPageApplied={isSmartPageApplied}
                    isLayoutAdjustToolbarOpen={isLayoutAdjustToolbarOpen}
                    onToggleLayoutAdjustToolbar={handleToggleLayoutAdjustToolbar}
                    onAdjustToSinglePage={adjustToSinglePage}
                    onRestoreDefault={restoreDefault}
                    bossGreeting={bossGreeting}
                    isBossGreetingVisible={isBossGreetingVisible}
                    isBossGreetingOutdated={isBossGreetingOutdated}
                    isGeneratingBossGreeting={isGeneratingBossGreeting}
                    onGenerateBossGreeting={handleGenerateBossGreeting}
                    onRefreshBossGreeting={handleRefreshBossGreeting}
                    onCopyBossGreeting={handleCopyBossGreeting}
                    onCollapseBossGreeting={handleCollapseBossGreeting}
                    jdText={jdText}
                    onJdTextChange={handleJdTextChange}
                    jdFile={jdFile}
                    onFileChange={setJdFile}
                    hasMissingAttachmentContext={hasMissingAttachmentContext}
                    isJDCollapsed={isJDCollapsed}
                    onJDCollapseChange={setIsJDCollapsed}
                    onLaunchAssistant={handleLaunchResumeAssistant}
                    canLaunchAssistant={Boolean(resumeId && !isLoadingResume)}
                />
            </div>
            <div className="flex flex-1 flex-col overflow-visible md:min-h-0 md:overflow-hidden md:flex-row">
                <div className={`hidden md:flex md:h-full md:min-h-0 md:shrink-0 md:overflow-hidden ${SIDEBAR_WIDTH_CLASS}`}>
                    <EditorSidebar
                        sidebarTab={sidebarTab}
                        onSelectTab={handleSidebarTabSelect}
                        onProfileTabSelected={handleProfileTabSelected}
                        jdPanelProps={{
                            jdText,
                            analysisResult,
                            isAnalyzing,
                            isCollapsed: isJDCollapsed,
                            onAnalyze: handleAnalyzeWithAutoName,
                            onToggleCollapse: handleToggleJdCollapse,
                            onJdTextChange: handleJdTextChange,
                            jdFile,
                            onFileChange: setJdFile,
                            hasMissingAttachmentContext,
                            bossGreeting,
                            isBossGreetingVisible,
                            isBossGreetingOutdated,
                            isGeneratingBossGreeting,
                            onGenerateBossGreeting: handleGenerateBossGreeting,
                            onRefreshBossGreeting: handleRefreshBossGreeting,
                            onCopyBossGreeting: handleCopyBossGreeting,
                            onCollapseBossGreeting: handleCollapseBossGreeting,
                            onOpenAgentPluginConfig,
                            debugInfo,
                            showDebugInfo,
                            isOutdated,
                        }}
                        profileTabProps={{
                            profile,
                            setProfile,
                            profileSyncMode,
                            setProfileSyncMode,
                            isEditingProfile,
                            isSavingProfile,
                            isProfileReadOnly,
                            onBeginEdit: handleBeginProfileEdit,
                            onCancelEdit: cancelProfileEdit,
                            onSave: handleSaveProfile,
                            educations,
                            selectedEduIds,
                            editingEducationId: education.editingEducationId,
                            educationDraft: education.educationDraft,
                            isSavingEducation: education.isSavingEducation,
                            deletingEducationIds: education.deletingEducationIds,
                            onBeginCreateEducation: handleBeginCreateEducation,
                            onBeginEditEducation: handleBeginEditEducation,
                            onCancelEducationEdit: education.cancelEducationEdit,
                            onUpdateEducationDraft: education.updateEducationDraft,
                            onUpdateEducationDate: education.updateEducationDate,
                            onSaveEducation: education.handleSaveEducation,
                            onRequestDeleteEducation: education.requestDeleteEducation,
                            onToggleEducationSelection: trackedSelection.toggleEducationSelection,
                        }}
                        experienceTabProps={{
                              experience,
                              certification,
                              skill,
                                selection: trackedSelection,
                                personalSummary: editablePersonalSummary,
                                isSummaryVisible,
                                isGeneratingPersonalSummary,
                                canGeneratePersonalSummary: Boolean(jdPolishContext.trim()),
                                onPersonalSummaryChange: handlePersonalSummaryChange,
                                onSummaryVisibilityChange: setIsSummaryVisible,
                                onGeneratePersonalSummary: () => void handleGeneratePersonalSummary(),
                                matchScoreFilter,
                            onMatchScoreFilterChange: handleMatchScoreFilterChange,
                            workItems,
                            projectItems,
                            selectedExpIds,
                            staleExperienceIds,
                            sortedCertifications,
                            selectedCertIds,
                            certificationMatchScores,
                            certificationMatchTrends,
                            skillGroups,
                            selectedSkillIds,
                            skillMatchScores,
                            skillMatchTrends,
                            selectedExperienceCount,
                            canBatchPolish,
                            isBatchPolishing: isFloatingExperiencePolishRunning,
                            isAutoAssembling,
                            onBatchPolish: handleOpenBatchPolishToolbar,
                            onAutoAssemble: handleAutoAssemble,
                            onResetRenamingCategory: resetRenamingCategory,
                            onPolishExperience: handlePolishExperienceFromCard,
                            activePolishExperienceId: activeFloatingPolishExperienceId,
                            hasBlockingPolishState: Boolean(floatingPolishSession) || isFloatingExperiencePolishRunning || isBatchPolishToolbarOpen,
                            isEditingExperiencePolishPreviewing: Boolean(experiencePolishPreview),
                            polishToolbar: floatingPolishToolbar,
                            batchPolishToolbar,
                            onClosePolishExperienceToolbar: handleCloseFloatingPolishToolbar,
                            onDismissPolishExperienceToolbar: handleDismissFloatingPolishToolbar,
                            onCloseBatchPolishToolbar: handleCloseBatchPolishToolbar,
                            onDismissBatchPolishToolbar: handleDismissBatchPolishToolbar,
                            onResetWorkSort: () => handleResetSort('work'),
                            onResetProjectSort: () => handleResetSort('project'),
                            onResetCertificationSort: handleResetCertificationSort,
                        }}
                        editingSuggestion={{
                            editingItem,
                            staleExperienceIds,
                            toolbar: editingSuggestionToolbar,
                        }}
                    />
                </div>
                <div className="flex flex-1 flex-col overflow-visible pb-20 md:min-h-0 md:overflow-hidden md:pb-0">
                    {isLayoutAdjustToolbarOpen ? (
                        <LayoutAdjustToolbar
                            lineHeight={lineHeight}
                            fontSize={fontSize}
                            topPaddingPx={topPaddingPx}
                            sectionSpacingKey={sectionSpacingKey}
                            itemSpacingEm={itemSpacingEm}
                            lineHeightOptions={LINE_HEIGHT_OPTIONS}
                            fontSizeOptions={FONT_SIZE_OPTIONS}
                            topPaddingOptions={TOP_PADDING_SELECT_OPTIONS}
                            sectionSpacingOptions={SECTION_SPACING_OPTIONS}
                            itemSpacingOptions={ITEM_SPACING_SELECT_OPTIONS}
                            lineHeightSlider={{
                                min: LINE_HEIGHT_MIN,
                                max: LINE_HEIGHT_MAX,
                                step: LINE_HEIGHT_STEP,
                            }}
                            fontSizeSlider={{
                                min: FONT_SIZE_MIN,
                                max: FONT_SIZE_MAX,
                                step: FONT_SIZE_STEP,
                            }}
                            topPaddingSlider={{
                                min: TOP_PADDING_MIN_PX,
                                max: TOP_PADDING_SLIDER_MAX,
                                step: SMART_PAGE_TOP_PADDING_STEP_PX,
                            }}
                            sectionSpacingSlider={{
                                min: 2,
                                max: 12,
                                step: 1,
                            }}
                            itemSpacingSlider={{
                                min: SMART_PAGE_ITEM_SPACING_MIN,
                                max: MAX_ITEM_SPACING_EM,
                                step: SMART_PAGE_ITEM_SPACING_STEP,
                            }}
                            themeColorPresetId={themeColorPresetId}
                            themeColorOptions={RESUME_THEME_COLOR_PRESETS}
                            onLineHeightChange={handleLineHeightChange}
                            onFontSizeChange={handleFontSizeChange}
                            onTopPaddingChange={handleTopPaddingChange}
                            onSectionSpacingChange={handleSectionSpacingChange}
                            onItemSpacingChange={handleItemSpacingChange}
                            onThemeColorChange={setThemeColorPresetId}
                        />
                    ) : null}
                    <ResumePreview
                        previewRef={previewRef}
                        previewContentRef={previewContentRef}
                        previewScope="editor"
                        showOverflowGuide={isPreviewOverflowing}
                        overflowHighlightSectionIds={overflowingSectionIds}
                        polishHighlightItemIds={floatingPolishHighlightItemIds}
                        readOnly={isPreviewInteractionLocked}
                        lineHeight={lineHeight}
                        fontSize={fontSize}
                        listSpacingValue={listSpacingValue}
                        bulletSpacingValue={bulletSpacingValue}
                        topPaddingPx={topPaddingPx}
                        templateId={resumeTemplateId}
                        themeColorPresetId={themeColorPresetId}
                        experienceListMarkerStyle={experienceListMarkerStyle}
                        skillTagSeparator={skillTagSeparator}
                        profile={previewProfile}
                        sectionSpacingClass={sectionSpacingClass}
                        listSpacingClass={listSpacingClass}
                        sectionOrder={sectionOrder}
                        selectedWorkItems={selectedWorkItems}
                        selectedProjectItems={selectedProjectItems}
                        educations={educations}
                        selectedEduIds={selectedEduIds}
                        sortedCertifications={sortedCertifications}
                        selectedCertIds={selectedCertIds}
                        selectedSkillGroups={selectedSkillGroups}
                        isDragging={isDragging}
                        draggedItemKey={draggedItemKey}
                        draggedSectionId={draggedSectionId}
                        onSectionDragStart={handleSectionDragStart}
                        onSectionDragHover={handleSectionDragHover}
                        onSectionDrop={handleSectionDrop}
                        onTouchSectionDragStart={startSectionReorder}
                        onItemDragStart={handleDragStart}
                        onItemDragHover={handleItemDragHover}
                        onItemDrop={handleItemDrop}
                        onTouchItemDragStart={startItemReorder}
                        onTouchDragEnd={finishDragInteraction}
                        onTouchDragCancel={cancelTouchDragInteraction}
                        onDragEnd={clearDragState}
                        onNavigateTab={handlePreviewNavigateTab}
                        onEditExperience={handleEditExperience}
                        onEditCertification={handleEditCertification}
                        onEditSkill={handleEditSkill}
                        resumeDisplayTitle={resolveResumeDisplayTitle(resumeName)}
                    />
                </div>
            </div>
            <TemplateSelectorModal
                isOpen={isTemplateSelectorOpen}
                selectedTemplateId={resumeTemplateId}
                themeColorPresetId={themeColorPresetId}
                sectionOrder={sectionOrder}
                experienceListMarkerStyle={experienceListMarkerStyle}
                skillTagSeparator={skillTagSeparator}
                templatePresetMap={templatePresetMap}
                isPresetMapReady={isTemplatePresetMapReady}
                isPresetSyncFallbackAvailable={isTemplatePresetFallbackAvailable}
                onClose={() => setIsTemplateSelectorOpen(false)}
                onUseLocalPresetFallback={() => unlockTemplatePresetMapWithLocalFallback(templatePresetFallbackOwnerKey)}
                onSelectTemplate={handleSelectTemplate}
                onSaveTemplatePreset={handleSaveTemplatePreset}
            />

            <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 md:hidden">
                <div className="pointer-events-auto rounded-t-[28px] border border-b-0 border-border-light bg-surface-light/96 px-4 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-2 shadow-[0_-18px_40px_rgba(15,23,42,0.14)] backdrop-blur dark:border-border-dark dark:bg-surface-dark/96">
                    <button
                        type="button"
                        onClick={mobileEditorDrawer.open}
                        className="mx-auto flex w-full max-w-[240px] flex-col items-center rounded-t-[20px] px-6 pb-1 pt-0.5 text-center"
                    >
                        <span className="mb-2 h-1.5 w-14 rounded-full bg-gray-300 dark:bg-gray-700" />
                        <span className="inline-flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                            <Database className="h-4 w-4 text-primary" />
                            经历库
                        </span>
                    </button>
                </div>
            </div>
            <div className="fixed left-[-200vw] top-0 w-screen md:w-[calc(100vw-600px)] pointer-events-none opacity-0" aria-hidden="true">
                <ResumePreview
                    previewRef={measurePreviewRef}
                    previewContentRef={measurePreviewContentRef}
                    previewScope="measure"
                    lineHeight={measureLayout.lineHeight}
                    fontSize={measureLayout.fontSize}
                    listSpacingValue={measureListSpacingValue}
                    bulletSpacingValue={measureBulletSpacingValue}
                    topPaddingPx={measureLayout.topPaddingPx}
                    templateId={resumeTemplateId}
                    themeColorPresetId={themeColorPresetId}
                    experienceListMarkerStyle={experienceListMarkerStyle}
                    skillTagSeparator={skillTagSeparator}
                    profile={previewProfile}
                    sectionSpacingClass={measureSectionSpacingClass}
                    listSpacingClass={listSpacingClass}
                    sectionOrder={sectionOrder}
                    selectedWorkItems={selectedWorkItems}
                    selectedProjectItems={selectedProjectItems}
                    educations={educations}
                    selectedEduIds={selectedEduIds}
                    sortedCertifications={sortedCertifications}
                    selectedCertIds={selectedCertIds}
                    selectedSkillGroups={selectedSkillGroups}
                    readOnly
                    isDragging={false}
                    draggedItemKey={null}
                    draggedSectionId={null}
                    onSectionDragStart={() => { }}
                    onSectionDragHover={() => { }}
                    onSectionDrop={() => { }}
                    onTouchSectionDragStart={() => { }}
                    onItemDragStart={() => { }}
                    onItemDragHover={() => { }}
                    onItemDrop={() => { }}
                    onTouchItemDragStart={() => { }}
                    onTouchDragEnd={() => { }}
                    onTouchDragCancel={() => { }}
                    onDragEnd={() => { }}
                    onNavigateTab={handlePreviewNavigateTab}
                    onEditExperience={() => { }}
                    onEditCertification={() => { }}
                    onEditSkill={() => { }}
                    resumeDisplayTitle={resolveResumeDisplayTitle(resumeName)}
                />
            </div>
            {mobileEditorDrawer.isOpen ? (
                <div className={`fixed inset-0 z-[70] transition-opacity duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)] md:hidden ${mobileEditorDrawer.isVisible ? 'bg-black/35 opacity-100 backdrop-blur-[1px]' : 'bg-black/0 opacity-0'}`}>
                    <button
                        type="button"
                        aria-label="关闭经历库抽屉遮罩"
                        className="absolute inset-0 h-full w-full cursor-default"
                        onClick={mobileEditorDrawer.close}
                    />
                    <div className={`absolute inset-x-0 bottom-0 h-[82vh] rounded-t-[28px] border border-border-light bg-surface-light shadow-[0_-24px_60px_rgba(15,23,42,0.22)] will-change-transform transition-transform duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)] dark:border-border-dark dark:bg-surface-dark ${mobileEditorDrawer.isVisible ? 'translate-y-0' : 'translate-y-full'}`}>
                        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-t-[28px]">
                            <div className="shrink-0 px-4 pb-2 pt-2">
                                <div className="mx-auto h-1.5 w-14 rounded-full bg-gray-300 dark:bg-gray-700" />
                            </div>
                            <EditorSidebar
                                layoutMode="drawer"
                                showJDPanel={false}
                                sidebarTab={sidebarTab}
                                onSelectTab={handleSidebarTabSelect}
                                onProfileTabSelected={handleProfileTabSelected}
                                jdPanelProps={{
                                    jdText,
                                    analysisResult,
                                    isAnalyzing,
                                    isCollapsed: isJDCollapsed,
                                    onAnalyze: handleAnalyzeWithAutoName,
                                    onToggleCollapse: handleToggleJdCollapse,
                                    onJdTextChange: handleJdTextChange,
                                    jdFile,
                                    onFileChange: setJdFile,
                                    hasMissingAttachmentContext,
                                    bossGreeting,
                                    isBossGreetingVisible,
                                    isBossGreetingOutdated,
                                    isGeneratingBossGreeting,
                                    onGenerateBossGreeting: handleGenerateBossGreeting,
                                    onRefreshBossGreeting: handleRefreshBossGreeting,
                                    onCopyBossGreeting: handleCopyBossGreeting,
                                    onCollapseBossGreeting: handleCollapseBossGreeting,
                                    onOpenAgentPluginConfig,
                                    debugInfo,
                                    showDebugInfo,
                                    isOutdated,
                                }}
                                profileTabProps={{
                                    profile,
                                    setProfile,
                                    profileSyncMode,
                                    setProfileSyncMode,
                                    isEditingProfile,
                                    isSavingProfile,
                                    isProfileReadOnly,
                                    onBeginEdit: handleBeginProfileEdit,
                                    onCancelEdit: cancelProfileEdit,
                                    onSave: handleSaveProfile,
                                    educations,
                                    selectedEduIds,
                                    editingEducationId: education.editingEducationId,
                                    educationDraft: education.educationDraft,
                                    isSavingEducation: education.isSavingEducation,
                                    deletingEducationIds: education.deletingEducationIds,
                                    onBeginCreateEducation: handleBeginCreateEducation,
                                    onBeginEditEducation: handleBeginEditEducation,
                                    onCancelEducationEdit: education.cancelEducationEdit,
                                    onUpdateEducationDraft: education.updateEducationDraft,
                                    onUpdateEducationDate: education.updateEducationDate,
                                    onSaveEducation: education.handleSaveEducation,
                                    onRequestDeleteEducation: education.requestDeleteEducation,
                                    onToggleEducationSelection: trackedSelection.toggleEducationSelection,
                                }}
                                experienceTabProps={{
                                      experience,
                                      certification,
                                      skill,
                                        selection: trackedSelection,
                                        personalSummary: editablePersonalSummary,
                                        isSummaryVisible,
                                        isGeneratingPersonalSummary,
                                        canGeneratePersonalSummary: Boolean(jdPolishContext.trim()),
                                        onPersonalSummaryChange: handlePersonalSummaryChange,
                                        onSummaryVisibilityChange: setIsSummaryVisible,
                                        onGeneratePersonalSummary: () => void handleGeneratePersonalSummary(),
                                        matchScoreFilter,
                                    onMatchScoreFilterChange: handleMatchScoreFilterChange,
                                    workItems,
                                    projectItems,
                                    selectedExpIds,
                                    staleExperienceIds,
                                    sortedCertifications,
                                    selectedCertIds,
                                    certificationMatchScores,
                                    certificationMatchTrends,
                                    skillGroups,
                                    selectedSkillIds,
                                    skillMatchScores,
                                    skillMatchTrends,
                                    selectedExperienceCount,
                                    canBatchPolish,
                                    isBatchPolishing: isFloatingExperiencePolishRunning,
                                    isAutoAssembling,
                                    onBatchPolish: handleOpenBatchPolishToolbar,
                                    onAutoAssemble: handleAutoAssemble,
                                    onResetRenamingCategory: resetRenamingCategory,
                            onPolishExperience: handlePolishExperienceFromCard,
                            activePolishExperienceId: activeFloatingPolishExperienceId,
                            hasBlockingPolishState: Boolean(floatingPolishSession) || isFloatingExperiencePolishRunning || isBatchPolishToolbarOpen,
                            isEditingExperiencePolishPreviewing: Boolean(experiencePolishPreview),
                            polishToolbar: floatingPolishToolbar,
                            batchPolishToolbar,
                            onClosePolishExperienceToolbar: handleCloseFloatingPolishToolbar,
                            onDismissPolishExperienceToolbar: handleDismissFloatingPolishToolbar,
                            onCloseBatchPolishToolbar: handleCloseBatchPolishToolbar,
                            onDismissBatchPolishToolbar: handleDismissBatchPolishToolbar,
                                    onResetWorkSort: () => handleResetSort('work'),
                                    onResetProjectSort: () => handleResetSort('project'),
                                    onResetCertificationSort: handleResetCertificationSort,
                                }}
                                editingSuggestion={{
                                    editingItem,
                                    staleExperienceIds,
                                    toolbar: editingSuggestionToolbar,
                                }}
                            />
                        </div>
                    </div>
                </div>
            ) : null}
            {isEditorBusy ? (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/70 dark:bg-black/50 backdrop-blur-[1px]">
                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 text-sm font-medium text-gray-600 dark:text-gray-200 shadow-sm">
                        {isCreatingResume ? '正在创建并切换简历...' : '正在加载简历...'}
                    </div>
                </div>
            ) : null}
            <ToastContainer toasts={toasts} onClose={closeToast} />
            <ConfirmDialog
                isOpen={!!confirmDialog}
                title={confirmDialog?.title || ''}
                description={confirmDialog?.description || ''}
                onConfirm={handleConfirmDelete}
                onCancel={handleCancelDelete}
            />
            <ConfirmDialog
                isOpen={isPersonalSummaryOverwriteDialogOpen}
                title="覆盖当前个人评价？"
                description="当前已有个人评价内容，继续后将使用新的 AI 生成结果覆盖。"
                confirmLabel="继续生成"
                tone="primary"
                isConfirming={isGeneratingPersonalSummary}
                onConfirm={confirmPersonalSummaryOverwrite}
                onCancel={cancelPersonalSummaryOverwrite}
            />
        </div>
    );
};
export default ResumeEditor;
