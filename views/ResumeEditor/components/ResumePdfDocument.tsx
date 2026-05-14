import React from 'react';
import type { ResumePdfRenderSnapshot } from '../../../types/resume';
import { resolveResumeDisplayTitle } from '../../../constants/resumeConstants';
import ResumePreview from './ResumePreview';

type ResumePdfDocumentProps = {
  snapshot: ResumePdfRenderSnapshot;
  previewRef?: React.RefObject<HTMLDivElement | null>;
  previewContentRef?: React.RefObject<HTMLDivElement | null>;
  className?: string;
};

const noop = () => {};

const ResumePdfDocument: React.FC<ResumePdfDocumentProps> = ({
  snapshot,
  previewRef,
  previewContentRef,
  className = 'rf-print-preview-shell',
}) => {
  const fallbackPreviewRef = React.useRef<HTMLDivElement | null>(null);
  const fallbackPreviewContentRef = React.useRef<HTMLDivElement | null>(null);
  const selectedEduIds = React.useMemo(
    () => new Set(snapshot.selectedEduIds),
    [snapshot.selectedEduIds]
  );
  const selectedCertIds = React.useMemo(
    () => new Set(snapshot.selectedCertIds),
    [snapshot.selectedCertIds]
  );

  return (
    <div className={className} data-rf-export-root="true">
      <ResumePreview
        previewRef={previewRef ?? fallbackPreviewRef}
        previewContentRef={previewContentRef ?? fallbackPreviewContentRef}
        previewScope="print"
        lineHeight={snapshot.lineHeight}
        fontSize={snapshot.fontSize}
        listSpacingValue={snapshot.listSpacingValue}
        bulletSpacingValue={snapshot.bulletSpacingValue}
        topPaddingPx={snapshot.topPaddingPx}
        templateId={snapshot.templateId}
        themeColorPresetId={snapshot.themeColorPresetId}
        experienceListMarkerStyle={snapshot.experienceListMarkerStyle}
        skillTagSeparator={snapshot.skillTagSeparator}
        profile={snapshot.profile}
        sectionSpacingClass={snapshot.sectionSpacingClass}
        listSpacingClass={snapshot.listSpacingClass}
        sectionOrder={snapshot.sectionOrder}
        selectedWorkItems={snapshot.selectedWorkItems}
        selectedProjectItems={snapshot.selectedProjectItems}
        educations={snapshot.educations}
        selectedEduIds={selectedEduIds}
        sortedCertifications={snapshot.sortedCertifications}
        selectedCertIds={selectedCertIds}
        selectedSkillGroups={snapshot.selectedSkillGroups}
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
        onNavigateTab={noop}
        onEditExperience={noop}
        onEditCertification={noop}
        onEditSkill={noop}
        resumeDisplayTitle={resolveResumeDisplayTitle(snapshot.resumeName)}
      />
    </div>
  );
};

export default ResumePdfDocument;
