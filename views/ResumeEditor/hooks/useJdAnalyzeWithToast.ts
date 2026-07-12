import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { AnalyzeStreamEvent, JDAnalysisResult } from '../../../services/aiService';
import { resolveAutoResumeName } from '../autoNameUtils';
import { createJDAnalyzeWorkflowCoordinator } from '../jdAnalyzeWorkflow';
import {
    JD_ANALYSIS_TOAST_DURATION_MS,
    JD_ANALYSIS_TOAST_ERROR_DURATION_MS,
    JD_ANALYSIS_TOAST_MESSAGES,
} from '../constants';

type JDAnalyzeOutcome =
    | { status: 'success'; result: JDAnalysisResult }
    | { status: 'empty' }
    | { status: 'no_change' }
    | { status: 'missing_attachment' }
    | { status: 'aborted' }
    | { status: 'error' };

type UseJdAnalyzeWithToastParams = {
    handleAnalyze: (options?: { onEvent?: (event: AnalyzeStreamEvent) => void }) => Promise<JDAnalyzeOutcome>;
    resumeId: string | null;
    isAnalyzing: boolean;
    jdText: string;
    resumeName: string;
    pendingPolishAutoAnalyzeSeq: number;
    applyResumeNameUpdate: (nextName: string, options?: { silent?: boolean }) => Promise<void>;
    canAutoNameResume: (name: string) => boolean;
    showToastError: (message: string, duration?: number) => string;
    showToastSuccess: (message: string, duration?: number) => string;
};

export const useJdAnalyzeWithToast = ({
    handleAnalyze,
    resumeId,
    isAnalyzing,
    jdText,
    resumeName,
    pendingPolishAutoAnalyzeSeq,
    applyResumeNameUpdate,
    canAutoNameResume,
    showToastError,
    showToastSuccess,
}: UseJdAnalyzeWithToastParams) => {
    const lastPolishAutoAnalyzeSeqRef = useRef(0);
    const workflowCoordinator = useMemo(
        () => createJDAnalyzeWorkflowCoordinator<JDAnalysisResult | null, string>(),
        [resumeId]
    );
    const latestAutoNameContextRef = useRef({
        applyResumeNameUpdate,
        canAutoNameResume,
        resumeId,
        resumeName,
    });
    latestAutoNameContextRef.current = {
        applyResumeNameUpdate,
        canAutoNameResume,
        resumeId,
        resumeName,
    };

    const applyLatestAutoName = useCallback(async (
        result: JDAnalysisResult | null,
        jdTextAtStart: string
    ) => {
        if (!result) {
            return;
        }
        const context = latestAutoNameContextRef.current;
        if (!context.canAutoNameResume(context.resumeName)) {
            return;
        }
        const autoName = resolveAutoResumeName(result, jdTextAtStart);
        if (autoName) {
            await context.applyResumeNameUpdate(autoName, { silent: true });
        }
    }, []);

    const runJdAnalyzeWorkflow = useCallback((requestAutoName: boolean) => {
        const workflowResumeId = resumeId;
        return workflowCoordinator.run(async (isCurrent) => {
            if (isAnalyzing) {
                return null;
            }
            try {
                const result = await handleAnalyze();
                if (
                    !isCurrent()
                    || latestAutoNameContextRef.current.resumeId !== workflowResumeId
                ) {
                    return null;
                }
                if (result.status === 'success') {
                    showToastSuccess(JD_ANALYSIS_TOAST_MESSAGES.success, JD_ANALYSIS_TOAST_DURATION_MS);
                    return result.result;
                }
                if (result.status === 'aborted') {
                    return null;
                }
                const isError = result.status === 'error'
                    || result.status === 'missing_attachment'
                    || result.status === 'empty';
                const message = result.status === 'empty'
                    ? JD_ANALYSIS_TOAST_MESSAGES.empty
                    : result.status === 'missing_attachment'
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
                if (!isCurrent()) {
                    return null;
                }
                console.error('[ResumeEditor] JD 分析失败:', error);
                showToastError(JD_ANALYSIS_TOAST_MESSAGES.error, JD_ANALYSIS_TOAST_ERROR_DURATION_MS);
                return null;
            }
        }, {
            requestAutoName,
            autoNameContext: jdText,
            applyAutoName: applyLatestAutoName,
        });
    }, [
        applyLatestAutoName,
        handleAnalyze,
        isAnalyzing,
        jdText,
        resumeId,
        showToastError,
        showToastSuccess,
        workflowCoordinator,
    ]);

    const runJdAnalyzeWithToast = useCallback(
        () => runJdAnalyzeWorkflow(false),
        [runJdAnalyzeWorkflow]
    );

    const handleAnalyzeWithAutoName = useCallback(
        () => runJdAnalyzeWorkflow(true),
        [runJdAnalyzeWorkflow]
    );

    const invalidateJdAnalyzeWorkflow = useCallback(() => {
        workflowCoordinator.invalidate();
    }, [workflowCoordinator]);

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
        invalidateJdAnalyzeWorkflow,
    };
};
