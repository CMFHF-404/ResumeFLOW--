import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { ExperienceEditDraft, ResumeExperienceView } from '../../../types/resume';
import { buildExperienceEditDraft } from '../helpers';
import type { SmartCompletionPromptState } from '../smartCompletionUtils';

export type FloatingExperiencePolishSessionItem = {
    targetId: string;
    beforeDraft: ExperienceEditDraft;
    afterDraft: ExperienceEditDraft;
    beforeItem: ResumeExperienceView;
    afterItem: ResumeExperienceView;
    wasSelected: boolean;
};

export type FloatingExperiencePolishSession = {
    mode: 'single' | 'batch';
    items: FloatingExperiencePolishSessionItem[];
    failedIds: string[];
};

type UseFloatingExperiencePolishSessionParams = {
    editingExperienceId: string | null;
    experienceItems: ResumeExperienceView[];
    selectedExpIds: Set<string>;
    setExperienceItems: Dispatch<SetStateAction<ResumeExperienceView[]>>;
    setSelectedExpIds: Dispatch<SetStateAction<Set<string>>>;
    setSidebarTab: Dispatch<SetStateAction<'profile' | 'experience'>>;
    showToastError: (message: string) => void;
    buildExperienceViewFromDraft: (
        baseItem: ResumeExperienceView,
        draft: ExperienceEditDraft
    ) => ResumeExperienceView;
};

export const useFloatingExperiencePolishSession = ({
    editingExperienceId,
    experienceItems,
    selectedExpIds,
    setExperienceItems,
    setSelectedExpIds,
    setSidebarTab,
    showToastError,
    buildExperienceViewFromDraft,
}: UseFloatingExperiencePolishSessionParams) => {
    const [activeFloatingPolishExperienceId, setActiveFloatingPolishExperienceId] = useState<string | null>(null);
    const [isBatchPolishToolbarOpen, setIsBatchPolishToolbarOpen] = useState(false);
    const [floatingSmartCompletionPrompt, setFloatingSmartCompletionPrompt] = useState<SmartCompletionPromptState | null>(null);
    const [floatingPolishSession, setFloatingPolishSession] = useState<FloatingExperiencePolishSession | null>(null);
    const [isFloatingExperiencePolishRunning, setIsFloatingExperiencePolishRunning] = useState(false);
    const floatingExperiencePolishRunningRef = useRef(false);

    const singleFloatingPolishPreview = useMemo(
        () => floatingPolishSession?.mode === 'single'
            ? floatingPolishSession.items[0] ?? null
            : null,
        [floatingPolishSession]
    );
    const batchFloatingPolishPreview = useMemo(
        () => floatingPolishSession?.mode === 'batch'
            ? floatingPolishSession
            : null,
        [floatingPolishSession]
    );

    useEffect(() => {
        if (!editingExperienceId || floatingPolishSession) {
            return;
        }
        setActiveFloatingPolishExperienceId(null);
    }, [editingExperienceId, floatingPolishSession]);

    useEffect(() => {
        if (!activeFloatingPolishExperienceId) {
            return;
        }
        const targetExists = experienceItems.some((item) => item.id === activeFloatingPolishExperienceId);
        if (!targetExists) {
            setActiveFloatingPolishExperienceId(null);
            setFloatingSmartCompletionPrompt(null);
            setFloatingPolishSession((prev) => {
                if (!prev || prev.mode !== 'single') {
                    return prev;
                }
                return prev.items.some((item) => item.targetId === activeFloatingPolishExperienceId) ? null : prev;
            });
            floatingExperiencePolishRunningRef.current = false;
            setIsFloatingExperiencePolishRunning(false);
        }
    }, [activeFloatingPolishExperienceId, experienceItems]);

    const buildFloatingPolishSessionItem = useCallback((
        baseItem: ResumeExperienceView,
        nextDraft: ExperienceEditDraft,
        beforeDraft?: ExperienceEditDraft
    ): FloatingExperiencePolishSessionItem | null => {
        const previousDraft = beforeDraft ?? buildExperienceEditDraft(baseItem);
        const nextItem = buildExperienceViewFromDraft(baseItem, nextDraft);
        const hasChange = (
            nextItem.title !== baseItem.title
            || nextItem.company !== baseItem.company
            || nextItem.startDate !== baseItem.startDate
            || nextItem.endDate !== baseItem.endDate
            || nextItem.isCurrent !== baseItem.isCurrent
            || nextItem.star.s !== baseItem.star.s
            || nextItem.star.t !== baseItem.star.t
            || nextItem.star.a !== baseItem.star.a
            || nextItem.star.r !== baseItem.star.r
        );
        if (!hasChange) {
            return null;
        }

        return {
            targetId: baseItem.id,
            beforeDraft: previousDraft,
            afterDraft: nextDraft,
            beforeItem: baseItem,
            afterItem: nextItem,
            wasSelected: selectedExpIds.has(baseItem.id),
        };
    }, [
        buildExperienceViewFromDraft,
        selectedExpIds,
    ]);

    const applyFloatingPolishSessionItems = useCallback((items: FloatingExperiencePolishSessionItem[]) => {
        if (!items.length) {
            return;
        }
        const nextItemMap = new Map(items.map((item) => [item.targetId, item.afterItem]));
        setExperienceItems((prev) =>
            prev.map((item) => nextItemMap.get(item.id) ?? item)
        );
        setSelectedExpIds((prev) => {
            const next = new Set(prev);
            items.forEach((item) => {
                next.add(item.targetId);
            });
            return next;
        });
    }, [setExperienceItems, setSelectedExpIds]);

    const restoreFloatingPolishSessionItems = useCallback((session: FloatingExperiencePolishSession) => {
        const previousItemMap = new Map(session.items.map((item) => [item.targetId, item.beforeItem]));
        setExperienceItems((prev) =>
            prev.map((item) => previousItemMap.get(item.id) ?? item)
        );
        setSelectedExpIds((prev) => {
            const next = new Set(prev);
            session.items.forEach((item) => {
                if (item.wasSelected) {
                    next.add(item.targetId);
                } else {
                    next.delete(item.targetId);
                }
            });
            return next;
        });
    }, [setExperienceItems, setSelectedExpIds]);

    const applyFloatingPolishPreview = useCallback((
        mode: FloatingExperiencePolishSession['mode'],
        items: FloatingExperiencePolishSessionItem[],
        failedIds: string[] = []
    ) => {
        if (!items.length) {
            return false;
        }
        applyFloatingPolishSessionItems(items);
        setFloatingPolishSession({ mode, items, failedIds });
        if (mode === 'single') {
            setActiveFloatingPolishExperienceId(items[0]?.targetId ?? null);
            setIsBatchPolishToolbarOpen(false);
        } else {
            setActiveFloatingPolishExperienceId(null);
            setIsBatchPolishToolbarOpen(true);
        }
        return true;
    }, [applyFloatingPolishSessionItems]);

    const handleCloseFloatingPolishToolbar = useCallback(() => {
        if (isFloatingExperiencePolishRunning) {
            showToastError('请等待当前润色完成后再继续操作');
            return;
        }
        setFloatingSmartCompletionPrompt(null);
        if (floatingPolishSession?.mode === 'single') {
            restoreFloatingPolishSessionItems(floatingPolishSession);
            setFloatingPolishSession(null);
            setActiveFloatingPolishExperienceId(null);
            return;
        }
        setActiveFloatingPolishExperienceId(null);
    }, [floatingPolishSession, isFloatingExperiencePolishRunning, restoreFloatingPolishSessionItems, showToastError]);

    const handleDismissFloatingPolishToolbar = useCallback(() => {
        if (isFloatingExperiencePolishRunning) {
            showToastError('请等待当前润色完成后再继续操作');
            return;
        }
        if (floatingPolishSession?.mode === 'single') {
            showToastError('请先确认或撤销当前润色结果');
            return;
        }
        setFloatingSmartCompletionPrompt(null);
        setActiveFloatingPolishExperienceId(null);
    }, [floatingPolishSession, isFloatingExperiencePolishRunning, showToastError]);

    const handleCloseBatchPolishToolbar = useCallback(() => {
        if (isFloatingExperiencePolishRunning) {
            showToastError('请等待当前润色完成后再继续操作');
            return;
        }
        setFloatingSmartCompletionPrompt(null);
        if (floatingPolishSession?.mode === 'batch') {
            restoreFloatingPolishSessionItems(floatingPolishSession);
            setFloatingPolishSession(null);
        }
        setIsBatchPolishToolbarOpen(false);
    }, [floatingPolishSession, isFloatingExperiencePolishRunning, restoreFloatingPolishSessionItems, showToastError]);

    const handleDismissBatchPolishToolbar = useCallback(() => {
        if (isFloatingExperiencePolishRunning) {
            showToastError('请等待当前润色完成后再继续操作');
            return;
        }
        if (floatingPolishSession?.mode === 'batch') {
            showToastError('请先确认或撤销当前批量润色结果');
            return;
        }
        setFloatingSmartCompletionPrompt(null);
        setIsBatchPolishToolbarOpen(false);
    }, [floatingPolishSession, isFloatingExperiencePolishRunning, showToastError]);

    const handlePolishExperienceFromCard = useCallback((id: string) => {
        if (isFloatingExperiencePolishRunning) {
            showToastError('请等待当前润色完成后再继续操作');
            return;
        }
        if (floatingPolishSession) {
            const isSameSingleTarget = floatingPolishSession.mode === 'single'
                && floatingPolishSession.items[0]?.targetId === id;
            if (!isSameSingleTarget) {
                showToastError('请先确认或撤销当前润色结果');
                return;
            }
        }
        if (isBatchPolishToolbarOpen) {
            showToastError('请先关闭当前批量润色弹窗');
            return;
        }
        setSidebarTab('experience');
        setFloatingSmartCompletionPrompt(null);
        setActiveFloatingPolishExperienceId((prev) => (
            prev === id && !singleFloatingPolishPreview ? null : id
        ));
    }, [
        floatingPolishSession,
        isBatchPolishToolbarOpen,
        isFloatingExperiencePolishRunning,
        setSidebarTab,
        showToastError,
        singleFloatingPolishPreview,
    ]);

    return {
        activeFloatingPolishExperienceId,
        setActiveFloatingPolishExperienceId,
        isBatchPolishToolbarOpen,
        setIsBatchPolishToolbarOpen,
        floatingSmartCompletionPrompt,
        setFloatingSmartCompletionPrompt,
        floatingPolishSession,
        setFloatingPolishSession,
        isFloatingExperiencePolishRunning,
        setIsFloatingExperiencePolishRunning,
        floatingExperiencePolishRunningRef,
        singleFloatingPolishPreview,
        batchFloatingPolishPreview,
        buildFloatingPolishSessionItem,
        applyFloatingPolishPreview,
        restoreFloatingPolishSessionItems,
        handleCloseFloatingPolishToolbar,
        handleDismissFloatingPolishToolbar,
        handleCloseBatchPolishToolbar,
        handleDismissBatchPolishToolbar,
        handlePolishExperienceFromCard,
    };
};
