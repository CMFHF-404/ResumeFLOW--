import { waitForResumeRenderReady } from '../../../utils/resumeRenderReadiness';
import { useCallback, useLayoutEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
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

const layoutKey = (layout: SmartPageLayout) => JSON.stringify([layout.topPaddingPx,layout.sectionSpacingKey,layout.itemSpacingEm,layout.lineHeight,layout.fontSize]);

type SmartPageResult = SmartPageLayout | null;
type SmartPageExecutionResult =
    | ({ status: 'fit' } & SmartPageLayout)
    | ({ status: 'overflow' } & SmartPageLayout)
    | { status: 'skipped'; reason: 'busy' | 'unavailable' };

type UseSmartPageExecutionParams = {
    currentLayout: SmartPageLayout;
    contentRevision: string;
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
    currentLayout,
    contentRevision,
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
    const activeRun = useRef<AbortController | null>(null);
    const verified = useRef<{revision: string; layout: string} | null>(null);
    const revisionRef = useRef(contentRevision);
    const committedLayoutRef = useRef(currentLayout);
    const expectedVisibleLayoutRef = useRef(currentLayout);
    useLayoutEffect(() => {
        committedLayoutRef.current = currentLayout;
        if (activeRun.current && layoutKey(currentLayout) !== layoutKey(expectedVisibleLayoutRef.current)) {
            activeRun.current.abort();
            verified.current = null;
        }
        expectedVisibleLayoutRef.current = currentLayout;
    }, [currentLayout]);
    useLayoutEffect(() => {
        revisionRef.current = contentRevision;
        verified.current = null;
        activeRun.current?.abort();
        return () => { activeRun.current?.abort(); };
    }, [contentRevision]);
    const isSinglePageVerified = useCallback((layout: SmartPageLayout) => (
        verified.current?.revision === revisionRef.current
        && verified.current?.layout === layoutKey(layout)
    ), []);
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

    const waitForSmartPageIdle = useCallback(() => new Promise<void>((resolve, reject) => {
        const deadline = Date.now() + 35000;
        const tick = () => {
            if (!smartPageAdjustingRef.current) {
                resolve();
                return;
            }
            if (Date.now() >= deadline) {reject(new Error("排版尚未完成，请稍后重试。"));return;}
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

    const commitVisibleLayout = useCallback((nextLayout: SmartPageLayout) => {
        expectedVisibleLayoutRef.current = nextLayout;
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

    const applyVisibleLayout = useCallback((layout: SmartPageLayout) => {
        activeRun.current?.abort();
        verified.current = null;
        commitVisibleLayout(layout);
    }, [commitVisibleLayout]);

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
        const run = activeRun.current;
        if (run?.signal.aborted) throw new Error('排版运行已失效。');
        setMeasureLayout(nextLayout);
        await waitForPreviewUpdate(2);
        if (run?.signal.aborted) throw new Error('排版运行已失效。');
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
            if (!options?.announce || !activeRun.current) return { status: 'skipped', reason: 'busy' };
            activeRun.current.abort();
            await waitForSmartPageIdle();
            if (smartPageAdjustingRef.current) return { status: 'skipped', reason: 'busy' };
        }
        const run = new AbortController();
        const revision = revisionRef.current;
        const deadlineMs = Date.now() + 30000;
        activeRun.current = run;
        verified.current = null;
        smartPageAdjustingRef.current = true;
        setIsAutoSavePaused(true);
        try {
            if (!measurePreviewRef.current || !measurePreviewContentRef.current) {
                return { status: 'skipped', reason: 'unavailable' };
            }
            await waitForResumeRenderReady(measurePreviewRef.current, {signal:run.signal,deadlineMs});
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
                if (run.signal.aborted || revision !== revisionRef.current) return {status:'skipped',reason:'unavailable'};
                commitVisibleLayout(layout);
                setIsSmartPageApplied(true);
                await waitForPreviewUpdate(2);
                await waitForResumeRenderReady(measurePreviewRef.current!, {signal:run.signal,deadlineMs});
                if (run.signal.aborted || revision !== revisionRef.current) return {status:'skipped',reason:'unavailable'};
                if (!measureContentLayout()?.fits) return {status:'overflow',...layout};
                verified.current = {revision,layout:layoutKey(layout)};
                trackSmartOnePageTriggered({
                    lineHeight: layout.lineHeight,
                    fontSize: layout.fontSize,
                });
                return { status: 'fit', ...layout };
            };
            const finalizeOverflow = async (layout: SmartPageLayout): Promise<SmartPageExecutionResult> => {
                if (run.signal.aborted || revision !== revisionRef.current) return {status:'skipped',reason:'unavailable'};
                commitVisibleLayout(layout);
                setIsSmartPageApplied(true);
                await waitForPreviewUpdate(2);
                if (run.signal.aborted || revision !== revisionRef.current) return {status:'skipped',reason:'unavailable'};
                return { status: 'overflow', ...layout };
            };

            const defaultLayout = resolveDefaultLayoutParams(a4Height);
            const initialFit = await tryMeasureLayout(a4Height, defaultLayout);
            if (initialFit) {
                return await finalizeFit(await resolveSmartPageExpansionFit({
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
                return await finalizeFit(fitLayout);
            }

            return await finalizeOverflow(hardFallbackLayout);
        } catch {
            if (!run.signal.aborted) showToastInfo('排版资源未就绪，请等待字体和图片加载后重试。');
            return {status:'skipped',reason:'unavailable'};
        } finally {
            if (activeRun.current === run) {
                if (run.signal.aborted) setMeasureLayout(committedLayoutRef.current);
                activeRun.current = null;
                smartPageAdjustingRef.current = false;
                setIsAutoSavePaused(false);
            }
        }
    }, [
        commitVisibleLayout,
        measureContentLayout,
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
        waitForSmartPageIdle,
        setMeasureLayout,
    ]);

    return {
        isSinglePageVerified,
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
