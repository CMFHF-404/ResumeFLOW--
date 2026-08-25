import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type Dispatch,
    type MutableRefObject,
    type SetStateAction,
} from 'react';
import type { ToastConfig } from '../../../components/Toast';
import { useAuthOwnerOperationGuard } from '../../../hooks/useAuthOwnerOperationGuard';
import { isAuthContextChangedError } from '../../../services/apiClient';
import { aiService, type PolishMode } from '../../../services/aiService';
import type { ExperienceEditDraft, ResumeExperienceView } from '../../../types/resume';
import {
    trackAiPolishResult,
    trackAiPolishStart,
} from '../../../utils/analyticsTracker';
import { resolveThoughtDisplayEvent } from '../../../utils/aiThought';
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

const isAbortError = (error: unknown) => (
    typeof error === 'object'
    && error !== null
    && 'name' in error
    && (error as { name?: unknown }).name === 'AbortError'
);

type UseFloatingExperiencePolishActionsParams = {
    authUserKey: string | null;
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
    showToastSuccess?: (message: string, duration?: number) => string;
    closeToast: (id: string) => void;
};

export const useFloatingExperiencePolishActions = ({
    authUserKey,
    activeFloatingPolishExperienceId,
    experienceItems,
    selectedExpIds,
    jdPolishContext,
    jdCapabilityPolishContext,
    floatingPolishMode,
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
    showToastSuccess,
    closeToast,
}: UseFloatingExperiencePolishActionsParams) => {
    const ownerGuard = useAuthOwnerOperationGuard(authUserKey);
    const [floatingThinkingText, setFloatingThinkingText] = useState('');
    const floatingAbortControllerRef = useRef<AbortController | null>(null);
    const activeRequestRef = useRef<symbol | null>(null);
    const loadingToastRef = useRef<string | null>(null);

    useLayoutEffect(() => {
        activeRequestRef.current = null;
        floatingAbortControllerRef.current?.abort();
        floatingAbortControllerRef.current = null;
        floatingExperiencePolishRunningRef.current = false;
        setIsFloatingExperiencePolishRunning(false);
        setFloatingThinkingText('');
        if (loadingToastRef.current) {
            closeToast(loadingToastRef.current);
            loadingToastRef.current = null;
        }
    }, [
        authUserKey,
        closeToast,
        floatingExperiencePolishRunningRef,
        setIsFloatingExperiencePolishRunning,
    ]);

    useEffect(() => {
        return () => {
            activeRequestRef.current = null;
            if (floatingAbortControllerRef.current) {
                floatingAbortControllerRef.current.abort();
            }
            if (loadingToastRef.current) {
                closeToast(loadingToastRef.current);
                loadingToastRef.current = null;
            }
        };
    }, [closeToast]);

    const handleStopFloating = useCallback(() => {
        if (floatingAbortControllerRef.current) {
            floatingAbortControllerRef.current.abort();
            floatingAbortControllerRef.current = null;
        }
        floatingExperiencePolishRunningRef.current = false;
        setIsFloatingExperiencePolishRunning(false);
        setFloatingThinkingText('');
    }, [floatingExperiencePolishRunningRef, setIsFloatingExperiencePolishRunning]);

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
        let hasError = false;
        let applied = false;
        let wasAborted = false;
        let action: 'applied' | 'discarded' = 'discarded';
        const startTime = Date.now();
        const requestId = Symbol('floating-experience-polish');
        const abortController = new AbortController();
        activeRequestRef.current = requestId;
        floatingAbortControllerRef.current = abortController;
        floatingExperiencePolishRunningRef.current = true;
        setIsFloatingExperiencePolishRunning(true);
        setFloatingThinkingText('');
        let operation: Awaited<ReturnType<typeof ownerGuard.beginOperation>> | null = null;

        try {
            operation = await ownerGuard.beginOperation();
            if (activeRequestRef.current !== requestId) {
                return;
            }
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
                const resolution = resolveThoughtDisplayEvent(event);
                if (
                    resolution?.kind === 'model_thought'
                    && activeRequestRef.current === requestId
                    && operation
                    && ownerGuard.isOperationCurrent(operation)
                ) {
                    setFloatingThinkingText(resolution.text);
                }
            }, abortController.signal, {
                expectedAuthCacheKey: operation.expectedAuthCacheKey,
            });
            await ownerGuard.assertOperationCurrent(operation);
            if (activeRequestRef.current !== requestId) {
                return;
            }

            if (shouldAskBeforeSmartCompletionRewrite(floatingPolishMode, result)) {
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
            if (
                isAbortError(error)
                || isAuthContextChangedError(error)
                || !operation
                || !ownerGuard.isOperationCurrent(operation)
                || activeRequestRef.current !== requestId
            ) {
                wasAborted = true;
                return;
            }
            hasError = true;
            console.error('[ResumeEditor] 浮动润色预览失败:', error);
        } finally {
            if (activeRequestRef.current !== requestId) {
                return;
            }
            if (wasAborted || !operation || !ownerGuard.isOperationCurrent(operation)) {
                activeRequestRef.current = null;
                floatingExperiencePolishRunningRef.current = false;
                setIsFloatingExperiencePolishRunning(false);
                setFloatingThinkingText('');
                if (floatingAbortControllerRef.current === abortController) {
                    floatingAbortControllerRef.current = null;
                }
                return;
            }
            const message = hasError
                ? 'AI 润色失败，请稍后重试'
                : applied
                    ? '已生成润色预览结果，请在右侧简历中确认'
                    : 'AI 已完成润色，但没有生成可用调整';
            const duration = 2500;

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
            activeRequestRef.current = null;
            floatingExperiencePolishRunningRef.current = false;
            setIsFloatingExperiencePolishRunning(false);
            setFloatingThinkingText('');
            if (floatingAbortControllerRef.current === abortController) {
                floatingAbortControllerRef.current = null;
            }
        }
    }, [
        activeFloatingPolishExperienceId,
        applyFloatingPolishPreview,
        buildFloatingPolishSessionItem,
        experienceItems,
        floatingPolishCustomPrompt,
        floatingPolishMode,
        floatingSmartCompletionPrompt,
        jdCapabilityPolishContext,
        jdPolishContext,
        floatingExperiencePolishRunningRef,
        ownerGuard,
        setIsFloatingExperiencePolishRunning,
        setFloatingSmartCompletionPrompt,
        showToastError,
        showToastLoading,
        updateToast,
        showToastSuccess,
        closeToast,
    ]);

    const handleRunBatchExperiencePolish = useCallback(async () => {
        const targetItems = experienceItems.filter((item) => selectedExpIds.has(item.id));
        if (targetItems.length === 0 || floatingExperiencePolishRunningRef.current) {
            return;
        }

        const trimmedJd = jdPolishContext.trim();
        if (!trimmedJd) {
            showToastError('请先填写 JD 再润色');
            return;
        }

        let hasError = false;
        let wasAborted = false;
        let action: 'applied' | 'discarded' = 'discarded';
        const startTime = Date.now();
        let sessionItems: FloatingExperiencePolishSessionItem[] = [];
        let failedItemCount = 0;
        const requestId = Symbol('batch-experience-polish');
        const abortController = new AbortController();
        activeRequestRef.current = requestId;
        floatingAbortControllerRef.current = abortController;
        floatingExperiencePolishRunningRef.current = true;
        setIsFloatingExperiencePolishRunning(true);
        setFloatingThinkingText('');
        let operation: Awaited<ReturnType<typeof ownerGuard.beginOperation>> | null = null;
        let toastId: string | null = null;

        try {
            operation = await ownerGuard.beginOperation();
            if (activeRequestRef.current !== requestId) {
                return;
            }
            toastId = showToastLoading('正在批量润色中……');
            loadingToastRef.current = toastId;
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
                }, undefined, abortController.signal, {
                    expectedAuthCacheKey: operation?.expectedAuthCacheKey,
                });

                const nextDraft = buildPolishedExperienceDraft(draft, result);
                return buildFloatingPolishSessionItem(item, nextDraft, draft);
            }));
            await ownerGuard.assertOperationCurrent(operation);
            if (activeRequestRef.current !== requestId) {
                return;
            }

            sessionItems = [];
            const failedIds: string[] = [];
            const abortedIds: string[] = [];
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
                if (isAbortError(result.reason)) {
                    abortedIds.push(targetId);
                    return;
                }
                failedIds.push(targetId);
            });

            if (abortedIds.length > 0) {
                wasAborted = true;
                updateToast(toastId, { message: '已停止批量润色', type: 'info', duration: 2000 });
                loadingToastRef.current = null;
                return;
            }
            if (sessionItems.length > 0) {
                applyFloatingPolishPreview('batch', sessionItems, failedIds);
                action = 'applied';
            }
            if (failedIds.length > 0) {
                failedItemCount = failedIds.length;
                if (sessionItems.length === 0) {
                    updateToast(toastId, {
                        message: `批量润色失败，${failedIds.length} 条经历未成功，请稍后重试`,
                        type: 'error',
                        duration: 3000,
                    });
                    loadingToastRef.current = null;
                }
            } else if (sessionItems.length === 0 && unchangedIds.length > 0) {
                updateToast(toastId, {
                    message: 'AI 已完成批量润色，但没有生成可用调整',
                    type: 'success',
                    duration: 2500,
                });
                loadingToastRef.current = null;
            }
        } catch (error) {
            if (
                isAbortError(error)
                && operation
                && ownerGuard.isOperationCurrent(operation)
                && activeRequestRef.current === requestId
            ) {
                wasAborted = true;
                if (toastId) {
                    updateToast(toastId, { message: '已停止批量润色', type: 'info', duration: 2000 });
                    loadingToastRef.current = null;
                }
                return;
            }
            if (
                isAuthContextChangedError(error)
                || !operation
                || !ownerGuard.isOperationCurrent(operation)
                || activeRequestRef.current !== requestId
            ) {
                wasAborted = true;
                if (toastId && loadingToastRef.current === toastId) {
                    closeToast(toastId);
                    loadingToastRef.current = null;
                }
                return;
            }
            hasError = true;
            console.error('[ResumeEditor] 批量润色失败:', error);
            if (toastId) {
                updateToast(toastId, {
                    message: '批量润色失败，请稍后重试',
                    type: 'error',
                    duration: 3000,
                });
                loadingToastRef.current = null;
            }
        } finally {
            if (activeRequestRef.current !== requestId) {
                return;
            }
            if (wasAborted || !operation || !ownerGuard.isOperationCurrent(operation)) {
                activeRequestRef.current = null;
                floatingExperiencePolishRunningRef.current = false;
                setIsFloatingExperiencePolishRunning(false);
                setFloatingThinkingText('');
                if (floatingAbortControllerRef.current === abortController) {
                    floatingAbortControllerRef.current = null;
                }
                return;
            }
            if (!hasError) {
                trackAiPolishResult({
                    source: 'resume_editor',
                    field: 'all',
                    action,
                    durationMs: Date.now() - startTime,
                });
                if (sessionItems.length > 0) {
                    updateToast(toastId, {
                        message: failedItemCount > 0
                            ? `已完成 ${sessionItems.length} 条，${failedItemCount} 条失败，请确认可用结果`
                            : '批量润色结果已应用到简历预览',
                        type: 'success',
                        duration: 2500,
                    });
                    loadingToastRef.current = null;
                }
            }
            activeRequestRef.current = null;
            floatingExperiencePolishRunningRef.current = false;
            setIsFloatingExperiencePolishRunning(false);
            setFloatingThinkingText('');
            if (floatingAbortControllerRef.current === abortController) {
                floatingAbortControllerRef.current = null;
            }
        }
    }, [
        applyFloatingPolishPreview,
        buildFloatingPolishSessionItem,
        experienceItems,
        floatingPolishCustomPrompt,
        floatingPolishMode,
        floatingExperiencePolishRunningRef,
        closeToast,
        ownerGuard,
        setIsFloatingExperiencePolishRunning,
        selectedExpIds,
        showToastError,
        showToastLoading,
        updateToast,
    ]);

    return {
        handleRunFloatingExperiencePolish,
        handleRunBatchExperiencePolish,
        floatingThinkingText,
        handleStopFloating,
    };
};
