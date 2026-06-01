import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { ToastConfig } from '../../../components/Toast';
import type { JDAnalysisResult } from '../../../services/aiService';
import type { LayoutSnapshot, SmartPageLayout } from '../layoutUtils';
import {
    AUTO_ASSEMBLY_TOAST_MESSAGES,
    JD_ANALYSIS_TOAST_DURATION_MS,
    JD_ANALYSIS_TOAST_ERROR_DURATION_MS,
} from '../constants';
import {
    buildAutoAssemblySelectionFilter,
    buildLayoutSnapshot,
    buildSelectionSnapshot,
    type AutoAssemblySelection,
    type ManualSelectionSnapshot,
} from '../autoAssemblyUtils';
import {
    trackSmartAssemblyResult,
    trackSmartAssemblyStart,
} from '../../../utils/analyticsTracker';
import type {
    AutoAssemblyExecutionResult,
    AutoAssemblyStateSnapshot,
} from './useAutoAssemblySelectionRunner';

type UpdateToast = (id: string, updates: Partial<Omit<ToastConfig, 'id'>>) => void;
type MatchScoreFilterSource = 'manual' | 'auto';
type RunAutoAssemblySelection = (
    selection: AutoAssemblySelection,
    requestedResumeId: string | null,
    requestedSelectionVersion: number,
    requestedLayoutVersion: number,
    initialStateSnapshot: AutoAssemblyStateSnapshot
) => Promise<AutoAssemblyExecutionResult>;

type UseAutoAssembleActionParams = {
    resumeId: string | null;
    analysisResult: JDAnalysisResult | null;
    isOutdated: boolean;
    isAutoAssembling: boolean;
    isFloatingExperiencePolishRunning: boolean;
    floatingPolishSession: unknown;
    isBatchPolishToolbarOpen: boolean;
    hasMissingAttachmentContext: boolean;
    jdFile: File | null;
    jdText: string;
    isSmartPageApplied: boolean;
    currentLayout: SmartPageLayout;
    selectedExpIds: Set<string>;
    selectedCertIds: Set<string>;
    selectedSkillIds: Set<string>;
    latestResumeIdRef: MutableRefObject<string | null | undefined>;
    autoAssembleRequestIdRef: MutableRefObject<number>;
    activeAutoAssembleToastIdRef: MutableRefObject<string | null>;
    manualSelectionVersionRef: MutableRefObject<number>;
    manualLayoutVersionRef: MutableRefObject<number>;
    latestLayoutSnapshotRef: MutableRefObject<LayoutSnapshot>;
    setIsAutoAssembling: Dispatch<SetStateAction<boolean>>;
    setMatchScoreFilter: Dispatch<SetStateAction<number>>;
    setMatchScoreFilterSource: Dispatch<SetStateAction<MatchScoreFilterSource>>;
    buildAutoAssemblySelection: (result: JDAnalysisResult) => AutoAssemblySelection;
    handleAnalyzeWithAutoName: () => Promise<JDAnalysisResult | null>;
    runAutoAssemblySelection: RunAutoAssemblySelection;
    waitForPreviewUpdate: (frames?: number) => Promise<void>;
    commitLayoutSnapshot: (snapshot: LayoutSnapshot, options?: { incrementVersion?: boolean }) => void;
    closeToast: (id: string) => void;
    showToastError: (message: string, duration?: number) => string;
    showToastLoading: (message: string) => string;
    updateToast: UpdateToast;
};

export const useAutoAssembleAction = ({
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
}: UseAutoAssembleActionParams) => useCallback(async () => {
    if (isAutoAssembling) {
        return;
    }
    if (isFloatingExperiencePolishRunning) {
        showToastError('请等待当前润色完成后再继续操作');
        return;
    }
    if (floatingPolishSession) {
        showToastError('请先确认或撤销当前润色结果');
        return;
    }
    if (isBatchPolishToolbarOpen) {
        showToastError('请先关闭当前批量润色弹窗');
        return;
    }
    if (!analysisResult && !hasMissingAttachmentContext && !jdFile && !jdText.trim()) {
        trackSmartAssemblyResult({
            resumeId,
            action: 'empty_jd',
        });
        showToastError(AUTO_ASSEMBLY_TOAST_MESSAGES.emptyJd);
        return;
    }
    const startedAt = Date.now();
    trackSmartAssemblyStart({ resumeId });
    const requestedResumeId = resumeId;
    const isResumeRequestCurrent = () => latestResumeIdRef.current === requestedResumeId;
    const requestId = autoAssembleRequestIdRef.current + 1;
    autoAssembleRequestIdRef.current = requestId;
    const isAutoAssembleRequestCurrent = () => autoAssembleRequestIdRef.current === requestId;
    const toastId = showToastLoading(AUTO_ASSEMBLY_TOAST_MESSAGES.loading);
    activeAutoAssembleToastIdRef.current = toastId;
    const releaseActiveAutoAssembleToast = () => {
        if (activeAutoAssembleToastIdRef.current === toastId) {
            activeAutoAssembleToastIdRef.current = null;
        }
    };
    setIsAutoAssembling(true);
    try {
        const requestedSelectionVersion = manualSelectionVersionRef.current;
        const requestedLayoutVersion = manualLayoutVersionRef.current;
        const effectiveResult = (!analysisResult || isOutdated)
            ? await handleAnalyzeWithAutoName()
            : analysisResult;
        if (!isResumeRequestCurrent() || !isAutoAssembleRequestCurrent()) {
            closeToast(toastId);
            releaseActiveAutoAssembleToast();
            return;
        }
        if (!effectiveResult) {
            trackSmartAssemblyResult({
                resumeId,
                action: 'analysis_unavailable',
                durationMs: Date.now() - startedAt,
            });
            closeToast(toastId);
            releaseActiveAutoAssembleToast();
            return;
        }
        const selection = buildAutoAssemblySelection(effectiveResult);
        const selectionMetrics = {
            experienceCount: selection.experienceIds.length,
            certificationCount: selection.certificationIds.length,
            skillCount: selection.skillIds.length,
            totalSelected:
                selection.experienceIds.length
                + selection.certificationIds.length
                + selection.skillIds.length,
        };
        if (!selection.hasMatchedExperience) {
            trackSmartAssemblyResult({
                resumeId,
                action: 'no_match',
                durationMs: Date.now() - startedAt,
                ...selectionMetrics,
            });
            updateToast(toastId, {
                message: AUTO_ASSEMBLY_TOAST_MESSAGES.noExperienceMatch,
                type: 'error',
                duration: JD_ANALYSIS_TOAST_ERROR_DURATION_MS,
            });
            releaseActiveAutoAssembleToast();
            return;
        }
        const autoAssemblyExecution = await runAutoAssemblySelection(
            selection,
            requestedResumeId,
            requestedSelectionVersion,
            requestedLayoutVersion,
            {
                selection: buildSelectionSnapshot(
                    selectedExpIds,
                    selectedCertIds,
                    selectedSkillIds
                ),
                layout: buildLayoutSnapshot(
                    currentLayout,
                    isSmartPageApplied
                ),
            }
        );
        const { result: smartPageResult, finalSelection } = autoAssemblyExecution;
        if (!isResumeRequestCurrent() || !isAutoAssembleRequestCurrent()) {
            closeToast(toastId);
            releaseActiveAutoAssembleToast();
            return;
        }
        if (smartPageResult.status !== 'skipped' && finalSelection) {
            setMatchScoreFilter(
                buildAutoAssemblySelectionFilter(effectiveResult, finalSelection)
            );
            setMatchScoreFilterSource('auto');
        }
        trackSmartAssemblyResult({
            resumeId,
            action: smartPageResult.status === 'fit'
                ? 'success'
                : smartPageResult.status === 'skipped'
                    ? 'skipped'
                    : 'partial_overflow',
            durationMs: Date.now() - startedAt,
            ...selectionMetrics,
        });
        if (smartPageResult.status !== 'skipped') {
            await waitForPreviewUpdate(2);
            commitLayoutSnapshot(latestLayoutSnapshotRef.current);
        }
        updateToast(toastId, {
            message: smartPageResult.status === 'fit'
                ? AUTO_ASSEMBLY_TOAST_MESSAGES.success
                : smartPageResult.status === 'skipped'
                    ? AUTO_ASSEMBLY_TOAST_MESSAGES.skipped
                    : AUTO_ASSEMBLY_TOAST_MESSAGES.partialOverflow,
            type: smartPageResult.status === 'fit' ? 'success' : 'error',
            duration: JD_ANALYSIS_TOAST_DURATION_MS,
        });
        releaseActiveAutoAssembleToast();
    } catch (error) {
        if (!isResumeRequestCurrent() || !isAutoAssembleRequestCurrent()) {
            closeToast(toastId);
            return;
        }
        console.error('[ResumeEditor] 一键组装失败:', error);
        trackSmartAssemblyResult({
            resumeId,
            action: 'error',
            durationMs: Date.now() - startedAt,
        });
        updateToast(toastId, {
            message: AUTO_ASSEMBLY_TOAST_MESSAGES.error,
            type: 'error',
            duration: JD_ANALYSIS_TOAST_ERROR_DURATION_MS,
        });
        releaseActiveAutoAssembleToast();
    } finally {
        if (isAutoAssembleRequestCurrent()) {
            setIsAutoAssembling(false);
        }
    }
}, [
    activeAutoAssembleToastIdRef,
    analysisResult,
    autoAssembleRequestIdRef,
    buildAutoAssemblySelection,
    closeToast,
    commitLayoutSnapshot,
    currentLayout,
    floatingPolishSession,
    handleAnalyzeWithAutoName,
    hasMissingAttachmentContext,
    isAutoAssembling,
    isBatchPolishToolbarOpen,
    isFloatingExperiencePolishRunning,
    isOutdated,
    isSmartPageApplied,
    jdFile,
    jdText,
    latestLayoutSnapshotRef,
    latestResumeIdRef,
    manualLayoutVersionRef,
    manualSelectionVersionRef,
    resumeId,
    runAutoAssemblySelection,
    selectedCertIds,
    selectedExpIds,
    selectedSkillIds,
    setIsAutoAssembling,
    setMatchScoreFilter,
    setMatchScoreFilterSource,
    showToastError,
    showToastLoading,
    updateToast,
    waitForPreviewUpdate,
]);
