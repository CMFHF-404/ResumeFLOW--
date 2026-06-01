import type React from 'react';
import type {
    ResumeTemplateDefinition,
    ResumeThemeColorDefinition,
} from '../../../../constants/resumeTemplates';
import {
    A4_PAGE_HEIGHT_MM,
    A4_PAGE_WIDTH_MM,
} from './previewRenderUtils';
import { PREVIEW_PADDING_MM } from '../../constants';

export const buildPreviewSpacingStyles = (sectionSpacingPx: number) => {
    const sectionInsetPx = Math.max(2, Math.round(sectionSpacingPx / 4));
    const itemInsetPx = Math.max(0, Math.round(sectionSpacingPx / 8));
    const sectionTitleGapPx = Math.max(4, Math.round(sectionSpacingPx / 2));
    const headerBottomPaddingPx = Math.max(8, Math.round(sectionSpacingPx * 0.67));

    return {
        sectionInsetPx,
        itemInsetPx,
        sectionTitleGapPx,
        headerBottomPaddingPx,
        sectionWrapperStyle: { marginBottom: `${sectionSpacingPx}px` } as React.CSSProperties,
        sectionSurfaceStyle: {
            margin: `${-sectionInsetPx}px`,
            padding: `${sectionInsetPx}px`,
        } as React.CSSProperties,
        itemSurfaceStyle: {
            margin: `${-itemInsetPx}px`,
            padding: `${itemInsetPx}px`,
        } as React.CSSProperties,
        sectionTitleStyle: { marginBottom: `${sectionTitleGapPx}px` } as React.CSSProperties,
        headerStyle: {
            marginBottom: `${sectionSpacingPx}px`,
            paddingBottom: `${headerBottomPaddingPx}px`,
        } as React.CSSProperties,
    };
};

export const buildPreviewInteractionClasses = ({
    showTouchDragHandles,
    isDragging,
    isReadOnly,
}: {
    showTouchDragHandles: boolean;
    isDragging: boolean;
    isReadOnly: boolean;
}) => {
    const sectionControlBaseClass = showTouchDragHandles
        ? 'absolute -left-10 top-0 z-10 flex flex-col gap-1 rounded-full bg-white/92 p-1 shadow-sm ring-1 ring-gray-200/80 backdrop-blur dark:bg-gray-800/92 dark:ring-gray-700/80'
        : 'absolute -left-6 top-0 flex flex-col gap-1';
    const itemControlBaseClass = showTouchDragHandles
        ? 'absolute -left-10 top-0 z-10 flex flex-col gap-2 rounded-full bg-white/92 p-1.5 shadow-sm ring-1 ring-gray-200/80 backdrop-blur dark:bg-gray-800/92 dark:ring-gray-700/80'
        : 'absolute -left-6 top-0 flex flex-col gap-1';

    return {
        sectionControlBaseClass,
        itemControlBaseClass,
        sectionControlClass: isDragging || isReadOnly
            ? `${sectionControlBaseClass} opacity-0`
            : showTouchDragHandles
                ? `${sectionControlBaseClass} opacity-100`
                : `${sectionControlBaseClass} opacity-0 group-hover:opacity-100 transition-opacity`,
        itemHoverBgClass: isDragging || isReadOnly ? '' : 'group-hover/item:bg-primary/5',
        sectionDragClass: isReadOnly ? 'cursor-default' : 'cursor-move',
        itemDragClass: isReadOnly ? 'cursor-default' : 'cursor-move',
        touchSelectionClass: isReadOnly ? '' : 'select-none',
        interactionTransitionClass: 'transform-gpu transition-[background-color,box-shadow,transform,ring-color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
    };
};

export const buildTouchHandleStyle = (
    isReadOnly: boolean,
    isDragging: boolean
): React.CSSProperties => ({
    WebkitTouchCallout: isReadOnly ? undefined : 'none',
    WebkitUserSelect: isReadOnly ? undefined : 'none',
    userSelect: isReadOnly ? undefined : 'none',
    touchAction: isReadOnly ? undefined : (isDragging ? 'none' : 'pan-y'),
});

export const resolveTemplateSectionSurfaceToneClass = ({
    sectionId,
    activeTemplate,
    isSplitTemplate,
    isTimelineBlueTemplate,
    splitSidebarSectionIdSet,
}: {
    sectionId: string;
    activeTemplate: ResumeTemplateDefinition;
    isSplitTemplate: boolean;
    isTimelineBlueTemplate: boolean;
    splitSidebarSectionIdSet: Set<string>;
}) => {
    if (isSplitTemplate && splitSidebarSectionIdSet.has(sectionId)) {
        return 'rounded-none border-0 bg-transparent';
    }
    if (
        activeTemplate.layoutKind === 'accent'
        || activeTemplate.layoutKind === 'minimal'
        || activeTemplate.layoutKind === 'avatar'
        || isTimelineBlueTemplate
    ) {
        return 'bg-transparent';
    }
    return '';
};

export const resolveSectionHeadingTextClassName = (
    activeTemplate: ResumeTemplateDefinition,
    isOpenSourceClassicTemplate: boolean,
    isTimelineBlueTemplate: boolean
) => {
    if (isOpenSourceClassicTemplate) {
        return 'text-[11px] tracking-[0.2em]';
    }
    if (isTimelineBlueTemplate) {
        return 'text-[11px] tracking-[0.18em]';
    }
    if (activeTemplate.layoutKind === 'minimal') {
        return 'text-[11px] tracking-[0.28em] text-gray-500';
    }
    if (activeTemplate.layoutKind === 'split') {
        return 'text-[11px] tracking-[0.18em]';
    }
    return 'text-xs tracking-widest';
};

export const resolveSectionHeadingBorderClassName = (
    activeTemplate: ResumeTemplateDefinition,
    isOpenSourceClassicTemplate: boolean,
    isPhotoCardTemplate: boolean,
    isTimelineBlueTemplate: boolean
) => {
    if (isPhotoCardTemplate) {
        return 'border-b pb-1';
    }
    if (isTimelineBlueTemplate) {
        return '';
    }
    if (isOpenSourceClassicTemplate) {
        return 'border-b';
    }
    if (activeTemplate.layoutKind === 'minimal') {
        return 'border-b border-gray-200';
    }
    if (activeTemplate.layoutKind === 'accent') {
        return '';
    }
    if (activeTemplate.layoutKind === 'avatar') {
        return 'border-b-[2.5px] pb-1';
    }
    return 'border-b';
};

export const buildPreviewPageStyle = ({
    lineHeight,
    fontSize,
    topPaddingPx,
    listSpacingValue,
    bulletSpacingValue,
    activeThemeColor,
    isPrintPreview,
    isScaledEditorPreview,
    isSplitTemplate,
    isPhotoCardTemplate,
    scale,
}: {
    lineHeight: number;
    fontSize: number;
    topPaddingPx: number;
    listSpacingValue: string;
    bulletSpacingValue: string;
    activeThemeColor: ResumeThemeColorDefinition;
    isPrintPreview: boolean;
    isScaledEditorPreview: boolean;
    isSplitTemplate: boolean;
    isPhotoCardTemplate: boolean;
    scale: number;
}) => {
    const baseStyle = {
        boxSizing: 'border-box',
        width: `${A4_PAGE_WIDTH_MM}mm`,
        height: isPrintPreview ? 'auto' : `${A4_PAGE_HEIGHT_MM}mm`,
        minHeight: `${A4_PAGE_HEIGHT_MM}mm`,
        lineHeight,
        fontSize: `${fontSize}px`,
        paddingTop: `${topPaddingPx}px`,
        paddingRight: `${PREVIEW_PADDING_MM}mm`,
        paddingBottom: `${PREVIEW_PADDING_MM}mm`,
        paddingLeft: `${PREVIEW_PADDING_MM}mm`,
        '--rf-line-height': String(lineHeight),
        '--rf-list-spacing': listSpacingValue,
        '--rf-bullet-spacing': bulletSpacingValue,
        '--rf-accent-color': activeThemeColor.accentColor,
        '--rf-accent-soft-bg': activeThemeColor.accentSoftBg,
        '--rf-accent-border': activeThemeColor.accentBorder,
        '--rf-accent-text': activeThemeColor.accentText,
        background: isSplitTemplate
            ? 'transparent'
            : isPhotoCardTemplate
                ? `linear-gradient(180deg, ${activeThemeColor.accentColor} 0px, ${activeThemeColor.accentColor} 64px, ${activeThemeColor.accentSoftBg} 110px, #ffffff 165px)`
                : '#ffffff',
    } as React.CSSProperties;

    if (!isScaledEditorPreview) {
        return baseStyle;
    }

    return {
        ...baseStyle,
        position: 'absolute',
        inset: 0,
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
    } as React.CSSProperties;
};

export const buildPreviewContentLayoutClassName = (
    isSplitTemplate: boolean,
    isReadOnly: boolean
) => (isSplitTemplate
    ? `relative z-[1] grid grid-cols-[0.8fr_1.2fr] rounded-[30px] ${isReadOnly ? 'overflow-hidden' : ''}`.trim()
    : '');

export const buildPreviewContentLayoutStyle = (
    isSplitTemplate: boolean,
    topPaddingPx: number
) => (isSplitTemplate
    ? {
        minHeight: `calc(${A4_PAGE_HEIGHT_MM}mm - ${topPaddingPx}px - ${PREVIEW_PADDING_MM}mm)`,
        gridTemplateRows: '1fr',
    } as React.CSSProperties
    : undefined);

export const buildSplitTemplateBackgroundStyle = (
    isSplitTemplate: boolean,
    isPrintPreview: boolean
) => (isSplitTemplate
    ? { height: isPrintPreview ? '100%' : `${A4_PAGE_HEIGHT_MM}mm` } as React.CSSProperties
    : undefined);
