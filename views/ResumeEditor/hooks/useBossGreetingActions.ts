import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { ToastConfig } from '../../../components/Toast';
import { aiService, type BossGreetingStreamEvent, type JDAnalysisResult } from '../../../services/aiService';
import type { ResumeBossGreeting } from '../../../types/resume';
import { extractThoughtHeadline } from '../../../utils/aiThought';
import {
    trackBossGreetingResult,
    trackBossGreetingStart,
} from '../../../utils/analyticsTracker';
import {
    BOSS_GREETING_TOAST_MESSAGES,
    JD_ANALYSIS_TOAST_DURATION_MS,
    JD_ANALYSIS_TOAST_ERROR_DURATION_MS,
} from '../constants';
import {
    buildBossGreetingSignature,
    type PendingPersistedBossGreeting,
} from '../snapshotUtils';

type BossGreetingSource = 'generate' | 'refresh';
type UpdateToast = (id: string, updates: Partial<Omit<ToastConfig, 'id'>>) => void;

type BossGreetingUiState = {
    text: string;
    signature: string;
    isVisible: boolean;
};

type UseBossGreetingActionsParams = {
    resumeId: string | null;
    analysisResult: JDAnalysisResult | null;
    bossGreeting: string;
    isBossGreetingVisible: boolean;
    isBossGreetingOutdated: boolean;
    isGeneratingBossGreeting: boolean;
    isOutdated: boolean;
    jdFile: File | null;
    jdText: string;
    jdPolishContext: string;
    hasMissingAttachmentContext: boolean;
    selectedResumeSnapshotText: string;
    latestResumeIdRef: MutableRefObject<string | null | undefined>;
    latestBossGreetingSignatureRef: MutableRefObject<string>;
    latestBossGreetingAnalysisOutdatedRef: MutableRefObject<boolean>;
    bossGreetingRequestIdRef: MutableRefObject<number>;
    pendingPersistedBossGreetingRef: MutableRefObject<PendingPersistedBossGreeting | null>;
    activeBossGreetingToastIdRef: MutableRefObject<string | null>;
    bossGreetingUiStateRef: MutableRefObject<BossGreetingUiState>;
    setBossGreeting: Dispatch<SetStateAction<string>>;
    setBossGreetingSignature: Dispatch<SetStateAction<string>>;
    setIsBossGreetingVisible: Dispatch<SetStateAction<boolean>>;
    setIsGeneratingBossGreeting: Dispatch<SetStateAction<boolean>>;
    handleAnalyzeWithAutoName: () => Promise<JDAnalysisResult | null>;
    closeToast: (id: string) => void;
    showToastError: (message: string, duration?: number) => string;
    showToastLoading: (message: string) => string;
    showToastSuccess: (message: string, duration?: number) => string;
    updateToast: UpdateToast;
};

export const useBossGreetingActions = ({
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
}: UseBossGreetingActionsParams) => {
    const generateBossGreeting = useCallback(async (options?: { forceRefresh?: boolean }) => {
        const forceRefresh = options?.forceRefresh ?? false;
        const bossGreetingSource: BossGreetingSource = forceRefresh ? 'refresh' : 'generate';
        const canReuseBossGreeting = !forceRefresh && Boolean(
            bossGreeting
            && !isBossGreetingOutdated
            && !isOutdated
        );
        if (isGeneratingBossGreeting) {
            return;
        }
        if (canReuseBossGreeting) {
            const nextIsVisible = !isBossGreetingVisible;
            setIsBossGreetingVisible(nextIsVisible);
            trackBossGreetingResult({
                resumeId,
                source: 'toggle',
                action: nextIsVisible ? 'shown' : 'hidden',
            });
            return;
        }
        if (!analysisResult && !hasMissingAttachmentContext && !jdFile && !jdText.trim()) {
            trackBossGreetingResult({
                resumeId,
                source: bossGreetingSource,
                action: 'empty',
            });
            showToastError(BOSS_GREETING_TOAST_MESSAGES.empty);
            return;
        }
        const startedAt = Date.now();
        trackBossGreetingStart({
            resumeId,
            source: bossGreetingSource,
        });
        const requestedResumeId = resumeId;
        const isResumeRequestCurrent = () => latestResumeIdRef.current === requestedResumeId;
        const requestId = bossGreetingRequestIdRef.current + 1;
        bossGreetingRequestIdRef.current = requestId;
        const isBossGreetingRequestCurrent = () => bossGreetingRequestIdRef.current === requestId;
        setIsGeneratingBossGreeting(true);
        const toastId = showToastLoading(BOSS_GREETING_TOAST_MESSAGES.loading);
        activeBossGreetingToastIdRef.current = toastId;
        const releaseActiveBossGreetingToast = () => {
            if (activeBossGreetingToastIdRef.current === toastId) {
                activeBossGreetingToastIdRef.current = null;
            }
        };
        try {
            const effectiveResult = (!analysisResult || isOutdated)
                ? await handleAnalyzeWithAutoName()
                : analysisResult;
            if (!isResumeRequestCurrent() || !isBossGreetingRequestCurrent()) {
                closeToast(toastId);
                releaseActiveBossGreetingToast();
                return;
            }
            if (!effectiveResult) {
                trackBossGreetingResult({
                    resumeId,
                    source: bossGreetingSource,
                    action: 'analysis_unavailable',
                    durationMs: Date.now() - startedAt,
                });
                closeToast(toastId);
                releaseActiveBossGreetingToast();
                return;
            }
            if (!effectiveResult.summary?.trim()) {
                trackBossGreetingResult({
                    resumeId,
                    source: bossGreetingSource,
                    action: 'empty',
                    durationMs: Date.now() - startedAt,
                });
                updateToast(toastId, {
                    message: BOSS_GREETING_TOAST_MESSAGES.empty,
                    type: 'error',
                    duration: JD_ANALYSIS_TOAST_ERROR_DURATION_MS,
                });
                releaseActiveBossGreetingToast();
                return;
            }
            const requestedBossGreetingSignature = buildBossGreetingSignature({
                jdText: jdPolishContext,
                summary: effectiveResult.summary,
                jobTitle: effectiveResult.jobTitle,
                company: effectiveResult.company,
                resumeText: selectedResumeSnapshotText,
            });
            setIsBossGreetingVisible(true);
            const response = await aiService.generateBossGreetingStream(
                {
                    jdText: jdPolishContext,
                    analysisSummary: effectiveResult.summary,
                    jobTitle: effectiveResult.jobTitle,
                    company: effectiveResult.company,
                    resumeText: selectedResumeSnapshotText,
                    resumeId,
                    signature: requestedBossGreetingSignature,
                },
                (event: BossGreetingStreamEvent) => {
                    if (event.type !== 'thought') {
                        return;
                    }
                    if (!isResumeRequestCurrent() || !isBossGreetingRequestCurrent()) {
                        return;
                    }
                    const title = extractThoughtHeadline(event.summary);
                    if (!title) {
                        return;
                    }
                    updateToast(toastId, {
                        message: title,
                        type: 'ai_thinking',
                        duration: 0,
                    });
                }
            );
            const nextGreeting = response.greeting.trim();
            if (!nextGreeting) {
                throw new Error('empty_greeting');
            }
            if (!isResumeRequestCurrent() || !isBossGreetingRequestCurrent()) {
                closeToast(toastId);
                releaseActiveBossGreetingToast();
                return;
            }
            if (
                latestResumeIdRef.current !== requestedResumeId
                || latestBossGreetingAnalysisOutdatedRef.current
                || latestBossGreetingSignatureRef.current !== requestedBossGreetingSignature
            ) {
                const shouldKeepVisible = (
                    bossGreetingUiStateRef.current.isVisible
                    && Boolean(bossGreetingUiStateRef.current.text.trim())
                );
                setIsBossGreetingVisible(shouldKeepVisible);
                closeToast(toastId);
                releaseActiveBossGreetingToast();
                return;
            }
            setBossGreeting(nextGreeting);
            setBossGreetingSignature(requestedBossGreetingSignature);
            pendingPersistedBossGreetingRef.current = {
                resumeId: requestedResumeId ?? null,
                greeting: nextGreeting,
                signature: requestedBossGreetingSignature,
            };
            trackBossGreetingResult({
                resumeId,
                source: bossGreetingSource,
                action: 'success',
                durationMs: Date.now() - startedAt,
            });
            updateToast(toastId, {
                message: BOSS_GREETING_TOAST_MESSAGES.success,
                type: 'success',
                duration: JD_ANALYSIS_TOAST_DURATION_MS,
            });
            releaseActiveBossGreetingToast();
        } catch (error) {
            if (!isResumeRequestCurrent() || !isBossGreetingRequestCurrent()) {
                closeToast(toastId);
                releaseActiveBossGreetingToast();
                return;
            }
            console.error('[ResumeEditor] 生成 BOSS 招呼语失败:', error);
            trackBossGreetingResult({
                resumeId,
                source: bossGreetingSource,
                action: 'error',
                durationMs: Date.now() - startedAt,
            });
            updateToast(toastId, {
                message: BOSS_GREETING_TOAST_MESSAGES.error,
                type: 'error',
                duration: JD_ANALYSIS_TOAST_ERROR_DURATION_MS,
            });
            releaseActiveBossGreetingToast();
        } finally {
            if (isBossGreetingRequestCurrent()) {
                setIsGeneratingBossGreeting(false);
            }
        }
    }, [
        activeBossGreetingToastIdRef,
        analysisResult,
        bossGreeting,
        bossGreetingRequestIdRef,
        bossGreetingUiStateRef,
        closeToast,
        handleAnalyzeWithAutoName,
        hasMissingAttachmentContext,
        isBossGreetingOutdated,
        isBossGreetingVisible,
        isGeneratingBossGreeting,
        isOutdated,
        jdFile,
        jdPolishContext,
        jdText,
        latestBossGreetingAnalysisOutdatedRef,
        latestBossGreetingSignatureRef,
        latestResumeIdRef,
        pendingPersistedBossGreetingRef,
        resumeId,
        selectedResumeSnapshotText,
        setBossGreeting,
        setBossGreetingSignature,
        setIsBossGreetingVisible,
        setIsGeneratingBossGreeting,
        showToastError,
        showToastLoading,
        updateToast,
    ]);

    const handleGenerateBossGreeting = useCallback(() => {
        void generateBossGreeting();
    }, [generateBossGreeting]);

    const handleRefreshBossGreeting = useCallback(() => {
        void generateBossGreeting({ forceRefresh: true });
    }, [generateBossGreeting]);

    const handleCollapseBossGreeting = useCallback(() => {
        trackBossGreetingResult({
            resumeId,
            source: 'toggle',
            action: 'hidden',
        });
        setIsBossGreetingVisible(false);
    }, [resumeId, setIsBossGreetingVisible]);

    const handleCopyBossGreeting = useCallback(async () => {
        if (!bossGreeting.trim()) {
            return;
        }
        try {
            if (!navigator.clipboard) {
                throw new Error('clipboard_unavailable');
            }
            await navigator.clipboard.writeText(bossGreeting);
            trackBossGreetingResult({
                resumeId,
                source: 'copy',
                action: 'success',
            });
            showToastSuccess(BOSS_GREETING_TOAST_MESSAGES.copySuccess);
        } catch (error) {
            console.error('[ResumeEditor] 复制 BOSS 招呼语失败:', error);
            trackBossGreetingResult({
                resumeId,
                source: 'copy',
                action: 'error',
            });
            showToastError(BOSS_GREETING_TOAST_MESSAGES.copyError);
        }
    }, [bossGreeting, resumeId, showToastError, showToastSuccess]);

    return {
        handleGenerateBossGreeting,
        handleRefreshBossGreeting,
        handleCollapseBossGreeting,
        handleCopyBossGreeting,
    };
};
