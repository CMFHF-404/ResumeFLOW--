import { useCallback, useEffect, useRef } from 'react';
import type { ToastConfig } from '../../../components/Toast';
import type { AnalyzeStreamEvent, JDAnalysisResult } from '../../../services/aiService';
import { resolveAutoResumeName } from '../autoNameUtils';
import {
    JD_ANALYSIS_PROGRESS_NODE_TITLES,
    JD_ANALYSIS_TOAST_DURATION_MS,
    JD_ANALYSIS_TOAST_ERROR_DURATION_MS,
    JD_ANALYSIS_TOAST_MESSAGES,
} from '../constants';

type JDAnalyzeOutcome =
    | { status: 'success'; result: JDAnalysisResult }
    | { status: 'no_change' }
    | { status: 'missing_attachment' }
    | { status: 'aborted' }
    | { status: 'error' };

type UseJdAnalyzeWithToastParams = {
    handleAnalyze: (options?: { onEvent?: (event: AnalyzeStreamEvent) => void }) => Promise<JDAnalyzeOutcome>;
    isAnalyzing: boolean;
    hasMissingAttachmentContext: boolean;
    jdFile: File | null;
    jdText: string;
    resumeName: string;
    pendingPolishAutoAnalyzeSeq: number;
    applyResumeNameUpdate: (nextName: string, options?: { silent?: boolean }) => Promise<void>;
    canAutoNameResume: (name: string) => boolean;
    showToastError: (message: string, duration?: number) => string;
    showToastLoading: (message: string) => string;
    showToastSuccess: (message: string, duration?: number) => string;
    updateToast: (id: string, updates: Partial<Omit<ToastConfig, 'id'>>) => void;
    closeToast: (id: string) => void;
};

export const useJdAnalyzeWithToast = ({
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
}: UseJdAnalyzeWithToastParams) => {
    const lastPolishAutoAnalyzeSeqRef = useRef(0);

    const runJdAnalyzeWithToast = useCallback(async () => {
        if (isAnalyzing) {
            return null;
        }
        if (!hasMissingAttachmentContext && !jdFile && !jdText.trim()) {
            showToastError(JD_ANALYSIS_TOAST_MESSAGES.empty, JD_ANALYSIS_TOAST_ERROR_DURATION_MS);
            return null;
        }
        let toastId: string | null = null;
        try {
            const result = await handleAnalyze();
            if (result.status === 'success') {
                showToastSuccess(JD_ANALYSIS_TOAST_MESSAGES.success, JD_ANALYSIS_TOAST_DURATION_MS);
                return result.result;
            }
            if (result.status === 'aborted') {
                return null;
            }
            const isError = result.status === 'error' || result.status === 'missing_attachment';
            const message = result.status === 'missing_attachment'
                ? JD_ANALYSIS_TOAST_MESSAGES.missingAttachment
                : isError
                    ? JD_ANALYSIS_TOAST_MESSAGES.error
                    : JD_ANALYSIS_TOAST_MESSAGES.noChange;
            const duration = isError
                ? JD_ANALYSIS_TOAST_ERROR_DURATION_MS
                : JD_ANALYSIS_TOAST_DURATION_MS;
            if (isError) {
                showToastError(message, duration);
            } else {
                showToastSuccess(message, duration);
            }
            return null;
        } catch (error) {
            console.error('[ResumeEditor] JD 分析失败:', error);
            showToastError(JD_ANALYSIS_TOAST_MESSAGES.error, JD_ANALYSIS_TOAST_ERROR_DURATION_MS);
            return null;
        }
    }, [
        handleAnalyze,
        hasMissingAttachmentContext,
        isAnalyzing,
        jdFile,
        jdText,
        showToastError,
        showToastLoading,
        showToastSuccess,
        updateToast,
    ]);

    const handleAnalyzeWithAutoName = useCallback(async () => {
        const result = await runJdAnalyzeWithToast();
        if (!result) {
            return null;
        }
        if (!canAutoNameResume(resumeName)) {
            return result;
        }
        const autoName = resolveAutoResumeName(result, jdText);
        if (!autoName) {
            return result;
        }
        await applyResumeNameUpdate(autoName, { silent: true });
        return result;
    }, [applyResumeNameUpdate, canAutoNameResume, jdText, resumeName, runJdAnalyzeWithToast]);

    useEffect(() => {
        if (pendingPolishAutoAnalyzeSeq <= 0) {
            return;
        }
        if (lastPolishAutoAnalyzeSeqRef.current === pendingPolishAutoAnalyzeSeq) {
            return;
        }
        lastPolishAutoAnalyzeSeqRef.current = pendingPolishAutoAnalyzeSeq;
        void runJdAnalyzeWithToast();
    }, [pendingPolishAutoAnalyzeSeq, runJdAnalyzeWithToast]);

    return {
        handleAnalyzeWithAutoName,
        runJdAnalyzeWithToast,
    };
};
