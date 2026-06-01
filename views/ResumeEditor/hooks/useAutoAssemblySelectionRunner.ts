import { useCallback, type MutableRefObject } from 'react';
import type {
    LayoutSnapshot,
    SmartPageLayout,
} from '../layoutUtils';
import type {
    AutoAssemblySelection,
    ManualSelectionSnapshot,
} from '../autoAssemblyUtils';

type SmartPageExecutionResult =
    | ({ status: 'fit' } & SmartPageLayout)
    | ({ status: 'overflow' } & SmartPageLayout)
    | { status: 'skipped'; reason: 'busy' | 'unavailable' };

export type AutoAssemblyStateSnapshot = {
    selection: ManualSelectionSnapshot;
    layout: LayoutSnapshot;
};

export type AutoAssemblyExecutionResult = {
    result: SmartPageExecutionResult;
    finalSelection: ManualSelectionSnapshot | null;
};

type AutoAssemblySelectionPayload = Pick<
    AutoAssemblySelection,
    'experienceIds' | 'certificationIds' | 'skillIds'
>;

type UseAutoAssemblySelectionRunnerParams = {
    latestResumeIdRef: MutableRefObject<string | null | undefined>;
    manualSelectionVersionRef: MutableRefObject<number>;
    manualLayoutVersionRef: MutableRefObject<number>;
    manualSelectionSnapshotRef: MutableRefObject<ManualSelectionSnapshot>;
    manualLayoutSnapshotRef: MutableRefObject<LayoutSnapshot>;
    smartPageAdjustingRef: MutableRefObject<boolean>;
    applyAssemblySelection: (selection: AutoAssemblySelectionPayload) => Promise<void>;
    applyLayoutSnapshot: (snapshot: LayoutSnapshot) => Promise<void>;
    waitForSmartPageIdle: () => Promise<void>;
    executeSmartPageAdjustment: () => Promise<SmartPageExecutionResult>;
    fallbackLayout: SmartPageLayout;
};

export const useAutoAssemblySelectionRunner = ({
    latestResumeIdRef,
    manualSelectionVersionRef,
    manualLayoutVersionRef,
    manualSelectionSnapshotRef,
    manualLayoutSnapshotRef,
    smartPageAdjustingRef,
    applyAssemblySelection,
    applyLayoutSnapshot,
    waitForSmartPageIdle,
    executeSmartPageAdjustment,
    fallbackLayout,
}: UseAutoAssemblySelectionRunnerParams) => useCallback(async (
    selection: AutoAssemblySelection,
    requestedResumeId: string | null,
    requestedSelectionVersion: number,
    requestedLayoutVersion: number,
    initialStateSnapshot: AutoAssemblyStateSnapshot
): Promise<AutoAssemblyExecutionResult> => {
    const isResumeRequestCurrent = () => latestResumeIdRef.current === requestedResumeId;
    const isSelectionVersionCurrent = () => (
        manualSelectionVersionRef.current === requestedSelectionVersion
    );
    const isLayoutVersionCurrent = () => (
        manualLayoutVersionRef.current === requestedLayoutVersion
    );
    const isAssemblyStateCurrent = () => (
        isResumeRequestCurrent()
        && isSelectionVersionCurrent()
        && isLayoutVersionCurrent()
    );
    const currentSelection = {
        experienceIds: [...selection.experienceIds],
        certificationIds: [...selection.certificationIds],
        skillIds: [...selection.skillIds],
    };
    const restoreInitialState = async () => {
        if (!isResumeRequestCurrent()) {
            return;
        }
        await applyAssemblySelection(initialStateSnapshot.selection);
        await applyLayoutSnapshot(initialStateSnapshot.layout);
    };
    const restoreInitialSelection = async () => {
        if (!isResumeRequestCurrent()) {
            return;
        }
        await applyAssemblySelection(initialStateSnapshot.selection);
    };
    const restoreLatestManualState = async () => {
        if (!isResumeRequestCurrent()) {
            return;
        }
        await applyAssemblySelection(manualSelectionSnapshotRef.current);
        await applyLayoutSnapshot(manualLayoutSnapshotRef.current);
    };
    const restoreStateAfterBusySkip = async () => {
        await waitForSmartPageIdle();
        if (!isResumeRequestCurrent()) {
            return;
        }
        if (!isSelectionVersionCurrent()) {
            await restoreLatestManualState();
            return;
        }
        await restoreInitialSelection();
    };
    const applySelectionAndMeasure = async (
        nextSelection: AutoAssemblySelectionPayload
    ): Promise<SmartPageExecutionResult> => {
        if (!isResumeRequestCurrent()) {
            return { status: 'skipped', reason: 'busy' };
        }
        if (!isAssemblyStateCurrent()) {
            await restoreLatestManualState();
            return { status: 'skipped', reason: 'busy' };
        }
        if (smartPageAdjustingRef.current) {
            await restoreStateAfterBusySkip();
            return { status: 'skipped', reason: 'busy' };
        }
        await applyAssemblySelection(nextSelection);
        const result = await executeSmartPageAdjustment();
        if (!isAssemblyStateCurrent()) {
            await restoreLatestManualState();
            return { status: 'skipped', reason: 'busy' };
        }
        if (result.status === 'skipped') {
            if (result.reason === 'busy') {
                await restoreStateAfterBusySkip();
                return result;
            }
            await restoreInitialState();
        }
        return result;
    };
    const removeNext = async (
        ids: string[],
        target: 'experienceIds' | 'certificationIds' | 'skillIds'
    ) => {
        const minRemaining = target === 'experienceIds' ? 1 : 0;
        for (const id of ids) {
            if (!isResumeRequestCurrent()) {
                return { status: 'skipped', reason: 'busy' } as const;
            }
            if (!isAssemblyStateCurrent()) {
                await restoreLatestManualState();
                return { status: 'skipped', reason: 'busy' } as const;
            }
            if (currentSelection[target].length <= minRemaining) {
                return null;
            }
            currentSelection[target] = currentSelection[target].filter((itemId) => itemId !== id);
            const result = await applySelectionAndMeasure(currentSelection);
            if (result.status === 'fit' || result.status === 'skipped') {
                return result;
            }
        }
        return null;
    };

    let lastOverflowResult: Extract<SmartPageExecutionResult, { status: 'overflow' }> | null = null;
    const initialResult = await applySelectionAndMeasure(currentSelection);
    if (initialResult.status === 'fit' || initialResult.status === 'skipped') {
        return {
            result: initialResult,
            finalSelection: initialResult.status === 'skipped' ? null : { ...currentSelection },
        };
    }
    lastOverflowResult = initialResult;
    const skillResult = await removeNext(selection.skillRemovalQueue, 'skillIds');
    if (skillResult) {
        return {
            result: skillResult,
            finalSelection: skillResult.status === 'skipped' ? null : { ...currentSelection },
        };
    }
    const certificationResult = await removeNext(
        selection.certificationRemovalQueue,
        'certificationIds'
    );
    if (certificationResult) {
        return {
            result: certificationResult,
            finalSelection: certificationResult.status === 'skipped' ? null : { ...currentSelection },
        };
    }
    const experienceResult = await removeNext(selection.experienceRemovalQueue, 'experienceIds');
    if (experienceResult) {
        return {
            result: experienceResult,
            finalSelection: experienceResult.status === 'skipped' ? null : { ...currentSelection },
        };
    }
    return {
        result: lastOverflowResult ?? {
            status: 'overflow',
            ...fallbackLayout,
        },
        finalSelection: { ...currentSelection },
    };
}, [
    applyAssemblySelection,
    applyLayoutSnapshot,
    executeSmartPageAdjustment,
    fallbackLayout,
    latestResumeIdRef,
    manualLayoutSnapshotRef,
    manualLayoutVersionRef,
    manualSelectionSnapshotRef,
    manualSelectionVersionRef,
    smartPageAdjustingRef,
    waitForSmartPageIdle,
]);
