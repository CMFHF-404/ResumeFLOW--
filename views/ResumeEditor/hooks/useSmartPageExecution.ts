import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { trackSmartOnePageTriggered } from '../../../utils/analyticsTracker';
import type { ResumePrintLayoutMeasurement, SectionSpacingKey } from '../../../types/resume';
import {
    SMART_PAGE_ADJUSTING_TOAST_DURATION_MS,
    SMART_PAGE_TOAST_MESSAGES,
} from '../constants';
import { getA4PixelHeight } from '../helpers';
import type { LayoutSnapshot, SmartPageLayout } from '../layoutUtils';
import { measureResumeLayout } from '../snapshotUtils';
import {
    resolveSmartPageExpansionFit,
    resolveSmartPageShrinkFit,
} from '../smartPageExecutionUtils';

type SmartPageResult = SmartPageLayout | null;
type SmartPageExecutionResult =
    | ({ status: 'fit' } & SmartPageLayout)
    | ({ status: 'overflow' } & SmartPageLayout)
    | { status: 'skipped'; reason: 'busy' | 'unavailable' };

type UseSmartPageExecutionParams = {
    density: 'compact' | 'standard' | 'spacious';
    a4HeightRef: MutableRefObject<number | null>;
    smartPageAdjustingRef: MutableRefObject<boolean>;
    measurePreviewRef: MutableRefObject<HTMLDivElement | null>;
    measurePreviewContentRef: MutableRefObject<HTMLDivElement | null>;
    setTopPaddingPx: Dispatch<SetStateAction<number>>;
    setSectionSpacingKey: Dispatch<SetStateAction<SectionSpacingKey>>;
    setItemSpacingEm: Dispatch<SetStateAction<number>>;
    setLineHeight: Dispatch<SetStateAction<number>>;
    setFontSize: Dispatch<SetStateAction<number>>;
    setMeasureLayout: Dispatch<SetStateAction<SmartPageLayout>>;
    setIsSmartPageApplied: Dispatch<SetStateAction<boolean>>;
    setIsAutoSavePaused: Dispatch<SetStateAction<boolean>>;
    buildDefaultSmartPageLayout: (
        density: 'compact' | 'standard' | 'spacious',
        a4Height?: number
    ) => SmartPageLayout;
    showToastInfo: (message: string, duration?: number) => string;
};

export const useSmartPageExecution = ({
    density,
    a4HeightRef,
    smartPageAdjustingRef,
    measurePreviewRef,
    measurePreviewContentRef,
    setTopPaddingPx,
    setSectionSpacingKey,
    setItemSpacingEm,
    setLineHeight,
    setFontSize,
    setMeasureLayout,
    setIsSmartPageApplied,
    setIsAutoSavePaused,
    buildDefaultSmartPageLayout,
    showToastInfo,
}: UseSmartPageExecutionParams) => {
    const resolveA4Height = useCallback(() => {
        if (!a4HeightRef.current) {
            a4HeightRef.current = getA4PixelHeight();
        }
        return a4HeightRef.current;
    }, [a4HeightRef]);

    const waitForPreviewUpdate = useCallback((frames = 1) => new Promise<void>((resolve) => {
        const tick = (remaining: number) => {
            requestAnimationFrame(() => {
                if (remaining <= 1) {
                    resolve();
                    return;
                }
                tick(remaining - 1);
            });
        };
        tick(frames);
    }), []);

    const waitForSmartPageIdle = useCallback(() => new Promise<void>((resolve) => {
        const tick = () => {
            if (!smartPageAdjustingRef.current) {
                resolve();
                return;
            }
            requestAnimationFrame(tick);
        };
        tick();
    }), [smartPageAdjustingRef]);

    const resolveDefaultLayoutParams = useCallback((
        a4Height?: number,
        densityOverride: 'compact' | 'standard' | 'spacious' = density
    ): SmartPageLayout => buildDefaultSmartPageLayout(densityOverride, a4Height), [
        buildDefaultSmartPageLayout,
        density,
    ]);

    const applyVisibleLayout = useCallback((nextLayout: SmartPageLayout) => {
        setTopPaddingPx(nextLayout.topPaddingPx);
        setSectionSpacingKey(nextLayout.sectionSpacingKey);
        setItemSpacingEm(nextLayout.itemSpacingEm);
        setLineHeight(nextLayout.lineHeight);
        setFontSize(nextLayout.fontSize);
        setMeasureLayout(nextLayout);
    }, [
        setFontSize,
        setItemSpacingEm,
        setLineHeight,
        setMeasureLayout,
        setSectionSpacingKey,
        setTopPaddingPx,
    ]);

    const restoreDefaultLayout = useCallback((isApplied = false) => {
        const defaultLayout = resolveDefaultLayoutParams(resolveA4Height() ?? undefined);
        applyVisibleLayout(defaultLayout);
        setIsSmartPageApplied(isApplied);
    }, [applyVisibleLayout, resolveA4Height, resolveDefaultLayoutParams, setIsSmartPageApplied]);

    const applyLayoutSnapshot = useCallback(async (snapshot: LayoutSnapshot) => {
        applyVisibleLayout(snapshot);
        setIsSmartPageApplied(snapshot.isSmartPageApplied);
        await waitForPreviewUpdate(2);
    }, [applyVisibleLayout, setIsSmartPageApplied, waitForPreviewUpdate]);

    const measureContentLayout = useCallback(() => measureResumeLayout(
        measurePreviewRef.current,
        measurePreviewContentRef.current
    ), [measurePreviewContentRef, measurePreviewRef]);

    const applyMeasureLayoutAndMeasure = useCallback(async (nextLayout: SmartPageLayout) => {
        setMeasureLayout(nextLayout);
        await waitForPreviewUpdate(2);
        return measureContentLayout();
    }, [measureContentLayout, setMeasureLayout, waitForPreviewUpdate]);

    const tryMeasureLayout = useCallback(async (
        _a4Height: number,
        nextLayout: SmartPageLayout
    ): Promise<SmartPageResult> => {
        const measurement: ResumePrintLayoutMeasurement | null = await applyMeasureLayoutAndMeasure(nextLayout);
        if (measurement?.fits) {
            return nextLayout;
        }
        return null;
    }, [applyMeasureLayoutAndMeasure]);

    const executeSmartPageAdjustment = useCallback(async (
        options?: { announce?: boolean }
    ): Promise<SmartPageExecutionResult> => {
        if (smartPageAdjustingRef.current) {
            return { status: 'skipped', reason: 'busy' };
        }
        smartPageAdjustingRef.current = true;
        setIsAutoSavePaused(true);
        try {
            if (!measurePreviewRef.current || !measurePreviewContentRef.current) {
                return { status: 'skipped', reason: 'unavailable' };
            }
            const a4Height = resolveA4Height();
            if (!a4Height) {
                return { status: 'skipped', reason: 'unavailable' };
            }
            if (options?.announce) {
                showToastInfo(
                    SMART_PAGE_TOAST_MESSAGES.adjusting,
                    SMART_PAGE_ADJUSTING_TOAST_DURATION_MS
                );
            }

            const finalizeFit = async (layout: SmartPageLayout): Promise<SmartPageExecutionResult> => {
                applyVisibleLayout(layout);
                setIsSmartPageApplied(true);
                await waitForPreviewUpdate(2);
                trackSmartOnePageTriggered({
                    lineHeight: layout.lineHeight,
                    fontSize: layout.fontSize,
                });
                return { status: 'fit', ...layout };
            };
            const finalizeOverflow = async (layout: SmartPageLayout): Promise<SmartPageExecutionResult> => {
                applyVisibleLayout(layout);
                setIsSmartPageApplied(true);
                await waitForPreviewUpdate(2);
                return { status: 'overflow', ...layout };
            };

            const defaultLayout = resolveDefaultLayoutParams(a4Height);
            const initialFit = await tryMeasureLayout(a4Height, defaultLayout);
            if (initialFit) {
                return finalizeFit(await resolveSmartPageExpansionFit({
                    a4Height,
                    defaultLayout,
                    initialFit,
                    tryMeasureLayout,
                }));
            }

            const {
                fitLayout,
                hardFallbackLayout,
            } = await resolveSmartPageShrinkFit({
                a4Height,
                defaultLayout,
                tryMeasureLayout,
            });
            if (fitLayout) {
                return finalizeFit(fitLayout);
            }

            return finalizeOverflow(hardFallbackLayout);
        } finally {
            smartPageAdjustingRef.current = false;
            setIsAutoSavePaused(false);
        }
    }, [
        applyVisibleLayout,
        measurePreviewContentRef,
        measurePreviewRef,
        resolveA4Height,
        resolveDefaultLayoutParams,
        setIsAutoSavePaused,
        setIsSmartPageApplied,
        showToastInfo,
        smartPageAdjustingRef,
        tryMeasureLayout,
        waitForPreviewUpdate,
    ]);

    return {
        applyLayoutSnapshot,
        applyVisibleLayout,
        executeSmartPageAdjustment,
        resolveA4Height,
        resolveDefaultLayoutParams,
        restoreDefaultLayout,
        waitForPreviewUpdate,
        waitForSmartPageIdle,
    };
};
