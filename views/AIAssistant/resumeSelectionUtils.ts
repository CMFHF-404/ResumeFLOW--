import type { AssistantSelectedResume } from '../../services/aiService';

const uniqueInSourceOrder = (sourceIds: string[], selectedIds: string[]) => {
  const selectedSet = new Set(selectedIds);
  return sourceIds.filter((id) => selectedSet.has(id));
};

export const buildDefaultResumeExperienceSelection = (
  resume: AssistantSelectedResume | null | undefined,
) => resume?.snapshot.experiences.map((item) => item.id).filter(Boolean) ?? [];

export const buildSelectedResumeWithExperienceSelection = (
  resume: AssistantSelectedResume | null | undefined,
  selectedExperienceIds: string[],
): AssistantSelectedResume | null => {
  if (!resume) {
    return null;
  }
  const sourceExperienceIds = buildDefaultResumeExperienceSelection(resume);
  const normalizedSelectedIds = uniqueInSourceOrder(sourceExperienceIds, selectedExperienceIds);
  if (sourceExperienceIds.length > 0 && normalizedSelectedIds.length === 0) {
    return null;
  }
  const isAllSelected = normalizedSelectedIds.length === sourceExperienceIds.length;
  return {
    ...resume,
    selection: {
      mode: isAllSelected ? 'all' : 'subset',
      experienceIds: normalizedSelectedIds,
    },
    snapshot: {
      ...resume.snapshot,
      experiences: isAllSelected
        ? resume.snapshot.experiences
        : resume.snapshot.experiences.filter((item) => normalizedSelectedIds.includes(item.id)),
    },
  };
};
