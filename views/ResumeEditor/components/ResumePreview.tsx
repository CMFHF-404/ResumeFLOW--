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
import { RICH_TEXT_INLINE_STYLES_CLASS, sanitizeRichTextHtml, splitRichTextLines } from '../../../utils/richText';
import { type DropPosition, resolveDragTarget } from '../../../utils/dragSort';
import { buildDragItemKey } from '../dragKeys';

type SectionDragHandler = (event: React.DragEvent, sectionId: string) => void;
type ItemDragHandler = (event: React.DragEvent, itemId: string) => void;
type DragHoverHandler = (targetId: string, position: DropPosition) => void;
type DragDropHandler = (event: React.DragEvent) => void;

const STAR_CONTEXT_SEPARATOR = ' ';
const normalizeStarText = (value?: string) => value?.trim() ?? '';
const LIST_GAP_CLASS = 'gap-y-[var(--rf-list-spacing)]';
const RICH_TEXT_LIST_NESTED_CLASS = '[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5';
const DATA_ITEM_ID_ATTR = 'data-rf-item-id';
const DATA_SECTION_ID_ATTR = 'data-rf-section-id';
const PREVIEW_SCALE_EPSILON = 0.001;
const PREVIEW_SIZE_EPSILON = 0.5;

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
    onItemDragStart: ItemDragHandler;
    onItemDragHover: DragHoverHandler;
    onItemDrop: DragDropHandler;
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
    onItemDragStart,
    onItemDragHover,
    onItemDrop,
    onDragEnd,
    onNavigateTab,
    onEditExperience,
    onEditCertification,
    onEditSkill,
}) => {
    const isScaledEditorPreview = previewScope === 'editor' || previewScope === 'dashboard-modal';
    const previewViewportRef = React.useRef<HTMLDivElement | null>(null);
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
    const headerStyle = React.useMemo(
        () => ({
            marginBottom: `${sectionSpacingPx}px`,
            paddingBottom: `${headerBottomPaddingPx}px`,
        }),
        [headerBottomPaddingPx, sectionSpacingPx]
    );

    const isReadOnly = Boolean(readOnly);

    // 拖拽时浏览器可能“冻结”hover 状态（尤其是起始元素），导致 hover 高光在拖动过程中残留。
    // 因此拖拽期间禁用所有 hover 视觉反馈，只保留拖拽交互本身（实时重排）。
    const sectionControlBaseClass = 'absolute -left-6 top-0 flex flex-col gap-1';
    const sectionControlClass = isDragging || isReadOnly
        ? `${sectionControlBaseClass} opacity-0`
        : `${sectionControlBaseClass} opacity-0 group-hover:opacity-100 transition-opacity`;
    const itemControlClass = isDragging || isReadOnly
        ? 'absolute -left-6 top-0 flex flex-col gap-1 opacity-0'
        : 'absolute -left-6 top-0 flex flex-col gap-1 opacity-0 group-hover/item:opacity-100 transition-opacity';
    const itemHoverBgClass = isDragging || isReadOnly ? '' : 'group-hover/item:bg-primary/5';
    const sectionHoverBgClass = '';
    const sectionDragClass = isReadOnly ? 'cursor-default' : 'cursor-move';
    const itemDragClass = isReadOnly ? 'cursor-default' : 'cursor-move';

    const syncScaledPreviewMetrics = React.useCallback(() => {
        if (!isScaledEditorPreview) {
            return;
        }

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

        const scale = Math.min(1, availableWidth / intrinsicWidth);
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
    }, [isScaledEditorPreview, previewRef]);

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
                draggable={!isReadOnly}
                onDragStart={
                    isReadOnly ? undefined : (event) => onSectionDragStart(event, sectionId)
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
                    isReadOnly
                        ? undefined
                        : (event) => {
                            event.stopPropagation();
                            onDragEnd();
                        }
                }
            >
                {!isReadOnly ? (
                    <div className={sectionControlClass}>
                        <GripVertical className="w-4 h-4 text-primary cursor-move" />
                    </div>
                ) : null}

                <h2
                    className={`text-xs font-bold uppercase tracking-widest text-primary border-b border-gray-200 ${SECTION_TITLE_BOTTOM_PADDING} ${SECTION_TITLE_BOTTOM_SPACING}`}
                    style={sectionTitleStyle}
                >
                    {title}
                </h2>
                <div
                    className={listSpacingClass}
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
                                draggable={!isReadOnly}
                                onDragStart={
                                    isReadOnly
                                        ? undefined
                                        : (event) => {
                                            event.stopPropagation();
                                            onItemDragStart(event, itemKey);
                                        }
                                }
                                onDragEnd={
                                    isReadOnly
                                        ? undefined
                                        : (event) => {
                                            event.stopPropagation();
                                            onDragEnd();
                                        }
                                }
                            >
                                {!isReadOnly ? (
                                    <div className={itemControlClass}>
                                        <GripVertical className="w-3.5 h-3.5 text-gray-400 cursor-move" />
                                        <Edit3
                                            className="w-3.5 h-3.5 text-gray-400 cursor-pointer hover:text-primary"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                onEditExperience(item.id);
                                            }}
                                        />
                                    </div>
                                ) : null}

                                <div
                                    className={`${itemHoverBgClass} -m-2 p-2 rounded transition-colors`}
                                    style={itemSurfaceStyle}
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
        );
    };

    return (
        <main className="flex-1 bg-gray-100 dark:bg-gray-900/50 overflow-y-auto overflow-x-hidden relative flex justify-center p-3 scroll-smooth md:p-8">
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
                        <div className="text-[11px] text-gray-600 flex justify-center flex-wrap gap-x-4 gap-y-1 font-medium">
                            <span>{profile.email}</span>
                            <span>{profile.phone}</span>
                            <span>{profile.location}</span>
                            <span>{profile.linkedin}</span>
                        </div>
                    </div>

                    {sectionOrder.map((sectionId) => {
                        if (sectionId === 'summary') {
                            // 职业总结模块已从编辑流程移除，预览保持隐藏。
                            return null;
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
                                    draggable={!isReadOnly}
                                    onDragStart={
                                        isReadOnly ? undefined : (event) => onSectionDragStart(event, 'education')
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
                                        isReadOnly
                                            ? undefined
                                            : (event) => {
                                                event.stopPropagation();
                                                onDragEnd();
                                            }
                                    }
                                >
                                    {!isReadOnly ? (
                                        <div className={sectionControlClass}>
                                            <GripVertical className="w-4 h-4 text-primary cursor-move" />
                                        </div>
                                    ) : null}

                                    <div
                                        className={`${sectionHoverBgClass} -m-2 p-2 rounded transition-colors`}
                                        style={sectionSurfaceStyle}
                                    >
                                        <h2
                    className={`text-xs font-bold uppercase tracking-widest text-primary border-b border-gray-200 ${SECTION_TITLE_BOTTOM_PADDING} ${SECTION_TITLE_BOTTOM_SPACING}`}
                    style={sectionTitleStyle}
                >
                                            教育背景
                                        </h2>
                                        <div
                                            className={`${listSpacingClass} ${LIST_GAP_CLASS}`}
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
                                                        draggable={!isReadOnly}
                                                        onDragStart={
                                                            isReadOnly
                                                                ? undefined
                                                                : (event) => {
                                                                    event.stopPropagation();
                                                                    onItemDragStart(event, itemKey);
                                                                }
                                                        }
                                                        onDragEnd={
                                                            isReadOnly
                                                                ? undefined
                                                                : (event) => {
                                                                    event.stopPropagation();
                                                                    onDragEnd();
                                                                }
                                                        }
                                                    >
                                                        {!isReadOnly ? (
                                                            <div className={itemControlClass}>
                                                                <GripVertical className="w-3.5 h-3.5 text-gray-400 cursor-move" />
                                                                <Edit3
                                                                    className="w-3.5 h-3.5 text-gray-400 cursor-pointer hover:text-primary"
                                                                    onClick={(event) => {
                                                                        event.stopPropagation();
                                                                        onNavigateTab('profile');
                                                                    }}
                                                                />
                                                            </div>
                                                        ) : null}
                                                        <div
                                                            className={`${itemHoverBgClass} -m-2 p-2 rounded transition-colors`}
                                                            style={itemSurfaceStyle}
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
                                    draggable={!isReadOnly}
                                    onDragStart={
                                        isReadOnly ? undefined : (event) => onSectionDragStart(event, 'certifications')
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
                                        isReadOnly
                                            ? undefined
                                            : (event) => {
                                                event.stopPropagation();
                                                onDragEnd();
                                            }
                                    }
                                >
                                    {!isReadOnly ? (
                                        <div className={sectionControlClass}>
                                            <GripVertical className="w-4 h-4 text-primary cursor-move" />
                                        </div>
                                    ) : null}

                                    <div
                                        className={`${sectionHoverBgClass} -m-2 p-2 rounded transition-colors`}
                                        style={sectionSurfaceStyle}
                                    >
                                        <h2
                    className={`text-xs font-bold uppercase tracking-widest text-primary border-b border-gray-200 ${SECTION_TITLE_BOTTOM_PADDING} ${SECTION_TITLE_BOTTOM_SPACING}`}
                    style={sectionTitleStyle}
                >
                                            证书资质
                                        </h2>
                                        <div
                                            className={`${listSpacingClass} ${LIST_GAP_CLASS}`}
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
                                                        draggable={!isReadOnly}
                                                        onDragStart={
                                                            isReadOnly
                                                                ? undefined
                                                                : (event) => {
                                                                    event.stopPropagation();
                                                                    onItemDragStart(event, itemKey);
                                                                }
                                                        }
                                                        onDragEnd={
                                                            isReadOnly
                                                                ? undefined
                                                                : (event) => {
                                                                    event.stopPropagation();
                                                                    onDragEnd();
                                                                }
                                                        }
                                                    >
                                                        {!isReadOnly ? (
                                                            <div className={itemControlClass}>
                                                                <GripVertical className="w-3.5 h-3.5 text-gray-400 cursor-move" />
                                                                <Edit3
                                                                    className="w-3.5 h-3.5 text-gray-400 cursor-pointer hover:text-primary"
                                                                    onClick={(event) => {
                                                                        event.stopPropagation();
                                                                        onEditCertification(cert.id);
                                                                    }}
                                                                />
                                                            </div>
                                                        ) : null}
                                                        <div
                                                            className={`${itemHoverBgClass} -m-2 p-2 rounded transition-colors`}
                                                            style={itemSurfaceStyle}
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
                                    draggable={!isReadOnly}
                                    onDragStart={
                                        isReadOnly ? undefined : (event) => onSectionDragStart(event, 'skills')
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
                                        isReadOnly
                                            ? undefined
                                            : (event) => {
                                                event.stopPropagation();
                                                onDragEnd();
                                            }
                                    }
                                >
                                    {!isReadOnly ? (
                                        <div className={sectionControlClass}>
                                            <GripVertical className="w-4 h-4 text-primary cursor-move" />
                                        </div>
                                    ) : null}

                                    <div
                                        className={`${sectionHoverBgClass} -m-2 p-2 rounded transition-colors`}
                                        style={sectionSurfaceStyle}
                                    >
                                        <h2
                    className={`text-xs font-bold uppercase tracking-widest text-primary border-b border-gray-200 ${SECTION_TITLE_BOTTOM_PADDING} ${SECTION_TITLE_BOTTOM_SPACING}`}
                    style={sectionTitleStyle}
                >
                                            专业技能
                                        </h2>
                                        <div
                                            className="text-xs text-gray-800 space-y-[var(--rf-list-spacing)]"
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
                                                        draggable={!isReadOnly}
                                                        onDragStart={
                                                            isReadOnly
                                                                ? undefined
                                                                : (event) => {
                                                                    event.stopPropagation();
                                                                    onItemDragStart(event, itemKey);
                                                                }
                                                        }
                                                        onDragEnd={
                                                            isReadOnly
                                                                ? undefined
                                                                : (event) => {
                                                                    event.stopPropagation();
                                                                    onDragEnd();
                                                                }
                                                        }
                                                    >
                                                        {!isReadOnly ? (
                                                            <div className={itemControlClass}>
                                                                <GripVertical className="w-3.5 h-3.5 text-gray-400 cursor-move" />
                                                                <Edit3
                                                                    className="w-3.5 h-3.5 text-gray-400 cursor-pointer hover:text-primary"
                                                                    onClick={(event) => {
                                                                        event.stopPropagation();
                                                                        if (!editableSkill) {
                                                                            return;
                                                                        }
                                                                        onEditSkill(editableSkill.id);
                                                                    }}
                                                                />
                                                            </div>
                                                        ) : null}
                                                        <div
                                                            className={`${itemHoverBgClass} -m-2 p-2 rounded transition-colors`}
                                                            style={itemSurfaceStyle}
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
                    </div>
                </div>
            </div>
            <style>{previewTypographyCss}</style>
        </main>
    );
};

export default ResumePreview;
