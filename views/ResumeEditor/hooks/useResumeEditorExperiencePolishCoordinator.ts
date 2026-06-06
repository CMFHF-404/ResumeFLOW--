import { useCallback, useMemo } from 'react';
import {
    trackAiPolishUndone,
} from '../../../utils/analyticsTracker';
import { buildDragItemKey } from '../dragKeys';
import { DEFAULT_RESUME_POLISH_MODE, useResumeEditorExperiencePolishControls } from './useResumeEditorExperiencePolishControls';
import { useEditingExperiencePolishActions } from './useEditingExperiencePolishActions';
import { useFloatingExperiencePolishActions } from './useFloatingExperiencePolishActions';
import { useFloatingExperiencePolishConfirmActions } from './useFloatingExperiencePolishConfirmActions';
import { useFloatingExperiencePolishSession } from './useFloatingExperiencePolishSession';
import { useFloatingPolishResumePersistence } from './useFloatingPolishResumePersistence';
import { useResumeEditorManualSaveDrafts } from './useResumeEditorManualSaveDrafts';
import {
    resolveBatchPolishOpenBlockMessage,
    shouldResetFloatingPolishModeForBatch,
} from '../experiencePolishCoordinatorUtils';

export const useResumeEditorExperiencePolishCoordinator = ({
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
    resumeExperienceMap,
    experienceSourceMap,
    applyResumeDetail,
    setResumeExperienceMap,
}: any) => {
    useResumeEditorManualSaveDrafts({
        resumeId,
        isLoadingExperiences,
        experienceItems,
        experience,
        activeManualSaveDraftRef,
        appliedManualSaveDraftKeyRef,
    });

    const floatingSession = useFloatingExperiencePolishSession({
        editingExperienceId: experience.editingExpId,
        experienceItems,
        selectedExpIds,
        setExperienceItems,
        setSelectedExpIds,
        setSidebarTab,
        showToastError,
        buildExperienceViewFromDraft,
    });

    const polishControls = useResumeEditorExperiencePolishControls({
        editingExperienceId: experience.editingExpId,
        setFloatingSmartCompletionPrompt: floatingSession.setFloatingSmartCompletionPrompt,
    });

    const editingActions = useEditingExperiencePolishActions({
        editingDraft: experience.editingDraft,
        setEditingDraft: experience.setEditingDraft,
        polishMode: polishControls.experiencePolishMode,
        customPrompt: polishControls.experienceCustomPrompt,
        smartCompletionPrompt: polishControls.experienceSmartCompletionPrompt,
        setSmartCompletionPrompt: polishControls.setExperienceSmartCompletionPrompt,
        polishPreview: polishControls.experiencePolishPreview,
        setPolishPreview: polishControls.setExperiencePolishPreview,
        isRunningRef: polishControls.editingExperiencePolishRunningRef,
        setIsRunning: polishControls.setIsEditingExperiencePolishRunning,
        pendingAiPolishApplyRef,
        jdPolishContext,
        jdCapabilityPolishContext,
        showToastError,
        showToastLoading,
        updateToast,
    });

    const floatingActions = useFloatingExperiencePolishActions({
        activeFloatingPolishExperienceId: floatingSession.activeFloatingPolishExperienceId,
        experienceItems,
        selectedExpIds,
        jdPolishContext,
        jdCapabilityPolishContext,
        floatingPolishMode: polishControls.floatingPolishMode,
        setFloatingPolishMode: polishControls.setFloatingPolishMode,
        defaultFloatingPolishMode: DEFAULT_RESUME_POLISH_MODE,
        floatingPolishCustomPrompt: polishControls.floatingPolishCustomPrompt,
        floatingSmartCompletionPrompt: floatingSession.floatingSmartCompletionPrompt,
        setFloatingSmartCompletionPrompt: floatingSession.setFloatingSmartCompletionPrompt,
        floatingExperiencePolishRunningRef: floatingSession.floatingExperiencePolishRunningRef,
        setIsFloatingExperiencePolishRunning: floatingSession.setIsFloatingExperiencePolishRunning,
        buildFloatingPolishSessionItem: floatingSession.buildFloatingPolishSessionItem,
        applyFloatingPolishPreview: floatingSession.applyFloatingPolishPreview,
        showToastError,
        showToastLoading,
        updateToast,
    });

    const handleUndoFloatingExperiencePolish = useCallback(() => {
        if (
            !floatingSession.singleFloatingPolishPreview
            || !floatingSession.floatingPolishSession
            || floatingSession.floatingPolishSession.mode !== 'single'
        ) {
            return;
        }
        floatingSession.restoreFloatingPolishSessionItems(floatingSession.floatingPolishSession);
        floatingSession.setFloatingPolishSession(null);
        floatingSession.setActiveFloatingPolishExperienceId(null);
        trackAiPolishUndone({ source: 'resume_editor', field: 'all' });
    }, [floatingSession]);

    const persistence = useFloatingPolishResumePersistence({
        resumeId,
        resumeExperienceMap,
        experienceSourceMap,
        applyResumeDetail,
        setResumeExperienceMap,
    });

    const confirmActions = useFloatingExperiencePolishConfirmActions({
        resumeId,
        singleFloatingPolishPreview: floatingSession.singleFloatingPolishPreview,
        batchFloatingPolishPreview: floatingSession.batchFloatingPolishPreview,
        floatingExperiencePolishRunningRef: floatingSession.floatingExperiencePolishRunningRef,
        setIsFloatingExperiencePolishRunning: floatingSession.setIsFloatingExperiencePolishRunning,
        ensureFloatingPolishResumeLinks: persistence.ensureFloatingPolishResumeLinks,
        rollbackFloatingPolishResumeLinks: persistence.rollbackFloatingPolishResumeLinks,
        buildExperiencePolishOverrideOperation: persistence.buildExperiencePolishOverrideOperation,
        applyResumeDetail,
        setResumeExperienceMap,
        setSelectedExpIds,
        setFloatingPolishSession: floatingSession.setFloatingPolishSession,
        setActiveFloatingPolishExperienceId: floatingSession.setActiveFloatingPolishExperienceId,
        setIsBatchPolishToolbarOpen: floatingSession.setIsBatchPolishToolbarOpen,
        setPendingPolishAutoAnalyzeSeq: polishControls.setPendingPolishAutoAnalyzeSeq,
        showToastLoading,
        updateToast,
    });

    const handleOpenBatchPolishToolbar = useCallback(() => {
        const blockMessage = resolveBatchPolishOpenBlockMessage({
            isFloatingExperiencePolishRunning: floatingSession.isFloatingExperiencePolishRunning,
            hasFloatingPolishSession: Boolean(floatingSession.floatingPolishSession),
            activeFloatingPolishExperienceId: floatingSession.activeFloatingPolishExperienceId,
        });
        if (blockMessage) {
            showToastError(blockMessage);
            return;
        }
        setSidebarTab('experience');
        floatingSession.setFloatingSmartCompletionPrompt(null);
        if (shouldResetFloatingPolishModeForBatch(polishControls.floatingPolishMode)) {
            polishControls.setFloatingPolishMode(DEFAULT_RESUME_POLISH_MODE);
        }
        floatingSession.setIsBatchPolishToolbarOpen(true);
    }, [floatingSession, polishControls, setSidebarTab, showToastError]);

    const handleUndoBatchExperiencePolish = useCallback(() => {
        if (!floatingSession.batchFloatingPolishPreview) {
            return;
        }
        floatingSession.restoreFloatingPolishSessionItems(floatingSession.batchFloatingPolishPreview);
        floatingSession.setFloatingPolishSession(null);
        floatingSession.setIsBatchPolishToolbarOpen(false);
        trackAiPolishUndone({ source: 'resume_editor', field: 'all' });
    }, [floatingSession]);

    const floatingPolishHighlightItemIds = useMemo(
        () => new Set(
            (floatingSession.floatingPolishSession?.items ?? [])
                .map((item) => buildDragItemKey('experience', item.targetId))
        ),
        [floatingSession.floatingPolishSession]
    );

    const isPreviewInteractionLocked = Boolean(floatingSession.floatingPolishSession)
        || floatingSession.isFloatingExperiencePolishRunning
        || floatingSession.isBatchPolishToolbarOpen;

    return {
        ...floatingSession,
        ...polishControls,
        ...editingActions,
        ...floatingActions,
        ...persistence,
        ...confirmActions,
        handleUndoFloatingExperiencePolish,
        handleOpenBatchPolishToolbar,
        handleUndoBatchExperiencePolish,
        floatingPolishHighlightItemIds,
        isPreviewInteractionLocked,
    };
};
