import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { ToastConfig } from '../../../components/Toast';
import { aiService, type PolishMode } from '../../../services/aiService';
import type { ExperienceEditDraft, PolishPreviewState } from '../../../types/resume';
import {
    trackAiPolishResult,
    trackAiPolishStart,
    trackAiPolishUndone,
} from '../../../utils/analyticsTracker';
import {
    buildExperiencePolishPayloadContent,
    buildPolishedExperienceDraft,
    resolveExperiencePolishCustomPrompt,
    shouldAskBeforeSmartCompletionRewrite,
} from '../experiencePolishUtils';
import {
    buildSmartCompletionPromptState,
    type SmartCompletionPromptState,
} from '../smartCompletionUtils';

type ResumePolishMode = Exclude<PolishMode, 'assistant'>;
type UpdateToast = (id: string, updates: Partial<Omit<ToastConfig, 'id'>>) => void;

const isAbortError = (error: unknown) => (
    typeof error === 'object'
    && error !== null
    && 'name' in error
    && (error as { name?: unknown }).name === 'AbortError'
);

type UseEditingExperiencePolishActionsParams = {
    editingDraft: ExperienceEditDraft | null;
    setEditingDraft: Dispatch<SetStateAction<ExperienceEditDraft | null>>;
    setIsRunning: Dispatch<SetStateAction<boolean>>;
    isRunningRef: MutableRefObject<boolean>;
    jdPolishContext: string;
    jdCapabilityPolishContext: string;
    polishMode: ResumePolishMode;
    customPrompt: string;
    smartCompletionPrompt: SmartCompletionPromptState | null;
    setSmartCompletionPrompt: Dispatch<SetStateAction<SmartCompletionPromptState | null>>;
    polishPreview: PolishPreviewState<ExperienceEditDraft> | null;
    setPolishPreview: Dispatch<SetStateAction<PolishPreviewState<ExperienceEditDraft> | null>>;
    pendingAiPolishApplyRef: MutableRefObject<Set<string>>;
    showToastError: (message: string) => void;
    showToastLoading: (message: string) => string;
    updateToast: UpdateToast;
    showToastSuccess?: (message: string, duration?: number) => string;
    closeToast: (id: string) => void;
};

export const useEditingExperiencePolishActions = ({
    editingDraft,
    setEditingDraft,
    setIsRunning,
    isRunningRef,
    jdPolishContext,
    jdCapabilityPolishContext,
    polishMode,
    customPrompt,
    smartCompletionPrompt,
    setSmartCompletionPrompt,
    polishPreview,
    setPolishPreview,
    pendingAiPolishApplyRef,
    showToastError,
    showToastLoading,
    updateToast,
    showToastSuccess,
    closeToast,
}: UseEditingExperiencePolishActionsParams) => {
    const [editingThinkingText, setEditingThinkingText] = useState('');
    const editingAbortControllerRef = useRef<AbortController | null>(null);

    useEffect(() => {
        return () => {
            if (editingAbortControllerRef.current) {
                editingAbortControllerRef.current.abort();
            }
        };
    }, []);

    const handleStopEditing = useCallback(() => {
        if (editingAbortControllerRef.current) {
            editingAbortControllerRef.current.abort();
            editingAbortControllerRef.current = null;
        }
        setIsRunning(false);
        setEditingThinkingText('');
    }, [setIsRunning]);

    const handleRunEditingExperiencePolish = useCallback(async () => {
        if (!editingDraft || isRunningRef.current) {
            return;
        }
        editingAbortControllerRef.current = new AbortController();
        setEditingThinkingText('');
        const trimmedJd = jdPolishContext.trim();
        if (!trimmedJd) {
            showToastError('请先填写 JD 再润色');
            return;
        }

        let toastId: string | null = null;
        let hasError = false;
        let applied = false;
        let requestedSmartCompletion = false;
        let wasAborted = false;
        let action: 'applied' | 'discarded' = 'discarded';
        const startTime = Date.now();

        try {
            isRunningRef.current = true;
            setIsRunning(true);
            trackAiPolishStart({ source: 'resume_editor', field: 'all' });
            const draft = editingDraft;
            const result = await aiService.polishExperienceStream({
                content: buildExperiencePolishPayloadContent(draft),
                jdText: trimmedJd,
                mode: polishMode,
                customPrompt: resolveExperiencePolishCustomPrompt({
                    mode: polishMode,
                    customPrompt,
                    smartCompletionAnswer: smartCompletionPrompt?.answer,
                    jdCapabilityPolishContext,
                }),
                entrySource: 'resume_editor',
            }, (event) => {
                if (event.type === 'thought') {
                    if (event.summary) {
                        setEditingThinkingText(event.summary);
                    }
                }
            }, editingAbortControllerRef.current?.signal);

            if (shouldAskBeforeSmartCompletionRewrite(polishMode, result)) {
                requestedSmartCompletion = true;
                setSmartCompletionPrompt((prev) => buildSmartCompletionPromptState(result, prev));
                return;
            }

            const nextDraft = buildPolishedExperienceDraft(draft, result);
            const hasChange = (['s', 't', 'a', 'r'] as const).some((key) => nextDraft.star[key] !== draft.star[key]);
            if (hasChange) {
                setEditingDraft(nextDraft);
                applied = true;
                action = 'applied';
                setSmartCompletionPrompt(null);
                pendingAiPolishApplyRef.current.add(draft.masterId);
            }
        } catch (error) {
            if (isAbortError(error)) {
                wasAborted = true;
                return;
            }
            hasError = true;
            console.error('[ResumeEditor] 编辑态 AI 润色失败:', error);
        } finally {
            if (wasAborted) {
                isRunningRef.current = false;
                setIsRunning(false);
                setEditingThinkingText('');
                editingAbortControllerRef.current = null;
                return;
            }
            const message = hasError
                ? 'JD 润色失败，请稍后重试'
                : applied
                    ? '已应用到当前编辑内容'
                    : requestedSmartCompletion
                        ? '请在智能补全卡片内补充信息后再执行'
                        : 'AI 已完成润色，但没有生成可用调整';
            const duration = hasError ? 3000 : 2500;

            if (hasError) {
                showToastError(message);
            } else {
                showToastSuccess?.(message, duration);
            }
            trackAiPolishResult({
                source: 'resume_editor',
                field: 'all',
                action,
                durationMs: Date.now() - startTime,
            });
            isRunningRef.current = false;
            setIsRunning(false);
            setEditingThinkingText('');
            editingAbortControllerRef.current = null;
        }
    }, [
        customPrompt,
        editingDraft,
        isRunningRef,
        jdCapabilityPolishContext,
        jdPolishContext,
        pendingAiPolishApplyRef,
        polishMode,
        setEditingDraft,
        setIsRunning,
        setSmartCompletionPrompt,
        showToastError,
        showToastLoading,
        smartCompletionPrompt,
        updateToast,
        showToastSuccess,
        closeToast,
    ]);

    const handleUndoEditingExperiencePolish = useCallback(() => {
        if (!polishPreview) {
            return;
        }
        setEditingDraft((prev) => {
            if (!prev) {
                return prev;
            }
            return {
                ...prev,
                star: {
                    s: prev.star.s === polishPreview.after.star.s ? polishPreview.before.star.s : prev.star.s,
                    t: prev.star.t === polishPreview.after.star.t ? polishPreview.before.star.t : prev.star.t,
                    a: prev.star.a === polishPreview.after.star.a ? polishPreview.before.star.a : prev.star.a,
                    r: prev.star.r === polishPreview.after.star.r ? polishPreview.before.star.r : prev.star.r,
                },
                starTouched: prev.starTouched || polishPreview.before.starTouched,
            };
        });
        if (editingDraft?.masterId && !polishPreview.hadPendingApplyBeforePreview) {
            pendingAiPolishApplyRef.current.delete(editingDraft.masterId);
        }
        setPolishPreview(null);
        trackAiPolishUndone({ source: 'resume_editor', field: 'all' });
    }, [editingDraft, pendingAiPolishApplyRef, polishPreview, setEditingDraft, setPolishPreview]);

    const handleConfirmEditingExperiencePolish = useCallback(() => {
        if (!polishPreview) {
            return;
        }
        setPolishPreview(null);
    }, [polishPreview, setPolishPreview]);

    return {
        handleRunEditingExperiencePolish,
        handleUndoEditingExperiencePolish,
        handleConfirmEditingExperiencePolish,
        editingThinkingText,
        handleStopEditing,
    };
};
