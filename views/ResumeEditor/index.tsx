import ResumeEditorViewport from './components/ResumeEditorViewport';
import { ScoreAnnotationProvider } from './components/ResumeEvaluationReport/ScoreAnnotations';
import PersistentAssistantPortal from './components/PersistentAssistantPortal';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ConfirmDialog from '../../components/ConfirmDialog';
import { ToastContainer, useToast } from '../../components/Toast';
import { useExperienceActions } from '../../hooks/useExperienceActions';
import { useJDAnalysis } from '../../hooks/useJDAnalysis';
import { useResumeEvaluation } from '../../hooks/useResumeEvaluation';
import { useResumeData } from '../../hooks/useResumeData';
import type { AssistantDraftApplyNavigation, AssistantSelectedResume } from '../../services/aiService';
import type { ExperienceCategory } from '../../services/experienceService';
import type { Resume as DashboardResume } from '../../types';
import { buildExperienceDate } from '../../utils/dateUtils';
import {
    buildStarFields,
    mergeStarFieldsWithSource,
} from '../../utils/resumeHelpers';
import {
    buildJDCapabilityContext,
    buildJDIntentSummary,
    buildJDPolishContext,
} from '../../utils/assistantResumeContext';
import {
    trackLayoutModeChange,
} from '../../utils/analyticsTracker';
import { UNTITLED_RESUME_TITLE } from '../../constants/resumeConstants';
import {
    AUTO_SAVE_DELAY_MS,
    LIST_SPACING_BY_DENSITY,
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
    DEFAULT_EXPERIENCE_TITLE_BY_CATEGORY,
    DEFAULT_EXPERIENCE_COMPANY_BY_CATEGORY,
    DEFAULT_SKILL_CATEGORY,
    DEFAULT_SKILL_NAME,
    EDUCATION_DRAFT_PREFIX,
    EXPERIENCE_DRAFT_PREFIX,
} from './constants';
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
    buildDefaultSmartPageLayout,
    resolveDefaultItemSpacingEm,
    resolveDefaultSectionSpacingKey,
    type LayoutSnapshot,
    type SmartPageLayout,
} from './layoutUtils';
import {
    buildLayoutSnapshot,
} from './autoAssemblyUtils';
import {
    normalizeResumeTitle,
} from './autoNameUtils';
import {
    buildBossGreetingSignature,
    buildPersonalSummarySignature,
} from './snapshotUtils';
import type { EditorSidebarProps } from './components/EditorSidebar';
import EditorToolbar from './components/EditorToolbar';
import ResumeEditorDesktopWorkspace, {
    type ResumeEditorWorkspaceLayout,
} from './components/ResumeEditorDesktopWorkspace';
import ResumeEditorMeasurePreview from './components/ResumeEditorMeasurePreview';
const ResumeEditorMobileDrawer = React.lazy(() => import('./components/ResumeEditorMobileDrawer'));
const MobileWorkbenchReports = React.lazy(() => import('./components/MobileWorkbenchReports'));
import TemplateSelectorModal from './components/TemplateSelectorModal';
import { useMobileTemplateSession } from './hooks/useMobileTemplateSession';
import { buildSpacingValue, resolveSectionSpacingClass } from './layoutUtils';
import { JDAnalysisDetailsSidebar } from './components/JDAnalysisPanel';
import type { ResumeFactorySidebarProps, ResumeFactoryTab } from './components/ResumeFactorySidebar';
import buildExperiencePolishToolbars from './components/ExperiencePolishToolbars';
import type { AssistantLaunchRequest } from '../AIAssistant/types';
import { useMobileEditorDrawer } from './hooks/useMobileEditorDrawer';
import { useMobileJDAnalysisDialog } from './hooks/useMobileJDAnalysisDialog';
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
import { useResumeEditorPreviewModel } from './hooks/useResumeEditorPreviewModel';
import {
    useResumeEditorPreviewWorkspaceProps,
    type SharedResumePreviewProps,
} from './hooks/useResumeEditorPreviewWorkspaceProps';
import { useResumeEditorAssistantLaunch } from './hooks/useResumeEditorAssistantLaunch';
import { useResumeEditorCoreState } from './hooks/useResumeEditorCoreState';
import { useResumeEditorTransientReset } from './hooks/useResumeEditorTransientReset';
import {
    DEFAULT_RESUME_POLISH_MODE,
    type ResumePolishMode,
} from './hooks/useResumeEditorExperiencePolishControls';
import { useResumeEditorExperiencePolishCoordinator } from './hooks/useResumeEditorExperiencePolishCoordinator';
import { useResumeEditorExperienceFocusRequest } from './hooks/useResumeEditorExperienceFocusRequest';
import { useResumeOptimizationFlow } from './hooks/useResumeOptimizationFlow';
import { useResumeEvaluationLinkPreflight } from './hooks/useResumeEvaluationLinkPreflight';
import { runResumeEvaluationAfterLinkPreflight } from './hooks/resumeExperienceLinkPersistence';
import { shouldRenderResumeOptimizationComparison } from './components/ResumeOptimization/optimizationDisplayUtils.mjs';
import { buildExperienceViewFromDraft } from './experiencePolishViewUtils';

const AIAssistant = React.lazy(() => import('../AIAssistant'));
const MobileEditorHeader = React.lazy(() => import('./components/MobileEditorHeader'));
const MobileTemplateStrip = React.lazy(() => import('./components/MobileTemplateStrip'));
const MobileTemplateToolbar = React.lazy(() => import('./components/MobileTemplateToolbar'));
const ResumeOptimizationWorkspace = React.lazy(async () => {
    const module = await import('./components/ResumeOptimization/ResumeOptimizationWorkspace');
    return { default: module.ResumeOptimizationWorkspace };
});

type ResumeEditorProps = {
    cachedResumes?: DashboardResume[];
    cachedResumesOwnerKey?: string | null;
    authUserKey?: string | null;
    onResumesUpdate?: (resumes: DashboardResume[]) => void;
    onLaunchAssistant?: (request: AssistantLaunchRequest) => void;
    onOpenAssistantSession?: (sessionId: string) => void;
    onOpenAgentPluginConfig?: () => void;
    onJumpToExperienceBank?: (
        category?: AssistantDraftApplyNavigation['category'],
        targetId?: string,
    ) => void;
    mobileDrawerOpenRequest?: number;
    onMobileDrawerOpenRequestConsumed?: () => void;
    focusExperienceRequest?: {
        requestId: number;
        targetId?: string;
    } | null;
    onFocusExperienceRequestHandled?: (requestId: number) => void;
};

type RightSidebarSurface = 'assistant' | 'analysis' | 'optimization' | null;

const SMART_RESUME_POLISH_MODES: ResumePolishMode[] = [
    'default',
    'campus_recruitment',
    'highlight',
    'custom',
];
const BATCH_RESUME_POLISH_MODES: ResumePolishMode[] = [
    'default',
    'campus_recruitment',
    'highlight',
    'custom',
];
const RESUME_OPTIMIZATION_ENABLED = import.meta.env.VITE_ENABLE_RESUME_OPTIMIZATION === 'true';
const ResumeEditor: React.FC<ResumeEditorProps> = ({
    cachedResumes = [],
    cachedResumesOwnerKey = null,
    authUserKey = null,
    onResumesUpdate,
    onLaunchAssistant,
    onOpenAssistantSession,
    onOpenAgentPluginConfig,
    onJumpToExperienceBank,
    mobileDrawerOpenRequest = 0,
    onMobileDrawerOpenRequestConsumed,
    focusExperienceRequest = null,
    onFocusExperienceRequestHandled,
}) => {
    const { isDarkMode, toggleTheme } = useEditorThemeState();
    const {
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
        targetRole, setTargetRole,
        originalTargetRole, setOriginalTargetRole,
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
    } = useResumeEditorCoreState();
    const previousLayoutDensityRef = useRef(density);
    const isCacheOwnerMatched = Boolean(
        cachedResumesOwnerKey && authUserKey && cachedResumesOwnerKey === authUserKey
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
    const [factorySidebarTab, setFactorySidebarTab] = useState<ResumeFactoryTab>('edit');
    const [workspaceLayout, setWorkspaceLayout] = useState<ResumeEditorWorkspaceLayout>('list');
    const [rightSidebarSurface, setRightSidebarSurface] = useState<RightSidebarSurface>(null);
    const [hasOpenedRightSidebar, setHasOpenedRightSidebar] = useState(false);
    const lastRightSidebarSurfaceRef = useRef<Exclude<RightSidebarSurface, null>>('assistant');
    const workspaceLayoutRequestRef = useRef(0);
    useEffect(() => {
        if (rightSidebarSurface) {
            lastRightSidebarSurfaceRef.current = rightSidebarSurface;
            setHasOpenedRightSidebar(true);
        }
    }, [rightSidebarSurface]);
    const [isAssistantSidebarMounted, setIsAssistantSidebarMounted] = useState(false);
    const [desktopAssistantContainer, setDesktopAssistantContainer] = useState<HTMLDivElement | null>(null);
    const [mobileAssistantContainer, setMobileAssistantContainer] = useState<HTMLDivElement | null>(null);
    const isJDAnalysisDetailsSidebarOpen = rightSidebarSurface === 'analysis';
    const [isResumeOptimizationLayoutTransitioning, setIsResumeOptimizationLayoutTransitioning] = useState(false);
    const resumeOptimizationReturnFocusRef = useRef<HTMLElement | null>(null);
    const resumeOptimizationShouldRestoreReportRef = useRef(false);
    const resumeOptimizationSuppressReturnFocusRef = useRef(false);
    const resumeOptimizationNavigationInFlightRef = useRef(false);
    const [resumeOptimizationAutoAssemblyFocusRequest, setResumeOptimizationAutoAssemblyFocusRequest] = useState(0);
    const [assistantSidebarLaunchRequest, setAssistantSidebarLaunchRequest] = useState<AssistantLaunchRequest | null>(null);
    const assistantSidebarLaunchRequestIdRef = useRef(0);
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
        const hasDensityChanged = previousLayoutDensityRef.current !== density;
        if (!hasDensityChanged) {
            return;
        }
        previousLayoutDensityRef.current = density;
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
        hasResumeVersionConflict,
        applyResumeDetail,
        flushResumeConfig: flushResumeConfigWithTimestamp,
        commitLatestResumeConfigIfNeeded,
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
    const mobileEditorDrawer = useMobileEditorDrawer({
        ownerKey: `${authUserKey ?? ""}:${resumeId ?? ""}`,
        mobileDrawerOpenRequest,
        onMobileDrawerOpenRequestConsumed,
        scrollContainerRef: mobileEditorScrollContainerRef,
        setSidebarTab,
    });
    const flushResumeConfig = useCallback(async (
        configOverride?: Parameters<typeof flushResumeConfigWithTimestamp>[0]
    ) => {
        await flushResumeConfigWithTimestamp(configOverride);
    }, [flushResumeConfigWithTimestamp]);
    useEffect(() => {
        setIsLayoutAdjustToolbarOpen(false);
    }, [resumeId]);
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
        authUserKey,
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
    useEffect(() => {
        lastRightSidebarSurfaceRef.current = 'assistant';
        workspaceLayoutRequestRef.current += 1;
        setHasOpenedRightSidebar(false);
        setAssistantSidebarLaunchRequest(null);
        setIsAssistantSidebarMounted(false);
        setRightSidebarSurface(null);
        setWorkspaceLayout('list');
        setIsResumeOptimizationLayoutTransitioning(false);
    }, [authUserKey, resumeId]);
    const {
        jdText,
        setJdText,
        jdFile,
        selectJdFile,
        clearJdFile,
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
        isEvaluationOutdated,
        evaluationSnapshot,
        evaluationSignature,
        evaluationJdText,
        evaluationJdAvailable,
        evaluationJdMatchPercentage,
        isEvaluationJdAnalysisInputCurrent,
        hasMissingEvaluationJdContext,
        hasPendingJdFileSelection,
        hasPendingJDAnalysisConflict,
        canPersistCurrentJDAnalysis,
        restorePendingJDAnalysisRecovery,
        discardPendingJDAnalysisRecovery,
        convertRestoredAttachmentToText,
        persistResumeEvaluation,
        thinkingText,
        handleStopAnalysis,
    } = useJDAnalysis({
        resumeId,
        experienceItems,
        setExperienceItems,
        certifications,
        skillGroups,
        profile,
        personalSummary,
        hasPersonalSummaryOverride,
        isSummaryVisible,
        targetRole: resumeDetail?.resume?.target_role ?? '',
        educations,
        selectedExperienceIds: selectedExpIds,
        selectedEducationIds: selectedEduIds,
        selectedCertificationIds: selectedCertIds,
        selectedSkillIds,
        sectionOrder,
        persistedJDAnalysis: resumeDetail?.resume?.config?.jdAnalysis,
        onPersistedJDAnalysisChange: setPersistedJDAnalysisSnapshot,
        isLoadingResume,
        isLoadingExperiences,
        authUserKey,
    });
    const jdPolishContext = useMemo(
        () => hasPendingJDAnalysisConflict ? '' : buildJDPolishContext(
            evaluationJdText,
            analysisResult,
            isOutdated || !evaluationJdAvailable,
        ),
        [analysisResult, evaluationJdAvailable, evaluationJdText, hasPendingJDAnalysisConflict, isOutdated]
    );
    const hasJdContext = Boolean(jdPolishContext.trim());
    const jdCapabilityPolishContext = useMemo(
        () => buildJDCapabilityContext(analysisResult, isOutdated),
        [analysisResult, isOutdated]
    );
    const {
        isEvaluating,
        thinkingText: evaluationThinkingText,
        evaluationError,
        generateEvaluation,
        stopEvaluation,
    } = useResumeEvaluation({
        authUserKey,
        resumeId,
        jdText: evaluationJdText,
        jdAvailable: evaluationJdAvailable,
        jdMatchPercentage: evaluationJdMatchPercentage,
        isJdAnalysisInputCurrent: isEvaluationJdAnalysisInputCurrent,
        hasMissingJdContext: hasMissingEvaluationJdContext,
        hasPendingJdFileSelection,
        hasJdAnalysisPersistenceConflict: hasPendingJDAnalysisConflict,
        canPersistCurrentJDAnalysis,
        jdAnalysisResult: analysisResult,
        snapshot: evaluationSnapshot,
        evaluationSignature,
        isEvaluationOutdated,
        persistEvaluation: persistResumeEvaluation,
    });
    const [isRestoredAttachmentConversionOpen, setIsRestoredAttachmentConversionOpen] = useState(false);
    const [restoredAttachmentFullTextDraft, setRestoredAttachmentFullTextDraft] = useState('');
    useEffect(() => {
        if (!hasMissingAttachmentContext) {
            setIsRestoredAttachmentConversionOpen(false);
            setRestoredAttachmentFullTextDraft('');
        }
    }, [hasMissingAttachmentContext]);
    const handleRestorePendingJDAnalysis = useCallback(() => {
        if (hasResumeVersionConflict) return;
        if (!window.confirm('恢复本地分析会以本地副本替换当前云端 JD 分析，是否继续？')) return;
        if (!restorePendingJDAnalysisRecovery()) {
            showToastError('本地 JD 分析恢复失败，请刷新后重试。');
        }
    }, [hasResumeVersionConflict, restorePendingJDAnalysisRecovery, showToastError]);
    const handleDiscardPendingJDAnalysis = useCallback(() => {
        if (hasResumeVersionConflict) return;
        if (!window.confirm('舍弃后，本地未同步的 JD 分析副本将无法恢复，是否继续？')) return;
        if (!discardPendingJDAnalysisRecovery()) {
            showToastError('无法切换到云端 JD 分析，请刷新后重试。');
        }
    }, [discardPendingJDAnalysisRecovery, hasResumeVersionConflict, showToastError]);
    const handleReloadAfterResumeConflict = useCallback(async () => {
        if (!resumeId || !hasResumeVersionConflict) return;
        if (!window.confirm('检测到该简历已在其他页面更新。重新加载将放弃当前未保存修改，是否继续？')) {
            return;
        }
        const result = await reloadResumeContext(resumeId);
        if (result.status === 'failed') {
            showToastError('重新加载失败，请刷新页面后重试。');
        }
    }, [hasResumeVersionConflict, reloadResumeContext, resumeId, showToastError]);
    const ensureSelectedExperienceLinks = useResumeEvaluationLinkPreflight({
        authUserKey,
        resumeId,
        evaluationSignature,
        selectedExperienceIds: selectedExpIds,
        resumeExperienceMap,
        experienceSourceMap,
        applyResumeDetail,
        setResumeExperienceMap,
    });
    const handleGenerateEvaluation = useCallback(async () => {
        if (!canPersistCurrentJDAnalysis()) {
            showToastError('请先处理未同步的本地 JD 分析。');
            return { status: 'error' as const };
        }
        try {
            return await runResumeEvaluationAfterLinkPreflight({
                ensureLinks: ensureSelectedExperienceLinks,
                flushConfig: flushResumeConfig,
                generateEvaluation,
                assertJDAnalysisCurrent: canPersistCurrentJDAnalysis,
            });
        } catch {
            if (!canPersistCurrentJDAnalysis()) {
                showToastError('请先处理未同步的本地 JD 分析。');
                return { status: 'error' as const };
            }
            showToastError('简历内容已在其他请求中更新，请刷新后再生成六维报告');
            return;
        }
    }, [
        canPersistCurrentJDAnalysis,
        ensureSelectedExperienceLinks,
        flushResumeConfig,
        generateEvaluation,
        showToastError,
    ]);
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
        authUserKey,
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
        authUserKey,
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
    const {
        activeFloatingPolishExperienceId,
        isBatchPolishToolbarOpen,
        floatingSmartCompletionPrompt,
        setFloatingSmartCompletionPrompt,
        floatingPolishSession,
        isFloatingExperiencePolishRunning,
        singleFloatingPolishPreview,
        batchFloatingPolishPreview,
        buildFloatingPolishSessionItem,
        applyFloatingPolishPreview,
        handleCloseFloatingPolishToolbar,
        handleDismissFloatingPolishToolbar,
        handleCloseBatchPolishToolbar,
        handleDismissBatchPolishToolbar,
        handlePolishExperienceFromCard,
        experiencePolishMode,
        experienceCustomPrompt,
        setExperienceCustomPrompt,
        experienceSmartCompletionPrompt,
        setExperienceSmartCompletionPrompt,
        experiencePolishPreview,
        setExperiencePolishPreview,
        isEditingExperiencePolishRunning,
        floatingPolishMode,
        floatingPolishCustomPrompt,
        setFloatingPolishCustomPrompt,
        pendingPolishAutoAnalyzeSeq,
        handleExperiencePolishModeChange,
        handleFloatingPolishModeChange,
        handleRunEditingExperiencePolish,
        handleUndoEditingExperiencePolish,
        handleConfirmEditingExperiencePolish,
        handleRunFloatingExperiencePolish,
        handleRunBatchExperiencePolish,
        ensureFloatingPolishResumeLink,
        handleConfirmFloatingExperiencePolish,
        handleConfirmBatchExperiencePolish,
        handleUndoFloatingExperiencePolish,
        handleOpenBatchPolishToolbar,
        handleUndoBatchExperiencePolish,
        floatingPolishHighlightItemIds,
        isPreviewInteractionLocked,
        editingThinkingText,
        handleStopEditing,
        floatingThinkingText,
        handleStopFloating,
    } = useResumeEditorExperiencePolishCoordinator({
        authUserKey,
        resumeId,
        isLoadingExperiences,
        experienceItems,
        setExperienceItems,
        selectedExpIds,
        setSelectedExpIds,
        setSidebarTab,
        activeManualSaveDraftRef,
        appliedManualSaveDraftKeyRef,
        experience,
        buildExperienceViewFromDraft,
        pendingAiPolishApplyRef,
        jdPolishContext,
        jdCapabilityPolishContext,
        showToastError,
        showToastLoading,
        updateToast,
        showToastSuccess,
        closeToast,
        resumeExperienceMap,
        experienceSourceMap,
        applyResumeDetail,
        setResumeExperienceMap,
    });
    const resumeOptimizationToast = useMemo(() => ({
        success: showToastSuccess,
        error: showToastError,
        info: showToastInfo,
    }), [showToastError, showToastInfo, showToastSuccess]);
    const resumeOptimizationFlow = useResumeOptimizationFlow({
        enabled: RESUME_OPTIMIZATION_ENABLED,
        authUserKey,
        resumeId,
        sourceResumeUpdatedAt: resumeDetail?.resume.updated_at,
        evaluationSignature,
        evaluation: analysisResult?.resumeEvaluation ?? null,
        persistedEvaluationSignature: persistedJDAnalysisSnapshot?.evaluationSignature ?? null,
        persistedEvaluation: persistedJDAnalysisSnapshot?.result.resumeEvaluation ?? null,
        isJDAnalysisOutdated: isOutdated,
        isEvaluationOutdated,
        jdText,
        hasResumeVersionConflict,
        isEvaluationRunning: isEvaluating,
        isPolishing: Boolean(
            floatingPolishSession
            || experiencePolishPreview
            || isFloatingExperiencePolishRunning
            || isEditingExperiencePolishRunning
            || isBatchPolishToolbarOpen
        ),
        isAutoAssembling,
        reloadResumeContext,
        generateEvaluation,
        flushResumeConfig: flushResumeConfigWithTimestamp,
        commitLatestResumeConfigIfNeeded,
        toast: resumeOptimizationToast,
    });
    const isResumeOptimizationBusy = (
        isResumeOptimizationLayoutTransitioning
        || resumeOptimizationFlow.uiState === 'starting'
        || resumeOptimizationFlow.uiState === 'answering'
        || resumeOptimizationFlow.uiState === 'applying'
        || resumeOptimizationFlow.uiState === 'rescoring'
    );
    const resumeOptimizationSkillNameById = useMemo(() => Object.fromEntries(
        skillGroups.flatMap((group) => group.skills.map((skillItem) => [skillItem.id, skillItem.name])),
    ), [skillGroups]);
    const hasResumableResumeOptimizationRun = resumeOptimizationFlow.canResumeLatestRun;
    const handleStartResumeOptimization = useCallback(async (selectedSuggestionIds: string[] = []) => {
        if (!selectedSuggestionIds.length && !hasResumableResumeOptimizationRun) {
            setWorkspaceLayout('ai'); setRightSidebarSurface('analysis');
            return null;
        }
        if (!canPersistCurrentJDAnalysis()) {
            showToastError('请先处理未同步的本地 JD 分析。');
            return null;
        }
        resumeOptimizationReturnFocusRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        resumeOptimizationShouldRestoreReportRef.current = true;
        setIsResumeOptimizationLayoutTransitioning(true);
        setWorkspaceLayout('ai');
        setRightSidebarSurface('optimization');
        try {
            await new Promise<void>((resolve) => {
                window.requestAnimationFrame(() => resolve());
            });
            if (!canPersistCurrentJDAnalysis()) {
                showToastError('请先处理未同步的本地 JD 分析。');
                setRightSidebarSurface(analysisResult ? 'analysis' : null);
                setWorkspaceLayout(analysisResult ? 'ai' : 'list');
                return null;
            }
            if (
                hasResumableResumeOptimizationRun
                && selectedSuggestionIds.length === 0
                && resumeOptimizationFlow.run?.status !== 'planning'
            ) {
                const reopenedRun = await resumeOptimizationFlow.reopenLatestRun();
                if (!reopenedRun && resumeOptimizationFlow.getLatestUiState() === 'closed') {
                    setRightSidebarSurface(analysisResult ? 'analysis' : null);
                    setWorkspaceLayout(analysisResult ? 'ai' : 'list');
                }
                return reopenedRun;
            }
            const startedRun = await resumeOptimizationFlow.startOptimization({ selectedSuggestionIds });
            if (!startedRun && resumeOptimizationFlow.getLatestUiState() === 'closed') {
                setRightSidebarSurface(analysisResult ? 'analysis' : null);
                setWorkspaceLayout(analysisResult ? 'ai' : 'list');
            }
            return startedRun;
        } finally {
            setIsResumeOptimizationLayoutTransitioning(false);
        }
    }, [
        analysisResult,
        canPersistCurrentJDAnalysis,
        hasResumableResumeOptimizationRun,
        resumeOptimizationFlow.run?.status,
        resumeOptimizationFlow.reopenLatestRun,
        resumeOptimizationFlow.getLatestUiState,
        resumeOptimizationFlow.startOptimization,
        showToastError,
    ]);
    const focusRestoredAnalysisReport = useCallback(() => {
        window.requestAnimationFrame(() => {
            const focusTarget = Array.from(document.querySelectorAll<HTMLButtonElement>(
                '[data-resume-optimization-focus-return="true"][aria-label="返回 AI 助手"]:not([disabled])'
            )).find((candidate) => (
                candidate.isConnected
                && candidate.getClientRects().length > 0
                && !candidate.closest('[inert]')
            ));
            focusTarget?.focus({ preventScroll: true });
        });
    }, []);
    const handleCloseResumeOptimization = useCallback(async () => {
        const shouldRestoreAnalysis = resumeOptimizationShouldRestoreReportRef.current && Boolean(analysisResult);
        resumeOptimizationSuppressReturnFocusRef.current = shouldRestoreAnalysis;
        const didClose = await resumeOptimizationFlow.closeWorkspace();
        if (!didClose) {
            resumeOptimizationSuppressReturnFocusRef.current = false;
            return false;
        }
        if (!shouldRestoreAnalysis) {
            setIsAssistantSidebarMounted(false);
        }
        setRightSidebarSurface(shouldRestoreAnalysis ? 'analysis' : null);
        setWorkspaceLayout(shouldRestoreAnalysis ? 'ai' : 'list');
        if (shouldRestoreAnalysis && window.matchMedia('(max-width: 767px)').matches) {
            mobileEditorDrawer.setReportTab('resume');
            mobileEditorDrawer.open('analysis');
        } else if (shouldRestoreAnalysis) focusRestoredAnalysisReport();
        resumeOptimizationShouldRestoreReportRef.current = false;
        return true;
    }, [analysisResult, focusRestoredAnalysisReport, resumeOptimizationFlow.closeWorkspace, mobileEditorDrawer.open]);

    const handleFinishResumeOptimization = useCallback(async () => {
        resumeOptimizationShouldRestoreReportRef.current = Boolean(analysisResult);
        const didClose = await handleCloseResumeOptimization();
        if (!didClose) return false;
        window.requestAnimationFrame(() => {
            const reportTab = Array.from(document.querySelectorAll<HTMLButtonElement>('[id="resume-report-tab"]')).find(
                candidate => candidate.getClientRects().length > 0 && !candidate.closest('[inert]'),
            );
            reportTab?.click();
            reportTab?.focus({ preventScroll: true });
        });
        return true;
    }, [analysisResult, handleCloseResumeOptimization]);
    const handleRescoreInReport = useCallback(async () => {
        if (!await handleFinishResumeOptimization()) return;
        return handleGenerateEvaluation();
    }, [handleFinishResumeOptimization, handleGenerateEvaluation]);

    const handleRevertResumeOptimization = useCallback(async () => {
        const shouldRestoreAnalysis = resumeOptimizationShouldRestoreReportRef.current && Boolean(analysisResult);
        resumeOptimizationSuppressReturnFocusRef.current = shouldRestoreAnalysis;
        const revertedRun = await resumeOptimizationFlow.revertRun();
        if (revertedRun?.status !== 'reverted') {
            resumeOptimizationSuppressReturnFocusRef.current = false;
            return revertedRun;
        }
        await handleCloseResumeOptimization();
        return revertedRun;
    }, [analysisResult, handleCloseResumeOptimization, resumeOptimizationFlow.revertRun]);

    const runResumeOptimizationNavigation = useCallback(async (navigate: () => void) => {
        if (resumeOptimizationNavigationInFlightRef.current) return false;
        resumeOptimizationNavigationInFlightRef.current = true;
        resumeOptimizationSuppressReturnFocusRef.current = true;
        let didClose = false;
        try {
            didClose = await resumeOptimizationFlow.closeWorkspace();
            if (!didClose) {
                resumeOptimizationSuppressReturnFocusRef.current = false;
                return false;
            }
            resumeOptimizationShouldRestoreReportRef.current = false;
            resumeOptimizationReturnFocusRef.current = null;
            setIsAssistantSidebarMounted(false);
            setRightSidebarSurface(null);
            setWorkspaceLayout('list');
            navigate();
            return true;
        } catch (cause) {
            if (!didClose) resumeOptimizationSuppressReturnFocusRef.current = false;
            throw cause;
        } finally {
            resumeOptimizationNavigationInFlightRef.current = false;
        }
    }, [resumeOptimizationFlow.closeWorkspace]);

    const handleResumeOptimizationViewExperience = useCallback((
        category: ExperienceCategory | undefined,
        masterExperienceId: string,
    ) => {
        if (!onJumpToExperienceBank) return;
        void runResumeOptimizationNavigation(() => {
            onJumpToExperienceBank?.(category, masterExperienceId);
        });
    }, [onJumpToExperienceBank, runResumeOptimizationNavigation]);

    const handleResumeOptimizationOpenAutoAssembly = useCallback(() => {
        if (experience.editingExpId) {
            showToastInfo('请先保存当前经历或返回列表，再前往一键组装。');
            return;
        }
        void runResumeOptimizationNavigation(() => {
            setFactorySidebarTab('edit');
            setSidebarTab('experience');
            setResumeOptimizationAutoAssemblyFocusRequest((current) => current + 1);
        });
    }, [experience.editingExpId, runResumeOptimizationNavigation, setSidebarTab, showToastInfo]);

    const handleResumeOptimizationReturnToPlan = useCallback(() => {
        resumeOptimizationShouldRestoreReportRef.current = true;
        setWorkspaceLayout('ai');
        setRightSidebarSurface('optimization');
        void (async () => {
            const reopenedRun = await resumeOptimizationFlow.reopenLatestRun();
            if (!reopenedRun && resumeOptimizationFlow.getLatestUiState() === 'closed') {
                setRightSidebarSurface(analysisResult ? 'analysis' : null);
                setWorkspaceLayout(analysisResult ? 'ai' : 'list');
            }
        })();
    }, [
        analysisResult,
        resumeOptimizationFlow.getLatestUiState,
        resumeOptimizationFlow.reopenLatestRun,
    ]);

    useEffect(() => {
        if (rightSidebarSurface === 'optimization' && workspaceLayout !== 'ai') {
            setWorkspaceLayout('ai');
        }
    }, [rightSidebarSurface, workspaceLayout]);

    useEffect(() => {
        if (
            resumeOptimizationFlow.uiState === 'closed'
            && rightSidebarSurface !== 'optimization'
        ) {
            resumeOptimizationShouldRestoreReportRef.current = false;
        }
    }, [resumeOptimizationFlow.uiState, rightSidebarSurface]);

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
        authUserKey,
        cachedResumes,
        isCacheOwnerMatched,
        onResumesUpdate,
    });
    const {
        applyResumeNameUpdate,
        canAutoNameResume,
        handleResumeNameChange,
    } = useResumeNameUpdate({
        authUserKey,
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
    useEffect(() => {
        if (!resumeDetail?.resume || isEditingProfile) {
            return;
        }
        const nextTargetRole = resumeDetail.resume.target_role?.trim() ?? '';
        setTargetRole(nextTargetRole);
        setOriginalTargetRole(nextTargetRole);
    }, [isEditingProfile, resumeDetail, setOriginalTargetRole, setTargetRole]);
    const handleAnalyzePersistedSnapshot = useCallback(async (
        options?: Parameters<typeof handleAnalyze>[0]
    ) => {
        if (!canPersistCurrentJDAnalysis()) {
            showToastError('请先处理未同步的本地 JD 分析。');
            return { status: 'pending_conflict' as const };
        }
        stopEvaluation();
        try {
            await flushResumeConfig();
        } catch {
            showToastError('简历内容已在其他请求中更新，请刷新后再分析 JD');
            return { status: 'aborted' as const };
        }
        if (!canPersistCurrentJDAnalysis()) {
            showToastError('请先处理未同步的本地 JD 分析。');
            return { status: 'pending_conflict' as const };
        }
        return handleAnalyze(options);
    }, [
        canPersistCurrentJDAnalysis,
        flushResumeConfig,
        handleAnalyze,
        showToastError,
        stopEvaluation,
    ]);
    const {
        handleAnalyzeWithAutoName,
        invalidateJdAnalyzeWorkflow,
    } = useJdAnalyzeWithToast({
        handleAnalyze: handleAnalyzePersistedSnapshot,
        resumeId,
        isAnalyzing,
        jdText,
        resumeName,
        pendingPolishAutoAnalyzeSeq,
        applyResumeNameUpdate,
        canAutoNameResume,
        showToastError,
        showToastSuccess,
    });
    const handleConfirmRestoredAttachmentConversion = useCallback(async () => {
        if (!convertRestoredAttachmentToText(restoredAttachmentFullTextDraft)) {
            showToastError('请先粘贴完整 JD 正文。');
            return;
        }
        setIsRestoredAttachmentConversionOpen(false);
        setRestoredAttachmentFullTextDraft('');
        await handleAnalyzeWithAutoName();
    }, [
        convertRestoredAttachmentToText,
        handleAnalyzeWithAutoName,
        restoredAttachmentFullTextDraft,
        showToastError,
    ]);
    const handleStopAnalysisWithToast = useCallback(() => {
        invalidateJdAnalyzeWorkflow();
        handleStopAnalysis();
        showToastInfo('分析中止', 2000);
    }, [handleStopAnalysis, invalidateJdAnalyzeWorkflow, showToastInfo]);
    const {
        beginProfileEdit,
        cancelProfileEdit,
        handleSaveProfile,
        isProfileReadOnly,
    } = useProfileEditActions({
        authUserKey,
        profile,
        setProfile,
        targetRole,
        setTargetRole,
        originalTargetRole,
        setOriginalTargetRole,
        resumeId,
        resumeDetail,
        applyResumeDetail,
        updateDashboardCache,
        flushResumeConfig,
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
        showToastError,
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
    const applyTemplateLayoutDefaults = useCallback((layoutDefaults: SmartPageLayout) => {
        commitLayoutSnapshot(buildLayoutSnapshot(layoutDefaults, false), { incrementVersion: true });
        applyVisibleLayout(layoutDefaults);
        setIsSmartPageApplied(false);
    }, [applyVisibleLayout, commitLayoutSnapshot, setIsSmartPageApplied]);
    const {
        handleSelectTemplate,
        handleSaveTemplatePreset,
    } = useTemplatePresetActions({
        authUserKey,
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
        onApplyTemplateLayoutDefaults: applyTemplateLayoutDefaults,
        showToastInfo,
        showToastSuccess,
        showToastError,
    });
    const resetEditorTransientState = useResumeEditorTransientReset({
        handleCancelDelete,
        setOriginalProfile,
        setOriginalProfileSyncMode,
        setIsEditingProfile,
        experience,
        education,
        certification,
        skill,
    });
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

    const listSpacingClass = 'space-y-[var(--rf-list-spacing)]';
    const {
        listSpacingValue,
        bulletSpacingValue,
        sectionSpacingClass,
        measureListSpacingValue,
        measureBulletSpacingValue,
        measureSectionSpacingClass,
        workItems,
        projectItems,
        selectedWorkItems,
        selectedProjectItems,
        selectedExperienceCount,
        sortedCertifications,
        selectedSkillGroups,
        selectedResumeSnapshot,
        selectedResumeSnapshotText,
        editablePersonalSummary,
        hasEditablePersonalSummary,
        previewProfile,
        personalSummaryContext,
    } = useResumeEditorPreviewModel({
        itemSpacingEm,
        lineHeight,
        sectionSpacingKey,
        measureLayout,
        experienceItems,
        selectedExpIds,
        educations,
        selectedEduIds,
        certifications,
        selectedCertIds,
        skillGroups,
        selectedSkillIds,
        profile,
        personalSummary,
        hasPersonalSummaryOverride,
        isSummaryVisible,
    });
    const canBatchPolish = Boolean(
        jdPolishContext.trim()
        && selectedExperienceCount > 0
        && !isFloatingExperiencePolishRunning
        && !floatingPolishSession
    );
    const assistantSidebarSelectedResume = useMemo<AssistantSelectedResume | null>(() => {
        if (!resumeId) {
            return null;
        }
        return {
            resumeId,
            resumeName: resumeName || UNTITLED_RESUME_TITLE,
            snapshot: selectedResumeSnapshot,
            contextSource: 'implicit_current_resume',
            ...(jdPolishContext.trim() ? { jdContext: jdPolishContext } : {}),
        };
    }, [jdPolishContext, resumeId, resumeName, selectedResumeSnapshot]);
    const handleApplyResumeAssistantDraft = useResumeAssistantDraftApply({
        authUserKey,
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
    const handleWorkbenchAssistantLaunch = useCallback((request: AssistantLaunchRequest) => {
        if (window.matchMedia('(max-width: 767px)').matches) {
            assistantSidebarLaunchRequestIdRef.current += 1;
            setAssistantSidebarLaunchRequest({ ...request, requestId: `mobile-workbench-${assistantSidebarLaunchRequestIdRef.current}` });
            setIsAssistantSidebarMounted(true);
            mobileEditorDrawer.open('assistant');
            return;
        }
        onLaunchAssistant?.(request);
    }, [mobileEditorDrawer.open, onLaunchAssistant]);
    const {
        handleOpenExperienceAssistant,
        handleOpenFloatingExperienceAssistant,
        handleLaunchResumeAssistant: launchResumeAssistant,
    } = useResumeEditorAssistantLaunch({
        resumeId,
        resumeName,
        jdPolishContext,
        selectedResumeSnapshot,
        onLaunchAssistant: handleWorkbenchAssistantLaunch,
        experience,
        experienceItems,
        activeFloatingPolishExperienceId,
        buildFloatingPolishSessionItem,
        applyFloatingPolishPreview,
        pendingAssistantApplyRef,
        trackedPendingAssistantApplyRef,
        setExperiencePolishPreview,
        handleApplyResumeAssistantDraft,
    });
    const handleLaunchResumeAssistant = useCallback(() => {
        if (window.matchMedia('(max-width: 767px)').matches && isAssistantSidebarMounted) {
            mobileEditorDrawer.open('assistant');
        } else launchResumeAssistant();
    }, [launchResumeAssistant, isAssistantSidebarMounted, mobileEditorDrawer.open]);
    const openResumeAssistantSidebar = useCallback(() => {
        if (!resumeId) {
            showToastInfo('请先选择或创建一份简历');
            return false;
        }
        assistantSidebarLaunchRequestIdRef.current += 1;
        setAssistantSidebarLaunchRequest({
            requestId: `editor-sidebar-launch-${assistantSidebarLaunchRequestIdRef.current}`,
            context: {
                mode: 'general',
                entrySource: 'resume_editor',
                title: `${resumeName || UNTITLED_RESUME_TITLE} · AI 简历助手`,
                contextJson: {
                    resumeId,
                },
            },
            prefillResume: assistantSidebarSelectedResume ?? undefined,
            applyDraftHandler: handleApplyResumeAssistantDraft,
        });
        setIsAssistantSidebarMounted(true);
        setRightSidebarSurface('assistant');
        return true;
    }, [
        assistantSidebarSelectedResume,
        handleApplyResumeAssistantDraft,
        resumeId,
        resumeName,
        showToastInfo,
    ]);
    const handleCloseAssistantSidebar = useCallback(() => {
        lastRightSidebarSurfaceRef.current = 'assistant';
        setRightSidebarSurface(null);
        setWorkspaceLayout('list');
    }, []);
    const handleCloseJDAnalysisDetailsSidebar = useCallback(() => {
        lastRightSidebarSurfaceRef.current = 'analysis';
        setRightSidebarSurface(null);
        setWorkspaceLayout('list');
    }, []);
    const handleReturnFromAnalysisToAssistant = useCallback(() => {
        if (window.matchMedia('(max-width: 767px)').matches) {
            mobileEditorDrawer.open('assistant');
            return;
        }
        lastRightSidebarSurfaceRef.current = 'assistant';
        setIsAssistantSidebarMounted(true);
        setRightSidebarSurface('assistant');
    }, [mobileEditorDrawer.open]);
    const {
        captureReturnFocus: captureMobileAnalysisReturnFocus,
        isMobileAnalysisViewport,
    } = useMobileJDAnalysisDialog({
        isOpen: false,
        onClose: handleReturnFromAnalysisToAssistant,
    });
    const mobileTemplates = useMobileTemplateSession({
        owner: `${authUserKey ?? ''}:${resumeId ?? ''}`,
        authUserKey,
        enabled: isMobileAnalysisViewport && Boolean(resumeId) && !isLoadingResume && !isCreatingResume,
        appearance: { templateId: resumeTemplateId, themeColorPresetId, sectionOrder, experienceListMarkerStyle, skillTagSeparator, layout: currentLayout, isSmartPageApplied },
        presets: templatePresetMap,
        ready: isTemplatePresetMapReady,
        canCommit: !hasResumeVersionConflict && !isAutoSavePaused,
        onPresetsSaved: saved => setTemplatePresetMap(previous => ({ ...previous, ...saved })),
        onCommit: appearance => {
            setResumeTemplateId(appearance.templateId);
            setThemeColorPresetId(appearance.themeColorPresetId);
            setSectionOrder([...appearance.sectionOrder]);
            setExperienceListMarkerStyle(appearance.experienceListMarkerStyle);
            setSkillTagSeparator(appearance.skillTagSeparator);
            commitLayoutSnapshot(buildLayoutSnapshot(appearance.layout, appearance.isSmartPageApplied), { incrementVersion: true });
            applyVisibleLayout(appearance.layout);
            setIsSmartPageApplied(appearance.isSmartPageApplied);
        },
    });
    const handleOpenResponsiveTemplateSelector = async () => {
        handleOpenTemplateSelector(); // Preserve account preset refresh and fallback handling.
        if (isMobileAnalysisViewport) {
            setIsTemplateSelectorOpen(false);
            mobileEditorDrawer.dismissImmediately();
            try {
                await mobileTemplates.prepareTransition();
            } catch {
                showToastError('模板加载失败，请重试');
                return;
            }
            mobileTemplates.open();
        }
    };
    const handleOpenJDAnalysisDetailsSidebar = useCallback(() => {
        if (window.matchMedia('(max-width: 767px)').matches) {
            mobileEditorDrawer.setReportTab('jd');
            mobileEditorDrawer.open('analysis');
            return;
        }
        if (!analysisResult) {
            return;
        }
        captureMobileAnalysisReturnFocus();
        setRightSidebarSurface('analysis');
        setWorkspaceLayout((currentLayout) => currentLayout === 'ai' ? 'ai' : 'triple');
    }, [analysisResult, captureMobileAnalysisReturnFocus, mobileEditorDrawer.open]);
    const shouldRestoreHydratedOptimizationWorkspace = Boolean(
        !isMobileAnalysisViewport
        && rightSidebarSurface === null
        && resumeOptimizationFlow.run?.resumeId === resumeId
        && ['planning', 'applying', 'rescoring'].includes(resumeOptimizationFlow.run?.status ?? '')
        && isResumeOptimizationBusy
        // closeWorkspace records an explicit dismissal as `closed`; do not steal
        // focus or reopen a task the user intentionally left.
        && ['starting', 'applying', 'rescoring'].includes(resumeOptimizationFlow.uiState)
    );
    useEffect(() => {
        if (!shouldRestoreHydratedOptimizationWorkspace) return;
        // invalidateGeneration updates this ref synchronously. It guards the
        // brief stale render that can otherwise follow an owner change.
        if (resumeOptimizationFlow.getLatestUiState() !== resumeOptimizationFlow.uiState) return;
        setWorkspaceLayout('ai');
        setRightSidebarSurface('optimization');
    }, [
        resumeOptimizationFlow.getLatestUiState,
        resumeOptimizationFlow.uiState,
        shouldRestoreHydratedOptimizationWorkspace,
    ]);
    useEffect(() => {
        if (!analysisResult && rightSidebarSurface === 'analysis') {
            handleCloseJDAnalysisDetailsSidebar();
        }
    }, [analysisResult, handleCloseJDAnalysisDetailsSidebar, rightSidebarSurface]);
    const handleWorkspaceLayoutChange = useCallback(async (nextLayout: ResumeEditorWorkspaceLayout) => {
        const requestId = ++workspaceLayoutRequestRef.current;
        if (nextLayout === workspaceLayout && (nextLayout === 'list' || rightSidebarSurface !== null)) return;
        if (rightSidebarSurface === 'optimization') {
            if (isResumeOptimizationBusy) return;
            const didClose = await resumeOptimizationFlow.closeWorkspace();
            if (!didClose || workspaceLayoutRequestRef.current !== requestId) return;
            resumeOptimizationShouldRestoreReportRef.current = false;
            resumeOptimizationReturnFocusRef.current = null;
        }
        if (nextLayout === 'list') {
            if (rightSidebarSurface) lastRightSidebarSurfaceRef.current = rightSidebarSurface;
            setRightSidebarSurface(null);
            setWorkspaceLayout('list');
            return;
        }
        setWorkspaceLayout(nextLayout);
        if (rightSidebarSurface === null || rightSidebarSurface === 'optimization') {
            const previousSurface = rightSidebarSurface === null ? lastRightSidebarSurfaceRef.current : 'assistant';
            if (previousSurface === 'analysis' && analysisResult) {
                setRightSidebarSurface('analysis');
            } else if (previousSurface === 'optimization' && resumeOptimizationFlow.canResumeLatestRun) {
                const reopenedRun = await resumeOptimizationFlow.reopenLatestRun();
                if (workspaceLayoutRequestRef.current !== requestId) return;
                if (reopenedRun) {
                    setWorkspaceLayout('ai');
                    setRightSidebarSurface('optimization');
                } else {
                    setRightSidebarSurface(analysisResult ? 'analysis' : null);
                    if (!analysisResult) setWorkspaceLayout('list');
                }
            } else if (isAssistantSidebarMounted) {
                setRightSidebarSurface('assistant');
            } else {
                openResumeAssistantSidebar();
            }
        }
    }, [
        analysisResult,
        isAssistantSidebarMounted,
        isResumeOptimizationBusy,
        openResumeAssistantSidebar,
        resumeOptimizationFlow.closeWorkspace,
        resumeOptimizationFlow.canResumeLatestRun,
        resumeOptimizationFlow.reopenLatestRun,
        rightSidebarSurface,
        workspaceLayout,
    ]);
    const handleConsumeAssistantSidebarLaunchRequest = useCallback((requestId?: string) => {
        setAssistantSidebarLaunchRequest((current) => {
            if (!current) {
                return current;
            }
            if (requestId && current.requestId !== requestId) {
                return current;
            }
            return null;
        });
    }, []);
    const handleExpandAssistantSidebar = useCallback((sessionId?: string | null) => {
        if (sessionId && onOpenAssistantSession) {
            onOpenAssistantSession(sessionId);
            return;
        }
        handleLaunchResumeAssistant();
    }, [handleLaunchResumeAssistant, onOpenAssistantSession]);
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
        editingThinkingText,
        onStopEditing: handleStopEditing,
        floatingThinkingText,
        onStopFloating: handleStopFloating,
    });
    const isEditorBusy = isLoadingResume || isCreatingResume;
    const {
        isPreviewOverflowing,
        overflowingSectionIds,
    } = useResumePreviewMeasurement({
        enabled: !isEditorBusy,
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
            summary: buildJDIntentSummary(analysisResult),
            jobTitle: analysisResult?.jobTitle,
            company: analysisResult?.company,
            resumeText: selectedResumeSnapshotText,
        }),
        [analysisResult, jdPolishContext, selectedResumeSnapshotText]
    );
    const isBossGreetingOutdated = Boolean(
        bossGreeting && bossGreetingSignature !== bossGreetingCurrentSignature
    );
    useLayoutEffect(() => {
        latestResumeIdRef.current = resumeId;
        latestBossGreetingSignatureRef.current = bossGreetingCurrentSignature;
        latestBossGreetingAnalysisOutdatedRef.current = isOutdated;
        bossGreetingUiStateRef.current = {
            text: bossGreeting,
            signature: bossGreetingSignature,
            isVisible: isBossGreetingVisible,
        };
    }, [
        bossGreeting,
        bossGreetingCurrentSignature,
        bossGreetingSignature,
        isBossGreetingVisible,
        isOutdated,
        resumeId,
    ]);
    const {
        isGeneratingPersonalSummary,
        isPersonalSummaryOverwriteDialogOpen,
        handlePersonalSummaryChange,
        handleGeneratePersonalSummary,
        confirmPersonalSummaryOverwrite,
        cancelPersonalSummaryOverwrite,
    } = usePersonalSummaryGeneration({
        authUserKey,
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
        hasJdContext,
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
        authUserKey,
        resumeId,
        analysisResult,
        bossGreeting,
        isBossGreetingVisible,
        isBossGreetingOutdated,
        isGeneratingBossGreeting,
        isOutdated,
        jdPolishContext,
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
        closeToast,
        resumeName,
        targetRole,
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
        openMobileDrawer: () => mobileEditorDrawer.open('information'),
        beginProfileEdit,
        cancelEditingExperience: experience.cancelEditingExperience,
        startEditingExperience: experience.startEditingExperience,
        beginEditCertification: certification.beginEditCertification,
        beginEditSkill: skill.beginEditSkill,
        beginCreateEducation: education.beginCreateEducation,
        beginEditEducation: education.beginEditEducation,
    });

    useResumeEditorExperienceFocusRequest({
        request: focusExperienceRequest,
        isLoading: isLoadingResume || isLoadingExperiences,
        experienceItems,
        onOpenExperienceEditor: () => {
            setSidebarTab('experience');
            mobileEditorDrawer.open('information');
        },
        onStartEditing: experience.startEditingExperience,
        onMissingTarget: () => {
            showToastError('未找到目标经历，已打开简历工厂');
        },
        onHandled: onFocusExperienceRequestHandled,
    });

    const canCreateResume = !isLoadingResume;
    const sharedPreviewProps: SharedResumePreviewProps = {
        templateId: resumeTemplateId,
        themeColorPresetId,
        experienceListMarkerStyle,
        skillTagSeparator,
        profile: previewProfile,
        listSpacingClass,
        sectionOrder,
        selectedWorkItems,
        selectedProjectItems,
        educations,
        selectedEduIds,
        sortedCertifications,
        selectedCertIds,
        selectedSkillGroups,
        onNavigateTab: handlePreviewNavigateTab,
        targetRole,
    };
    const {
        layoutAdjustProps,
        editorPreviewProps,
        measurePreviewProps,
    } = useResumeEditorPreviewWorkspaceProps({
        sharedPreviewProps,
        isLayoutAdjustToolbarOpen,
        lineHeight,
        fontSize,
        topPaddingPx,
        sectionSpacingKey,
        itemSpacingEm,
        themeColorPresetId,
        onLineHeightChange: handleLineHeightChange,
        onFontSizeChange: handleFontSizeChange,
        onTopPaddingChange: handleTopPaddingChange,
        onSectionSpacingChange: handleSectionSpacingChange,
        onItemSpacingChange: handleItemSpacingChange,
        onThemeColorChange: setThemeColorPresetId,
        previewRef,
        previewContentRef,
        isPreviewOverflowing,
        overflowingSectionIds,
        floatingPolishHighlightItemIds,
        isPreviewInteractionLocked,
        listSpacingValue,
        bulletSpacingValue,
        sectionSpacingClass,
        isDragging,
        draggedItemKey,
        draggedSectionId,
        onSectionDragStart: handleSectionDragStart,
        onSectionDragHover: handleSectionDragHover,
        onSectionDrop: handleSectionDrop,
        onTouchSectionDragStart: startSectionReorder,
        onItemDragStart: handleDragStart,
        onItemDragHover: handleItemDragHover,
        onItemDrop: handleItemDrop,
        onTouchItemDragStart: startItemReorder,
        onTouchDragEnd: finishDragInteraction,
        onTouchDragCancel: cancelTouchDragInteraction,
        onDragEnd: clearDragState,
        onEditExperience: handleEditExperience,
        onEditCertification: handleEditCertification,
        onEditSkill: handleEditSkill,
        measurePreviewRef,
        measurePreviewContentRef,
        measureLayout,
        measureListSpacingValue,
        measureBulletSpacingValue,
        measureSectionSpacingClass,
    });
    const commonEditorSidebarProps: Omit<EditorSidebarProps, 'layoutMode' | 'showJDPanel'> = {
        sidebarTab,
        onSelectTab: handleSidebarTabSelect,
        onProfileTabSelected: handleProfileTabSelected,
        jdPanelProps: {
            jdText,
            jdContextText: jdPolishContext,
            analysisResult,
            isAnalyzing,
            isCollapsed: isJDCollapsed,
            onAnalyze: handleAnalyzeWithAutoName,
            onToggleCollapse: handleToggleJdCollapse,
            onJdTextChange: handleJdTextChange,
            jdFile,
            onFileSelect: selectJdFile,
            onFileClear: clearJdFile,
            hasMissingAttachmentContext,
            hasJdContext,
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
            isEvaluationOutdated,
            isEvaluating,
            evaluationThinkingText,
            evaluationError,
            onGenerateEvaluation: handleGenerateEvaluation,
            onStopEvaluation: stopEvaluation,
            isOptimizationEnabled: RESUME_OPTIMIZATION_ENABLED,
            isOptimizationBusy: isResumeOptimizationBusy,
            canStartOptimization: resumeOptimizationFlow.canStart,
            optimizationDisabledReason: resumeOptimizationFlow.disabledReason,
            onStartOptimization: handleStartResumeOptimization,
            thinkingText,
            onStopAnalyze: handleStopAnalysisWithToast,
            onOpenDetailsSidebar: handleOpenJDAnalysisDetailsSidebar,
        },
        profileTabProps: {
            profile,
            setProfile,
            targetRole,
            setTargetRole,
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
        },
        experienceTabProps: {
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
            autoAssemblyFocusRequest: resumeOptimizationAutoAssemblyFocusRequest,
            showReturnToOptimizationPlan: (
                rightSidebarSurface !== 'optimization'
                && hasResumableResumeOptimizationRun
            ),
            onReturnToOptimizationPlan: handleResumeOptimizationReturnToPlan,
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
        },
        editingSuggestion: {
            editingItem,
            staleExperienceIds,
            toolbar: editingSuggestionToolbar,
        },
    };
    const currentLayoutDefaults = useMemo<SmartPageLayout>(() => ({
        topPaddingPx,
        sectionSpacingKey,
        itemSpacingEm,
        lineHeight,
        fontSize,
    }), [fontSize, itemSpacingEm, lineHeight, sectionSpacingKey, topPaddingPx]);
    const handleSaveCurrentTemplateDefault = useCallback(async () => {
        await handleSaveTemplatePreset({
            templateId: resumeTemplateId,
            sectionOrder,
            themeColorPresetId,
            experienceListMarkerStyle,
            skillTagSeparator,
            layoutDefaults: currentLayoutDefaults,
        });
    }, [
        currentLayoutDefaults,
        experienceListMarkerStyle,
        handleSaveTemplatePreset,
        resumeTemplateId,
        sectionOrder,
        skillTagSeparator,
        themeColorPresetId,
    ]);
    const handleRestoreTemplateDefault = useCallback(() => {
        const templateLayoutDefaults = templatePresetMap[resumeTemplateId]?.layoutDefaults;
        if (templateLayoutDefaults) {
            applyTemplateLayoutDefaults(templateLayoutDefaults);
            showToastInfo('已恢复当前模板默认布局');
            return;
        }
        restoreDefault();
    }, [
        applyTemplateLayoutDefaults,
        restoreDefault,
        resumeTemplateId,
        showToastInfo,
        templatePresetMap,
    ]);
    const handleCustomizeTemplateFromSidebar = useCallback((templateId: ResumeFactorySidebarProps['selectedTemplateId']) => {
        handleSelectTemplate(templateId);
        setFactorySidebarTab('layout');
    }, [handleSelectTemplate]);
    const factorySidebarProps = useMemo<ResumeFactorySidebarProps>(() => ({
        activeTab: factorySidebarTab,
        onTabChange: setFactorySidebarTab,
        editorSidebarProps: commonEditorSidebarProps,
        layoutAdjustProps,
        selectedTemplateId: resumeTemplateId,
        templatePresetMap,
        isTemplatePresetMapReady,
        onSelectTemplate: handleSelectTemplate,
        onCustomizeTemplate: handleCustomizeTemplateFromSidebar,
        sectionOrder,
        onSectionOrderChange: setSectionOrder,
        experienceListMarkerStyle,
        onExperienceListMarkerStyleChange: setExperienceListMarkerStyle,
        skillTagSeparator,
        onSkillTagSeparatorChange: setSkillTagSeparator,
        onSaveCurrentTemplateDefault: handleSaveCurrentTemplateDefault,
        onRestoreDefault: handleRestoreTemplateDefault,
        onAdjustToSinglePage: adjustToSinglePage,
    }), [
        adjustToSinglePage,
        commonEditorSidebarProps,
        experienceListMarkerStyle,
        factorySidebarTab,
        handleCustomizeTemplateFromSidebar,
        handleRestoreTemplateDefault,
        handleSaveCurrentTemplateDefault,
        handleSelectTemplate,
        isTemplatePresetMapReady,
        layoutAdjustProps,
        resumeTemplateId,
        sectionOrder,
        setExperienceListMarkerStyle,
        setSectionOrder,
        setSkillTagSeparator,
        skillTagSeparator,
        templatePresetMap,
    ]);
    const isRightSidebarOpen = workspaceLayout !== 'list' && rightSidebarSurface !== null;
    const isAssistantSidebarActive = rightSidebarSurface === 'assistant';
    const resumeOptimizationModuleOrder = useMemo(() => {
        const modulesBySection = new Map<string, string[]>([
            ['summary', ['summary']],
            ['work', selectedWorkItems.map((item) => item.id)],
            ['project', selectedProjectItems.map((item) => item.id)],
            ['skills', ['skills']],
        ]);
        return [
            ...sectionOrder.flatMap((sectionId) => modulesBySection.get(sectionId) ?? []),
            'sections',
        ];
    }, [sectionOrder, selectedProjectItems, selectedWorkItems]);
    const optimizationReviewPlan = resumeOptimizationFlow.run
        ? resumeOptimizationFlow.run.result ?? resumeOptimizationFlow.run.plan
        : null;
    const editorPreviewPropsWithOptimization = (
        rightSidebarSurface === 'optimization'
        && optimizationReviewPlan
        && !isMobileAnalysisViewport
        && !isResumeOptimizationLayoutTransitioning
        && shouldRenderResumeOptimizationComparison(resumeOptimizationFlow.uiState)
    ) ? {
            ...editorPreviewProps,
            optimizationComparison: {
                changes: optimizationReviewPlan.changes,
                acceptedChangeIds: resumeOptimizationFlow.acceptedChangeIds,
                readOnly: resumeOptimizationFlow.run?.status !== 'preview_ready',
            },
        } : mobileTemplates.active ? {
            ...editorPreviewProps,
            templateId: mobileTemplates.current.templateId,
            themeColorPresetId: mobileTemplates.current.themeColorPresetId,
            sectionOrder: mobileTemplates.current.sectionOrder,
            experienceListMarkerStyle: mobileTemplates.current.experienceListMarkerStyle,
            skillTagSeparator: mobileTemplates.current.skillTagSeparator,
            lineHeight: mobileTemplates.current.layout.lineHeight,
            fontSize: mobileTemplates.current.layout.fontSize,
            topPaddingPx: mobileTemplates.current.layout.topPaddingPx,
            listSpacingValue: buildSpacingValue(mobileTemplates.current.layout.itemSpacingEm, mobileTemplates.current.layout.lineHeight),
            bulletSpacingValue: buildSpacingValue(LIST_SPACING_BY_DENSITY.compact, mobileTemplates.current.layout.lineHeight),
            sectionSpacingClass: resolveSectionSpacingClass(mobileTemplates.current.layout.sectionSpacingKey),
            readOnly: true,
        } : editorPreviewProps;
    const jdAnalysisDetailsSidebarProps = analysisResult ? {
        onAnalyze: handleAnalyzeWithAutoName,
        isAnalyzing,
        isAnalyzeDisabled: isEvaluating || !hasJdContext || hasMissingAttachmentContext,
        analysisResult,
        jdText: jdPolishContext,
        isOutdated,
        isEvaluationOutdated,
        isEvaluating,
        evaluationThinkingText,
        evaluationError,
        onGenerateEvaluation: handleGenerateEvaluation,
        onStopEvaluation: stopEvaluation,
        isOptimizationEnabled: RESUME_OPTIMIZATION_ENABLED,
        isOptimizationBusy: isResumeOptimizationBusy,
        canStartOptimization: resumeOptimizationFlow.canStart,
        optimizationDisabledReason: resumeOptimizationFlow.disabledReason,
        onStartOptimization: handleStartResumeOptimization,
        onClose: handleReturnFromAnalysisToAssistant,
        onOpenAgentPluginConfig,
    } satisfies React.ComponentProps<typeof JDAnalysisDetailsSidebar> : null;
    const rightSidebarContent = isRightSidebarOpen || hasOpenedRightSidebar ? (
        <div aria-hidden={!isRightSidebarOpen} inert={!isRightSidebarOpen ? true : undefined} className="relative h-full min-h-0 w-full overflow-clip bg-white dark:bg-slate-950">
            {isAssistantSidebarMounted && !isMobileAnalysisViewport ? (
                <div
                    aria-hidden={!isAssistantSidebarActive}
                    inert={!isAssistantSidebarActive ? true : undefined}
                    className={[
                        'absolute inset-0 transition-[transform,opacity] duration-200 ease-out',
                        isAssistantSidebarActive
                            ? 'translate-y-0 opacity-100'
                            : '-translate-y-4 opacity-0 pointer-events-none',
                    ].join(' ')}
                >
                    <div ref={setDesktopAssistantContainer} className="h-full min-h-0" />
                </div>
            ) : null}
            {jdAnalysisDetailsSidebarProps ? (
                <div
                    aria-hidden={!isJDAnalysisDetailsSidebarOpen}
                    inert={!isJDAnalysisDetailsSidebarOpen ? true : undefined}
                    className={[
                        'absolute inset-0 transition-transform duration-200 ease-out',
                        isJDAnalysisDetailsSidebarOpen
                            ? 'translate-y-0'
                            : 'translate-y-full pointer-events-none',
                    ].join(' ')}
                >
                    <JDAnalysisDetailsSidebar {...jdAnalysisDetailsSidebarProps} />
                </div>
            ) : null}
            {rightSidebarSurface === 'optimization' && !isMobileAnalysisViewport ? (
                <React.Suspense fallback={<div className="h-full w-full animate-pulse bg-slate-50 dark:bg-slate-900" aria-label="正在加载简历优化工作区" />}>
                    <ResumeOptimizationWorkspace
                        {...resumeOptimizationFlow}
                        revertRun={handleRevertResumeOptimization}
                        surface="sidebar"
                        onRequestClose={handleCloseResumeOptimization}
                        onFinish={handleFinishResumeOptimization}
                        onRescoreInReport={handleRescoreInReport}
                        returnFocusRef={resumeOptimizationReturnFocusRef}
                        suppressReturnFocusRef={resumeOptimizationSuppressReturnFocusRef}
                        skillNameById={resumeOptimizationSkillNameById}
                        moduleOrder={resumeOptimizationModuleOrder}
                        onViewExperience={handleResumeOptimizationViewExperience}
                        onOpenAutoAssembly={handleResumeOptimizationOpenAutoAssembly}
                    />
                </React.Suspense>
            ) : null}
        </div>
    ) : null;
    return (
        <ScoreAnnotationProvider experiences={[...selectedWorkItems, ...selectedProjectItems]} onLocate={isMobileAnalysisViewport ? (key) => {
            const experienceId = key.startsWith('experience_star:') ? key.slice('experience_star:'.length) : null;
            if (experienceId && experienceItems.some(item => item.id === experienceId)) {
                handleEditExperience(experienceId);
                return true;
            }
            mobileEditorDrawer.dismissImmediately();
        } : undefined} suggestions={!isEvaluationOutdated && analysisResult?.resumeEvaluation?.evaluationVersion === 'resume_score_v2' ? analysisResult.resumeEvaluation.suggestions : []}
            reportKey={JSON.stringify([resumeId, evaluationSignature, analysisResult?.resumeEvaluation, isEvaluationOutdated])}>
        <ResumeEditorViewport
            scrollContainerRef={mobileEditorScrollContainerRef}
            onKeyDownCapture={event => {
                if (mobileTemplates.active && !mobileTemplates.editingTemplateId && event.key === 'Escape') {
                    event.preventDefault(); mobileTemplates.cancel(); return;
                }
                if (!mobileEditorDrawer.isOpen || event.key !== 'Escape') return;
                if (confirmDialog) {
                    event.preventDefault(); event.stopPropagation(); handleCancelDelete();
                } else if (isPersonalSummaryOverwriteDialogOpen) {
                    event.preventDefault(); event.stopPropagation(); cancelPersonalSummaryOverwrite();
                }
            }}
            busy={isEditorBusy}
            templateToolbar={mobileTemplates.active ? <React.Suspense fallback={null}><MobileTemplateToolbar
                saving={mobileTemplates.saving} ready={isTemplatePresetMapReady} error={mobileTemplates.error}
                onCancel={mobileTemplates.cancel} onConfirm={() => void mobileTemplates.confirm()}
            /></React.Suspense> : null}
            templateStrip={mobileTemplates.active ? <React.Suspense fallback={<div className="h-56 shrink-0 bg-white dark:bg-slate-900" role="status">正在加载模板…</div>}><MobileTemplateStrip
                selectedTemplateId={mobileTemplates.current.templateId}
                presets={mobileTemplates.effectivePresets}
                ready={isTemplatePresetMapReady}
                busy={mobileTemplates.saving}
                fallbackAvailable={isTemplatePresetFallbackAvailable}
                onFallback={() => unlockTemplatePresetMapWithLocalFallback(templatePresetFallbackOwnerKey)}
                onSelect={mobileTemplates.select}
                onCustomize={mobileTemplates.customize}
            /></React.Suspense> : null}
            workbench={isMobileAnalysisViewport ? <React.Suspense fallback={null}>
                <ResumeEditorMobileDrawer
                    key={`${authUserKey ?? ''}:${resumeId ?? ''}`}
                    hasOpened={mobileEditorDrawer.hasOpened}
                    busy={isEditorBusy}
                    page={mobileEditorDrawer.page}
                    suspended={resumeOptimizationFlow.uiState !== 'closed' && isMobileAnalysisViewport}
                    analysis={<MobileWorkbenchReports panel={commonEditorSidebarProps.jdPanelProps} reportTab={mobileEditorDrawer.reportTab} onSelectReport={mobileEditorDrawer.setReportTab} />}
                    assistant={<div ref={setMobileAssistantContainer} className="h-full min-h-0" />}
                    isOpen={mobileEditorDrawer.isOpen}
                    isVisible={mobileEditorDrawer.isVisible}
                    onOpen={(target) => {
                        if (target === 'assistant') {
                            handleLaunchResumeAssistant();
                        } else mobileEditorDrawer.open(target);
                    }}
                    onClose={mobileEditorDrawer.close}
                    sidebarProps={commonEditorSidebarProps}
                />
            </React.Suspense> : null}
        >
            {hasResumeVersionConflict ? (
                <div
                    role="alert"
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100 md:px-6"
                >
                    <span>检测到远端更新，自动保存已暂停，以避免覆盖其他页面的修改。</span>
                    <button
                        type="button"
                        onClick={() => void handleReloadAfterResumeConflict()}
                        className="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-amber-800 transition hover:bg-amber-100 dark:border-amber-400/40 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-500/20"
                    >
                        重新加载远端版本
                    </button>
                </div>
            ) : null}
            {hasPendingJDAnalysisConflict ? (
                <div
                    role="alert"
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100 md:px-6"
                >
                    <span>检测到未同步的本地 JD 分析，暂时无法确认它基于当前云端版本。为避免覆盖或重复消耗 AI，请先选择处理方式。</span>
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            disabled={hasResumeVersionConflict}
                            onClick={handleRestorePendingJDAnalysis}
                            className="rounded-md border border-rose-300 bg-white px-2.5 py-1 text-rose-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-400/40 dark:bg-rose-950/40 dark:text-rose-100"
                        >
                            恢复本地分析
                        </button>
                        <button
                            type="button"
                            disabled={hasResumeVersionConflict}
                            onClick={handleDiscardPendingJDAnalysis}
                            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                        >
                            舍弃本地副本
                        </button>
                    </div>
                </div>
            ) : null}
            {hasMissingAttachmentContext ? (
                <div
                    role="alert"
                    className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100 md:px-6"
                >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>原 JD 附件正文不可恢复；当前输入框仅是补充说明，不会被当作完整 JD。请重新上传附件，或明确改用完整文本 JD。</span>
                        <button
                            type="button"
                            onClick={() => setIsRestoredAttachmentConversionOpen((current) => !current)}
                            className="rounded-md border border-amber-300 bg-white px-2.5 py-1 font-semibold text-amber-800 dark:border-amber-400/40 dark:bg-amber-950/40 dark:text-amber-100"
                        >
                            改用完整文本 JD
                        </button>
                    </div>
                    {isRestoredAttachmentConversionOpen ? (
                        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
                            <label className="min-w-0 flex-1">
                                <span className="mb-1 block font-semibold">完整 JD 正文</span>
                                <textarea
                                    value={restoredAttachmentFullTextDraft}
                                    onChange={(event) => setRestoredAttachmentFullTextDraft(event.target.value)}
                                    placeholder="请在此粘贴完整 JD 正文"
                                    className="h-24 w-full rounded-md border border-amber-300 bg-white p-2 text-xs text-slate-800 dark:border-amber-500/40 dark:bg-slate-950 dark:text-slate-100"
                                />
                            </label>
                            <button
                                type="button"
                                disabled={!restoredAttachmentFullTextDraft.trim()}
                                onClick={() => void handleConfirmRestoredAttachmentConversion()}
                                className="rounded-md bg-amber-700 px-3 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                确认切换并重新评分
                            </button>
                        </div>
                    ) : null}
                </div>
            ) : null}
            <div className="hidden md:block">
                <EditorToolbar
                    isDarkMode={isDarkMode}
                    saveState={saveState}
                    lastSavedAt={lastSavedAt}
                    onToggleTheme={toggleTheme}
                    isLayoutModified={isLayoutModified}
                    isSmartPageApplied={isSmartPageApplied}
                    onAdjustToSinglePage={adjustToSinglePage}
                    onRestoreDefault={handleRestoreTemplateDefault}
                    canCreateResume={canCreateResume}
                    isCreatingResume={isCreatingResume}
                    onCreateResume={handleCreateResume}
                    resumeName={resumeName}
                    onResumeNameChange={handleResumeNameChange}
                    onExportPdf={handleExportPdf}
                    isExportingPdf={isExportingPdf}
                    isPreviewOverflowing={isPreviewOverflowing}
                    workspaceLayout={workspaceLayout}
                    onWorkspaceLayoutChange={handleWorkspaceLayoutChange}
                    canOpenWorkspacePanels={Boolean(resumeId && !isLoadingResume)}
                    isWorkspaceLayoutLocked={rightSidebarSurface === 'optimization' && isResumeOptimizationBusy}
                />
            </div>
            <div className={`${mobileTemplates.active ? 'hidden' : 'md:hidden'} rf-mobile-editor-header`}>
                <React.Suspense fallback={null}>
                    <MobileEditorHeader
                        templateSelectionActive={mobileTemplates.active}
                        resumeId={resumeId}
                        resumeName={resumeName}
                        onResumeNameChange={handleResumeNameChange}
                    analysisResult={analysisResult}
                    isOutdated={isOutdated}
                    isAnalyzing={isAnalyzing}
                    onAnalyze={handleAnalyzeWithAutoName}
                    onOpenAnalysisDetails={handleOpenJDAnalysisDetailsSidebar}
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
                    onOpenTemplateSelector={handleOpenResponsiveTemplateSelector}
                    onAutoAssemble={handleAutoAssemble}
                    isAutoAssembling={isAutoAssembling}
                    autoAssemblyFocusRequest={resumeOptimizationAutoAssemblyFocusRequest}
                    showReturnToOptimizationPlan={(
                        rightSidebarSurface !== 'optimization'
                        && hasResumableResumeOptimizationRun
                    )}
                    onReturnToOptimizationPlan={handleResumeOptimizationReturnToPlan}
                    onCreateResume={handleCreateResume}
                    canCreateResume={canCreateResume}
                    isCreatingResume={isCreatingResume}
                    isLayoutModified={isLayoutModified}
                    isSmartPageApplied={isSmartPageApplied}
                    isLayoutAdjustToolbarOpen={isLayoutAdjustToolbarOpen}
                    onToggleLayoutAdjustToolbar={handleToggleLayoutAdjustToolbar}
                    onAdjustToSinglePage={adjustToSinglePage}
                    onRestoreDefault={handleRestoreTemplateDefault}
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
                    onFileSelect={selectJdFile}
                    onFileClear={clearJdFile}
                    hasMissingAttachmentContext={hasMissingAttachmentContext}
                    hasJdContext={hasJdContext}
                    isJDCollapsed={isJDCollapsed}
                    onJDCollapseChange={setIsJDCollapsed}
                    onLaunchAssistant={handleLaunchResumeAssistant}
                    canLaunchAssistant={Boolean(resumeId && !isLoadingResume)}
                    thinkingText={thinkingText}
                    onStopAnalyze={handleStopAnalysisWithToast}
                />
                </React.Suspense>
            </div>
            <ResumeEditorDesktopWorkspace
                factorySidebarProps={factorySidebarProps}
                layoutAdjustProps={mobileTemplates.active ? { ...layoutAdjustProps, isOpen: false } : layoutAdjustProps}
                previewProps={editorPreviewPropsWithOptimization}
                layoutMode={workspaceLayout}
                isRightSidebarOpen={isRightSidebarOpen}
                rightSidebar={rightSidebarContent}
            />
            {resumeOptimizationFlow.uiState !== 'closed' && isMobileAnalysisViewport ? (
                <React.Suspense fallback={<div className="fixed inset-0 z-[90] animate-pulse bg-white/95 dark:bg-slate-950/95" aria-label="正在加载简历优化工作区" />}>
                    <ResumeOptimizationWorkspace
                        {...resumeOptimizationFlow}
                        revertRun={handleRevertResumeOptimization}
                        surface="modal"
                        onRequestClose={handleCloseResumeOptimization}
                        onFinish={handleFinishResumeOptimization}
                        onRescoreInReport={handleRescoreInReport}
                        returnFocusRef={resumeOptimizationReturnFocusRef}
                        suppressReturnFocusRef={resumeOptimizationSuppressReturnFocusRef}
                        skillNameById={resumeOptimizationSkillNameById}
                        moduleOrder={resumeOptimizationModuleOrder}
                        onViewExperience={handleResumeOptimizationViewExperience}
                        onOpenAutoAssembly={handleResumeOptimizationOpenAutoAssembly}
                    />
                </React.Suspense>
            ) : null}
            <TemplateSelectorModal
                isOpen={mobileTemplates.active ? Boolean(mobileTemplates.editingTemplateId) : isTemplateSelectorOpen}
                surface={mobileTemplates.active ? 'drawer' : 'modal'}
                initialEditingTemplateId={mobileTemplates.editingTemplateId}
                selectedTemplateId={mobileTemplates.current.templateId}
                themeColorPresetId={mobileTemplates.current.themeColorPresetId}
                sectionOrder={mobileTemplates.current.sectionOrder}
                experienceListMarkerStyle={mobileTemplates.current.experienceListMarkerStyle}
                skillTagSeparator={mobileTemplates.current.skillTagSeparator}
                templatePresetMap={mobileTemplates.effectivePresets}
                isPresetMapReady={isTemplatePresetMapReady}
                isPresetSyncFallbackAvailable={isTemplatePresetFallbackAvailable}
                onClose={mobileTemplates.active ? mobileTemplates.closeCustomization : () => setIsTemplateSelectorOpen(false)}
                onUseLocalPresetFallback={() => unlockTemplatePresetMapWithLocalFallback(templatePresetFallbackOwnerKey)}
                onSelectTemplate={handleSelectTemplate}
                onSaveTemplatePreset={mobileTemplates.active ? mobileTemplates.stagePreset : handleSaveTemplatePreset}
            />

            {isAssistantSidebarMounted ? (
                <PersistentAssistantPortal
                    key={`${authUserKey ?? ''}:${resumeId ?? ''}`}
                    container={isMobileAnalysisViewport ? mobileAssistantContainer : desktopAssistantContainer}
                >
                    <React.Suspense fallback={<div className="p-4 text-sm text-gray-500" role="status">正在加载 AI 助手…</div>}>
                        <AIAssistant
                            authUserKey={authUserKey}
                            surface={isMobileAnalysisViewport ? 'workbench' : 'sidebar'}
                            pendingLaunchRequest={assistantSidebarLaunchRequest}
                            liveSelectedResume={assistantSidebarSelectedResume}
                            onConsumeLaunchRequest={handleConsumeAssistantSidebarLaunchRequest}
                            onClose={handleCloseAssistantSidebar}
                            onExpandToFullPage={handleExpandAssistantSidebar}
                            onOpenAnalysisDetails={isMobileAnalysisViewport || analysisResult ? handleOpenJDAnalysisDetailsSidebar : undefined}
                        />
                    </React.Suspense>
                </PersistentAssistantPortal>
            ) : null}
            {!isEditorBusy ? <ResumeEditorMeasurePreview {...measurePreviewProps} /> : null}
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
        </ResumeEditorViewport>
        </ScoreAnnotationProvider>
    );
};
export default ResumeEditor;
