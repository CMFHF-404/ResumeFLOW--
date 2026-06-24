import React, { useCallback, useEffect, useMemo } from 'react';
import ConfirmDialog from '../../components/ConfirmDialog';
import { ToastContainer, useToast } from '../../components/Toast';
import { useExperienceActions } from '../../hooks/useExperienceActions';
import { useJDAnalysis } from '../../hooks/useJDAnalysis';
import { useResumeData } from '../../hooks/useResumeData';
import { experienceService } from '../../services/experienceService';
import type { TokenQuotaSummary } from '../../services/billingService';
import type {
    CertificationView,
    EducationView,
    ProfileSyncMode,
    ResumeEditorProfile,
    ResumeExperienceView,
    SkillGroupView,
} from '../../types/resume';
import type { Resume as DashboardResume } from '../../types';
import { buildExperienceDate } from '../../utils/dateUtils';
import {
    buildStarFields,
    mergeStarFieldsWithSource,
} from '../../utils/resumeHelpers';
import { buildJDCapabilityContext, buildJDPolishContext } from '../../utils/assistantResumeContext';
import {
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
    waitForNextFrame,
} from './snapshotUtils';
import {
    buildPreferredResumeCreateConfig,
} from '../resumeTemplateStorage';
import type { EditorSidebarProps } from './components/EditorSidebar';
import EditorToolbar from './components/EditorToolbar';
import MobileEditorHeader from './components/MobileEditorHeader';
import ResumeEditorDesktopWorkspace from './components/ResumeEditorDesktopWorkspace';
import ResumeEditorMeasurePreview from './components/ResumeEditorMeasurePreview';
import ResumeEditorMobileDrawer from './components/ResumeEditorMobileDrawer';
import TemplateSelectorModal from './components/TemplateSelectorModal';
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
import { buildExperienceViewFromDraft } from './experiencePolishViewUtils';
type ResumeEditorProps = {
    cachedResumes?: DashboardResume[];
    cachedResumesOwnerKey?: string | null;
    authUserKey?: string | null;
    onResumesUpdate?: (resumes: DashboardResume[]) => void;
    onLaunchAssistant?: (request: AssistantLaunchRequest) => void;
    onOpenAgentPluginConfig?: () => void;
    mobileDrawerOpenRequest?: number;
    onMobileDrawerOpenRequestConsumed?: () => void;
    quotaSummary?: TokenQuotaSummary | null;
    onOpenTokenQuota?: () => void;
};

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
    quotaSummary,
    onOpenTokenQuota,
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
    } = useResumeEditorCoreState();
    const isCacheOwnerMatched = Boolean(
        cachedResumesOwnerKey && authUserKey && cachedResumesOwnerKey === authUserKey
    );
    const mobileEditorDrawer = useMobileEditorDrawer({
        mobileDrawerOpenRequest,
        onMobileDrawerOpenRequestConsumed,
        scrollContainerRef: mobileEditorScrollContainerRef,
        setSidebarTab,
    });
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
        thinkingText,
        handleStopAnalysis,
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
        setIsEditingExperiencePolishRunning,
        editingExperiencePolishRunningRef,
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
        closeToast,
    });
    const handleStopAnalysisWithToast = useCallback(() => {
        handleStopAnalysis();
        showToastInfo('分析中止', 2000);
    }, [handleStopAnalysis, showToastInfo]);
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
        selectedEducations,
        sortedCertifications,
        selectedSkillGroups,
        selectedCertifications,
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
    const {
        handleOpenExperienceAssistant,
        handleOpenFloatingExperienceAssistant,
        handleLaunchResumeAssistant,
    } = useResumeEditorAssistantLaunch({
        resumeId,
        resumeName,
        jdPolishContext,
        selectedResumeSnapshot,
        onLaunchAssistant,
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
        resumeDisplayTitle: resolveResumeDisplayTitle(resumeName),
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
            thinkingText,
            onStopAnalyze: handleStopAnalysisWithToast,
        },
        profileTabProps: {
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
            quotaSummary,
            onOpenTokenQuota,
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
                    thinkingText={thinkingText}
                    onStopAnalyze={handleStopAnalysisWithToast}
                />
            </div>
            <ResumeEditorDesktopWorkspace
                sidebarProps={commonEditorSidebarProps}
                layoutAdjustProps={layoutAdjustProps}
                previewProps={editorPreviewProps}
                quotaSummary={quotaSummary}
                onOpenTokenQuota={onOpenTokenQuota}
            />
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

            <ResumeEditorMobileDrawer
                isOpen={mobileEditorDrawer.isOpen}
                isVisible={mobileEditorDrawer.isVisible}
                onOpen={mobileEditorDrawer.open}
                onClose={mobileEditorDrawer.close}
                sidebarProps={commonEditorSidebarProps}
            />
            <ResumeEditorMeasurePreview {...measurePreviewProps} />
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
