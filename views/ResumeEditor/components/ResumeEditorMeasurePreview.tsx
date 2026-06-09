import React from 'react';
import ResumePreview, { type ResumePreviewProps } from './ResumePreview';

type FixedMeasurePreviewProp =
    | 'previewScope'
    | 'showOverflowGuide'
    | 'suppressOverflowIndicators'
    | 'overflowHighlightSectionIds'
    | 'polishHighlightItemIds'
    | 'readOnly'
    | 'isDragging'
    | 'draggedItemKey'
    | 'draggedSectionId'
    | 'onSectionDragStart'
    | 'onSectionDragHover'
    | 'onSectionDrop'
    | 'onTouchSectionDragStart'
    | 'onItemDragStart'
    | 'onItemDragHover'
    | 'onItemDrop'
    | 'onTouchItemDragStart'
    | 'onTouchDragEnd'
    | 'onTouchDragCancel'
    | 'onDragEnd'
    | 'onEditExperience'
    | 'onEditCertification'
    | 'onEditSkill';

export type ResumeEditorMeasurePreviewProps = Omit<ResumePreviewProps, FixedMeasurePreviewProp>;

const noop = () => {};

const ResumeEditorMeasurePreview: React.FC<ResumeEditorMeasurePreviewProps> = ({
    onNavigateTab,
    ...previewProps
}) => (
    <div className="fixed left-[-200vw] top-0 w-screen md:w-[calc(100vw-600px)] pointer-events-none opacity-0" aria-hidden="true">
        <ResumePreview
            {...previewProps}
            previewScope="measure"
            readOnly
            isDragging={false}
            draggedItemKey={null}
            draggedSectionId={null}
            onSectionDragStart={noop}
            onSectionDragHover={noop}
            onSectionDrop={noop}
            onTouchSectionDragStart={noop}
            onItemDragStart={noop}
            onItemDragHover={noop}
            onItemDrop={noop}
            onTouchItemDragStart={noop}
            onTouchDragEnd={noop}
            onTouchDragCancel={noop}
            onDragEnd={noop}
            onNavigateTab={onNavigateTab}
            onEditExperience={noop}
            onEditCertification={noop}
            onEditSkill={noop}
        />
    </div>
);

export default ResumeEditorMeasurePreview;
