import React from 'react';
import type {
    ResumeEditorProfile,
    ResumeExperienceListMarkerStyle,
    StarFields,
} from '../../../../types/resume';
import {
    RICH_TEXT_INLINE_STYLES_CLASS,
    sanitizeRichTextHtml,
    splitRichTextLines,
} from '../../../../utils/richText';

export const renderTimelineBlueLeadMarkers = (showConnectorToNext: boolean) => (
    <>
        {showConnectorToNext ? (
            <span
                aria-hidden="true"
                className="pointer-events-none absolute left-[7px] top-[22px] w-px"
                style={{
                    bottom: 'calc(-1 * var(--rf-list-spacing))',
                    backgroundColor: 'var(--rf-accent-color)',
                    opacity: 0.24,
                }}
            />
        ) : null}
        <span
            aria-hidden="true"
            className="pointer-events-none absolute left-[4px] top-2.5 h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: 'var(--rf-accent-color)' }}
        />
    </>
);

const STAR_CONTEXT_SEPARATOR = ' ';
const normalizeStarText = (value?: string) => value?.trim() ?? '';
export const LIST_GAP_CLASS = 'gap-y-[var(--rf-list-spacing)]';
export const RICH_TEXT_LIST_NESTED_CLASS = '[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5';
export const PREVIEW_SCALE_EPSILON = 0.001;
export const PREVIEW_SIZE_EPSILON = 0.5;
export const EDITOR_PREVIEW_MAX_A4_HEIGHT_RATIO = 1.4;
export const A4_PAGE_WIDTH_MM = 210;
export const A4_PAGE_HEIGHT_MM = 297;
export const SPLIT_TEMPLATE_SIDEBAR_RATIO = 0.4;
export const DESKTOP_EDITOR_MEDIA_QUERY = '(min-width: 768px)';
export const MOBILE_EDITOR_MEDIA_QUERY = '(max-width: 767px)';
const MOBILE_USER_AGENT_PATTERN = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i;

const TAILWIND_TEXT_SIZES_PX = {
    xs: 12,
    sm: 14,
    base: 16,
    lg: 18,
    xl: 20,
    '2xl': 24,
    '3xl': 30,
} as const;

export const buildPreviewTypographyCss = (scale: number, previewScope: string) => {
    const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    const px = (value: number) => `${(value * safeScale).toFixed(3)}px`;

    return `
        .a4-preview[data-rf-preview-scope="${previewScope}"] .text-xs { font-size: ${px(TAILWIND_TEXT_SIZES_PX.xs)}; }
        .a4-preview[data-rf-preview-scope="${previewScope}"] .text-sm { font-size: ${px(TAILWIND_TEXT_SIZES_PX.sm)}; }
        .a4-preview[data-rf-preview-scope="${previewScope}"] .text-base { font-size: ${px(TAILWIND_TEXT_SIZES_PX.base)}; }
        .a4-preview[data-rf-preview-scope="${previewScope}"] .text-lg { font-size: ${px(TAILWIND_TEXT_SIZES_PX.lg)}; }
        .a4-preview[data-rf-preview-scope="${previewScope}"] .text-xl { font-size: ${px(TAILWIND_TEXT_SIZES_PX.xl)}; }
        .a4-preview[data-rf-preview-scope="${previewScope}"] .text-2xl { font-size: ${px(TAILWIND_TEXT_SIZES_PX['2xl'])}; }
        .a4-preview[data-rf-preview-scope="${previewScope}"] .text-3xl { font-size: ${px(TAILWIND_TEXT_SIZES_PX['3xl'])}; }
        .a4-preview[data-rf-preview-scope="${previewScope}"] .text-\\[11px\\] { font-size: ${px(11)}; }
    `;
};

const detectMobileLikeNavigator = () => {
    if (typeof navigator === 'undefined') {
        return false;
    }

    const navigatorWithUAData = navigator as Navigator & {
        userAgentData?: { mobile?: boolean };
    };
    if (typeof navigatorWithUAData.userAgentData?.mobile === 'boolean') {
        return navigatorWithUAData.userAgentData.mobile;
    }

    const userAgent = navigator.userAgent || '';
    if (MOBILE_USER_AGENT_PATTERN.test(userAgent)) {
        return true;
    }

    return (navigator.platform || '') === 'MacIntel' && navigator.maxTouchPoints > 1;
};

export const detectTouchOnlyInteractionEnvironment = () => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
        return false;
    }

    const hasFineHoverPointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches
        || window.matchMedia('(any-hover: hover) and (any-pointer: fine)').matches;
    const hasTouchPoints = navigator.maxTouchPoints > 0;
    const hasCoarsePointer = window.matchMedia('(pointer: coarse)').matches
        || window.matchMedia('(any-pointer: coarse)').matches
        || hasTouchPoints;
    const isMobileViewport = window.matchMedia(MOBILE_EDITOR_MEDIA_QUERY).matches;
    const isMobileLikeNavigator = detectMobileLikeNavigator();

    if (isMobileViewport && hasCoarsePointer && (isMobileLikeNavigator || !hasFineHoverPointer)) {
        return true;
    }

    return hasCoarsePointer && !hasFineHoverPointer;
};

export const detectDesktopEditorViewport = () => {
    if (typeof window === 'undefined') {
        return false;
    }

    return window.matchMedia(DESKTOP_EDITOR_MEDIA_QUERY).matches;
};

export const resolveVisibleSectionOrder = (
    sectionOrder: string[],
    hasMeaningfulSummary: boolean
) => (hasMeaningfulSummary
    ? sectionOrder
    : sectionOrder.filter((sectionId) => sectionId !== 'summary'));

export const resolveContactItems = (
    profile: Pick<ResumeEditorProfile, 'email' | 'phone' | 'location' | 'linkedin'>
) => [profile.email, profile.phone, profile.location, profile.linkedin]
    .map((value) => value?.trim() ?? '')
    .filter(Boolean);

export const isSplitSidebarEligibleSection = (sectionId: string) => (
    sectionId === 'summary'
    || sectionId === 'education'
    || sectionId === 'certifications'
    || sectionId === 'skills'
);

export const resolveSplitColumnSectionIds = (
    visibleSectionOrder: string[],
    isSplitTemplate: boolean
) => {
    if (!isSplitTemplate) {
        return {
            sidebar: [] as string[],
            main: visibleSectionOrder,
        };
    }

    const sidebar: string[] = [];
    const main: string[] = [];
    let hasEnteredMainColumn = false;

    for (const sectionId of visibleSectionOrder) {
        // Once the user places any section into the main flow, later sections should
        // stay in that flow so the saved section order remains visible in split layouts.
        if (!hasEnteredMainColumn && isSplitSidebarEligibleSection(sectionId)) {
            sidebar.push(sectionId);
            continue;
        }

        hasEnteredMainColumn = true;
        main.push(sectionId);
    }

    return { sidebar, main };
};

export const resolveProfileInitials = (name: string) => {
    const normalized = name.trim();
    if (!normalized) {
        return '简历';
    }
    const parts = normalized.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
        return parts[0].slice(0, 2).toUpperCase();
    }
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
};

export const resolveSectionSpacingPx = (spacingClass: string) => {
    const spacingMap: Record<string, number> = {
        'mb-2': 8,
        'mb-3': 12,
        'mb-4': 16,
        'mb-5': 20,
        'mb-6': 24,
        'mb-8': 32,
        'mb-10': 40,
        'mb-12': 48,
    };
    return spacingMap[spacingClass] ?? 24;
};

const buildContextText = (star?: StarFields) => {
    const parts = [normalizeStarText(star?.s), normalizeStarText(star?.t)].filter(Boolean);
    return parts.join(STAR_CONTEXT_SEPARATOR);
};

const resolveActionList = (
    value?: string,
    listType: ResumeExperienceListMarkerStyle = 'unordered'
) => {
    const lines = splitRichTextLines(value ?? '');
    return { lines, listType };
};

const renderRichText = (value: string) => ({
    __html: sanitizeRichTextHtml(value),
});

export const renderStarBlocks = (
    star: StarFields,
    itemId: string,
    experienceListMarkerStyle: ResumeExperienceListMarkerStyle
) => {
    const contextText = buildContextText(star);
    const actionList = resolveActionList(star.a, experienceListMarkerStyle);
    const resultText = normalizeStarText(star.r);

    if (!contextText && actionList.lines.length === 0 && !resultText) {
        return null;
    }

    return (
        <>
            {contextText ? (
                <div
                    className={`text-gray-900 text-xs mb-1 ${RICH_TEXT_INLINE_STYLES_CLASS}`}
                    dangerouslySetInnerHTML={renderRichText(contextText)}
                />
            ) : null}
            {actionList.lines.length > 0 ? (
                actionList.listType === 'none' ? (
                    <div
                        className={`space-y-[var(--rf-bullet-spacing)] text-xs text-gray-900 leading-[var(--rf-line-height)] ${RICH_TEXT_INLINE_STYLES_CLASS}`}
                    >
                        {actionList.lines.map((line, index) => (
                            <div key={`${itemId}-action-${index}`} dangerouslySetInnerHTML={{ __html: line }} />
                        ))}
                    </div>
                ) : (
                    React.createElement(
                        actionList.listType === 'ordered' ? 'ol' : 'ul',
                        {
                            className: `${actionList.listType === 'ordered' ? 'list-decimal' : 'list-disc'} list-outside ml-4 text-xs text-gray-900 space-y-[var(--rf-bullet-spacing)] leading-[var(--rf-line-height)] ${RICH_TEXT_LIST_NESTED_CLASS} ${RICH_TEXT_INLINE_STYLES_CLASS}`,
                        },
                        actionList.lines.map((line, index) => (
                            <li key={`${itemId}-action-${index}`} dangerouslySetInnerHTML={{ __html: line }} />
                        ))
                    )
                )
            ) : null}
            {resultText ? (
                <div
                    className={`text-xs text-gray-900 mt-1 ${RICH_TEXT_INLINE_STYLES_CLASS}`}
                    dangerouslySetInnerHTML={renderRichText(resultText)}
                />
            ) : null}
        </>
    );
};
