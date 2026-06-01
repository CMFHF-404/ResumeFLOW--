import { DEFAULT_SECTION_ORDER, RESUME_SECTION_IDS } from '../../constants';

export const normalizeTemplateSectionOrder = (sectionOrder?: string[]) => {
  const filtered = (sectionOrder || []).filter((sectionId) => RESUME_SECTION_IDS.has(sectionId));
  const unique: string[] = [];
  filtered.forEach((sectionId) => {
    if (!unique.includes(sectionId)) {
      unique.push(sectionId);
    }
  });
  if (!unique.includes('summary')) {
    unique.unshift('summary');
  }
  DEFAULT_SECTION_ORDER.forEach((sectionId) => {
    if (!unique.includes(sectionId)) {
      unique.push(sectionId);
    }
  });
  return unique.length ? unique : [...DEFAULT_SECTION_ORDER];
};

export const reorderTemplateSectionOrder = (
  sectionOrder: string[],
  draggedSectionId: string,
  targetSectionId: string,
  placement: 'before' | 'after'
) => {
  if (draggedSectionId === targetSectionId) {
    return sectionOrder;
  }
  const nextOrder = [...sectionOrder];
  const draggedIndex = nextOrder.indexOf(draggedSectionId);
  const targetIndex = nextOrder.indexOf(targetSectionId);
  if (draggedIndex < 0 || targetIndex < 0) {
    return sectionOrder;
  }
  nextOrder.splice(draggedIndex, 1);
  const adjustedTargetIndex = draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;
  const insertIndex = placement === 'before' ? adjustedTargetIndex : adjustedTargetIndex + 1;
  nextOrder.splice(insertIndex, 0, draggedSectionId);
  return nextOrder;
};
