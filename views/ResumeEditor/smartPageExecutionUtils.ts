import {
    FONT_SIZE_MAX,
    FONT_SIZE_STEP,
    LINE_HEIGHT_MAX,
    LINE_HEIGHT_STEP,
    SMART_PAGE_ITEM_SPACING_MAX,
    SMART_PAGE_ITEM_SPACING_MIN,
    SMART_PAGE_ITEM_SPACING_STEP,
    SMART_PAGE_TOP_PADDING_MIN_PX,
    SMART_PAGE_TOP_PADDING_STEP_PX,
} from './constants';
import {
    areLayoutValuesEqual,
    buildDiscreteStepsFromCurrent,
    buildFontSizeSteps,
    buildItemSpacingSteps,
    buildLineHeightSteps,
    buildReductionStepsFromCurrent,
    buildSmartPageExpansionStages,
    buildSmartPageShrinkStages,
    buildTopPaddingSteps,
    FONT_SIZE_SHRINK_STEPS,
    LINE_HEIGHT_SHRINK_STEPS,
    resolveMaxTopPaddingPx,
    SECTION_SPACING_KEYS,
    resolveLayoutScore,
    resolveNearestStepIndex,
    type SmartPageAdjustmentMode,
    type SmartPageLayout,
} from './layoutUtils';

export type SmartPageResult = SmartPageLayout | null;

export type SmartPageFitCandidate = {
    key: string;
    layout: SmartPageLayout;
    score: number;
};

export type TryMeasureSmartPageLayout = (
    a4Height: number,
    layout: SmartPageLayout
) => Promise<SmartPageResult>;

export const findBestFitWithinStage = async ({
    a4Height,
    targetLayout,
    defaultLayout,
    topPaddingSteps,
    itemSpacingSteps,
    mode,
    fontSizeSteps,
    lineHeightSteps,
    tryMeasureLayout,
}: {
    a4Height: number;
    targetLayout: SmartPageLayout;
    defaultLayout: SmartPageLayout;
    topPaddingSteps: number[];
    itemSpacingSteps: number[];
    mode: SmartPageAdjustmentMode;
    fontSizeSteps: number[];
    lineHeightSteps: number[];
    tryMeasureLayout: TryMeasureSmartPageLayout;
}): Promise<SmartPageResult> => {
    const fontStartIndex = resolveNearestStepIndex(fontSizeSteps, targetLayout.fontSize);
    const lineHeightStartIndex = resolveNearestStepIndex(lineHeightSteps, targetLayout.lineHeight);
    let bestFitLayout: SmartPageResult = null;
    let bestFitScore = Number.NEGATIVE_INFINITY;

    if (mode === 'shrink') {
        for (let fontIndex = fontStartIndex; fontIndex < fontSizeSteps.length; fontIndex += 1) {
            const relaxedLineHeightStartIndex = Math.max(
                0,
                lineHeightStartIndex - (fontIndex - fontStartIndex)
            );
            for (
                let lineHeightIndex = relaxedLineHeightStartIndex;
                lineHeightIndex < lineHeightSteps.length;
                lineHeightIndex += 1
            ) {
                const fitLayout = await tryMeasureLayout(a4Height, {
                    ...targetLayout,
                    fontSize: fontSizeSteps[fontIndex],
                    lineHeight: lineHeightSteps[lineHeightIndex],
                });
                if (!fitLayout) {
                    continue;
                }
                const score = resolveLayoutScore(
                    fitLayout,
                    defaultLayout,
                    topPaddingSteps,
                    itemSpacingSteps,
                    mode
                );
                if (score > bestFitScore) {
                    bestFitLayout = fitLayout;
                    bestFitScore = score;
                }
            }
        }
        return bestFitLayout;
    }

    for (let fontIndex = fontStartIndex; fontIndex >= 0; fontIndex -= 1) {
        for (let lineHeightIndex = lineHeightStartIndex; lineHeightIndex >= 0; lineHeightIndex -= 1) {
            const fitLayout = await tryMeasureLayout(a4Height, {
                ...targetLayout,
                fontSize: fontSizeSteps[fontIndex],
                lineHeight: lineHeightSteps[lineHeightIndex],
            });
            if (!fitLayout) {
                continue;
            }
            const score = resolveLayoutScore(
                fitLayout,
                defaultLayout,
                topPaddingSteps,
                itemSpacingSteps,
                mode
            );
            if (score > bestFitScore) {
                bestFitLayout = fitLayout;
                bestFitScore = score;
            }
        }
    }

    return bestFitLayout;
};

export const reboundTypographyIfPossible = async ({
    a4Height,
    layout,
    tryMeasureLayout,
}: {
    a4Height: number;
    layout: SmartPageLayout;
    tryMeasureLayout: TryMeasureSmartPageLayout;
}): Promise<SmartPageLayout> => {
    let candidate = layout;
    const fontIndex = resolveNearestStepIndex(FONT_SIZE_SHRINK_STEPS, candidate.fontSize);
    if (fontIndex > 0) {
        const reboundFontLayout = await tryMeasureLayout(a4Height, {
            ...candidate,
            fontSize: FONT_SIZE_SHRINK_STEPS[fontIndex - 1],
        });
        if (reboundFontLayout) {
            candidate = reboundFontLayout;
        }
    }

    const lineHeightIndex = resolveNearestStepIndex(LINE_HEIGHT_SHRINK_STEPS, candidate.lineHeight);
    if (lineHeightIndex > 0) {
        const reboundLineHeightLayout = await tryMeasureLayout(a4Height, {
            ...candidate,
            lineHeight: LINE_HEIGHT_SHRINK_STEPS[lineHeightIndex - 1],
        });
        if (reboundLineHeightLayout) {
            candidate = reboundLineHeightLayout;
        }
    }

    return candidate;
};

export const pickBestSmartPageFitCandidate = (
    candidates: SmartPageFitCandidate[]
) => candidates.reduce<SmartPageFitCandidate | null>(
    (bestCandidate, currentCandidate) => {
        if (!bestCandidate || currentCandidate.score > bestCandidate.score) {
            return currentCandidate;
        }
        return bestCandidate;
    },
    null
);

export const buildSmartPageHardFallbackLayout = (
    topPaddingSteps: number[],
    itemSpacingSteps: number[]
): SmartPageLayout => ({
    topPaddingPx: topPaddingSteps[topPaddingSteps.length - 1],
    sectionSpacingKey: SECTION_SPACING_KEYS[SECTION_SPACING_KEYS.length - 1],
    itemSpacingEm: itemSpacingSteps[itemSpacingSteps.length - 1],
    lineHeight: LINE_HEIGHT_SHRINK_STEPS[LINE_HEIGHT_SHRINK_STEPS.length - 1],
    fontSize: FONT_SIZE_SHRINK_STEPS[FONT_SIZE_SHRINK_STEPS.length - 1],
});

export const resolveSmartPageExpansionFit = async ({
    a4Height,
    defaultLayout,
    initialFit,
    tryMeasureLayout,
}: {
    a4Height: number;
    defaultLayout: SmartPageLayout;
    initialFit: SmartPageLayout;
    tryMeasureLayout: TryMeasureSmartPageLayout;
}): Promise<SmartPageLayout> => {
    const topPaddingExpandSteps = buildTopPaddingSteps(
        defaultLayout.topPaddingPx,
        resolveMaxTopPaddingPx(a4Height),
        SMART_PAGE_TOP_PADDING_STEP_PX
    );
    const itemSpacingExpandSteps = buildItemSpacingSteps(
        defaultLayout.itemSpacingEm,
        SMART_PAGE_ITEM_SPACING_MAX,
        SMART_PAGE_ITEM_SPACING_STEP
    );
    const fontSizeExpandSteps = buildFontSizeSteps(
        defaultLayout.fontSize,
        FONT_SIZE_MAX,
        FONT_SIZE_STEP
    );
    const lineHeightExpandSteps = buildLineHeightSteps(
        defaultLayout.lineHeight,
        LINE_HEIGHT_MAX,
        LINE_HEIGHT_STEP
    );
    const sectionSpacingExpandSteps = buildDiscreteStepsFromCurrent(
        SECTION_SPACING_KEYS,
        defaultLayout.sectionSpacingKey,
        'expand'
    );

    const dedupedExpansionStages = buildSmartPageExpansionStages(
        defaultLayout,
        topPaddingExpandSteps,
        itemSpacingExpandSteps,
        fontSizeExpandSteps,
        lineHeightExpandSteps,
        sectionSpacingExpandSteps
    );
    const expansionCandidates: SmartPageFitCandidate[] = [];
    for (const stage of dedupedExpansionStages) {
        const fitLayout = await findBestFitWithinStage({
            a4Height,
            targetLayout: stage.layout,
            defaultLayout,
            topPaddingSteps: topPaddingExpandSteps,
            itemSpacingSteps: itemSpacingExpandSteps,
            mode: 'expand',
            fontSizeSteps: fontSizeExpandSteps,
            lineHeightSteps: lineHeightExpandSteps,
            tryMeasureLayout,
        });
        if (!fitLayout || areLayoutValuesEqual(fitLayout, defaultLayout)) {
            continue;
        }
        expansionCandidates.push({
            key: stage.key,
            layout: fitLayout,
            score: resolveLayoutScore(
                fitLayout,
                defaultLayout,
                topPaddingExpandSteps,
                itemSpacingExpandSteps,
                'expand'
            ),
        });
    }
    const bestExpansionCandidate = pickBestSmartPageFitCandidate(expansionCandidates);
    return bestExpansionCandidate?.layout ?? initialFit;
};

export const resolveSmartPageShrinkFit = async ({
    a4Height,
    defaultLayout,
    tryMeasureLayout,
}: {
    a4Height: number;
    defaultLayout: SmartPageLayout;
    tryMeasureLayout: TryMeasureSmartPageLayout;
}): Promise<{
    fitLayout: SmartPageLayout | null;
    hardFallbackLayout: SmartPageLayout;
}> => {
    const topPaddingSteps = buildTopPaddingSteps(
        defaultLayout.topPaddingPx,
        SMART_PAGE_TOP_PADDING_MIN_PX,
        SMART_PAGE_TOP_PADDING_STEP_PX
    );
    const itemSpacingSteps = buildReductionStepsFromCurrent(
        defaultLayout.itemSpacingEm,
        SMART_PAGE_ITEM_SPACING_MIN,
        SMART_PAGE_ITEM_SPACING_STEP
    );
    const hardFallbackLayout = buildSmartPageHardFallbackLayout(
        topPaddingSteps,
        itemSpacingSteps
    );

    const dedupedStageLayouts = buildSmartPageShrinkStages(
        defaultLayout,
        topPaddingSteps,
        itemSpacingSteps,
        hardFallbackLayout
    );

    const fittingCandidates: SmartPageFitCandidate[] = [];
    for (const stage of dedupedStageLayouts) {
        const fitLayout = stage.key === 'hard-fallback'
            ? await tryMeasureLayout(a4Height, stage.layout)
            : await findBestFitWithinStage({
                a4Height,
                targetLayout: stage.layout,
                defaultLayout,
                topPaddingSteps,
                itemSpacingSteps,
                mode: 'shrink',
                fontSizeSteps: FONT_SIZE_SHRINK_STEPS,
                lineHeightSteps: LINE_HEIGHT_SHRINK_STEPS,
                tryMeasureLayout,
            });
        if (!fitLayout) {
            continue;
        }
        fittingCandidates.push({
            key: stage.key,
            layout: fitLayout,
            score: resolveLayoutScore(
                fitLayout,
                defaultLayout,
                topPaddingSteps,
                itemSpacingSteps,
                'shrink'
            ),
        });
    }

    const bestFitCandidate = pickBestSmartPageFitCandidate(fittingCandidates);
    if (!bestFitCandidate) {
        return {
            fitLayout: null,
            hardFallbackLayout,
        };
    }

    return {
        fitLayout: await reboundTypographyIfPossible({
            a4Height,
            layout: bestFitCandidate.layout,
            tryMeasureLayout,
        }),
        hardFallbackLayout,
    };
};
