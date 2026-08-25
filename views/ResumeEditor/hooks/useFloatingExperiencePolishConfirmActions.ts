import {
    useCallback,
    useLayoutEffect,
    useRef,
    type Dispatch,
    type MutableRefObject,
    type SetStateAction,
} from 'react';
import type { ToastConfig } from '../../../components/Toast';
import { useAuthOwnerOperationGuard } from '../../../hooks/useAuthOwnerOperationGuard';
import { isAuthContextChangedError } from '../../../services/apiClient';
import {
    resumeService,
    type ResumeDetail,
    type ResumeExperienceItem,
} from '../../../services/resumeService';
import { trackAiPolishApplied } from '../../../utils/analyticsTracker';
import { buildResumeExperienceMap } from '../helpers';
import type {
    FloatingExperiencePolishSession,
    FloatingExperiencePolishSessionItem,
} from './useFloatingExperiencePolishSession';

type UpdateToast = (id: string, updates: Partial<Omit<ToastConfig, 'id'>>) => void;
type EnsureResumeLinksResult = {
    nextMap: Map<string, ResumeExperienceItem>;
    addedLinkIds: string[];
};
type AssemblyOperation = {
    op: string;
    resume_experience_id: string;
    overrides_json: Record<string, unknown>;
};

type UseFloatingExperiencePolishConfirmActionsParams = {
    authUserKey: string | null;
    resumeId: string | null;
    singleFloatingPolishPreview: FloatingExperiencePolishSessionItem | null;
    batchFloatingPolishPreview: FloatingExperiencePolishSession | null;
    floatingExperiencePolishRunningRef: MutableRefObject<boolean>;
    setIsFloatingExperiencePolishRunning: Dispatch<SetStateAction<boolean>>;
    ensureFloatingPolishResumeLinks: (
        items: FloatingExperiencePolishSessionItem[],
        options?: { expectedAuthCacheKey: string },
    ) => Promise<EnsureResumeLinksResult>;
    rollbackFloatingPolishResumeLinks: (
        linkIds: string[],
        options?: { expectedAuthCacheKey: string },
    ) => Promise<void>;
    buildExperiencePolishOverrideOperation: (
        item: FloatingExperiencePolishSessionItem,
        linkMap?: Map<string, ResumeExperienceItem>
    ) => AssemblyOperation;
    applyResumeDetail: (detail: ResumeDetail | null) => void;
    setResumeExperienceMap: (nextMap: Map<string, ResumeExperienceItem>) => void;
    setSelectedExpIds: Dispatch<SetStateAction<Set<string>>>;
    setFloatingPolishSession: Dispatch<SetStateAction<FloatingExperiencePolishSession | null>>;
    setActiveFloatingPolishExperienceId: Dispatch<SetStateAction<string | null>>;
    setIsBatchPolishToolbarOpen: Dispatch<SetStateAction<boolean>>;
    setPendingPolishAutoAnalyzeSeq: Dispatch<SetStateAction<number>>;
    showToastLoading: (message: string) => string;
    updateToast: UpdateToast;
    closeToast: (id: string) => void;
};

export const useFloatingExperiencePolishConfirmActions = ({
    authUserKey,
    resumeId,
    singleFloatingPolishPreview,
    batchFloatingPolishPreview,
    floatingExperiencePolishRunningRef,
    setIsFloatingExperiencePolishRunning,
    ensureFloatingPolishResumeLinks,
    rollbackFloatingPolishResumeLinks,
    buildExperiencePolishOverrideOperation,
    applyResumeDetail,
    setResumeExperienceMap,
    setSelectedExpIds,
    setFloatingPolishSession,
    setActiveFloatingPolishExperienceId,
    setIsBatchPolishToolbarOpen,
    setPendingPolishAutoAnalyzeSeq,
    showToastLoading,
    updateToast,
    closeToast,
}: UseFloatingExperiencePolishConfirmActionsParams) => {
    const ownerGuard = useAuthOwnerOperationGuard(authUserKey);
    const activeRequestRef = useRef<symbol | null>(null);
    const loadingToastRef = useRef<string | null>(null);

    useLayoutEffect(() => {
        activeRequestRef.current = null;
        floatingExperiencePolishRunningRef.current = false;
        setIsFloatingExperiencePolishRunning(false);
        if (loadingToastRef.current) {
            closeToast(loadingToastRef.current);
            loadingToastRef.current = null;
        }
    }, [authUserKey, closeToast, floatingExperiencePolishRunningRef, setIsFloatingExperiencePolishRunning]);

    const handleConfirmFloatingExperiencePolish = useCallback(async () => {
        if (!singleFloatingPolishPreview || floatingExperiencePolishRunningRef.current || !resumeId) {
            return;
        }

        const requestId = Symbol('confirm-floating-polish');
        activeRequestRef.current = requestId;
        floatingExperiencePolishRunningRef.current = true;
        setIsFloatingExperiencePolishRunning(true);
        let operation: Awaited<ReturnType<typeof ownerGuard.beginOperation>> | null = null;
        let toastId: string | null = null;
        let addedLinkIds: string[] = [];
        try {
            operation = await ownerGuard.beginOperation();
            if (activeRequestRef.current !== requestId) {
                return;
            }
            toastId = showToastLoading('正在保存润色结果...');
            loadingToastRef.current = toastId;
            const targetId = singleFloatingPolishPreview.targetId;
            const { nextMap: workingResumeMap, addedLinkIds: createdLinkIds } = await ensureFloatingPolishResumeLinks([
                singleFloatingPolishPreview,
            ], { expectedAuthCacheKey: operation.expectedAuthCacheKey });
            await ownerGuard.assertOperationCurrent(operation);
            addedLinkIds = createdLinkIds;
            const assemblyOperation = buildExperiencePolishOverrideOperation(singleFloatingPolishPreview, workingResumeMap);
            const detail = await resumeService.updateAssembly(resumeId, {
                operations: [assemblyOperation],
            }, { expectedAuthCacheKey: operation.expectedAuthCacheKey });
            await ownerGuard.assertOperationCurrent(operation);
            const nextMap = buildResumeExperienceMap(detail);
            applyResumeDetail(detail);
            setResumeExperienceMap(nextMap);
            setSelectedExpIds((prev) => {
                const next = new Set(prev);
                next.add(targetId);
                return next;
            });
            setFloatingPolishSession(null);
            setActiveFloatingPolishExperienceId(null);
            setPendingPolishAutoAnalyzeSeq((current) => current + 1);
            trackAiPolishApplied({ source: 'resume_editor', field: 'all' });
            updateToast(toastId, { message: '润色结果已保存到当前简历', type: 'success', duration: 2500 });
            loadingToastRef.current = null;
        } catch (error) {
            const ownerChanged = isAuthContextChangedError(error)
                || !operation
                || !ownerGuard.isOperationCurrent(operation)
                || activeRequestRef.current !== requestId;
            if (!ownerChanged) {
                console.error('[ResumeEditor] 保存浮动润色结果失败:', error);
            }
            if (!ownerChanged && operation && addedLinkIds.length > 0) {
                try {
                    await rollbackFloatingPolishResumeLinks(addedLinkIds, {
                        expectedAuthCacheKey: operation.expectedAuthCacheKey,
                    });
                    await ownerGuard.assertOperationCurrent(operation);
                } catch (rollbackError) {
                    if (!isAuthContextChangedError(rollbackError)) {
                        console.error('[ResumeEditor] 回滚浮动润色关联失败:', rollbackError);
                    }
                }
            }
            if (toastId && operation && !ownerChanged && ownerGuard.isOperationCurrent(operation)) {
                updateToast(toastId, { message: '保存润色结果失败，请稍后重试', type: 'error', duration: 3000 });
                loadingToastRef.current = null;
            } else if (toastId && loadingToastRef.current === toastId) {
                closeToast(toastId);
                loadingToastRef.current = null;
            }
        } finally {
            if (activeRequestRef.current === requestId) {
                activeRequestRef.current = null;
                floatingExperiencePolishRunningRef.current = false;
                setIsFloatingExperiencePolishRunning(false);
            }
        }
    }, [
        applyResumeDetail,
        closeToast,
        buildExperiencePolishOverrideOperation,
        ensureFloatingPolishResumeLinks,
        floatingExperiencePolishRunningRef,
        ownerGuard,
        resumeId,
        rollbackFloatingPolishResumeLinks,
        setActiveFloatingPolishExperienceId,
        setFloatingPolishSession,
        setIsFloatingExperiencePolishRunning,
        setPendingPolishAutoAnalyzeSeq,
        setResumeExperienceMap,
        setSelectedExpIds,
        showToastLoading,
        singleFloatingPolishPreview,
        updateToast,
    ]);

    const handleConfirmBatchExperiencePolish = useCallback(async () => {
        if (!batchFloatingPolishPreview || floatingExperiencePolishRunningRef.current || !resumeId) {
            return;
        }

        const requestId = Symbol('confirm-batch-polish');
        activeRequestRef.current = requestId;
        floatingExperiencePolishRunningRef.current = true;
        setIsFloatingExperiencePolishRunning(true);
        let operation: Awaited<ReturnType<typeof ownerGuard.beginOperation>> | null = null;
        let toastId: string | null = null;
        let addedLinkIds: string[] = [];
        try {
            operation = await ownerGuard.beginOperation();
            if (activeRequestRef.current !== requestId) {
                return;
            }
            toastId = showToastLoading('正在保存批量润色结果...');
            loadingToastRef.current = toastId;
            const { nextMap: workingResumeMap, addedLinkIds: createdLinkIds } = await ensureFloatingPolishResumeLinks(
                batchFloatingPolishPreview.items,
                { expectedAuthCacheKey: operation.expectedAuthCacheKey },
            );
            await ownerGuard.assertOperationCurrent(operation);
            addedLinkIds = createdLinkIds;
            const operations = [];
            for (const item of batchFloatingPolishPreview.items) {
                operations.push(buildExperiencePolishOverrideOperation(item, workingResumeMap));
            }
            const detail = await resumeService.updateAssembly(
                resumeId,
                { operations },
                { expectedAuthCacheKey: operation.expectedAuthCacheKey },
            );
            await ownerGuard.assertOperationCurrent(operation);
            const nextMap = buildResumeExperienceMap(detail);
            applyResumeDetail(detail);
            setResumeExperienceMap(nextMap);
            setFloatingPolishSession(null);
            setIsBatchPolishToolbarOpen(false);
            setPendingPolishAutoAnalyzeSeq((current) => current + 1);
            trackAiPolishApplied({ source: 'resume_editor', field: 'all' });
            updateToast(toastId, {
                message: batchFloatingPolishPreview.failedIds.length > 0
                    ? `批量润色已保存 ${batchFloatingPolishPreview.items.length} 条可用结果`
                    : '批量润色结果已保存到当前简历',
                type: 'success',
                duration: 2500,
            });
            loadingToastRef.current = null;
        } catch (error) {
            const ownerChanged = isAuthContextChangedError(error)
                || !operation
                || !ownerGuard.isOperationCurrent(operation)
                || activeRequestRef.current !== requestId;
            if (!ownerChanged) {
                console.error('[ResumeEditor] 保存批量润色结果失败:', error);
            }
            if (!ownerChanged && operation && addedLinkIds.length > 0) {
                try {
                    await rollbackFloatingPolishResumeLinks(addedLinkIds, {
                        expectedAuthCacheKey: operation.expectedAuthCacheKey,
                    });
                    await ownerGuard.assertOperationCurrent(operation);
                } catch (rollbackError) {
                    if (!isAuthContextChangedError(rollbackError)) {
                        console.error('[ResumeEditor] 回滚批量润色关联失败:', rollbackError);
                    }
                }
            }
            if (toastId && operation && !ownerChanged && ownerGuard.isOperationCurrent(operation)) {
                updateToast(toastId, { message: '保存批量润色结果失败，请稍后重试', type: 'error', duration: 3000 });
                loadingToastRef.current = null;
            } else if (toastId && loadingToastRef.current === toastId) {
                closeToast(toastId);
                loadingToastRef.current = null;
            }
        } finally {
            if (activeRequestRef.current === requestId) {
                activeRequestRef.current = null;
                floatingExperiencePolishRunningRef.current = false;
                setIsFloatingExperiencePolishRunning(false);
            }
        }
    }, [
        applyResumeDetail,
        batchFloatingPolishPreview,
        buildExperiencePolishOverrideOperation,
        closeToast,
        ensureFloatingPolishResumeLinks,
        floatingExperiencePolishRunningRef,
        ownerGuard,
        resumeId,
        rollbackFloatingPolishResumeLinks,
        setFloatingPolishSession,
        setIsBatchPolishToolbarOpen,
        setIsFloatingExperiencePolishRunning,
        setPendingPolishAutoAnalyzeSeq,
        setResumeExperienceMap,
        showToastLoading,
        updateToast,
    ]);

    return {
        handleConfirmFloatingExperiencePolish,
        handleConfirmBatchExperiencePolish,
    };
};
