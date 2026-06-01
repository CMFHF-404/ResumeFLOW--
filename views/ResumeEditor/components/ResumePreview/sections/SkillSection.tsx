import React from 'react';
import { Edit3, GripVertical } from 'lucide-react';
import type { SkillGroupView } from '../../../../../types/resume';
import { resolveDragTarget } from '../../../../../utils/dragSort';
import { buildDragItemKey } from '../../../dragKeys';
import { DATA_ITEM_ID_ATTR } from '../dragDrop';
import { renderTimelineBlueLeadMarkers } from '../previewRenderUtils';

type SkillSectionProps = {
    groups: SkillGroupView[];
    sectionSpacingClass: string;
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
    renderSkillGroupLine: (group: SkillGroupView) => React.ReactNode;
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
    onEditSkill: (id: string) => void;
};

const SkillSection: React.FC<SkillSectionProps> = ({
    groups,
    sectionSpacingClass,
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
    renderSkillGroupLine,
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
    onEditSkill,
}) => {
    if (!groups.length) {
        return null;
    }

    return (
        <div
            key="skills"
            id="skills"
            data-rf-section-id="skills"
            className={`${sectionSpacingClass} scroll-mt-20 relative group ${sectionDragClass}`}
            style={getTemplateSectionWrapperStyle('skills')}
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
            onDragEnd={enableNativeHtmlDrag ? handleNativeDragEnd : undefined}
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
                style={{
                    ...sectionSurfaceStyle,
                    ...(includeOverflowState ? getSectionOverflowHighlightStyle('skills') : undefined),
                }}
            >
                {includeOverflowState ? renderOverflowMarker('skills') : null}
                {renderSectionHeading('专业技能', 'skills')}
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
                    {groups.map((group, groupIndex) => {
                        const itemKey = buildDragItemKey('skillGroup', group.name);
                        const editableSkill = group.skills[0];
                        const showTimelineRail = isTimelineBlueTemplate && groupIndex < groups.length - 1;
                        return (
                            <div
                                key={group.name}
                                data-rf-item-id={itemKey}
                                className={`relative group/item ${itemDragClass} ${isTimelineBlueTemplate ? 'pl-7' : ''}`}
                                draggable={enableNativeHtmlDrag}
                                onDragStart={
                                    enableNativeHtmlDrag
                                        ? (event) => handleNativeItemDragStart(event, itemKey)
                                        : undefined
                                }
                                onDragEnd={enableNativeHtmlDrag ? handleNativeDragEnd : undefined}
                            >
                                {isTimelineBlueTemplate ? renderTimelineBlueLeadMarkers(showTimelineRail) : null}
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
                                    style={{ ...itemSurfaceStyle, ...getItemPolishHighlightStyle(itemKey), ...touchHandleStyle }}
                                    onTouchStart={
                                        isReadOnly
                                            ? undefined
                                            : (event) => handleItemCardTouchStart(event, itemKey)
                                    }
                                >
                                    {renderSkillGroupLine(group)}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default SkillSection;
