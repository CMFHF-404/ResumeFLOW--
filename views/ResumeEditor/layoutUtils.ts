import type {
    ResumeEditorConfig,
    SectionSpacingKey,
} from '../../types/resume';
import {
    A4_HEIGHT_MM,
    FONT_SIZE_DEFAULT,
    FONT_SIZE_MAX,
    FONT_SIZE_MIN,
    FONT_SIZE_STEP,
    LINE_HEIGHT_DEFAULT,
    LINE_HEIGHT_MAX,
    LINE_HEIGHT_MIN,
    LINE_HEIGHT_STEP,
    LIST_SPACING_BY_DENSITY,
    PREVIEW_PADDING_MM,
    SECTION_SPACING_CLASS_BY_DENSITY,
    SMART_PAGE_ITEM_SPACING_DEFAULT,
    SMART_PAGE_ITEM_SPACING_MAX,
    SMART_PAGE_ITEM_SPACING_MIN,
    SMART_PAGE_ITEM_SPACING_STEP,
    SMART_PAGE_SECTION_SPACING_CLASS_BY_KEY,
    SMART_PAGE_SECTION_SPACING_STEPS,
    SMART_PAGE_TOP_PADDING_MAX_OFFSET_PX,
    SMART_PAGE_TOP_PADDING_MIN_PX,
    SMART_PAGE_TOP_PADDING_STEP_PX,
} from './constants';

export const buildLineHeightSteps = (start: number, min: number, step: number) => {
    const steps: number[] = [];
    const direction = start <= min ? 1 : -1;
    for (
        let value = start;
        direction > 0 ? value <= min : value >= min;
        value += step * direction
    ) {
        steps.push(Number(value.toFixed(2)));
    }
    const normalizedEnd = Number(min.toFixed(2));
    if (steps[steps.length - 1] !== normalizedEnd) {
        steps.push(normalizedEnd);
    }
    return steps;
};

export const LINE_HEIGHT_SHRINK_STEPS = buildLineHeightSteps(
    LINE_HEIGHT_DEFAULT,
    LINE_HEIGHT_MIN,
    LINE_HEIGHT_STEP
);
const LINE_HEIGHT_OPTION_VALUES = buildLineHeightSteps(
    LINE_HEIGHT_MAX,
    LINE_HEIGHT_MIN,
    LINE_HEIGHT_STEP
);

// 字号调整步骤（用于智能一页算法）
export const buildFontSizeSteps = (start: number, min: number, step: number) => {
    const steps: number[] = [];
    const direction = start <= min ? 1 : -1;
    for (
        let value = start;
        direction > 0 ? value <= min : value >= min;
        value += step * direction
    ) {
        steps.push(Number(value.toFixed(1)));
    }
    const normalizedEnd = Number(min.toFixed(1));
    if (steps[steps.length - 1] !== normalizedEnd) {
        steps.push(normalizedEnd);
    }
    return steps;
};

export const buildDiscreteStepsFromCurrent = <T extends number>(
    steps: readonly T[],
    start: T,
    direction: 'shrink' | 'expand'
) => {
    const exactIndex = steps.findIndex((candidate) => candidate === start);
    const startIndex = exactIndex >= 0
        ? exactIndex
        : steps.reduce(
            (nearestIndex, step, index) => (
                Math.abs(step - start) < Math.abs(steps[nearestIndex] - start)
                    ? index
                    : nearestIndex
            ),
            0
        );
    return direction === 'shrink'
        ? [...steps].slice(startIndex)
        : [...steps].slice(0, startIndex + 1).reverse();
};

export const FONT_SIZE_SHRINK_STEPS = buildFontSizeSteps(FONT_SIZE_DEFAULT, FONT_SIZE_MIN, FONT_SIZE_STEP);
const FONT_SIZE_OPTION_VALUES = buildFontSizeSteps(FONT_SIZE_MAX, FONT_SIZE_MIN, FONT_SIZE_STEP);
const CSS_PX_PER_MM = 96 / 25.4;
export const formatOptionNumberLabel = (value: number, maxDecimals = 2) => (
    value.toFixed(maxDecimals).replace(/\.?0+$/, '')
);
export const LINE_HEIGHT_OPTIONS = LINE_HEIGHT_OPTION_VALUES.map((value) => ({
    value,
    label: formatOptionNumberLabel(value),
}));
export const FONT_SIZE_OPTIONS = FONT_SIZE_OPTION_VALUES.map((value) => ({
    value,
    label: `${formatOptionNumberLabel(value, 1)} px`,
}));

export type SmartPageLayout = {
    topPaddingPx: number;
    sectionSpacingKey: SectionSpacingKey;
    itemSpacingEm: number;
    lineHeight: number;
    fontSize: number;
};

export type LayoutSnapshot = SmartPageLayout & {
    isSmartPageApplied: boolean;
};

export const buildTopPaddingSteps = (start: number, min: number, step: number) => {
    const steps: number[] = [];
    const direction = start <= min ? 1 : -1;
    for (
        let value = start;
        direction > 0 ? value <= min : value >= min;
        value += step * direction
    ) {
        steps.push(Number(value.toFixed(2)));
    }
    const normalizedEnd = Number(min.toFixed(2));
    if (steps[steps.length - 1] !== normalizedEnd) {
        steps.push(normalizedEnd);
    }
    return steps;
};

export const buildItemSpacingSteps = (start: number, min: number, step: number) => {
    const steps: number[] = [];
    const direction = start <= min ? 1 : -1;
    for (
        let value = start;
        direction > 0 ? value <= min : value >= min;
        value += step * direction
    ) {
        steps.push(Number(value.toFixed(2)));
    }
    const normalizedEnd = Number(min.toFixed(2));
    if (steps[steps.length - 1] !== normalizedEnd) {
        steps.push(normalizedEnd);
    }
    return steps;
};

export const buildReductionStepsFromCurrent = (start: number, min: number, step: number) => {
    if (start <= min) {
        return [Number(start.toFixed(2))];
    }
    return buildItemSpacingSteps(start, min, step);
};

export const SECTION_SPACING_KEYS: SectionSpacingKey[] = [...SMART_PAGE_SECTION_SPACING_STEPS];
export const MAX_ITEM_SPACING_EM = SMART_PAGE_ITEM_SPACING_MAX;
const ITEM_SPACING_OPTIONS = Array.from(new Set([
    ...buildItemSpacingSteps(
        MAX_ITEM_SPACING_EM,
        SMART_PAGE_ITEM_SPACING_MIN,
        SMART_PAGE_ITEM_SPACING_STEP
    ),
    ...Object.values(LIST_SPACING_BY_DENSITY),
].map((value) => Number(value.toFixed(3))))).sort((left, right) => right - left);
export const SECTION_SPACING_OPTIONS = SECTION_SPACING_KEYS.map((value) => ({
    value,
    label: `${value}`,
}));
export const ITEM_SPACING_SELECT_OPTIONS = ITEM_SPACING_OPTIONS.map((value) => ({
    value,
    label: formatOptionNumberLabel(value, 3),
}));

export const areLayoutValuesEqual = (current: SmartPageLayout, defaults: SmartPageLayout) => (
    current.topPaddingPx === defaults.topPaddingPx
    && current.sectionSpacingKey === defaults.sectionSpacingKey
    && current.itemSpacingEm === defaults.itemSpacingEm
    && current.lineHeight === defaults.lineHeight
    && current.fontSize === defaults.fontSize
);

export type SmartPageAdjustmentMode = 'shrink' | 'expand';

export type SmartPageStageLayout = {
    key: string;
    layout: SmartPageLayout;
};

export const resolveNearestStepIndex = (steps: readonly number[], value: number) => steps.reduce(
    (nearestIndex, step, index) => (
        Math.abs(step - value) < Math.abs(steps[nearestIndex] - value)
            ? index
            : nearestIndex
    ),
    0
);

export const resolveStepByOffset = <T extends number>(
    steps: readonly T[],
    value: number,
    offset: number
): T => {
    const baseIndex = resolveNearestStepIndex(steps, value);
    const nextIndex = Math.min(Math.max(baseIndex + offset, 0), steps.length - 1);
    return steps[nextIndex];
};

export const resolveLayoutScore = (
    layout: SmartPageLayout,
    defaultLayout: SmartPageLayout,
    topPaddingSteps: readonly number[],
    itemSpacingSteps: readonly number[],
    mode: SmartPageAdjustmentMode
) => {
    const topPaddingMinPx = Math.min(...topPaddingSteps);
    const topPaddingMaxPx = Math.max(...topPaddingSteps);
    const itemSpacingMinEm = Math.min(...itemSpacingSteps);
    const itemSpacingMaxEm = Math.max(...itemSpacingSteps);
    const minSectionSpacingKey = SECTION_SPACING_KEYS[SECTION_SPACING_KEYS.length - 1];
    const maxSectionSpacingKey = SECTION_SPACING_KEYS[0];
    const defaultSectionIndex = resolveNearestStepIndex(
        SECTION_SPACING_KEYS,
        defaultLayout.sectionSpacingKey
    );
    const currentSectionIndex = resolveNearestStepIndex(
        SECTION_SPACING_KEYS,
        layout.sectionSpacingKey
    );
    const fontSizeDelta = Math.abs(layout.fontSize - defaultLayout.fontSize) / FONT_SIZE_STEP;
    const lineHeightDelta = Math.abs(layout.lineHeight - defaultLayout.lineHeight) / LINE_HEIGHT_STEP;
    const topPaddingDelta = Math.abs(layout.topPaddingPx - defaultLayout.topPaddingPx)
        / SMART_PAGE_TOP_PADDING_STEP_PX;
    const itemSpacingDelta = Math.abs(layout.itemSpacingEm - defaultLayout.itemSpacingEm)
        / SMART_PAGE_ITEM_SPACING_STEP;
    const sectionSpacingDelta = Math.abs(currentSectionIndex - defaultSectionIndex);

    const weightedDelta = (
        (fontSizeDelta * 5)
        + (lineHeightDelta * 3)
        + (sectionSpacingDelta * 2)
        + (topPaddingDelta * 2)
        + (itemSpacingDelta * 1.5)
    );

    let penalty = mode === 'shrink' ? weightedDelta : 0;

    if (mode === 'shrink' && Math.abs(layout.fontSize - FONT_SIZE_MIN) < 0.001) {
        if (layout.sectionSpacingKey !== minSectionSpacingKey) {
            penalty += 6;
        }
        if (layout.topPaddingPx - topPaddingMinPx > 0.001) {
            penalty += 6;
        }
    }

    if (mode === 'expand' && Math.abs(layout.fontSize - FONT_SIZE_MAX) < 0.001) {
        if (layout.sectionSpacingKey !== maxSectionSpacingKey) {
            penalty += 6;
        }
        if (topPaddingMaxPx - layout.topPaddingPx > 0.001) {
            penalty += 6;
        }
    }

    const resolveAdjustmentRatio = (
        value: number,
        baselineValue: number,
        minValue: number,
        maxValue: number
    ) => {
        const denominator = mode === 'shrink'
            ? baselineValue - minValue
            : maxValue - baselineValue;
        if (Math.abs(denominator) < 0.001) {
            return 0;
        }
        return mode === 'shrink'
            ? Math.max(0, Math.min(1, (baselineValue - value) / denominator))
            : Math.max(0, Math.min(1, (value - baselineValue) / denominator));
    };

    const sectionAdjustmentRatio = mode === 'shrink'
        ? defaultSectionIndex >= SECTION_SPACING_KEYS.length - 1
            ? 0
            : Math.max(
                0,
                Math.min(
                    1,
                    (currentSectionIndex - defaultSectionIndex)
                    / ((SECTION_SPACING_KEYS.length - 1) - defaultSectionIndex)
                )
            )
        : defaultSectionIndex <= 0
            ? 0
            : Math.max(
                0,
                Math.min(1, (defaultSectionIndex - currentSectionIndex) / defaultSectionIndex)
            );

    const ratios = [
        resolveAdjustmentRatio(layout.fontSize, defaultLayout.fontSize, FONT_SIZE_MIN, FONT_SIZE_MAX),
        resolveAdjustmentRatio(layout.lineHeight, defaultLayout.lineHeight, LINE_HEIGHT_MIN, LINE_HEIGHT_MAX),
        sectionAdjustmentRatio,
        resolveAdjustmentRatio(
            layout.topPaddingPx,
            defaultLayout.topPaddingPx,
            topPaddingMinPx,
            topPaddingMaxPx
        ),
        resolveAdjustmentRatio(
            layout.itemSpacingEm,
            defaultLayout.itemSpacingEm,
            itemSpacingMinEm,
            itemSpacingMaxEm
        ),
    ];
    const averageRatio = ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length;
    penalty += ratios.reduce(
        (sum, ratio) => sum + Math.abs(ratio - averageRatio),
        0
    ) * 2;

    const maxRatio = Math.max(...ratios);
    const minRatio = Math.min(...ratios);
    if (maxRatio - minRatio > 0.35) {
        penalty += (maxRatio - minRatio - 0.35) * 8;
    }

    return mode === 'shrink'
        ? 100 - penalty
        : weightedDelta - penalty;
};

export const dedupeSmartPageStageLayouts = (stages: SmartPageStageLayout[]) => (
    stages.filter((stage, index) => {
        const currentKey = JSON.stringify(stage.layout);
        return stages.findIndex((candidate) => JSON.stringify(candidate.layout) === currentKey) === index;
    })
);

export const buildSmartPageExpansionStages = (
    defaultLayout: SmartPageLayout,
    topPaddingSteps: readonly number[],
    itemSpacingSteps: readonly number[],
    fontSizeSteps: readonly number[],
    lineHeightSteps: readonly number[],
    sectionSpacingSteps: readonly SectionSpacingKey[]
) => dedupeSmartPageStageLayouts([
    {
        key: 'mild',
        layout: {
            topPaddingPx: resolveStepByOffset(topPaddingSteps, defaultLayout.topPaddingPx, 1),
            sectionSpacingKey: resolveStepByOffset(sectionSpacingSteps, defaultLayout.sectionSpacingKey, 1),
            itemSpacingEm: resolveStepByOffset(itemSpacingSteps, defaultLayout.itemSpacingEm, 1),
            lineHeight: resolveStepByOffset(lineHeightSteps, defaultLayout.lineHeight, 1),
            fontSize: resolveStepByOffset(fontSizeSteps, defaultLayout.fontSize, 1),
        },
    },
    {
        key: 'medium',
        layout: {
            topPaddingPx: resolveStepByOffset(topPaddingSteps, defaultLayout.topPaddingPx, 2),
            sectionSpacingKey: resolveStepByOffset(sectionSpacingSteps, defaultLayout.sectionSpacingKey, 2),
            itemSpacingEm: resolveStepByOffset(itemSpacingSteps, defaultLayout.itemSpacingEm, 2),
            lineHeight: resolveStepByOffset(lineHeightSteps, defaultLayout.lineHeight, 2),
            fontSize: resolveStepByOffset(fontSizeSteps, defaultLayout.fontSize, 2),
        },
    },
    {
        key: 'strong',
        layout: {
            topPaddingPx: resolveStepByOffset(topPaddingSteps, defaultLayout.topPaddingPx, 3),
            sectionSpacingKey: resolveStepByOffset(sectionSpacingSteps, defaultLayout.sectionSpacingKey, 3),
            itemSpacingEm: resolveStepByOffset(itemSpacingSteps, defaultLayout.itemSpacingEm, 3),
            lineHeight: resolveStepByOffset(lineHeightSteps, defaultLayout.lineHeight, 3),
            fontSize: resolveStepByOffset(fontSizeSteps, defaultLayout.fontSize, 3),
        },
    },
    {
        key: 'max-balanced',
        layout: {
            topPaddingPx: topPaddingSteps[topPaddingSteps.length - 1],
            sectionSpacingKey: sectionSpacingSteps[sectionSpacingSteps.length - 1],
            itemSpacingEm: itemSpacingSteps[itemSpacingSteps.length - 1],
            lineHeight: lineHeightSteps[lineHeightSteps.length - 1],
            fontSize: fontSizeSteps[fontSizeSteps.length - 1],
        },
    },
]);

export const buildSmartPageShrinkStages = (
    defaultLayout: SmartPageLayout,
    topPaddingSteps: readonly number[],
    itemSpacingSteps: readonly number[],
    hardFallbackLayout: SmartPageLayout
) => dedupeSmartPageStageLayouts([
    {
        key: 'mild',
        layout: {
            topPaddingPx: resolveStepByOffset(topPaddingSteps, defaultLayout.topPaddingPx, 1),
            sectionSpacingKey: resolveStepByOffset(SECTION_SPACING_KEYS, defaultLayout.sectionSpacingKey, 1),
            itemSpacingEm: resolveStepByOffset(itemSpacingSteps, defaultLayout.itemSpacingEm, 1),
            lineHeight: resolveStepByOffset(LINE_HEIGHT_SHRINK_STEPS, defaultLayout.lineHeight, 1),
            fontSize: resolveStepByOffset(FONT_SIZE_SHRINK_STEPS, defaultLayout.fontSize, 1),
        },
    },
    {
        key: 'medium',
        layout: {
            topPaddingPx: resolveStepByOffset(topPaddingSteps, defaultLayout.topPaddingPx, 2),
            sectionSpacingKey: resolveStepByOffset(SECTION_SPACING_KEYS, defaultLayout.sectionSpacingKey, 2),
            itemSpacingEm: resolveStepByOffset(itemSpacingSteps, defaultLayout.itemSpacingEm, 2),
            lineHeight: resolveStepByOffset(LINE_HEIGHT_SHRINK_STEPS, defaultLayout.lineHeight, 2),
            fontSize: resolveStepByOffset(FONT_SIZE_SHRINK_STEPS, defaultLayout.fontSize, 2),
        },
    },
    {
        key: 'strong',
        layout: {
            topPaddingPx: resolveStepByOffset(topPaddingSteps, defaultLayout.topPaddingPx, 3),
            sectionSpacingKey: resolveStepByOffset(SECTION_SPACING_KEYS, defaultLayout.sectionSpacingKey, 3),
            itemSpacingEm: resolveStepByOffset(itemSpacingSteps, defaultLayout.itemSpacingEm, 3),
            lineHeight: resolveStepByOffset(LINE_HEIGHT_SHRINK_STEPS, defaultLayout.lineHeight, 3),
            fontSize: resolveStepByOffset(FONT_SIZE_SHRINK_STEPS, defaultLayout.fontSize, 3),
        },
    },
    {
        key: 'max-balanced',
        layout: {
            topPaddingPx: topPaddingSteps[topPaddingSteps.length - 1],
            sectionSpacingKey: SECTION_SPACING_KEYS[SECTION_SPACING_KEYS.length - 1],
            itemSpacingEm: itemSpacingSteps[itemSpacingSteps.length - 1],
            lineHeight: resolveStepByOffset(
                LINE_HEIGHT_SHRINK_STEPS,
                defaultLayout.lineHeight,
                Math.round(0.2 / LINE_HEIGHT_STEP)
            ),
            fontSize: resolveStepByOffset(
                FONT_SIZE_SHRINK_STEPS,
                defaultLayout.fontSize,
                Math.round(2 / FONT_SIZE_STEP)
            ),
        },
    },
    {
        key: 'hard-fallback',
        layout: hardFallbackLayout,
    },
]);

export const resolveNearestSectionSpacingKey = (value: number): SectionSpacingKey => (
    SECTION_SPACING_KEYS.reduce<SectionSpacingKey>((nearest, candidate) => {
        const candidateDistance = Math.abs(candidate - value);
        const nearestDistance = Math.abs(nearest - value);
        if (candidateDistance < nearestDistance) {
            return candidate;
        }
        return nearest;
    }, SECTION_SPACING_KEYS[0])
);

export const resolveDefaultTopPaddingPx = (a4Height?: number) => {
    const pxPerMm = a4Height ? a4Height / A4_HEIGHT_MM : CSS_PX_PER_MM;
    return Number((pxPerMm * PREVIEW_PADDING_MM).toFixed(2));
};
export const resolveMaxTopPaddingPx = (a4Height?: number) => Number(
    (resolveDefaultTopPaddingPx(a4Height) + SMART_PAGE_TOP_PADDING_MAX_OFFSET_PX).toFixed(2)
);
export const TOP_PADDING_MAX_PX = resolveMaxTopPaddingPx();
export const TOP_PADDING_MIN_PX = SMART_PAGE_TOP_PADDING_MIN_PX;
const TOP_PADDING_OPTIONS = buildTopPaddingSteps(
    TOP_PADDING_MAX_PX,
    TOP_PADDING_MIN_PX,
    SMART_PAGE_TOP_PADDING_STEP_PX
);
export const TOP_PADDING_SELECT_OPTIONS = TOP_PADDING_OPTIONS.map((value) => ({
    value,
    label: `${formatOptionNumberLabel(value)} px`,
}));
export const TOP_PADDING_SLIDER_MAX = TOP_PADDING_MAX_PX;

export const resolveDefaultSectionSpacingKey = (
    density: 'compact' | 'standard' | 'spacious'
): SectionSpacingKey => {
    if (density === 'compact') {
        return 4;
    }
    if (density === 'spacious') {
        return 8;
    }
    return 6;
};

export const resolveDefaultItemSpacingEm = (density: 'compact' | 'standard' | 'spacious') => {
    if (density === 'standard') {
        return SMART_PAGE_ITEM_SPACING_DEFAULT;
    }
    return LIST_SPACING_BY_DENSITY[density];
};

export const resolveSectionSpacingClass = (spacingKey: SectionSpacingKey) => {
    return SMART_PAGE_SECTION_SPACING_CLASS_BY_KEY[spacingKey]
        ?? SECTION_SPACING_CLASS_BY_DENSITY.standard;
};

export const buildDefaultSmartPageLayout = (
    density: 'compact' | 'standard' | 'spacious',
    a4Height?: number
): SmartPageLayout => ({
    topPaddingPx: resolveDefaultTopPaddingPx(a4Height),
    sectionSpacingKey: resolveDefaultSectionSpacingKey(density),
    itemSpacingEm: resolveDefaultItemSpacingEm(density),
    lineHeight: LINE_HEIGHT_DEFAULT,
    fontSize: FONT_SIZE_DEFAULT,
});

export const resolveLayoutSnapshotFromConfig = (
    layout?: ResumeEditorConfig['layout'],
    a4Height?: number
): LayoutSnapshot => {
    const resolvedDensity = layout?.density ?? 'standard';
    const defaultLayout = buildDefaultSmartPageLayout(resolvedDensity, a4Height);
    return {
        topPaddingPx: layout?.topPaddingPx ?? defaultLayout.topPaddingPx,
        sectionSpacingKey: layout?.sectionSpacingKey ?? defaultLayout.sectionSpacingKey,
        itemSpacingEm: layout?.itemSpacingEm ?? defaultLayout.itemSpacingEm,
        lineHeight: layout?.lineHeight ?? defaultLayout.lineHeight,
        fontSize: layout?.fontSize ?? defaultLayout.fontSize,
        isSmartPageApplied: layout?.isSmartPageApplied ?? false,
    };
};

export const buildSpacingValue = (baseSpacing: number, lineHeightValue: number) => {
    const scale = Math.min(1, lineHeightValue / LINE_HEIGHT_DEFAULT);
    // 用 em 而不是 rem：这样间距会跟随预览容器的 fontSize 缩放（智能一页阶段2会调整字号）。
    return `${(baseSpacing * scale).toFixed(3)}em`;
};
