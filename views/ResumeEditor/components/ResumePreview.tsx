import React from 'react';
import { Edit3, GripVertical } from 'lucide-react';
import {
    FONT_SIZE_DEFAULT,
    HEADER_EXTRA_TOP_SPACING_CLASS,
    PREVIEW_PADDING_MM,
    SECTION_TITLE_BOTTOM_PADDING,
    SECTION_TITLE_BOTTOM_SPACING,
} from '../constants';
import type {
    CertificationView,
    EducationView,
    ResumeEditorProfile,
    ResumeExperienceView,
    SkillGroupView,
    StarFields,
} from '../../../types/resume';
import { buildExperienceDate } from '../../../utils/dateUtils';
import {
    RICH_TEXT_INLINE_STYLES_CLASS,
    sanitizeRichTextHtml,
    splitRichTextLines,
    stripRichTextToText,
} from '../../../utils/richText';
import { type DropPosition, resolveDragTarget } from '../../../utils/dragSort';
import { buildDragItemKey } from '../dragKeys';

type SectionDragHandler = (event: React.DragEvent, sectionId: string) => void;
type ItemDragHandler = (event: React.DragEvent, itemId: string) => void;
type DragHoverHandler = (targetId: string, position: DropPosition) => void;
type DragDropHandler = (event: React.DragEvent) => void;
type TouchDragStartHandler = (id: string) => void;
type TouchDragMode = 'section' | 'item';
type TouchDragSession = {
    touchId: number;
    mode: TouchDragMode;
    sourceId: string;
    container: HTMLElement | null;
    sourceElement: HTMLElement | null;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    sourceRectLeft: number;
    sourceRectTop: number;
    activated: boolean;
    timerId: number | null;
};
type TouchFeedbackState = {
    mode: TouchDragMode;
    sourceId: string;
    phase: 'pressing' | 'dragging';
} | null;
type TouchDragPreviewState = {
    sourceId: string;
    width: number;
    height: number;
    html: string;
};

const STAR_CONTEXT_SEPARATOR = ' ';
const normalizeStarText = (value?: string) => value?.trim() ?? '';
const LIST_GAP_CLASS = 'gap-y-[var(--rf-list-spacing)]';
const RICH_TEXT_LIST_NESTED_CLASS = '[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5';
const DATA_ITEM_ID_ATTR = 'data-rf-item-id';
const DATA_ITEM_CONTAINER_ATTR = 'data-rf-item-container';
const DATA_ITEM_SURFACE_ATTR = 'data-rf-item-surface';
const DATA_SECTION_ID_ATTR = 'data-rf-section-id';
const DATA_SECTION_SURFACE_ATTR = 'data-rf-section-surface';
const PREVIEW_SCALE_EPSILON = 0.001;
const PREVIEW_SIZE_EPSILON = 0.5;
const TOUCH_LONG_PRESS_DELAY_MS = 260;
const TOUCH_DRAG_CANCEL_DISTANCE_PX = 14;
const TOUCH_AUTOSCROLL_EDGE_PX = 88;
const TOUCH_AUTOSCROLL_MAX_STEP_PX = 18;
const TOUCH_DRAG_PREVIEW_LIFT_PX = 10;
const EDITOR_PREVIEW_MAX_A4_HEIGHT_RATIO = 1.4;
const DESKTOP_EDITOR_MEDIA_QUERY = '(min-width: 768px)';
const MOBILE_EDITOR_MEDIA_QUERY = '(max-width: 767px)';
const MOBILE_USER_AGENT_PATTERN = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i;

// Tailwind 的 text-* 类是 rem 单位；仅设置预览容器 fontSize 不会让这些字号随之缩放。
// 这里按比例重写预览内部常用 text-* 的字号，确保“智能一页”调整字号真实生效。
const TAILWIND_TEXT_SIZES_PX = {
    xs: 12,
    sm: 14,
    base: 16,
    lg: 18,
    xl: 20,
    '2xl': 24,
    '3xl': 30,
} as const;

const buildPreviewTypographyCss = (scale: number, previewScope: string) => {
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

const detectTouchOnlyInteractionEnvironment = () => {
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

    // 某些真机手机会同时上报 touch + fine/hover（例如手写笔悬停或厂商定制能力）。
    // 预览区在移动断点下仍应优先采用移动触摸交互，否则会退回旧的长按拖拽模式，
    // 同时失去页面级滚动，出现“卡片长按拖动 + 预览无法滑动”的组合故障。
    if (isMobileViewport && hasCoarsePointer && (isMobileLikeNavigator || !hasFineHoverPointer)) {
        return true;
    }

    return hasCoarsePointer && !hasFineHoverPointer;
};

const detectDesktopEditorViewport = () => {
    if (typeof window === 'undefined') {
        return false;
    }

    return window.matchMedia(DESKTOP_EDITOR_MEDIA_QUERY).matches;
};

const isScrollableOverflow = (overflowValue: string) => (
    overflowValue === 'auto'
    || overflowValue === 'scroll'
    || overflowValue === 'overlay'
);

const findNearestScrollableAncestor = (element: HTMLElement | null) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return null;
    }

    let current = element?.parentElement ?? null;
    while (current) {
        const computedStyle = window.getComputedStyle(current);
        if (
            isScrollableOverflow(computedStyle.overflowY)
            && current.scrollHeight > current.clientHeight
        ) {
            return current;
        }
        current = current.parentElement;
    }

    return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null;
};

const resolveElementVerticalPadding = (element: HTMLElement) => {
    const computedStyle = window.getComputedStyle(element);
    const paddingTop = Number.parseFloat(computedStyle.paddingTop);
    const paddingBottom = Number.parseFloat(computedStyle.paddingBottom);

    return (Number.isFinite(paddingTop) ? paddingTop : 0)
        + (Number.isFinite(paddingBottom) ? paddingBottom : 0);
};

const resolveSectionSpacingPx = (spacingClass: string) => {
    const spacingMap: Record<string, number> = {
        'mb-2': 8,
        'mb-3': 12,
        'mb-4': 16,
        'mb-5': 20,
        'mb-6': 24,
        'mb-8': 32,
    };
    return spacingMap[spacingClass] ?? 24;
};

const buildContextText = (star?: StarFields) => {
    const parts = [normalizeStarText(star?.s), normalizeStarText(star?.t)].filter(Boolean);
    return parts.join(STAR_CONTEXT_SEPARATOR);
};

const resolveActionList = (value?: string) => {
    // Action部分始终显示为无序列表
    const lines = splitRichTextLines(value ?? '');
    return { lines, listType: 'unordered' as const };
};

const renderRichText = (value: string) => ({
    __html: sanitizeRichTextHtml(value),
});

const renderStarBlocks = (star: StarFields, itemId: string) => {
    const contextText = buildContextText(star);
    const actionList = resolveActionList(star.a);
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
                <ul
                    className={`list-disc list-outside ml-4 text-xs text-gray-900 space-y-[var(--rf-bullet-spacing)] leading-[var(--rf-line-height)] ${RICH_TEXT_LIST_NESTED_CLASS} ${RICH_TEXT_INLINE_STYLES_CLASS}`}
                >
                    {actionList.lines.map((line, index) => (
                        <li key={`${itemId}-action-${index}`} dangerouslySetInnerHTML={{ __html: line }} />
                    ))}
                </ul>
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

export type ResumePreviewProps = {
    previewRef: React.RefObject<HTMLDivElement>;
    previewContentRef: React.RefObject<HTMLDivElement>;
    previewScope: string;
    lineHeight: number;
    fontSize: number;
    listSpacingValue: string;
    bulletSpacingValue: string;
    topPaddingPx: number;
    profile: ResumeEditorProfile;
    sectionSpacingClass: string;
    listSpacingClass: string;
    sectionOrder: string[];
    selectedWorkItems: ResumeExperienceView[];
    selectedProjectItems: ResumeExperienceView[];
    educations: EducationView[];
    selectedEduIds: Set<string>;
    sortedCertifications: CertificationView[];
    selectedCertIds: Set<string>;
    selectedSkillGroups: SkillGroupView[];
    readOnly?: boolean;
    isDragging: boolean;
    draggedItemKey: string | null;
    draggedSectionId: string | null;
    onSectionDragStart: SectionDragHandler;
    onSectionDragHover: DragHoverHandler;
    onSectionDrop: DragDropHandler;
    onTouchSectionDragStart: TouchDragStartHandler;
    onItemDragStart: ItemDragHandler;
    onItemDragHover: DragHoverHandler;
    onItemDrop: DragDropHandler;
    onTouchItemDragStart: TouchDragStartHandler;
    onTouchDragEnd: () => void;
    onTouchDragCancel: () => void;
    onDragEnd: () => void;
    onNavigateTab: (tab: 'profile' | 'experience') => void;
    onEditExperience: (id: string) => void;
    onEditCertification: (id: string) => void;
    onEditSkill: (id: string) => void;
};

const ResumePreview: React.FC<ResumePreviewProps> = ({
    previewRef,
    previewContentRef,
    previewScope,
    lineHeight,
    fontSize,
    listSpacingValue,
    bulletSpacingValue,
    topPaddingPx,
    profile,
    sectionSpacingClass,
    listSpacingClass,
    sectionOrder,
    selectedWorkItems,
    selectedProjectItems,
    educations,
    selectedEduIds,
    sortedCertifications,
    selectedCertIds,
    selectedSkillGroups,
    readOnly,
    isDragging,
    draggedItemKey,
    draggedSectionId,
    onSectionDragStart,
    onSectionDragHover,
    onSectionDrop,
    onTouchSectionDragStart,
    onItemDragStart,
    onItemDragHover,
    onItemDrop,
    onTouchItemDragStart,
    onTouchDragEnd,
    onTouchDragCancel,
    onDragEnd,
    onNavigateTab,
    onEditExperience,
    onEditCertification,
    onEditSkill,
}) => {
    const isScaledEditorPreview = previewScope === 'editor' || previewScope === 'dashboard-modal';
    const previewScrollRef = React.useRef<HTMLElement | null>(null);
    const previewViewportRef = React.useRef<HTMLDivElement | null>(null);
    const touchSessionRef = React.useRef<TouchDragSession | null>(null);
    const touchDragPreviewRef = React.useRef<HTMLDivElement | null>(null);
    const desktopDragPreviewRef = React.useRef<HTMLDivElement | null>(null);
    const [touchFeedback, setTouchFeedback] = React.useState<TouchFeedbackState>(null);
    const [touchDragPreview, setTouchDragPreview] = React.useState<TouchDragPreviewState | null>(null);
    const [activeMobileItemControlId, setActiveMobileItemControlId] = React.useState<string | null>(null);
    const [isTouchOnlyInteractionEnvironment, setIsTouchOnlyInteractionEnvironment] = React.useState(
        detectTouchOnlyInteractionEnvironment
    );
    const [isDesktopEditorViewport, setIsDesktopEditorViewport] = React.useState(
        detectDesktopEditorViewport
    );
    const isReadOnly = Boolean(readOnly);
    const useMobileEditorInteraction = previewScope === 'editor' && !isDesktopEditorViewport;
    const showTouchDragHandles = !isReadOnly
        && (isTouchOnlyInteractionEnvironment || useMobileEditorInteraction);
    const usePageScrollOnMobile = useMobileEditorInteraction;
    const previewTypographyCss = React.useMemo(
        () => buildPreviewTypographyCss(fontSize / FONT_SIZE_DEFAULT, previewScope),
        [fontSize, previewScope]
    );
    const [scaledPreviewMetrics, setScaledPreviewMetrics] = React.useState({
        scale: 1,
        widthPx: 0,
        heightPx: 0,
    });
    const sectionSpacingPx = React.useMemo(
        () => resolveSectionSpacingPx(sectionSpacingClass),
        [sectionSpacingClass]
    );
    const sectionInsetPx = React.useMemo(
        () => Math.max(2, Math.round(sectionSpacingPx / 4)),
        [sectionSpacingPx]
    );
    const itemInsetPx = React.useMemo(
        () => Math.max(0, Math.round(sectionSpacingPx / 8)),
        [sectionSpacingPx]
    );
    const sectionTitleGapPx = React.useMemo(
        () => Math.max(4, Math.round(sectionSpacingPx / 2)),
        [sectionSpacingPx]
    );
    const headerBottomPaddingPx = React.useMemo(
        () => Math.max(8, Math.round(sectionSpacingPx * 0.67)),
        [sectionSpacingPx]
    );
    const sectionWrapperStyle = React.useMemo(
        () => ({ marginBottom: `${sectionSpacingPx}px` }),
        [sectionSpacingPx]
    );
    const sectionSurfaceStyle = React.useMemo(
        () => ({
            margin: `${-sectionInsetPx}px`,
            padding: `${sectionInsetPx}px`,
        }),
        [sectionInsetPx]
    );
    const itemSurfaceStyle = React.useMemo(
        () => ({
            margin: `${-itemInsetPx}px`,
            padding: `${itemInsetPx}px`,
        }),
        [itemInsetPx]
    );
    const sectionTitleStyle = React.useMemo(
        () => ({ marginBottom: `${sectionTitleGapPx}px` }),
        [sectionTitleGapPx]
    );
    const summaryHtml = React.useMemo(
        () => sanitizeRichTextHtml(profile.summary ?? ''),
        [profile.summary]
    );
    const hasMeaningfulSummary = React.useMemo(
        () => Boolean(stripRichTextToText(profile.summary ?? '').trim()),
        [profile.summary]
    );
    const visibleSectionOrder = React.useMemo(
        () => (hasMeaningfulSummary ? sectionOrder : sectionOrder.filter((sectionId) => sectionId !== 'summary')),
        [hasMeaningfulSummary, sectionOrder]
    );
    const contactItems = React.useMemo(
        () => [profile.email, profile.phone, profile.location, profile.linkedin]
            .map((value) => value?.trim() ?? '')
            .filter(Boolean),
        [profile.email, profile.linkedin, profile.location, profile.phone]
    );
    const headerStyle = React.useMemo(
        () => ({
            marginBottom: `${sectionSpacingPx}px`,
            paddingBottom: `${headerBottomPaddingPx}px`,
        }),
        [headerBottomPaddingPx, sectionSpacingPx]
    );

    const enableNativeHtmlDrag = !isReadOnly && !isTouchOnlyInteractionEnvironment;
    const isTouchDragging = touchFeedback?.phase === 'dragging';

    // 拖拽时浏览器可能“冻结”hover 状态（尤其是起始元素），导致 hover 高光在拖动过程中残留。
    // 因此拖拽期间禁用所有 hover 视觉反馈，只保留拖拽交互本身（实时重排）。
    const sectionControlBaseClass = showTouchDragHandles
        ? 'absolute -left-10 top-0 z-10 flex flex-col gap-1 rounded-full bg-white/92 p-1 shadow-sm ring-1 ring-gray-200/80 backdrop-blur dark:bg-gray-800/92 dark:ring-gray-700/80'
        : 'absolute -left-6 top-0 flex flex-col gap-1';
    const itemControlBaseClass = showTouchDragHandles
        ? 'absolute -left-10 top-0 z-10 flex flex-col gap-2 rounded-full bg-white/92 p-1.5 shadow-sm ring-1 ring-gray-200/80 backdrop-blur dark:bg-gray-800/92 dark:ring-gray-700/80'
        : 'absolute -left-6 top-0 flex flex-col gap-1';
    const sectionControlClass = isDragging || isReadOnly
        ? `${sectionControlBaseClass} opacity-0`
        : showTouchDragHandles
            ? `${sectionControlBaseClass} opacity-100`
            : `${sectionControlBaseClass} opacity-0 group-hover:opacity-100 transition-opacity`;
    const itemHoverBgClass = isDragging || isReadOnly ? '' : 'group-hover/item:bg-primary/5';
    const sectionDragClass = isReadOnly ? 'cursor-default' : 'cursor-move';
    const itemDragClass = isReadOnly ? 'cursor-default' : 'cursor-move';
    const touchSelectionClass = isReadOnly ? '' : 'select-none';
    const interactionTransitionClass = 'transform-gpu transition-[background-color,box-shadow,transform,ring-color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]';
    const touchHandleStyle = React.useMemo(
        () => ({
            WebkitTouchCallout: isReadOnly ? undefined : 'none',
            WebkitUserSelect: isReadOnly ? undefined : 'none',
            userSelect: isReadOnly ? undefined : 'none',
            touchAction: isReadOnly ? undefined : (isDragging ? 'none' : 'pan-y'),
        } as React.CSSProperties),
        [isDragging, isReadOnly]
    );
    const getTouchFeedbackState = React.useCallback((mode: TouchDragMode, sourceId: string) => {
        if (!touchFeedback || touchFeedback.mode !== mode || touchFeedback.sourceId !== sourceId) {
            return null;
        }
        return touchFeedback.phase;
    }, [touchFeedback]);
    const getSectionSurfaceClass = React.useCallback((sectionId: string) => {
        const feedbackPhase = getTouchFeedbackState('section', sectionId);
        const baseClass = `-m-2 rounded p-2 ${interactionTransitionClass}`;
        if (feedbackPhase === 'dragging' && touchDragPreview?.sourceId === sectionId) {
            return `${baseClass} border border-dashed border-primary/35 bg-primary/[0.03] shadow-none`;
        }
        if (feedbackPhase === 'dragging') {
            return `${baseClass} bg-primary/10 ring-1 ring-primary/35 shadow-[0_14px_32px_rgba(16,185,129,0.14)] -translate-y-0.5`;
        }
        if (feedbackPhase === 'pressing') {
            return `${baseClass} bg-primary/6 ring-1 ring-primary/20 shadow-[0_10px_22px_rgba(16,185,129,0.10)]`;
        }
        return baseClass;
    }, [getTouchFeedbackState, interactionTransitionClass, touchDragPreview?.sourceId]);
    const getItemSurfaceClass = React.useCallback((itemKey: string) => {
        const feedbackPhase = getTouchFeedbackState('item', itemKey);
        const baseClass = `${itemHoverBgClass} -m-2 rounded p-2 ${touchSelectionClass} ${interactionTransitionClass}`;
        if (feedbackPhase === 'dragging' && touchDragPreview?.sourceId === itemKey) {
            return `${baseClass} opacity-20 ring-1 ring-primary/15 shadow-none`;
        }
        if (feedbackPhase === 'dragging') {
            return `${baseClass} bg-white ring-1 ring-primary/35 shadow-[0_18px_38px_rgba(15,23,42,0.16)] -translate-y-1`;
        }
        if (feedbackPhase === 'pressing') {
            return `${baseClass} bg-white/95 ring-1 ring-primary/20 shadow-[0_10px_24px_rgba(15,23,42,0.10)] -translate-y-0.5`;
        }
        return baseClass;
    }, [getTouchFeedbackState, interactionTransitionClass, itemHoverBgClass, touchDragPreview?.sourceId, touchSelectionClass]);
    const getItemControlClass = React.useCallback((itemKey: string) => {
        if (isDragging || isReadOnly) {
            return `${itemControlBaseClass} pointer-events-none opacity-0`;
        }
        if (showTouchDragHandles) {
            const feedbackPhase = getTouchFeedbackState('item', itemKey);
            const isVisible = activeMobileItemControlId === itemKey || feedbackPhase !== null;
            return isVisible
                ? `${itemControlBaseClass} opacity-100`
                : `${itemControlBaseClass} pointer-events-none opacity-0`;
        }
        return `${itemControlBaseClass} opacity-0 group-hover/item:opacity-100 transition-opacity`;
    }, [
        activeMobileItemControlId,
        getTouchFeedbackState,
        isDragging,
        isReadOnly,
        itemControlBaseClass,
        showTouchDragHandles,
    ]);

    const clearTouchDragPreview = React.useCallback(() => {
        setTouchDragPreview(null);
    }, []);

    const clearDesktopDragPreview = React.useCallback(() => {
        const previewNode = desktopDragPreviewRef.current;
        if (!previewNode) {
            return;
        }

        previewNode.remove();
        desktopDragPreviewRef.current = null;
    }, []);

    const createDesktopDragPreview = React.useCallback((
        event: React.DragEvent<HTMLElement>,
        sourceElement: HTMLElement | null
    ) => {
        if (!event.dataTransfer || !sourceElement || typeof document === 'undefined') {
            return;
        }

        clearDesktopDragPreview();

        const rect = sourceElement.getBoundingClientRect();
        if (!rect.width || !rect.height) {
            return;
        }

        const clone = sourceElement.cloneNode(true) as HTMLElement;
        clone.style.margin = '0';
        clone.style.width = `${rect.width}px`;
        clone.style.height = `${rect.height}px`;
        clone.style.maxWidth = 'none';
        clone.style.transform = 'none';
        clone.style.pointerEvents = 'none';
        clone.style.opacity = '1';
        clone.style.boxSizing = 'border-box';

        const previewNode = document.createElement('div');
        previewNode.style.position = 'fixed';
        previewNode.style.left = '-9999px';
        previewNode.style.top = '-9999px';
        previewNode.style.pointerEvents = 'none';
        previewNode.style.zIndex = '-1';
        previewNode.style.width = `${rect.width}px`;
        previewNode.style.height = `${rect.height}px`;
        previewNode.style.borderRadius = '18px';
        previewNode.style.overflow = 'visible';
        previewNode.style.filter = 'drop-shadow(0 22px 40px rgba(15, 23, 42, 0.18))';
        previewNode.style.transform = 'scale(1.03)';
        previewNode.style.transformOrigin = 'top left';
        previewNode.appendChild(clone);
        document.body.appendChild(previewNode);
        desktopDragPreviewRef.current = previewNode;

        const offsetX = Math.min(rect.width - 12, Math.max(12, event.clientX - rect.left));
        const offsetY = Math.min(rect.height - 12, Math.max(12, event.clientY - rect.top));
        event.dataTransfer.setDragImage(previewNode, offsetX, offsetY);
    }, [clearDesktopDragPreview]);

    const updateTouchDragPreviewPosition = React.useCallback((clientX: number, clientY: number) => {
        const previewNode = touchDragPreviewRef.current;
        const session = touchSessionRef.current;
        const previewElement = previewRef.current;
        if (!previewNode || !session || !previewElement) {
            return;
        }

        const previewRect = previewElement.getBoundingClientRect();
        const previewScale = previewElement.offsetWidth > 0
            ? previewRect.width / previewElement.offsetWidth
            : 1;
        const safeScale = previewScale > 0 ? previewScale : 1;
        const left = (clientX - previewRect.left - session.startX + session.sourceRectLeft) / safeScale;
        const top = (clientY - previewRect.top - session.startY + session.sourceRectTop) / safeScale
            - (TOUCH_DRAG_PREVIEW_LIFT_PX / safeScale);

        previewNode.style.transform = `translate3d(${left}px, ${top}px, 0) scale(1.03)`;
    }, [previewRef]);

    const createTouchDragPreview = React.useCallback((session: TouchDragSession) => {
        if (!session.sourceElement) {
            clearTouchDragPreview();
            return;
        }

        const previewElement = previewRef.current;
        if (!previewElement) {
            clearTouchDragPreview();
            return;
        }

        const sourceRect = session.sourceElement.getBoundingClientRect();
        const previewRect = previewElement.getBoundingClientRect();
        const previewScale = previewElement.offsetWidth > 0
            ? previewRect.width / previewElement.offsetWidth
            : 1;
        const safeScale = previewScale > 0 ? previewScale : 1;
        const clone = session.sourceElement.cloneNode(true) as HTMLElement;
        clone.style.margin = '0';
        clone.style.width = '100%';
        clone.style.height = '100%';
        clone.style.maxWidth = 'none';
        clone.style.transform = 'none';
        clone.style.pointerEvents = 'none';
        clone.style.opacity = '1';

        session.sourceRectLeft = sourceRect.left;
        session.sourceRectTop = sourceRect.top;

        setTouchDragPreview({
            sourceId: session.sourceId,
            width: sourceRect.width / safeScale,
            height: sourceRect.height / safeScale,
            html: clone.outerHTML,
        });
    }, [clearTouchDragPreview, previewRef]);

    const cancelTouchSession = React.useCallback(() => {
        const session = touchSessionRef.current;
        if (!session) {
            return;
        }
        if (session.timerId !== null && typeof window !== 'undefined') {
            window.clearTimeout(session.timerId);
        }
        touchSessionRef.current = null;
        setTouchFeedback(null);
        clearTouchDragPreview();
    }, [clearTouchDragPreview]);

    const finishTouchSession = React.useCallback((shouldCommit: boolean) => {
        const session = touchSessionRef.current;
        if (!session) {
            return;
        }
        if (session.timerId !== null && typeof window !== 'undefined') {
            window.clearTimeout(session.timerId);
        }
        const wasActivated = session.activated;
        const shouldPreserveMobileItemControl = showTouchDragHandles && session.mode === 'item';
        touchSessionRef.current = null;
        setTouchFeedback(null);
        clearTouchDragPreview();
        if (!shouldPreserveMobileItemControl && (!shouldCommit || !wasActivated)) {
            setActiveMobileItemControlId(null);
        }
        if (shouldCommit && wasActivated) {
            onTouchDragEnd();
            return;
        }
        if (wasActivated) {
            onTouchDragCancel();
        }
    }, [clearTouchDragPreview, onTouchDragCancel, onTouchDragEnd, showTouchDragHandles]);

    const autoScrollPreview = React.useCallback((clientY: number) => {
        const scrollContainer = usePageScrollOnMobile
            ? findNearestScrollableAncestor(previewScrollRef.current)
            : previewScrollRef.current;
        if (!scrollContainer) {
            return;
        }

        const rect = scrollContainer.getBoundingClientRect();
        if (!rect.height) {
            return;
        }

        let delta = 0;
        if (clientY < rect.top + TOUCH_AUTOSCROLL_EDGE_PX) {
            const ratio = (rect.top + TOUCH_AUTOSCROLL_EDGE_PX - clientY) / TOUCH_AUTOSCROLL_EDGE_PX;
            delta = -Math.max(6, Math.round(TOUCH_AUTOSCROLL_MAX_STEP_PX * Math.min(1, ratio)));
        } else if (clientY > rect.bottom - TOUCH_AUTOSCROLL_EDGE_PX) {
            const ratio = (clientY - (rect.bottom - TOUCH_AUTOSCROLL_EDGE_PX)) / TOUCH_AUTOSCROLL_EDGE_PX;
            delta = Math.max(6, Math.round(TOUCH_AUTOSCROLL_MAX_STEP_PX * Math.min(1, ratio)));
        }

        if (delta !== 0) {
            scrollContainer.scrollTop += delta;
        }
    }, [usePageScrollOnMobile]);

    const updateTouchDragHover = React.useCallback((clientX: number, clientY: number) => {
        const session = touchSessionRef.current;
        if (!session || !session.activated || typeof document === 'undefined') {
            return;
        }

        autoScrollPreview(clientY);
        const currentTarget = document.elementFromPoint(clientX, clientY);

        if (session.mode === 'section') {
            const container = previewContentRef.current;
            if (!container) {
                return;
            }
            const target = resolveDragTarget(
                container,
                clientY,
                DATA_SECTION_ID_ATTR,
                session.sourceId,
                currentTarget
            );
            if (target) {
                onSectionDragHover(target.id, target.position);
            }
            return;
        }

        if (!session.container) {
            return;
        }

        const target = resolveDragTarget(
            session.container,
            clientY,
            DATA_ITEM_ID_ATTR,
            session.sourceId,
            currentTarget
        );
        if (target) {
            onItemDragHover(target.id, target.position);
        }
    }, [autoScrollPreview, onItemDragHover, onSectionDragHover, previewContentRef]);

    const startTouchLongPress = React.useCallback((
        event: React.TouchEvent<HTMLElement>,
        mode: TouchDragMode,
        sourceId: string,
        container: HTMLElement | null,
        sourceElement: HTMLElement | null
    ) => {
        if (isReadOnly || event.touches.length !== 1 || typeof window === 'undefined') {
            return;
        }

        if (touchSessionRef.current?.activated) {
            onTouchDragEnd();
        }
        cancelTouchSession();
        const touch = event.changedTouches[0];
        if (!touch) {
            return;
        }

        const nextSession: TouchDragSession = {
            touchId: touch.identifier,
            mode,
            sourceId,
            container,
            sourceElement,
            startX: touch.clientX,
            startY: touch.clientY,
            currentX: touch.clientX,
            currentY: touch.clientY,
            sourceRectLeft: 0,
            sourceRectTop: 0,
            activated: false,
            timerId: null,
        };
        setTouchFeedback({
            mode,
            sourceId,
            phase: 'pressing',
        });

        nextSession.timerId = window.setTimeout(() => {
            const current = touchSessionRef.current;
            if (
                !current
                || current.touchId !== nextSession.touchId
                || current.mode !== mode
                || current.sourceId !== sourceId
            ) {
                return;
            }

            current.activated = true;
            createTouchDragPreview(current);
            setTouchFeedback({
                mode,
                sourceId,
                phase: 'dragging',
            });
            if (mode === 'section') {
                onTouchSectionDragStart(sourceId);
                return;
            }
            onTouchItemDragStart(sourceId);
        }, TOUCH_LONG_PRESS_DELAY_MS);

        touchSessionRef.current = nextSession;
    }, [cancelTouchSession, createTouchDragPreview, isReadOnly, onTouchDragEnd, onTouchItemDragStart, onTouchSectionDragStart]);

    const handleSectionTitleTouchStart = React.useCallback((
        event: React.TouchEvent<HTMLElement>,
        sectionId: string
    ) => {
        const sectionSurface = event.currentTarget.closest(`[${DATA_SECTION_SURFACE_ATTR}]`);
        startTouchLongPress(
            event,
            'section',
            sectionId,
            previewContentRef.current,
            sectionSurface instanceof HTMLElement ? sectionSurface : null
        );
    }, [previewContentRef, startTouchLongPress]);

    const handleItemCardTouchStart = React.useCallback((
        event: React.TouchEvent<HTMLElement>,
        itemKey: string
    ) => {
        setActiveMobileItemControlId(itemKey);
        if (showTouchDragHandles) {
            return;
        }
        const container = event.currentTarget.closest(`[${DATA_ITEM_CONTAINER_ATTR}]`);
        startTouchLongPress(
            event,
            'item',
            itemKey,
            container instanceof HTMLElement ? container : null,
            event.currentTarget
        );
    }, [showTouchDragHandles, startTouchLongPress]);

    const handleSectionControlTouchStart = React.useCallback((
        event: React.TouchEvent<HTMLElement>,
        sectionId: string
    ) => {
        event.stopPropagation();
        const sectionWrapper = event.currentTarget.closest(`[${DATA_SECTION_ID_ATTR}]`);
        const sectionSurface = sectionWrapper?.querySelector(`[${DATA_SECTION_SURFACE_ATTR}]`);
        startTouchLongPress(
            event,
            'section',
            sectionId,
            previewContentRef.current,
            sectionSurface instanceof HTMLElement ? sectionSurface : null
        );
    }, [previewContentRef, startTouchLongPress]);

    const handleItemControlTouchStart = React.useCallback((
        event: React.TouchEvent<HTMLElement>,
        itemKey: string
    ) => {
        event.stopPropagation();
        setActiveMobileItemControlId(itemKey);
        const itemSurface = event.currentTarget
            .closest(`[${DATA_ITEM_ID_ATTR}]`)
            ?.querySelector(`[${DATA_ITEM_SURFACE_ATTR}]`);
        const container = event.currentTarget.closest(`[${DATA_ITEM_CONTAINER_ATTR}]`);
        startTouchLongPress(
            event,
            'item',
            itemKey,
            container instanceof HTMLElement ? container : null,
            itemSurface instanceof HTMLElement ? itemSurface : null
        );
    }, [startTouchLongPress]);

    const stopTouchStartPropagation = React.useCallback((event: React.TouchEvent<HTMLElement>) => {
        event.stopPropagation();
    }, []);

    const handleNativeSectionDragStart = React.useCallback((
        event: React.DragEvent<HTMLElement>,
        sectionId: string
    ) => {
        const sourceElement = event.currentTarget.querySelector(`[${DATA_SECTION_SURFACE_ATTR}]`);
        createDesktopDragPreview(
            event,
            sourceElement instanceof HTMLElement ? sourceElement : event.currentTarget
        );
        onSectionDragStart(event, sectionId);
    }, [createDesktopDragPreview, onSectionDragStart]);

    const handleNativeItemDragStart = React.useCallback((
        event: React.DragEvent<HTMLElement>,
        itemKey: string
    ) => {
        event.stopPropagation();
        const sourceElement = event.currentTarget.querySelector(`[${DATA_ITEM_SURFACE_ATTR}]`);
        createDesktopDragPreview(
            event,
            sourceElement instanceof HTMLElement ? sourceElement : event.currentTarget
        );
        onItemDragStart(event, itemKey);
    }, [createDesktopDragPreview, onItemDragStart]);

    const handleNativeDragEnd = React.useCallback((event: React.DragEvent<HTMLElement>) => {
        event.stopPropagation();
        clearDesktopDragPreview();
        onDragEnd();
    }, [clearDesktopDragPreview, onDragEnd]);

    React.useEffect(() => {
        if (typeof window === 'undefined') {
            return undefined;
        }

        const mediaQueries = [
            window.matchMedia(MOBILE_EDITOR_MEDIA_QUERY),
            window.matchMedia('(pointer: coarse)'),
            window.matchMedia('(any-pointer: coarse)'),
            window.matchMedia('(hover: hover) and (pointer: fine)'),
            window.matchMedia('(any-hover: hover) and (any-pointer: fine)'),
            window.matchMedia(DESKTOP_EDITOR_MEDIA_QUERY),
        ];
        const updateInteractionEnvironment = () => {
            setIsTouchOnlyInteractionEnvironment(detectTouchOnlyInteractionEnvironment());
            setIsDesktopEditorViewport(detectDesktopEditorViewport());
        };

        updateInteractionEnvironment();
        window.addEventListener('resize', updateInteractionEnvironment);
        mediaQueries.forEach((mediaQuery) => {
            if (typeof mediaQuery.addEventListener === 'function') {
                mediaQuery.addEventListener('change', updateInteractionEnvironment);
                return;
            }
            mediaQuery.addListener(updateInteractionEnvironment);
        });

        return () => {
            window.removeEventListener('resize', updateInteractionEnvironment);
            mediaQueries.forEach((mediaQuery) => {
                if (typeof mediaQuery.removeEventListener === 'function') {
                    mediaQuery.removeEventListener('change', updateInteractionEnvironment);
                    return;
                }
                mediaQuery.removeListener(updateInteractionEnvironment);
            });
        };
    }, []);

    React.useEffect(() => {
        if (typeof document === 'undefined') {
            return undefined;
        }

        const resolveTrackedTouch = (touchList: TouchList, touchId: number) => {
            for (let index = 0; index < touchList.length; index += 1) {
                const touch = touchList.item(index);
                if (touch?.identifier === touchId) {
                    return touch;
                }
            }
            return null;
        };

        const handleTouchMove = (event: TouchEvent) => {
            const session = touchSessionRef.current;
            if (!session) {
                return;
            }
            const touch = resolveTrackedTouch(event.touches, session.touchId);
            if (!touch) {
                return;
            }
            session.currentX = touch.clientX;
            session.currentY = touch.clientY;

            if (!session.activated) {
                const distance = Math.hypot(touch.clientX - session.startX, touch.clientY - session.startY);
                if (distance > TOUCH_DRAG_CANCEL_DISTANCE_PX) {
                    finishTouchSession(false);
                }
                return;
            }

            event.preventDefault();
            updateTouchDragHover(touch.clientX, touch.clientY);
            updateTouchDragPreviewPosition(touch.clientX, touch.clientY);
        };

        const handleTouchFinish = (event: TouchEvent) => {
            const session = touchSessionRef.current;
            if (!session) {
                return;
            }
            const touch = resolveTrackedTouch(event.changedTouches, session.touchId);
            if (!touch) {
                return;
            }

            if (session.activated) {
                event.preventDefault();
            }
            finishTouchSession(session.activated);
        };

        const handleTouchCancel = (event: TouchEvent) => {
            const session = touchSessionRef.current;
            if (!session) {
                return;
            }
            const touch = resolveTrackedTouch(event.changedTouches, session.touchId);
            if (!touch) {
                return;
            }

            finishTouchSession(false);
        };

        document.addEventListener('touchmove', handleTouchMove, { passive: false });
        document.addEventListener('touchend', handleTouchFinish, { passive: false });
        document.addEventListener('touchcancel', handleTouchCancel, { passive: false });

        return () => {
            document.removeEventListener('touchmove', handleTouchMove);
            document.removeEventListener('touchend', handleTouchFinish);
            document.removeEventListener('touchcancel', handleTouchCancel);
        };
    }, [finishTouchSession, updateTouchDragHover, updateTouchDragPreviewPosition]);

    React.useEffect(() => {
        return () => {
            cancelTouchSession();
        };
    }, [cancelTouchSession]);

    React.useEffect(() => {
        if (!showTouchDragHandles || typeof document === 'undefined') {
            return undefined;
        }

        const handleDocumentTouchStart = (event: TouchEvent) => {
            const target = event.target;
            if (!(target instanceof Element)) {
                setActiveMobileItemControlId(null);
                return;
            }

            if (target.closest(`[${DATA_ITEM_ID_ATTR}]`) || target.closest(`[${DATA_SECTION_ID_ATTR}]`)) {
                return;
            }

            setActiveMobileItemControlId(null);
        };

        document.addEventListener('touchstart', handleDocumentTouchStart, { passive: true });
        return () => {
            document.removeEventListener('touchstart', handleDocumentTouchStart);
        };
    }, [showTouchDragHandles]);

    React.useEffect(() => {
        return () => {
            clearDesktopDragPreview();
        };
    }, [clearDesktopDragPreview]);

    React.useEffect(() => {
        if (!isTouchDragging || typeof window === 'undefined' || typeof document === 'undefined') {
            return undefined;
        }

        const preventScroll = (event: TouchEvent | WheelEvent) => {
            event.preventDefault();
        };

        document.addEventListener('touchmove', preventScroll, { passive: false });
        document.addEventListener('wheel', preventScroll, { passive: false });

        return () => {
            document.removeEventListener('touchmove', preventScroll);
            document.removeEventListener('wheel', preventScroll);
        };
    }, [isTouchDragging]);

    React.useLayoutEffect(() => {
        const session = touchSessionRef.current;
        if (!touchDragPreview || !session || !session.activated) {
            return;
        }
        updateTouchDragPreviewPosition(session.currentX, session.currentY);
    }, [touchDragPreview, updateTouchDragPreviewPosition]);

    const syncScaledPreviewMetrics = React.useCallback(() => {
        if (!isScaledEditorPreview) {
            return;
        }

        const scrollContainer = previewScrollRef.current;
        const viewport = previewViewportRef.current;
        const previewElement = previewRef.current;
        if (!viewport || !previewElement) {
            return;
        }

        const intrinsicWidth = previewElement.offsetWidth;
        const intrinsicHeight = previewElement.offsetHeight;
        const availableWidth = viewport.clientWidth;
        if (!intrinsicWidth || !intrinsicHeight || !availableWidth) {
            return;
        }

        const widthFitScale = availableWidth / intrinsicWidth;
        let scale = widthFitScale;

        const isDesktopEditorPreview = previewScope === 'editor' && detectDesktopEditorViewport();
        if (isDesktopEditorPreview && scrollContainer) {
            const availableHeight = scrollContainer.clientHeight - resolveElementVerticalPadding(scrollContainer);

            if (availableHeight > 0 && intrinsicHeight > 0) {
                const heightFitScale = (availableHeight * EDITOR_PREVIEW_MAX_A4_HEIGHT_RATIO) / intrinsicHeight;
                scale = Math.min(scale, heightFitScale);
            }
        }

        scale = Math.min(1, scale);
        const nextMetrics = {
            scale,
            widthPx: intrinsicWidth * scale,
            heightPx: intrinsicHeight * scale,
        };

        setScaledPreviewMetrics((currentMetrics) => {
            if (
                Math.abs(currentMetrics.scale - nextMetrics.scale) < PREVIEW_SCALE_EPSILON
                && Math.abs(currentMetrics.widthPx - nextMetrics.widthPx) < PREVIEW_SIZE_EPSILON
                && Math.abs(currentMetrics.heightPx - nextMetrics.heightPx) < PREVIEW_SIZE_EPSILON
            ) {
                return currentMetrics;
            }
            return nextMetrics;
        });
    }, [isScaledEditorPreview, previewRef, previewScope]);

    React.useLayoutEffect(() => {
        if (!isScaledEditorPreview) {
            return;
        }

        syncScaledPreviewMetrics();

        const handleResize = () => {
            syncScaledPreviewMetrics();
        };

        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', handleResize);
            return () => {
                window.removeEventListener('resize', handleResize);
            };
        }

        const resizeObserver = new ResizeObserver(() => {
            syncScaledPreviewMetrics();
        });

        if (previewScrollRef.current) {
            resizeObserver.observe(previewScrollRef.current);
        }
        if (previewViewportRef.current) {
            resizeObserver.observe(previewViewportRef.current);
        }
        if (previewRef.current) {
            resizeObserver.observe(previewRef.current);
        }

        window.addEventListener('resize', handleResize);

        return () => {
            resizeObserver.disconnect();
            window.removeEventListener('resize', handleResize);
        };
    }, [isScaledEditorPreview, previewRef, syncScaledPreviewMetrics]);

    const scaledPreviewWrapperStyle = React.useMemo(() => {
        if (!isScaledEditorPreview) {
            return undefined;
        }

        return {
            width: `${scaledPreviewMetrics.widthPx}px`,
            minHeight: `${scaledPreviewMetrics.heightPx}px`,
        } as React.CSSProperties;
    }, [isScaledEditorPreview, scaledPreviewMetrics.heightPx, scaledPreviewMetrics.widthPx]);

    const previewStyle = React.useMemo(() => {
        const baseStyle = {
            lineHeight,
            fontSize: `${fontSize}px`,
            paddingTop: `${topPaddingPx}px`,
            paddingRight: `${PREVIEW_PADDING_MM}mm`,
            paddingBottom: `${PREVIEW_PADDING_MM}mm`,
            paddingLeft: `${PREVIEW_PADDING_MM}mm`,
            '--rf-line-height': String(lineHeight),
            '--rf-list-spacing': listSpacingValue,
            '--rf-bullet-spacing': bulletSpacingValue,
        } as React.CSSProperties;

        if (!isScaledEditorPreview) {
            return baseStyle;
        }

        return {
            ...baseStyle,
            position: 'absolute',
            inset: 0,
            transform: `scale(${scaledPreviewMetrics.scale})`,
            transformOrigin: 'top left',
        } as React.CSSProperties;
    }, [
        bulletSpacingValue,
        fontSize,
        isScaledEditorPreview,
        lineHeight,
        listSpacingValue,
        scaledPreviewMetrics.scale,
        topPaddingPx,
    ]);

    const renderExperienceSection = (
        sectionId: 'work' | 'project',
        title: string,
        items: ResumeExperienceView[]
    ) => {
        if (!items.length) {
            return null;
        }

        return (
            <div
                key={sectionId}
                id={sectionId}
                data-rf-section-id={sectionId}
                className={`${sectionSpacingClass} scroll-mt-20 relative group ${sectionDragClass}`}
                style={sectionWrapperStyle}
                draggable={enableNativeHtmlDrag}
                onDragStart={
                    enableNativeHtmlDrag ? (event) => handleNativeSectionDragStart(event, sectionId) : undefined
                }
                onDrop={
                    isReadOnly
                        ? undefined
                        : (event) => {
                            event.stopPropagation();
                            onSectionDrop(event);
                        }
                }
                onDragEnd={
                    enableNativeHtmlDrag ? handleNativeDragEnd : undefined
                }
            >
                {!isReadOnly ? (
                    <div
                        className={sectionControlClass}
                        onTouchStart={
                            showTouchDragHandles
                                ? (event) => handleSectionControlTouchStart(event, sectionId)
                                : undefined
                        }
                        style={showTouchDragHandles ? { touchAction: 'none' } : undefined}
                    >
                        <GripVertical className="h-3.5 w-3.5 text-primary cursor-move" />
                    </div>
                ) : null}

                <div
                    data-rf-section-surface={sectionId}
                    className={getSectionSurfaceClass(sectionId)}
                    style={sectionSurfaceStyle}
                >
                    <h2
                        className={`${touchSelectionClass} text-xs font-bold uppercase tracking-widest text-primary border-b border-gray-200 ${SECTION_TITLE_BOTTOM_PADDING} ${SECTION_TITLE_BOTTOM_SPACING}`}
                        style={{ ...sectionTitleStyle, ...touchHandleStyle }}
                        onTouchStart={
                            isReadOnly || showTouchDragHandles
                                ? undefined
                                : (event) => handleSectionTitleTouchStart(event, sectionId)
                        }
                    >
                        {title}
                    </h2>
                    <div
                        className={listSpacingClass}
                        data-rf-item-container={sectionId}
                        onDragOver={
                            isReadOnly
                                ? undefined
                                : (event) => {
                                    if (!draggedItemKey || draggedSectionId) {
                                        return;
                                    }
                                    event.preventDefault();
                                    event.stopPropagation();
                                    const container = event.currentTarget as HTMLElement;
                                    const target = resolveDragTarget(
                                        container,
                                        event.clientY,
                                        DATA_ITEM_ID_ATTR,
                                        draggedItemKey,
                                        event.target
                                    );
                                    if (!target) {
                                        return;
                                    }
                                    onItemDragHover(target.id, target.position);
                                }
                        }
                        onDrop={
                            isReadOnly
                                ? undefined
                                : (event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    onItemDrop(event);
                                }
                        }
                    >
                        {items.map((item) => {
                            const itemKey = buildDragItemKey('experience', item.id);
                            return (
                                <div
                                    key={item.id}
                                    data-rf-item-id={itemKey}
                                    className={`relative group/item ${itemDragClass}`}
                                    draggable={enableNativeHtmlDrag}
                                    onDragStart={
                                        enableNativeHtmlDrag ? (event) => handleNativeItemDragStart(event, itemKey) : undefined
                                    }
                                    onDragEnd={
                                        enableNativeHtmlDrag ? handleNativeDragEnd : undefined
                                    }
                                >
                                    {!isReadOnly ? (
                                        <div
                                            className={getItemControlClass(itemKey)}
                                        >
                                            <div
                                                onTouchStart={
                                                    showTouchDragHandles
                                                        ? (event) => handleItemControlTouchStart(event, itemKey)
                                                        : undefined
                                                }
                                                style={showTouchDragHandles ? { touchAction: 'none' } : undefined}
                                                className={showTouchDragHandles ? 'rounded-full p-0.5' : undefined}
                                            >
                                                <GripVertical className="h-3 w-3 text-gray-400 cursor-move" />
                                            </div>
                                            <button
                                                type="button"
                                                className="inline-flex items-center justify-center rounded-full p-0.5 text-gray-400 hover:text-primary"
                                                onTouchStart={(event) => {
                                                    setActiveMobileItemControlId(itemKey);
                                                    stopTouchStartPropagation(event);
                                                }}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    onEditExperience(item.id);
                                                }}
                                            >
                                                <Edit3 className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    ) : null}

                                        <div
                                            data-rf-item-surface={itemKey}
                                            className={getItemSurfaceClass(itemKey)}
                                            style={{ ...itemSurfaceStyle, ...touchHandleStyle }}
                                            onTouchStart={
                                            isReadOnly
                                                ? undefined
                                                : (event) => handleItemCardTouchStart(event, itemKey)
                                        }
                                    >
                                        <div className="flex justify-between items-baseline mb-1">
                                            <h3 className="text-sm font-bold text-gray-900">
                                                {item.company}
                                            </h3>
                                            <span className="text-xs font-medium text-gray-900">
                                                {item.date}
                                            </span>
                                        </div>
                                        <p className="text-xs font-semibold text-gray-800 mb-1.5">
                                            {item.title}
                                        </p>

                                        {renderStarBlocks(item.star, item.id)}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        );
    };

    const renderSummarySection = () => {
        if (!hasMeaningfulSummary || !summaryHtml.trim()) {
            return null;
        }

        return (
            <div
                key="summary"
                id="summary"
                data-rf-section-id="summary"
                className={`${sectionSpacingClass} scroll-mt-20 relative group ${sectionDragClass}`}
                style={sectionWrapperStyle}
                draggable={enableNativeHtmlDrag}
                onDragStart={
                    enableNativeHtmlDrag
                        ? (event) => handleNativeSectionDragStart(event, 'summary')
                        : undefined
                }
                onDrop={
                    isReadOnly
                        ? undefined
                        : (event) => {
                            event.stopPropagation();
                            onSectionDrop(event);
                        }
                }
                onDragEnd={enableNativeHtmlDrag ? handleNativeDragEnd : undefined}
            >
                {!isReadOnly ? (
                    <div
                        className={sectionControlClass}
                        onTouchStart={
                            showTouchDragHandles
                                ? (event) => handleSectionControlTouchStart(event, 'summary')
                                : undefined
                        }
                        style={showTouchDragHandles ? { touchAction: 'none' } : undefined}
                    >
                        <GripVertical className="h-3.5 w-3.5 text-primary cursor-move" />
                    </div>
                ) : null}
                <div
                    data-rf-section-surface="summary"
                    className={getSectionSurfaceClass('summary')}
                    style={sectionSurfaceStyle}
                >
                    <h2
                        className={`${touchSelectionClass} text-xs font-bold uppercase tracking-widest text-primary border-b border-gray-200 ${SECTION_TITLE_BOTTOM_PADDING} ${SECTION_TITLE_BOTTOM_SPACING}`}
                        style={{ ...sectionTitleStyle, ...touchHandleStyle }}
                        onTouchStart={
                            isReadOnly || showTouchDragHandles
                                ? undefined
                                : (event) => handleSectionTitleTouchStart(event, 'summary')
                        }
                    >
                        个人评价
                    </h2>
                    <div
                        className={`text-sm leading-[var(--rf-line-height)] text-gray-800 ${RICH_TEXT_INLINE_STYLES_CLASS}`}
                        dangerouslySetInnerHTML={{ __html: summaryHtml }}
                    />
                </div>
            </div>
        );
    };

    return (
        <main
            ref={previewScrollRef}
            className={`bg-gray-100 dark:bg-gray-900/50 overflow-x-hidden relative flex justify-center p-3 scroll-smooth md:p-8 ${
                usePageScrollOnMobile ? 'overflow-visible' : 'flex-1 overflow-y-auto'
            }`}
            style={{
                touchAction: isDragging ? 'none' : 'pan-y',
                overscrollBehaviorY: isDragging ? 'none' : (usePageScrollOnMobile ? undefined : 'contain'),
                WebkitOverflowScrolling: usePageScrollOnMobile ? undefined : 'touch',
            }}
        >
            <div
                ref={isScaledEditorPreview ? previewViewportRef : null}
                className="flex w-full justify-center"
            >
                <div
                    className={isScaledEditorPreview ? 'relative shrink-0' : 'relative'}
                    style={scaledPreviewWrapperStyle}
                >
                    <div
                        ref={previewRef}
                        className="a4-preview text-gray-900 relative"
                        data-rf-preview-scope={previewScope}
                        style={previewStyle}
                    >
                <div
                    ref={previewContentRef}
                    onDragOver={
                        isReadOnly
                            ? undefined
                            : (event) => {
                                if (!draggedSectionId || draggedItemKey) {
                                    return;
                                }
                                event.preventDefault();
                                const container = event.currentTarget as HTMLElement;
                                const target = resolveDragTarget(
                                    container,
                                    event.clientY,
                                    DATA_SECTION_ID_ATTR,
                                    draggedSectionId,
                                    event.target
                                );
                                if (!target) {
                                    return;
                                }
                                onSectionDragHover(target.id, target.position);
                            }
                    }
                    onDrop={
                        isReadOnly
                            ? undefined
                            : (event) => {
                                event.preventDefault();
                                onSectionDrop(event);
                            }
                    }
                >
                    <div
                        id="basic-info"
                        className={`border-b-2 border-gray-900 pb-4 ${sectionSpacingClass} ${HEADER_EXTRA_TOP_SPACING_CLASS} text-center scroll-mt-8`}
                        style={headerStyle}
                    >
                        <h1 className="text-3xl font-bold uppercase tracking-widest mb-2 text-gray-900">
                            {profile.name}
                        </h1>
                        {contactItems.length ? (
                            <div className="text-[11px] text-gray-600 flex justify-center flex-wrap gap-x-4 gap-y-1 font-medium">
                                {contactItems.map((item) => (
                                    <span key={item}>{item}</span>
                                ))}
                            </div>
                        ) : null}
                    </div>

                    {visibleSectionOrder.map((sectionId) => {
                        if (sectionId === 'summary') {
                            return renderSummarySection();
                        }

                        if (sectionId === 'work') {
                            return renderExperienceSection('work', '工作经历', selectedWorkItems);
                        }

                        if (sectionId === 'project') {
                            return renderExperienceSection('project', '项目经历', selectedProjectItems);
                        }

                        if (sectionId === 'education' && selectedEduIds.size > 0) {
                            const visibleEducations = educations.filter((edu) => selectedEduIds.has(edu.id));
                            return (
                                <div
                                    key="education"
                                    id="education"
                                    data-rf-section-id="education"
                                    className={`${sectionSpacingClass} scroll-mt-20 relative group ${sectionDragClass}`}
                                    style={sectionWrapperStyle}
                                    draggable={enableNativeHtmlDrag}
                                    onDragStart={
                                        enableNativeHtmlDrag
                                            ? (event) => handleNativeSectionDragStart(event, 'education')
                                            : undefined
                                    }
                                    onDrop={
                                        isReadOnly
                                            ? undefined
                                            : (event) => {
                                                event.stopPropagation();
                                                onSectionDrop(event);
                                            }
                                    }
                                    onDragEnd={
                                        enableNativeHtmlDrag ? handleNativeDragEnd : undefined
                                    }
                                >
                                    {!isReadOnly ? (
                                        <div
                                            className={sectionControlClass}
                                            onTouchStart={
                                                showTouchDragHandles
                                                    ? (event) => handleSectionControlTouchStart(event, 'education')
                                                    : undefined
                                            }
                                            style={showTouchDragHandles ? { touchAction: 'none' } : undefined}
                                        >
                                            <GripVertical className="h-3.5 w-3.5 text-primary cursor-move" />
                                        </div>
                                    ) : null}

                                    <div
                                        data-rf-section-surface="education"
                                        className={getSectionSurfaceClass('education')}
                                        style={sectionSurfaceStyle}
                                    >
                                        <h2
                                            className={`${touchSelectionClass} text-xs font-bold uppercase tracking-widest text-primary border-b border-gray-200 ${SECTION_TITLE_BOTTOM_PADDING} ${SECTION_TITLE_BOTTOM_SPACING}`}
                                            style={{ ...sectionTitleStyle, ...touchHandleStyle }}
                                            onTouchStart={
                                                isReadOnly || showTouchDragHandles
                                                    ? undefined
                                                    : (event) => handleSectionTitleTouchStart(event, 'education')
                                            }
                                        >
                                            教育背景
                                        </h2>
                                        <div
                                            className={`${listSpacingClass} ${LIST_GAP_CLASS}`}
                                            data-rf-item-container="education"
                                            onDragOver={
                                                isReadOnly
                                                    ? undefined
                                                    : (event) => {
                                                        if (!draggedItemKey || draggedSectionId) {
                                                            return;
                                                        }
                                                        event.preventDefault();
                                                        event.stopPropagation();
                                                        const container = event.currentTarget as HTMLElement;
                                                        const target = resolveDragTarget(
                                                            container,
                                                            event.clientY,
                                                            DATA_ITEM_ID_ATTR,
                                                            draggedItemKey,
                                                            event.target
                                                        );
                                                        if (!target) {
                                                            return;
                                                        }
                                                        onItemDragHover(target.id, target.position);
                                                    }
                                            }
                                            onDrop={
                                                isReadOnly
                                                    ? undefined
                                                    : (event) => {
                                                        event.preventDefault();
                                                        event.stopPropagation();
                                                        onItemDrop(event);
                                                    }
                                            }
                                        >
                                            {visibleEducations.map((edu) => {
                                                const itemKey = buildDragItemKey('education', edu.id);
                                                const dateText = buildExperienceDate(
                                                    edu.startDate,
                                                    edu.endDate,
                                                    edu.isCurrent
                                                );
                                                return (
                                                    <div
                                                        key={edu.id}
                                                        data-rf-item-id={itemKey}
                                                        className={`relative group/item ${itemDragClass}`}
                                                        draggable={enableNativeHtmlDrag}
                                                        onDragStart={
                                                            enableNativeHtmlDrag
                                                                ? (event) => handleNativeItemDragStart(event, itemKey)
                                                                : undefined
                                                        }
                                                        onDragEnd={
                                                            enableNativeHtmlDrag ? handleNativeDragEnd : undefined
                                                        }
                                                    >
                                                        {!isReadOnly ? (
                                                            <div
                                                                className={getItemControlClass(itemKey)}
                                                            >
                                                                <div
                                                                    onTouchStart={
                                                                        showTouchDragHandles
                                                                            ? (event) => handleItemControlTouchStart(event, itemKey)
                                                                        : undefined
                                                                    }
                                                                    style={showTouchDragHandles ? { touchAction: 'none' } : undefined}
                                                                    className={showTouchDragHandles ? 'rounded-full p-0.5' : undefined}
                                                                >
                                                                    <GripVertical className="h-3 w-3 text-gray-400 cursor-move" />
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    className="inline-flex items-center justify-center rounded-full p-0.5 text-gray-400 hover:text-primary"
                                                                    onTouchStart={(event) => {
                                                                        setActiveMobileItemControlId(itemKey);
                                                                        stopTouchStartPropagation(event);
                                                                    }}
                                                                    onClick={(event) => {
                                                                        event.stopPropagation();
                                                                        onNavigateTab('profile');
                                                                    }}
                                                                >
                                                                    <Edit3 className="h-3.5 w-3.5" />
                                                                </button>
                                                            </div>
                                                        ) : null}
                                                        <div
                                                            data-rf-item-surface={itemKey}
                                                            className={getItemSurfaceClass(itemKey)}
                                                            style={{ ...itemSurfaceStyle, ...touchHandleStyle }}
                                                            onTouchStart={
                                                                isReadOnly
                                                                    ? undefined
                                                                    : (event) => handleItemCardTouchStart(event, itemKey)
                                                            }
                                                        >
                                                            <div className="flex justify-between items-baseline mb-0.5">
                                                                <h3 className="text-sm font-bold text-gray-900">
                                                                    {edu.school}
                                                                </h3>
                                                                <span className="text-xs font-medium text-gray-900">
                                                                    {dateText}
                                                                </span>
                                                            </div>
                                                            <p className="text-xs text-gray-900">
                                                                {edu.major}, {edu.degree}
                                                            </p>
                                                            {edu.gpa ? (
                                                                <p className="text-xs text-gray-900">GPA: {edu.gpa}</p>
                                                            ) : null}
                                                            {edu.courses ? (
                                                                <p className="text-xs text-gray-900">课程：{edu.courses}</p>
                                                            ) : null}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            );
                        }

                        if (sectionId === 'certifications' && selectedCertIds.size > 0) {
                            const visibleCerts = sortedCertifications.filter((cert) => selectedCertIds.has(cert.id));
                            return (
                                <div
                                    key="certifications"
                                    id="certifications"
                                    className={`${sectionSpacingClass} scroll-mt-20 relative group ${sectionDragClass}`}
                                    style={sectionWrapperStyle}
                                    data-rf-section-id="certifications"
                                    draggable={enableNativeHtmlDrag}
                                    onDragStart={
                                        enableNativeHtmlDrag
                                            ? (event) => handleNativeSectionDragStart(event, 'certifications')
                                            : undefined
                                    }
                                    onDrop={
                                        isReadOnly
                                            ? undefined
                                            : (event) => {
                                                event.stopPropagation();
                                                onSectionDrop(event);
                                            }
                                    }
                                    onDragEnd={
                                        enableNativeHtmlDrag ? handleNativeDragEnd : undefined
                                    }
                                >
                                    {!isReadOnly ? (
                                        <div
                                            className={sectionControlClass}
                                            onTouchStart={
                                                showTouchDragHandles
                                                    ? (event) => handleSectionControlTouchStart(event, 'certifications')
                                                    : undefined
                                            }
                                            style={showTouchDragHandles ? { touchAction: 'none' } : undefined}
                                        >
                                            <GripVertical className="h-3.5 w-3.5 text-primary cursor-move" />
                                        </div>
                                    ) : null}

                                    <div
                                        data-rf-section-surface="certifications"
                                        className={getSectionSurfaceClass('certifications')}
                                        style={sectionSurfaceStyle}
                                    >
                                        <h2
                                            className={`${touchSelectionClass} text-xs font-bold uppercase tracking-widest text-primary border-b border-gray-200 ${SECTION_TITLE_BOTTOM_PADDING} ${SECTION_TITLE_BOTTOM_SPACING}`}
                                            style={{ ...sectionTitleStyle, ...touchHandleStyle }}
                                            onTouchStart={
                                                isReadOnly || showTouchDragHandles
                                                    ? undefined
                                                    : (event) => handleSectionTitleTouchStart(event, 'certifications')
                                            }
                                        >
                                            证书资质
                                        </h2>
                                        <div
                                            className={`${listSpacingClass} ${LIST_GAP_CLASS}`}
                                            data-rf-item-container="certifications"
                                            onDragOver={
                                                isReadOnly
                                                    ? undefined
                                                    : (event) => {
                                                        if (!draggedItemKey || draggedSectionId) {
                                                            return;
                                                        }
                                                        event.preventDefault();
                                                        event.stopPropagation();
                                                        const container = event.currentTarget as HTMLElement;
                                                        const target = resolveDragTarget(
                                                            container,
                                                            event.clientY,
                                                            DATA_ITEM_ID_ATTR,
                                                            draggedItemKey,
                                                            event.target
                                                        );
                                                        if (!target) {
                                                            return;
                                                        }
                                                        onItemDragHover(target.id, target.position);
                                                    }
                                            }
                                            onDrop={
                                                isReadOnly
                                                    ? undefined
                                                    : (event) => {
                                                        event.preventDefault();
                                                        event.stopPropagation();
                                                        onItemDrop(event);
                                                    }
                                            }
                                        >
                                            {visibleCerts.map((cert) => {
                                                const itemKey = buildDragItemKey('certification', cert.id);
                                                return (
                                                    <div
                                                        key={cert.id}
                                                        data-rf-item-id={itemKey}
                                                        className={`relative group/item ${itemDragClass}`}
                                                        draggable={enableNativeHtmlDrag}
                                                        onDragStart={
                                                            enableNativeHtmlDrag
                                                                ? (event) => handleNativeItemDragStart(event, itemKey)
                                                                : undefined
                                                        }
                                                        onDragEnd={
                                                            enableNativeHtmlDrag ? handleNativeDragEnd : undefined
                                                        }
                                                    >
                                                        {!isReadOnly ? (
                                                            <div
                                                                className={getItemControlClass(itemKey)}
                                                            >
                                                                <div
                                                                    onTouchStart={
                                                                        showTouchDragHandles
                                                                            ? (event) => handleItemControlTouchStart(event, itemKey)
                                                                        : undefined
                                                                    }
                                                                    style={showTouchDragHandles ? { touchAction: 'none' } : undefined}
                                                                    className={showTouchDragHandles ? 'rounded-full p-0.5' : undefined}
                                                                >
                                                                    <GripVertical className="h-3 w-3 text-gray-400 cursor-move" />
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    className="inline-flex items-center justify-center rounded-full p-0.5 text-gray-400 hover:text-primary"
                                                                    onTouchStart={(event) => {
                                                                        setActiveMobileItemControlId(itemKey);
                                                                        stopTouchStartPropagation(event);
                                                                    }}
                                                                    onClick={(event) => {
                                                                        event.stopPropagation();
                                                                        onEditCertification(cert.id);
                                                                    }}
                                                                >
                                                                    <Edit3 className="h-3.5 w-3.5" />
                                                                </button>
                                                            </div>
                                                        ) : null}
                                                        <div
                                                            data-rf-item-surface={itemKey}
                                                            className={getItemSurfaceClass(itemKey)}
                                                            style={{ ...itemSurfaceStyle, ...touchHandleStyle }}
                                                            onTouchStart={
                                                                isReadOnly
                                                                    ? undefined
                                                                    : (event) => handleItemCardTouchStart(event, itemKey)
                                                            }
                                                        >
                                                            <div className="flex justify-between items-baseline">
                                                                <div>
                                                                    <span className="text-xs font-bold text-gray-900">
                                                                        {cert.name}
                                                                    </span>
                                                                    {cert.issuer ? (
                                                                        <span className="text-xs text-gray-900 ml-2">
                                                                            ({cert.issuer})
                                                                        </span>
                                                                    ) : null}
                                                                </div>
                                                                <span className="text-xs text-gray-900">{cert.date}</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            );
                        }

                        if (sectionId === 'skills' && selectedSkillGroups.length > 0) {
                            return (
                                <div
                                    key="skills"
                                    id="skills"
                                    data-rf-section-id="skills"
                                    className={`${sectionSpacingClass} scroll-mt-20 relative group ${sectionDragClass}`}
                                    style={sectionWrapperStyle}
                                    draggable={enableNativeHtmlDrag}
                                    onDragStart={
                                        enableNativeHtmlDrag
                                            ? (event) => handleNativeSectionDragStart(event, 'skills')
                                            : undefined
                                    }
                                    onDrop={
                                        isReadOnly
                                            ? undefined
                                            : (event) => {
                                                event.stopPropagation();
                                                onSectionDrop(event);
                                            }
                                    }
                                    onDragEnd={
                                        enableNativeHtmlDrag ? handleNativeDragEnd : undefined
                                    }
                                >
                                    {!isReadOnly ? (
                                        <div
                                            className={sectionControlClass}
                                            onTouchStart={
                                                showTouchDragHandles
                                                    ? (event) => handleSectionControlTouchStart(event, 'skills')
                                                    : undefined
                                            }
                                            style={showTouchDragHandles ? { touchAction: 'none' } : undefined}
                                        >
                                            <GripVertical className="h-3.5 w-3.5 text-primary cursor-move" />
                                        </div>
                                    ) : null}

                                    <div
                                        data-rf-section-surface="skills"
                                        className={getSectionSurfaceClass('skills')}
                                        style={sectionSurfaceStyle}
                                    >
                                        <h2
                                            className={`${touchSelectionClass} text-xs font-bold uppercase tracking-widest text-primary border-b border-gray-200 ${SECTION_TITLE_BOTTOM_PADDING} ${SECTION_TITLE_BOTTOM_SPACING}`}
                                            style={{ ...sectionTitleStyle, ...touchHandleStyle }}
                                            onTouchStart={
                                                isReadOnly || showTouchDragHandles
                                                    ? undefined
                                                    : (event) => handleSectionTitleTouchStart(event, 'skills')
                                            }
                                        >
                                            专业技能
                                        </h2>
                                        <div
                                            className="text-xs text-gray-800 space-y-[var(--rf-list-spacing)]"
                                            data-rf-item-container="skills"
                                            onDragOver={
                                                isReadOnly
                                                    ? undefined
                                                    : (event) => {
                                                        if (!draggedItemKey || draggedSectionId) {
                                                            return;
                                                        }
                                                        event.preventDefault();
                                                        event.stopPropagation();
                                                        const container = event.currentTarget as HTMLElement;
                                                        const target = resolveDragTarget(
                                                            container,
                                                            event.clientY,
                                                            DATA_ITEM_ID_ATTR,
                                                            draggedItemKey,
                                                            event.target
                                                        );
                                                        if (!target) {
                                                            return;
                                                        }
                                                        onItemDragHover(target.id, target.position);
                                                    }
                                            }
                                            onDrop={
                                                isReadOnly
                                                    ? undefined
                                                    : (event) => {
                                                        event.preventDefault();
                                                        event.stopPropagation();
                                                        onItemDrop(event);
                                                    }
                                            }
                                        >
                                            {selectedSkillGroups.map((group) => {
                                                const itemKey = buildDragItemKey('skillGroup', group.name);
                                                const editableSkill = group.skills[0];
                                                return (
                                                    <div
                                                        key={group.name}
                                                        data-rf-item-id={itemKey}
                                                        className={`relative group/item ${itemDragClass}`}
                                                        draggable={enableNativeHtmlDrag}
                                                        onDragStart={
                                                            enableNativeHtmlDrag
                                                                ? (event) => handleNativeItemDragStart(event, itemKey)
                                                                : undefined
                                                        }
                                                        onDragEnd={
                                                            enableNativeHtmlDrag ? handleNativeDragEnd : undefined
                                                        }
                                                    >
                                                        {!isReadOnly ? (
                                                            <div
                                                                className={getItemControlClass(itemKey)}
                                                            >
                                                                <div
                                                                    onTouchStart={
                                                                        showTouchDragHandles
                                                                            ? (event) => handleItemControlTouchStart(event, itemKey)
                                                                        : undefined
                                                                    }
                                                                    style={showTouchDragHandles ? { touchAction: 'none' } : undefined}
                                                                    className={showTouchDragHandles ? 'rounded-full p-0.5' : undefined}
                                                                >
                                                                    <GripVertical className="h-3 w-3 text-gray-400 cursor-move" />
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    className="inline-flex items-center justify-center rounded-full p-0.5 text-gray-400 hover:text-primary"
                                                                    onTouchStart={(event) => {
                                                                        setActiveMobileItemControlId(itemKey);
                                                                        stopTouchStartPropagation(event);
                                                                    }}
                                                                    onClick={(event) => {
                                                                        event.stopPropagation();
                                                                        if (!editableSkill) {
                                                                            return;
                                                                        }
                                                                        onEditSkill(editableSkill.id);
                                                                    }}
                                                                >
                                                                    <Edit3 className="h-3.5 w-3.5" />
                                                                </button>
                                                            </div>
                                                        ) : null}
                                                        <div
                                                            data-rf-item-surface={itemKey}
                                                            className={getItemSurfaceClass(itemKey)}
                                                            style={{ ...itemSurfaceStyle, ...touchHandleStyle }}
                                                            onTouchStart={
                                                                isReadOnly
                                                                    ? undefined
                                                                    : (event) => handleItemCardTouchStart(event, itemKey)
                                                            }
                                                        >
                                                            <div className={`grid grid-cols-[100px_1fr] ${LIST_GAP_CLASS}`}>
                                                                <span className="font-bold text-gray-900">{group.name}:</span>
                                                                <span>{group.skills.map((skill) => skill.name).join(', ')}</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            );
                        }

                        return null;
                    })}
                </div>
                {touchDragPreview ? (
                    <div
                        ref={touchDragPreviewRef}
                        className="pointer-events-none absolute left-0 top-0 z-[60] overflow-visible rounded-[18px]"
                        style={{
                            width: `${touchDragPreview.width}px`,
                            height: `${touchDragPreview.height}px`,
                            transform: 'translate3d(-200vw, -200vh, 0) scale(1.03)',
                            transformOrigin: 'top left',
                            willChange: 'transform',
                            filter: 'drop-shadow(0 22px 40px rgba(15, 23, 42, 0.18))',
                        }}
                        dangerouslySetInnerHTML={{ __html: touchDragPreview.html }}
                    />
                ) : null}
                    </div>
                </div>
            </div>
            <style>{previewTypographyCss}</style>
        </main>
    );
};

export default ResumePreview;
