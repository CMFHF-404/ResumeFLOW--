import React from 'react';
import { Edit3, GripVertical } from 'lucide-react';
import type { EducationView } from '../../../../../types/resume';
import { buildExperienceDate } from '../../../../../utils/dateUtils';
import { resolveDragTarget } from '../../../../../utils/dragSort';
import { buildDragItemKey } from '../../../dragKeys';
import { DATA_ITEM_ID_ATTR } from '../dragDrop';
import { LIST_GAP_CLASS, renderTimelineBlueLeadMarkers } from '../previewRenderUtils';

type EducationSectionVariant = 'split' | 'page';

type EducationSectionProps = {
    items: EducationView[];
    variant: EducationSectionVariant;
    sectionSpacingClass: string;
    listSpacingClass: string;
    sectionDragClass: string;
    itemDragClass: string;
    sectionControlClass: string;
    sectionSurfaceStyle: React.CSSProperties;
    itemSurfaceStyle: React.CSSProperties;
    touchHandleStyle: React.CSSProperties;
    enableNativeHtmlDrag: boolean;
    isReadOnly: boolean;
    showTouchDragHandles: boolean;
    isTimelineBlueTemplate: boolean;
    draggedItemKey: string | null;
    draggedSectionId: string | null;
    includeOverflowState: boolean;
    getTemplateSectionWrapperStyle: (sectionId: string) => React.CSSProperties;
    getSectionSurfaceClass: (sectionId: string) => string;
    getItemSurfaceClass: (itemKey: string) => string;
    getItemControlClass: (itemKey: string) => string;
    getSectionOverflowHighlightStyle: (sectionId: string) => React.CSSProperties | undefined;
    getItemPolishHighlightStyle: (itemKey: string) => React.CSSProperties | undefined;
    renderOverflowMarker: (sectionId: string) => React.ReactNode;
    renderSectionHeading: (title: string, sectionId: string) => React.ReactNode;
    handleNativeSectionDragStart: (event: React.DragEvent<HTMLElement>, sectionId: string) => void;
    handleNativeItemDragStart: (event: React.DragEvent<HTMLElement>, itemKey: string) => void;
    handleNativeDragEnd: (event: React.DragEvent<HTMLElement>) => void;
    handleSectionControlTouchStart: (event: React.TouchEvent<HTMLElement>, sectionId: string) => void;
    handleItemControlTouchStart: (event: React.TouchEvent<HTMLElement>, itemKey: string) => void;
    handleItemCardTouchStart: (event: React.TouchEvent<HTMLElement>, itemKey: string) => void;
    stopTouchStartPropagation: (event: React.TouchEvent<HTMLElement>) => void;
    setActiveMobileItemControlId: React.Dispatch<React.SetStateAction<string | null>>;
    onSectionDrop: (event: React.DragEvent<HTMLElement>) => void;
    onItemDragHover: (targetId: string, position: 'before' | 'after') => void;
    onItemDrop: (event: React.DragEvent<HTMLElement>) => void;
    onNavigateTab: (tab: 'profile') => void;
};

const EducationSection: React.FC<EducationSectionProps> = ({
    items,
    variant,
    sectionSpacingClass,
    listSpacingClass,
    sectionDragClass,
    itemDragClass,
    sectionControlClass,
    sectionSurfaceStyle,
    itemSurfaceStyle,
    touchHandleStyle,
    enableNativeHtmlDrag,
    isReadOnly,
    showTouchDragHandles,
    isTimelineBlueTemplate,
    draggedItemKey,
    draggedSectionId,
    includeOverflowState,
    getTemplateSectionWrapperStyle,
    getSectionSurfaceClass,
    getItemSurfaceClass,
    getItemControlClass,
    getSectionOverflowHighlightStyle,
    getItemPolishHighlightStyle,
    renderOverflowMarker,
    renderSectionHeading,
    handleNativeSectionDragStart,
    handleNativeItemDragStart,
    handleNativeDragEnd,
    handleSectionControlTouchStart,
    handleItemControlTouchStart,
    handleItemCardTouchStart,
    stopTouchStartPropagation,
    setActiveMobileItemControlId,
    onSectionDrop,
    onItemDragHover,
    onItemDrop,
    onNavigateTab,
}) => {
    if (!items.length) {
        return null;
    }

    const useTimelineMarkers = variant === 'split' && isTimelineBlueTemplate;

    return (
        <div
            key="education"
            id="education"
            data-rf-section-id="education"
            className={`${sectionSpacingClass} scroll-mt-20 relative group ${sectionDragClass}`}
            style={getTemplateSectionWrapperStyle('education')}
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
            onDragEnd={enableNativeHtmlDrag ? handleNativeDragEnd : undefined}
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
                style={{
                    ...sectionSurfaceStyle,
                    ...(includeOverflowState ? getSectionOverflowHighlightStyle('education') : undefined),
                }}
            >
                {includeOverflowState ? renderOverflowMarker('education') : null}
                {renderSectionHeading('教育背景', 'education')}
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
                    {items.map((edu, eduIndex) => {
                        const itemKey = buildDragItemKey('education', edu.id);
                        const dateText = buildExperienceDate(edu.startDate, edu.endDate, edu.isCurrent);
                        const showTimelineRail = useTimelineMarkers && eduIndex < items.length - 1;
                        return (
                            <div
                                key={edu.id}
                                data-rf-item-id={itemKey}
                                className={`relative group/item ${itemDragClass} ${useTimelineMarkers ? 'pl-7' : ''}`}
                                draggable={enableNativeHtmlDrag}
                                onDragStart={
                                    enableNativeHtmlDrag
                                        ? (event) => handleNativeItemDragStart(event, itemKey)
                                        : undefined
                                }
                                onDragEnd={enableNativeHtmlDrag ? handleNativeDragEnd : undefined}
                            >
                                {useTimelineMarkers ? renderTimelineBlueLeadMarkers(showTimelineRail) : null}
                                {!isReadOnly ? (
                                    <div className={getItemControlClass(itemKey)}>
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
                                    style={{ ...itemSurfaceStyle, ...getItemPolishHighlightStyle(itemKey), ...touchHandleStyle }}
                                    onTouchStart={
                                        isReadOnly
                                            ? undefined
                                            : (event) => handleItemCardTouchStart(event, itemKey)
                                    }
                                >
                                    <div className="mb-0.5 flex justify-between items-baseline">
                                        <h3 className="text-sm font-bold text-gray-900">{edu.school}</h3>
                                        <span className="text-xs font-medium text-gray-900">{dateText}</span>
                                    </div>
                                    {variant === 'split' ? (
                                        <p className="text-xs text-gray-900">
                                            {edu.major ? <span className="font-semibold">{edu.major}</span> : null}
                                            {edu.major && edu.degree ? ' | ' : null}
                                            {edu.degree || null}
                                        </p>
                                    ) : (
                                        <p className="text-xs text-gray-900">
                                            {edu.major}, {edu.degree}
                                        </p>
                                    )}
                                    {edu.gpa ? <p className="text-xs text-gray-900">GPA: {edu.gpa}</p> : null}
                                    {edu.courses ? <p className="text-xs text-gray-900">课程：{edu.courses}</p> : null}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default EducationSection;
