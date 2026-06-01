import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { ToastConfig } from '../../../components/Toast';
import { aiService, type PolishMode } from '../../../services/aiService';
import type { ExperienceEditDraft, PolishPreviewState } from '../../../types/resume';
import {
    trackAiPolishResult,
    trackAiPolishStart,
    trackAiPolishUndone,
} from '../../../utils/analyticsTracker';
import { extractThoughtHeadline } from '../../../utils/aiThought';
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

type UseEditingExperiencePolishActionsParams = {
    editingDraft: ExperienceEditDraft | null;
    setEditingDraft: Dispatch<SetStateAction<ExperienceEditDraft | null>>;
    polishMode: ResumePolishMode;
    customPrompt: string;
    smartCompletionPrompt: SmartCompletionPromptState | null;
    setSmartCompletionPrompt: Dispatch<SetStateAction<SmartCompletionPromptState | null>>;
    polishPreview: PolishPreviewState<ExperienceEditDraft> | null;
    setPolishPreview: Dispatch<SetStateAction<PolishPreviewState<ExperienceEditDraft> | null>>;
    isRunningRef: MutableRefObject<boolean>;
    setIsRunning: Dispatch<SetStateAction<boolean>>;
    pendingAiPolishApplyRef: MutableRefObject<Set<string>>;
    jdPolishContext: string;
    jdCapabilityPolishContext: string;
    showToastError: (message: string) => void;
    showToastLoading: (message: string) => string;
    updateToast: UpdateToast;
};

export const useEditingExperiencePolishActions = ({
    editingDraft,
    setEditingDraft,
    polishMode,
    customPrompt,
    smartCompletionPrompt,
    setSmartCompletionPrompt,
    polishPreview,
    setPolishPreview,
    isRunningRef,
    setIsRunning,
    pendingAiPolishApplyRef,
    jdPolishContext,
    jdCapabilityPolishContext,
    showToastError,
    showToastLoading,
    updateToast,
}: UseEditingExperiencePolishActionsParams) => {
    const handleRunEditingExperiencePolish = useCallback(async () => {
        if (!editingDraft || isRunningRef.current) {
            return;
        }
        const trimmedJd = jdPolishContext.trim();
        if (!trimmedJd) {
            showToastError('请先填写 JD 再润色');
            return;
        }

        const toastId = showToastLoading(
            polishMode === 'default'
                ? '正在根据 JD 突出重点...'
                : '正在基于 JD 润色...'
        );
        let hasError = false;
        let applied = false;
        let requestedSmartCompletion = false;
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
                if (event.type !== 'thought') {
                    return;
                }
                const title = extractThoughtHeadline(event.summary);
                if (title) {
                    updateToast(toastId, { message: title, type: 'ai_thinking', duration: 0 });
                }
            });

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
            hasError = true;
            console.error('[ResumeEditor] 编辑态 AI 润色失败:', error);
        } finally {
            if (hasError) {
                updateToast(toastId, { message: 'JD 润色失败，请稍后重试', type: 'error', duration: 3000 });
            } else if (applied) {
                updateToast(toastId, { message: '已应用到当前编辑内容', type: 'success', duration: 2500 });
            } else if (requestedSmartCompletion) {
                updateToast(toastId, { message: '请在智能补全卡片内补充信息后再执行', type: 'success', duration: 2500 });
            } else {
                updateToast(toastId, { message: 'AI 已完成润色，但没有生成可用调整', type: 'success', duration: 2500 });
            }
            trackAiPolishResult({
                source: 'resume_editor',
                field: 'all',
                action,
                durationMs: Date.now() - startTime,
            });
            isRunningRef.current = false;
            setIsRunning(false);
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
    };
};
