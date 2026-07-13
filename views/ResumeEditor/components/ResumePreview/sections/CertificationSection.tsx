import React from 'react';
import { Edit3, GripVertical } from 'lucide-react';
import type { CertificationView } from '../../../../../types/resume';
import { resolveDragTarget } from '../../../../../utils/dragSort';
import { buildDragItemKey } from '../../../dragKeys';
import { DATA_ITEM_ID_ATTR } from '../dragDrop';
import { LIST_GAP_CLASS, renderTimelineBlueLeadMarkers } from '../previewRenderUtils';

type CertificationSectionVariant = 'split' | 'page';

type CertificationSectionProps = {
    items: CertificationView[];
    variant: CertificationSectionVariant;
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
    onEditCertification: (id: string) => void;
};

const CertificationSection: React.FC<CertificationSectionProps> = ({
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
    onEditCertification,
}) => {
    if (!items.length) {
        return null;
    }

    const useTimelineMarkers = variant === 'split' && isTimelineBlueTemplate;

    return (
        <div
            key="certifications"
            id="certifications"
            className={`${sectionSpacingClass} scroll-mt-20 relative group ${sectionDragClass}`}
            style={getTemplateSectionWrapperStyle('certifications')}
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
            onDragEnd={enableNativeHtmlDrag ? handleNativeDragEnd : undefined}
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
                style={{
                    ...sectionSurfaceStyle,
                    ...(includeOverflowState ? getSectionOverflowHighlightStyle('certifications') : undefined),
                }}
            >
                {includeOverflowState ? renderOverflowMarker('certifications') : null}
                {renderSectionHeading('证书资质', 'certifications')}
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
                    {items.map((cert, certIndex) => {
                        const itemKey = buildDragItemKey('certification', cert.id);
                        const showTimelineRail = useTimelineMarkers && certIndex < items.length - 1;
                        return (
                            <div
                                key={cert.id}
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
                                    style={{ ...itemSurfaceStyle, ...getItemPolishHighlightStyle(itemKey), ...touchHandleStyle }}
                                    onTouchStart={
                                        isReadOnly
                                            ? undefined
                                            : (event) => handleItemCardTouchStart(event, itemKey)
                                    }
                                >
                                    {variant === 'split' ? (
                                        <div className="space-y-1">
                                            <div className="rf-template-certification-name text-xs font-bold text-gray-900">{cert.name}</div>
                                            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs text-gray-700">
                                                <span>{cert.issuer ? `(${cert.issuer})` : ''}</span>
                                                <span className="rf-template-date font-medium text-gray-900">{cert.date}</span>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex justify-between items-baseline">
                                            <div>
                                                <span className="rf-template-certification-name text-xs font-bold text-gray-900">{cert.name}</span>
                                                {cert.issuer ? (
                                                    <span className="text-xs text-gray-900 ml-2">({cert.issuer})</span>
                                                ) : null}
                                            </div>
                                            <span className="rf-template-date text-xs text-gray-900">{cert.date}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default CertificationSection;
