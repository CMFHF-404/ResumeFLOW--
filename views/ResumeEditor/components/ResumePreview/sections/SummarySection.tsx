import { ModuleScoreNote } from '../../ResumeEvaluationReport/ScoreAnnotations';
import React from 'react';
import { GripVertical } from 'lucide-react';
import { RICH_TEXT_INLINE_STYLES_CLASS } from '../../../../../utils/richText';
import {
    renderOptimizationTextComparison,
    type ResumeOptimizationTextComparison,
} from '../previewRenderUtils';

type SummarySectionProps = {
    summaryHtml: string;
    sectionSpacingClass: string;
    sectionDragClass: string;
    sectionControlClass: string;
    sectionSurfaceStyle: React.CSSProperties;
    enableNativeHtmlDrag: boolean;
    isReadOnly: boolean;
    showTouchDragHandles: boolean;
    getTemplateSectionWrapperStyle: (sectionId: string) => React.CSSProperties;
    getSectionSurfaceClass: (sectionId: string) => string;
    getSectionOverflowHighlightStyle: (sectionId: string) => React.CSSProperties | undefined;
    renderOverflowMarker: (sectionId: string) => React.ReactNode;
    renderSectionHeading: (title: string, sectionId: string) => React.ReactNode;
    handleNativeSectionDragStart: (event: React.DragEvent<HTMLElement>, sectionId: string) => void;
    handleNativeDragEnd: (event: React.DragEvent<HTMLElement>) => void;
    handleSectionControlTouchStart: (event: React.TouchEvent<HTMLElement>, sectionId: string) => void;
    onSectionDrop: (event: React.DragEvent<HTMLElement>) => void;
    summaryComparison?: ResumeOptimizationTextComparison | null;
};

const SummarySection: React.FC<SummarySectionProps> = ({
    summaryHtml,
    sectionSpacingClass,
    sectionDragClass,
    sectionControlClass,
    sectionSurfaceStyle,
    enableNativeHtmlDrag,
    isReadOnly,
    showTouchDragHandles,
    getTemplateSectionWrapperStyle,
    getSectionSurfaceClass,
    getSectionOverflowHighlightStyle,
    renderOverflowMarker,
    renderSectionHeading,
    handleNativeSectionDragStart,
    handleNativeDragEnd,
    handleSectionControlTouchStart,
    onSectionDrop,
    summaryComparison,
}) => (
    <div
        key="summary"
        id="summary"
        data-rf-section-id="summary"
        className={`${sectionSpacingClass} scroll-mt-20 relative group ${sectionDragClass}`}
        style={getTemplateSectionWrapperStyle('summary')}
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
            style={{
                ...sectionSurfaceStyle,
                ...getSectionOverflowHighlightStyle('summary'),
            }}
        >
            {renderOverflowMarker('summary')}
            <ModuleScoreNote moduleType="personal_summary" moduleId="current_resume" readOnly={isReadOnly} />
            {renderSectionHeading('个人评价', 'summary')}
            {summaryComparison ? renderOptimizationTextComparison(summaryComparison, '个人评价') : (
                <div
                    className={`text-xs leading-[var(--rf-line-height)] text-gray-800 ${RICH_TEXT_INLINE_STYLES_CLASS}`}
                    dangerouslySetInnerHTML={{ __html: summaryHtml }}
                />
            )}
        </div>
    </div>
);

export default SummarySection;
