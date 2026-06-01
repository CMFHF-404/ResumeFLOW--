import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { ToastConfig } from '../../../components/Toast';
import { aiService, type PolishMode } from '../../../services/aiService';
import type { ExperienceEditDraft, ResumeExperienceView } from '../../../types/resume';
import {
    trackAiPolishResult,
    trackAiPolishStart,
} from '../../../utils/analyticsTracker';
import { extractThoughtHeadline } from '../../../utils/aiThought';
import { buildExperienceEditDraft } from '../helpers';
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
import type { FloatingExperiencePolishSessionItem } from './useFloatingExperiencePolishSession';

type ResumePolishMode = Exclude<PolishMode, 'assistant'>;
type UpdateToast = (id: string, updates: Partial<Omit<ToastConfig, 'id'>>) => void;

type UseFloatingExperiencePolishActionsParams = {
    activeFloatingPolishExperienceId: string | null;
    experienceItems: ResumeExperienceView[];
    selectedExpIds: Set<string>;
    jdPolishContext: string;
    jdCapabilityPolishContext: string;
    floatingPolishMode: ResumePolishMode;
    setFloatingPolishMode: Dispatch<SetStateAction<ResumePolishMode>>;
    defaultFloatingPolishMode: ResumePolishMode;
    floatingPolishCustomPrompt: string;
    floatingSmartCompletionPrompt: SmartCompletionPromptState | null;
    setFloatingSmartCompletionPrompt: Dispatch<SetStateAction<SmartCompletionPromptState | null>>;
    floatingExperiencePolishRunningRef: MutableRefObject<boolean>;
    setIsFloatingExperiencePolishRunning: Dispatch<SetStateAction<boolean>>;
    buildFloatingPolishSessionItem: (
        baseItem: ResumeExperienceView,
        nextDraft: ExperienceEditDraft,
        beforeDraft?: ExperienceEditDraft
    ) => FloatingExperiencePolishSessionItem | null;
    applyFloatingPolishPreview: (
        mode: 'single' | 'batch',
        items: FloatingExperiencePolishSessionItem[],
        failedIds?: string[]
    ) => boolean;
    showToastError: (message: string) => void;
    showToastLoading: (message: string) => string;
    updateToast: UpdateToast;
};

export const useFloatingExperiencePolishActions = ({
    activeFloatingPolishExperienceId,
    experienceItems,
    selectedExpIds,
    jdPolishContext,
    jdCapabilityPolishContext,
    floatingPolishMode,
    setFloatingPolishMode,
    defaultFloatingPolishMode,
    floatingPolishCustomPrompt,
    floatingSmartCompletionPrompt,
    setFloatingSmartCompletionPrompt,
    floatingExperiencePolishRunningRef,
    setIsFloatingExperiencePolishRunning,
    buildFloatingPolishSessionItem,
    applyFloatingPolishPreview,
    showToastError,
    showToastLoading,
    updateToast,
}: UseFloatingExperiencePolishActionsParams) => {
    const handleRunFloatingExperiencePolish = useCallback(async () => {
        if (!activeFloatingPolishExperienceId || floatingExperiencePolishRunningRef.current) {
            return;
        }
        const targetItem = experienceItems.find((item) => item.id === activeFloatingPolishExperienceId);
        if (!targetItem) {
            return;
        }

        const trimmedJd = jdPolishContext.trim();
        if (!trimmedJd) {
            showToastError('请先填写 JD 再润色');
            return;
        }

        const draft = buildExperienceEditDraft(targetItem);
        const toastId = showToastLoading('正在为简历预览生成润色结果...');
        let hasError = false;
        let applied = false;
        let requestedSmartCompletion = false;
        let action: 'applied' | 'discarded' = 'discarded';
        const startTime = Date.now();

        try {
            floatingExperiencePolishRunningRef.current = true;
            setIsFloatingExperiencePolishRunning(true);
            trackAiPolishStart({ source: 'resume_editor', field: 'all' });
            const result = await aiService.polishExperienceStream({
                content: buildExperiencePolishPayloadContent(draft),
                jdText: trimmedJd,
                mode: floatingPolishMode,
                customPrompt: resolveExperiencePolishCustomPrompt({
                    mode: floatingPolishMode,
                    customPrompt: floatingPolishCustomPrompt,
                    smartCompletionAnswer: floatingSmartCompletionPrompt?.answer,
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

            if (shouldAskBeforeSmartCompletionRewrite(floatingPolishMode, result)) {
                requestedSmartCompletion = true;
                setFloatingSmartCompletionPrompt((prev) => buildSmartCompletionPromptState(result, prev));
                return;
            }

            const nextDraft = buildPolishedExperienceDraft(draft, result);
            const sessionItem = buildFloatingPolishSessionItem(targetItem, nextDraft, draft);
            applied = sessionItem ? applyFloatingPolishPreview('single', [sessionItem]) : false;
            if (applied) {
                action = 'applied';
                setFloatingSmartCompletionPrompt(null);
            }
        } catch (error) {
            hasError = true;
            console.error('[ResumeEditor] 浮动润色预览失败:', error);
        } finally {
            if (hasError) {
                updateToast(toastId, { message: 'AI 润色失败，请稍后重试', type: 'error', duration: 3000 });
            } else if (applied) {
                updateToast(toastId, { message: '已同步到简历预览，请确认或撤销', type: 'success', duration: 2500 });
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
            floatingExperiencePolishRunningRef.current = false;
            setIsFloatingExperiencePolishRunning(false);
        }
    }, [
        activeFloatingPolishExperienceId,
        applyFloatingPolishPreview,
        buildFloatingPolishSessionItem,
        experienceItems,
        floatingExperiencePolishRunningRef,
        floatingPolishCustomPrompt,
        floatingPolishMode,
        floatingSmartCompletionPrompt,
        jdCapabilityPolishContext,
        jdPolishContext,
        setFloatingSmartCompletionPrompt,
        setIsFloatingExperiencePolishRunning,
        showToastError,
        showToastLoading,
        updateToast,
    ]);

    const handleRunBatchExperiencePolish = useCallback(async () => {
        if (floatingExperiencePolishRunningRef.current) {
            return;
        }
        const trimmedJd = jdPolishContext.trim();
        if (!trimmedJd) {
            showToastError('请先填写 JD 再润色');
            return;
        }
        if (floatingPolishMode === 'smart_complete') {
            setFloatingPolishMode(defaultFloatingPolishMode);
            setFloatingSmartCompletionPrompt(null);
            showToastError('批量润色暂不支持智能补全，请使用单条经历补充事实');
            return;
        }
        const targetItems = experienceItems.filter((item) => selectedExpIds.has(item.id));
        if (!targetItems.length) {
            showToastError('请先至少选中一条经历');
            return;
        }

        const toastId = showToastLoading('正在批量润色中……');
        let hasError = false;
        let action: 'applied' | 'discarded' = 'discarded';
        const startTime = Date.now();

        try {
            floatingExperiencePolishRunningRef.current = true;
            setIsFloatingExperiencePolishRunning(true);
            trackAiPolishStart({ source: 'resume_editor', field: 'all' });

            const results = await Promise.allSettled(targetItems.map(async (item) => {
                const draft = buildExperienceEditDraft(item);
                const result = await aiService.polishExperienceStream({
                    content: buildExperiencePolishPayloadContent(draft),
                    jdText: trimmedJd,
                    mode: floatingPolishMode,
                    customPrompt: resolveExperiencePolishCustomPrompt({
                        mode: floatingPolishMode,
                        customPrompt: floatingPolishCustomPrompt,
                    }),
                    entrySource: 'resume_editor',
                });

                const nextDraft = buildPolishedExperienceDraft(draft, result);
                return buildFloatingPolishSessionItem(item, nextDraft, draft);
            }));

            const sessionItems: FloatingExperiencePolishSessionItem[] = [];
            const failedIds: string[] = [];
            const unchangedIds: string[] = [];

            results.forEach((result, index) => {
                const targetId = targetItems[index]?.id;
                if (!targetId) {
                    return;
                }
                if (result.status === 'fulfilled') {
                    if (result.value) {
                        sessionItems.push(result.value);
                    } else {
                        unchangedIds.push(targetId);
                    }
                    return;
                }
                failedIds.push(targetId);
            });

            if (sessionItems.length > 0) {
                applyFloatingPolishPreview('batch', sessionItems, failedIds);
                action = 'applied';
                updateToast(toastId, {
                    message: failedIds.length > 0
                        ? `已完成 ${sessionItems.length} 条，${failedIds.length} 条失败，请确认可用结果`
                        : '批量润色完成，请确认是否保存',
                    type: 'success',
                    duration: 2500,
                });
            } else if (unchangedIds.length > 0 && failedIds.length === 0) {
                updateToast(toastId, {
                    message: 'AI 已完成批量润色，但没有生成可用调整',
                    type: 'success',
                    duration: 2500,
                });
            } else {
                hasError = true;
                updateToast(toastId, {
                    message: '批量润色失败，请稍后重试',
                    type: 'error',
                    duration: 3000,
                });
            }
        } catch (error) {
            hasError = true;
            console.error('[ResumeEditor] 批量润色失败:', error);
            updateToast(toastId, {
                message: '批量润色失败，请稍后重试',
                type: 'error',
                duration: 3000,
            });
        } finally {
            if (!hasError) {
                trackAiPolishResult({
                    source: 'resume_editor',
                    field: 'all',
                    action,
                    durationMs: Date.now() - startTime,
                });
            } else {
                trackAiPolishResult({
                    source: 'resume_editor',
                    field: 'all',
                    action: 'discarded',
                    durationMs: Date.now() - startTime,
                });
            }
            floatingExperiencePolishRunningRef.current = false;
            setIsFloatingExperiencePolishRunning(false);
        }
    }, [
        applyFloatingPolishPreview,
        buildFloatingPolishSessionItem,
        defaultFloatingPolishMode,
        experienceItems,
        floatingExperiencePolishRunningRef,
        floatingPolishCustomPrompt,
        floatingPolishMode,
        jdPolishContext,
        selectedExpIds,
        setFloatingPolishMode,
        setFloatingSmartCompletionPrompt,
        setIsFloatingExperiencePolishRunning,
        showToastError,
        showToastLoading,
        updateToast,
    ]);

    return {
        handleRunFloatingExperiencePolish,
        handleRunBatchExperiencePolish,
    };
};
