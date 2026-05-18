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
