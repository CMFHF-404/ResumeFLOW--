import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { ToastConfig } from '../../../components/Toast';
import { aiService, type PersonalSummaryStreamEvent } from '../../../services/aiService';
import { extractThoughtHeadline } from '../../../utils/aiThought';
import { normalizeAiRichText, stripRichTextToText } from '../../../utils/richText';
import { hasMeaningfulPersonalSummary, type buildPersonalSummaryContext } from '../personalSummaryUtils';

type UpdateToast = (id: string, updates: Partial<Omit<ToastConfig, 'id'>>) => void;

type UsePersonalSummaryGenerationParams = {
    resumeId: string | null;
    jdPolishContext: string;
    personalSummaryContext: ReturnType<typeof buildPersonalSummaryContext>;
    personalSummaryCurrentSignature: string;
    hasEditablePersonalSummary: boolean;
    isSummaryVisible: boolean;
    closeToast: (id: string) => void;
    showToastError: (message: string, duration?: number) => string;
    showToastLoading: (message: string) => string;
    updateToast: UpdateToast;
    setIsSummaryVisible: Dispatch<SetStateAction<boolean>>;
    setPersonalSummary: Dispatch<SetStateAction<string>>;
    setHasPersonalSummaryOverride: Dispatch<SetStateAction<boolean>>;
};

export const usePersonalSummaryGeneration = ({
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
}: UsePersonalSummaryGenerationParams) => {
    const [isGeneratingPersonalSummary, setIsGeneratingPersonalSummary] = useState(false);
    const [isPersonalSummaryOverwriteDialogOpen, setIsPersonalSummaryOverwriteDialogOpen] = useState(false);
    const requestIdRef = useRef(0);
    const draftVersionRef = useRef(0);
    const latestResumeIdRef = useRef<string | null>(resumeId);
    const latestSignatureRef = useRef('');
    const activeToastIdRef = useRef<string | null>(null);

    latestResumeIdRef.current = resumeId;
    latestSignatureRef.current = personalSummaryCurrentSignature;

    const cancelPersonalSummaryGeneration = useCallback(() => {
        requestIdRef.current += 1;
        if (activeToastIdRef.current) {
            closeToast(activeToastIdRef.current);
            activeToastIdRef.current = null;
        }
        setIsGeneratingPersonalSummary(false);
        setIsPersonalSummaryOverwriteDialogOpen(false);
    }, [closeToast]);

    useEffect(() => cancelPersonalSummaryGeneration, [cancelPersonalSummaryGeneration, resumeId]);

    const handlePersonalSummaryChange = useCallback((value: string) => {
        draftVersionRef.current += 1;
        if (
            !isSummaryVisible
            && !hasEditablePersonalSummary
            && hasMeaningfulPersonalSummary(value)
        ) {
            setIsSummaryVisible(true);
        }
        setPersonalSummary(value);
        setHasPersonalSummaryOverride(true);
    }, [
        hasEditablePersonalSummary,
        isSummaryVisible,
        setHasPersonalSummaryOverride,
        setIsSummaryVisible,
        setPersonalSummary,
    ]);

    const runGeneratePersonalSummary = useCallback(async () => {
        if (isGeneratingPersonalSummary) {
            return;
        }
        if (!jdPolishContext.trim()) {
            showToastError('请先填写 JD 内容或完成 JD 分析后再生成个人评价。');
            return;
        }

        const toastId = showToastLoading('正在生成个人评价...');
        activeToastIdRef.current = toastId;
        const requestedResumeId = resumeId;
        const isResumeRequestCurrent = () => latestResumeIdRef.current === requestedResumeId;
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        const draftVersionAtStart = draftVersionRef.current;
        const requestedSignature = personalSummaryCurrentSignature;
        const isRequestCurrent = () => requestIdRef.current === requestId;
        const releaseActiveToast = () => {
            if (activeToastIdRef.current === toastId) {
                activeToastIdRef.current = null;
            }
        };
        setIsGeneratingPersonalSummary(true);
        try {
            const response = await aiService.generatePersonalSummaryStream(
                {
                    mode: 'resume',
                    profile: personalSummaryContext.profile,
                    workExperiences: personalSummaryContext.workExperiences,
                    projectExperiences: personalSummaryContext.projectExperiences,
                    educationExperiences: personalSummaryContext.educationExperiences,
                    certifications: personalSummaryContext.certifications,
                    skills: personalSummaryContext.skills,
                    jdText: jdPolishContext,
                },
                (event: PersonalSummaryStreamEvent) => {
                    if (event.type !== 'thought') {
                        return;
                    }
                    if (
                        !isResumeRequestCurrent()
                        || !isRequestCurrent()
                        || latestSignatureRef.current !== requestedSignature
                    ) {
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
            if (
                !isResumeRequestCurrent()
                || !isRequestCurrent()
                || draftVersionRef.current !== draftVersionAtStart
                || latestSignatureRef.current !== requestedSignature
            ) {
                closeToast(toastId);
                releaseActiveToast();
                return;
            }
            const normalizedSummary = normalizeAiRichText(response.summary, { allowList: false });
            const hasGeneratedSummary = Boolean(stripRichTextToText(normalizedSummary).trim());
            if (!isSummaryVisible && !hasEditablePersonalSummary && hasGeneratedSummary) {
                setIsSummaryVisible(true);
            }
            setPersonalSummary(normalizedSummary);
            setHasPersonalSummaryOverride(true);
            updateToast(toastId, {
                message: '个人评价已生成',
                type: 'success',
                duration: 2500,
            });
            releaseActiveToast();
        } catch (error) {
            if (!isResumeRequestCurrent() || !isRequestCurrent()) {
                closeToast(toastId);
                releaseActiveToast();
                return;
            }
            console.error('[ResumeEditor] 生成个人评价失败:', error);
            updateToast(toastId, {
                message: error instanceof Error ? error.message : '个人评价生成失败，请稍后重试',
                type: 'error',
                duration: 3500,
            });
            releaseActiveToast();
        } finally {
            if (isRequestCurrent()) {
                setIsGeneratingPersonalSummary(false);
            }
        }
    }, [
        closeToast,
        hasEditablePersonalSummary,
        isGeneratingPersonalSummary,
        isSummaryVisible,
        jdPolishContext,
        personalSummaryContext,
        personalSummaryCurrentSignature,
        resumeId,
        showToastError,
        showToastLoading,
        updateToast,
        setHasPersonalSummaryOverride,
        setIsSummaryVisible,
        setPersonalSummary,
    ]);

    const handleGeneratePersonalSummary = useCallback(() => {
        if (isGeneratingPersonalSummary) {
            return;
        }
        if (!jdPolishContext.trim()) {
            showToastError('请先填写 JD 内容或完成 JD 分析后再生成个人评价。');
            return;
        }
        if (hasEditablePersonalSummary) {
            setIsPersonalSummaryOverwriteDialogOpen(true);
            return;
        }
        void runGeneratePersonalSummary();
    }, [
        hasEditablePersonalSummary,
        isGeneratingPersonalSummary,
        jdPolishContext,
        runGeneratePersonalSummary,
        showToastError,
    ]);

    const confirmPersonalSummaryOverwrite = useCallback(() => {
        setIsPersonalSummaryOverwriteDialogOpen(false);
        void runGeneratePersonalSummary();
    }, [runGeneratePersonalSummary]);

    const cancelPersonalSummaryOverwrite = useCallback(() => {
        setIsPersonalSummaryOverwriteDialogOpen(false);
    }, []);

    return {
        isGeneratingPersonalSummary,
        isPersonalSummaryOverwriteDialogOpen,
        handlePersonalSummaryChange,
        handleGeneratePersonalSummary,
        confirmPersonalSummaryOverwrite,
        cancelPersonalSummaryOverwrite,
    };
};
