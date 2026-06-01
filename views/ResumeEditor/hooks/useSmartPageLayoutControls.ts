import { useCallback, type Dispatch, type SetStateAction } from 'react';
import {
    SMART_PAGE_TOAST_MESSAGES,
} from '../constants';
import {
    resolveNearestSectionSpacingKey,
    type LayoutSnapshot,
    type SmartPageLayout,
} from '../layoutUtils';
import { buildLayoutSnapshot } from '../autoAssemblyUtils';

type SmartPageExecutionResult =
    | ({ status: 'fit' } & SmartPageLayout)
    | ({ status: 'overflow' } & SmartPageLayout)
    | { status: 'skipped'; reason: 'busy' | 'unavailable' };

type UseSmartPageLayoutControlsParams = {
    currentLayout: SmartPageLayout;
    executeSmartPageAdjustment: (options?: { announce?: boolean }) => Promise<SmartPageExecutionResult>;
    commitLayoutSnapshot: (snapshot: LayoutSnapshot, options?: { incrementVersion?: boolean }) => void;
    applyVisibleLayout: (nextLayout: SmartPageLayout) => void;
    restoreDefaultLayout: (isApplied?: boolean) => void;
    resolveDefaultLayoutParams: (a4Height?: number) => SmartPageLayout;
    resolveA4Height: () => number | null;
    setIsSmartPageApplied: Dispatch<SetStateAction<boolean>>;
    setIsLayoutAdjustToolbarOpen: Dispatch<SetStateAction<boolean>>;
    showToastInfo: (message: string, duration?: number) => string;
    showToastSuccess: (message: string, duration?: number) => string;
    showToastError: (message: string, duration?: number) => string;
};

export const useSmartPageLayoutControls = ({
    currentLayout,
    executeSmartPageAdjustment,
    commitLayoutSnapshot,
    applyVisibleLayout,
    restoreDefaultLayout,
    resolveDefaultLayoutParams,
    resolveA4Height,
    setIsSmartPageApplied,
    setIsLayoutAdjustToolbarOpen,
    showToastInfo,
    showToastSuccess,
    showToastError,
}: UseSmartPageLayoutControlsParams) => {
    const handleAdjustToSinglePage = useCallback(async () => {
        const result = await executeSmartPageAdjustment({ announce: true });
        if (result.status === 'fit') {
            commitLayoutSnapshot(
                buildLayoutSnapshot(
                    {
                        topPaddingPx: result.topPaddingPx,
                        sectionSpacingKey: result.sectionSpacingKey,
                        itemSpacingEm: result.itemSpacingEm,
                        lineHeight: result.lineHeight,
                        fontSize: result.fontSize,
                    },
                    true
                ),
                { incrementVersion: true }
            );
            showToastSuccess(SMART_PAGE_TOAST_MESSAGES.success);
            return;
        }
        if (result.status === 'overflow') {
            commitLayoutSnapshot(
                buildLayoutSnapshot(
                    {
                        topPaddingPx: result.topPaddingPx,
                        sectionSpacingKey: result.sectionSpacingKey,
                        itemSpacingEm: result.itemSpacingEm,
                        lineHeight: result.lineHeight,
                        fontSize: result.fontSize,
                    },
                    true
                ),
                { incrementVersion: true }
            );
            showToastError(SMART_PAGE_TOAST_MESSAGES.overflow);
        }
    }, [commitLayoutSnapshot, executeSmartPageAdjustment, showToastError, showToastSuccess]);

    const applyManualLayoutChange = useCallback((
        updater: (layout: SmartPageLayout) => SmartPageLayout
    ) => {
        const nextLayout = updater(currentLayout);
        commitLayoutSnapshot(buildLayoutSnapshot(nextLayout, false), { incrementVersion: true });
        applyVisibleLayout(nextLayout);
        setIsSmartPageApplied(false);
    }, [applyVisibleLayout, commitLayoutSnapshot, currentLayout, setIsSmartPageApplied]);

    const handleToggleLayoutAdjustToolbar = useCallback(() => {
        setIsLayoutAdjustToolbarOpen((prev) => {
            if (!prev) {
                showToastInfo('进入手动调节模式');
            }
            return !prev;
        });
    }, [setIsLayoutAdjustToolbarOpen, showToastInfo]);

    const handleLineHeightChange = useCallback((value: number) => {
        applyManualLayoutChange((layout) => ({
            ...layout,
            lineHeight: Number(value.toFixed(2)),
        }));
    }, [applyManualLayoutChange]);

    const handleFontSizeChange = useCallback((value: number) => {
        applyManualLayoutChange((layout) => ({
            ...layout,
            fontSize: Number(value.toFixed(1)),
        }));
    }, [applyManualLayoutChange]);

    const handleTopPaddingChange = useCallback((value: number) => {
        applyManualLayoutChange((layout) => ({
            ...layout,
            topPaddingPx: Number(value.toFixed(2)),
        }));
    }, [applyManualLayoutChange]);

    const handleSectionSpacingChange = useCallback((value: number) => {
        applyManualLayoutChange((layout) => ({
            ...layout,
            sectionSpacingKey: resolveNearestSectionSpacingKey(value),
        }));
    }, [applyManualLayoutChange]);

    const handleItemSpacingChange = useCallback((value: number) => {
        applyManualLayoutChange((layout) => ({
            ...layout,
            itemSpacingEm: Number(value.toFixed(2)),
        }));
    }, [applyManualLayoutChange]);

    const adjustToSinglePage = useCallback(() => {
        void handleAdjustToSinglePage();
    }, [handleAdjustToSinglePage]);

    const handleRestoreDefault = useCallback(() => {
        commitLayoutSnapshot(
            buildLayoutSnapshot(
                resolveDefaultLayoutParams(resolveA4Height() ?? undefined),
                false
            ),
            { incrementVersion: true }
        );
        restoreDefaultLayout(false);
    }, [commitLayoutSnapshot, resolveA4Height, resolveDefaultLayoutParams, restoreDefaultLayout]);

    const restoreDefault = useCallback(() => {
        handleRestoreDefault();
    }, [handleRestoreDefault]);

    return {
        adjustToSinglePage,
        restoreDefault,
        handleToggleLayoutAdjustToolbar,
        handleLineHeightChange,
        handleFontSizeChange,
        handleTopPaddingChange,
        handleSectionSpacingChange,
        handleItemSpacingChange,
    };
};
