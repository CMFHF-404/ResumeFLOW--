import React from 'react';
import { Edit3, GripVertical } from 'lucide-react';
import type {
    ResumeExperienceListMarkerStyle,
    ResumeExperienceView,
} from '../../../../../types/resume';
import { resolveDragTarget } from '../../../../../utils/dragSort';
import { buildDragItemKey } from '../../../dragKeys';
import {
    DATA_ITEM_ID_ATTR,
} from '../dragDrop';
import {
    renderStarBlocks,
    renderTimelineBlueLeadMarkers,
} from '../previewRenderUtils';

type ExperienceSectionProps = {
    sectionId: 'work' | 'project';
    title: string;
    items: ResumeExperienceView[];
    experienceListMarkerStyle: ResumeExperienceListMarkerStyle;
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
    onEditExperience: (id: string) => void;
};

const ExperienceSection: React.FC<ExperienceSectionProps> = ({
    sectionId,
    title,
    items,
    experienceListMarkerStyle,
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
    onEditExperience,
}) => {
    if (!items.length) {
        return null;
    }

    return (
        <div
            key={sectionId}
            id={sectionId}
            data-rf-section-id={sectionId}
            className={`${sectionSpacingClass} scroll-mt-20 relative group ${sectionDragClass}`}
            style={getTemplateSectionWrapperStyle(sectionId)}
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
                style={{
                    ...sectionSurfaceStyle,
                    ...getSectionOverflowHighlightStyle(sectionId),
                }}
            >
                {renderOverflowMarker(sectionId)}
                {renderSectionHeading(title, sectionId)}
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
                    {items.map((item, index) => {
                        const itemKey = buildDragItemKey('experience', item.id);
                        const showTimelineRail = isTimelineBlueTemplate && index < items.length - 1;
                        return (
                            <div
                                key={item.id}
                                data-rf-item-id={itemKey}
                                className={`relative group/item ${itemDragClass} ${isTimelineBlueTemplate ? 'pl-7' : ''}`}
                                draggable={enableNativeHtmlDrag}
                                onDragStart={
                                    enableNativeHtmlDrag ? (event) => handleNativeItemDragStart(event, itemKey) : undefined
                                }
                                onDragEnd={
                                    enableNativeHtmlDrag ? handleNativeDragEnd : undefined
                                }
                            >
                                {isTimelineBlueTemplate ? renderTimelineBlueLeadMarkers(showTimelineRail) : null}
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
                                    style={{ ...itemSurfaceStyle, ...getItemPolishHighlightStyle(itemKey), ...touchHandleStyle }}
                                    onTouchStart={
                                        isReadOnly
                                            ? undefined
                                            : (event) => handleItemCardTouchStart(event, itemKey)
                                    }
                                >
                                    <div className="mb-1 flex items-start gap-3">
                                        <div className="min-w-0 flex-1">
                                            <h3 className="rf-template-item-title text-sm font-bold leading-snug text-gray-900">
                                                {item.company}
                                            </h3>
                                        </div>
                                        <span className="rf-template-date shrink-0 whitespace-nowrap pt-0.5 text-xs font-medium text-gray-900">
                                            {item.date}
                                        </span>
                                    </div>
                                    <p className="text-xs font-semibold text-gray-800 mb-1.5">
                                        {item.title}
                                    </p>

                                    {renderStarBlocks(item.star, item.id, experienceListMarkerStyle)}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default ExperienceSection;
