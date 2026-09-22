import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { JDAnalysisResult } from '../../../services/aiService';
import type { ResumeEditorWorkspaceLayout } from '../components/ResumeEditorDesktopWorkspace';
import type { useMobileEditorDrawer } from './useMobileEditorDrawer';
import type { useResumeOptimizationFlow } from './useResumeOptimizationFlow';

export type RightSidebarSurface = 'assistant' | 'analysis' | 'optimization' | null;

type UseResumeOptimizationWorkspaceNavigationOptions = {
    authUserKey: string | null;
    resumeId: string | null;
    analysisResult: JDAnalysisResult | null;
    resumeOptimizationFlow: Pick<ReturnType<typeof useResumeOptimizationFlow>,
        'uiState' | 'run' | 'canResumeLatestRun' | 'startOptimization' | 'reopenLatestRun'
        | 'getLatestUiState' | 'closeWorkspace' | 'revertRun'>;
    canPersistCurrentJDAnalysis: () => boolean;
    rightSidebarSurface: RightSidebarSurface;
    setWorkspaceLayout: Dispatch<SetStateAction<ResumeEditorWorkspaceLayout>>;
    setRightSidebarSurface: Dispatch<SetStateAction<RightSidebarSurface>>;
    setIsAssistantSidebarMounted: Dispatch<SetStateAction<boolean>>;
    mobileEditorDrawer: Pick<ReturnType<typeof useMobileEditorDrawer>, 'open' | 'setReportTab'>;
    showToastError: (message: string) => string;
};

// Own the workspace transition and focus lifecycle; provider work and persistence
// remain in useResumeOptimizationFlow, while editor destinations supply navigation.
export const useResumeOptimizationWorkspaceNavigation = ({
    authUserKey,
    resumeId,
    analysisResult,
    resumeOptimizationFlow,
    canPersistCurrentJDAnalysis,
    rightSidebarSurface,
    setWorkspaceLayout,
    setRightSidebarSurface,
    setIsAssistantSidebarMounted,
    mobileEditorDrawer,
    showToastError,
}: UseResumeOptimizationWorkspaceNavigationOptions) => {
    const [isResumeOptimizationLayoutTransitioning, setIsResumeOptimizationLayoutTransitioning] = useState(false);
    const resumeOptimizationReturnFocusRef = useRef<HTMLElement | null>(null);
    const resumeOptimizationShouldRestoreReportRef = useRef(false);
    const resumeOptimizationSuppressReturnFocusRef = useRef(false);
    const resumeOptimizationNavigationInFlightRef = useRef(false);
    useEffect(() => {
        setIsResumeOptimizationLayoutTransitioning(false);
    }, [authUserKey, resumeId]);
    const isResumeOptimizationBusy = (
        isResumeOptimizationLayoutTransitioning
        || resumeOptimizationFlow.uiState === 'starting'
        || resumeOptimizationFlow.uiState === 'answering'
        || resumeOptimizationFlow.uiState === 'applying'
        || resumeOptimizationFlow.uiState === 'rescoring'
    );
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
        if (
            resumeOptimizationFlow.uiState === 'closed'
            && rightSidebarSurface !== 'optimization'
        ) {
            resumeOptimizationShouldRestoreReportRef.current = false;
        }
    }, [resumeOptimizationFlow.uiState, rightSidebarSurface]);

    return {
        isResumeOptimizationLayoutTransitioning,
        isResumeOptimizationBusy,
        hasResumableResumeOptimizationRun,
        resumeOptimizationReturnFocusRef,
        resumeOptimizationShouldRestoreReportRef,
        resumeOptimizationSuppressReturnFocusRef,
        handleStartResumeOptimization,
        handleCloseResumeOptimization,
        handleFinishResumeOptimization,
        handleRevertResumeOptimization,
        runResumeOptimizationNavigation,
        handleResumeOptimizationReturnToPlan,
    };
};
