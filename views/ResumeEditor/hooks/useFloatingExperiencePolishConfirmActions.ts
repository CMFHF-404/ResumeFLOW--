import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { ToastConfig } from '../../../components/Toast';
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
    resumeId: string | null;
    singleFloatingPolishPreview: FloatingExperiencePolishSessionItem | null;
    batchFloatingPolishPreview: FloatingExperiencePolishSession | null;
    floatingExperiencePolishRunningRef: MutableRefObject<boolean>;
    setIsFloatingExperiencePolishRunning: Dispatch<SetStateAction<boolean>>;
    ensureFloatingPolishResumeLinks: (
        items: FloatingExperiencePolishSessionItem[]
    ) => Promise<EnsureResumeLinksResult>;
    rollbackFloatingPolishResumeLinks: (linkIds: string[]) => Promise<void>;
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
};

export const useFloatingExperiencePolishConfirmActions = ({
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
}: UseFloatingExperiencePolishConfirmActionsParams) => {
    const handleConfirmFloatingExperiencePolish = useCallback(async () => {
        if (!singleFloatingPolishPreview || floatingExperiencePolishRunningRef.current || !resumeId) {
            return;
        }

        const toastId = showToastLoading('正在保存润色结果...');
        let addedLinkIds: string[] = [];
        try {
            floatingExperiencePolishRunningRef.current = true;
            setIsFloatingExperiencePolishRunning(true);
            const targetId = singleFloatingPolishPreview.targetId;
            const { nextMap: workingResumeMap, addedLinkIds: createdLinkIds } = await ensureFloatingPolishResumeLinks([
                singleFloatingPolishPreview,
            ]);
            addedLinkIds = createdLinkIds;
            const operation = buildExperiencePolishOverrideOperation(singleFloatingPolishPreview, workingResumeMap);
            const detail = await resumeService.updateAssembly(resumeId, {
                operations: [operation],
            });
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
        } catch (error) {
            console.error('[ResumeEditor] 保存浮动润色结果失败:', error);
            if (addedLinkIds.length > 0) {
                try {
                    await rollbackFloatingPolishResumeLinks(addedLinkIds);
                } catch (rollbackError) {
                    console.error('[ResumeEditor] 回滚浮动润色关联失败:', rollbackError);
                }
            }
            updateToast(toastId, { message: '保存润色结果失败，请稍后重试', type: 'error', duration: 3000 });
        } finally {
            floatingExperiencePolishRunningRef.current = false;
            setIsFloatingExperiencePolishRunning(false);
        }
    }, [
        applyResumeDetail,
        buildExperiencePolishOverrideOperation,
        ensureFloatingPolishResumeLinks,
        floatingExperiencePolishRunningRef,
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

        const toastId = showToastLoading('正在保存批量润色结果...');
        let addedLinkIds: string[] = [];
        try {
            floatingExperiencePolishRunningRef.current = true;
            setIsFloatingExperiencePolishRunning(true);
            const { nextMap: workingResumeMap, addedLinkIds: createdLinkIds } = await ensureFloatingPolishResumeLinks(
                batchFloatingPolishPreview.items
            );
            addedLinkIds = createdLinkIds;
            const operations = [];
            for (const item of batchFloatingPolishPreview.items) {
                operations.push(buildExperiencePolishOverrideOperation(item, workingResumeMap));
            }
            const detail = await resumeService.updateAssembly(resumeId, { operations });
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
        } catch (error) {
            console.error('[ResumeEditor] 保存批量润色结果失败:', error);
            if (addedLinkIds.length > 0) {
                try {
                    await rollbackFloatingPolishResumeLinks(addedLinkIds);
                } catch (rollbackError) {
                    console.error('[ResumeEditor] 回滚批量润色关联失败:', rollbackError);
                }
            }
            updateToast(toastId, { message: '保存批量润色结果失败，请稍后重试', type: 'error', duration: 3000 });
        } finally {
            floatingExperiencePolishRunningRef.current = false;
            setIsFloatingExperiencePolishRunning(false);
        }
    }, [
        applyResumeDetail,
        batchFloatingPolishPreview,
        buildExperiencePolishOverrideOperation,
        ensureFloatingPolishResumeLinks,
        floatingExperiencePolishRunningRef,
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
