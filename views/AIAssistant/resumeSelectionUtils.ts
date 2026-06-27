import type { AssistantSelectedResume } from '../../services/aiService';

export type AssistantResumeModuleSelection = {
  kind: 'experience' | 'education' | 'certification' | 'skills';
  contextId?: string;
};

const uniqueInSourceOrder = (sourceIds: string[], selectedIds: string[]) => {
  const selectedSet = new Set(selectedIds);
  return sourceIds.filter((id) => selectedSet.has(id));
};

const uniqueModuleContextIds = (
  modules: AssistantResumeModuleSelection[],
  kind: AssistantResumeModuleSelection['kind'],
) => Array.from(new Set(modules
  .filter((item) => item.kind === kind && item.contextId)
  .map((item) => item.contextId as string)));

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

export const buildSelectedResumeWithModuleSelection = (
  resume: AssistantSelectedResume | null | undefined,
  selectedModules: AssistantResumeModuleSelection[],
): AssistantSelectedResume | null => {
  if (!resume) {
    return null;
  }
  if (selectedModules.length === 0) {
    return resume;
  }
  const sourceExperienceIds = buildDefaultResumeExperienceSelection(resume);
  const selectedExperienceIds = uniqueInSourceOrder(
    sourceExperienceIds,
    uniqueModuleContextIds(selectedModules, 'experience'),
  );
  const selectedEducationIds = uniqueModuleContextIds(selectedModules, 'education');
  const selectedCertificationIds = uniqueModuleContextIds(selectedModules, 'certification');
  const shouldIncludeSkills = selectedModules.some((item) => item.kind === 'skills');
  const nextSnapshot = {
    ...resume.snapshot,
    experiences: selectedExperienceIds.length > 0
      ? resume.snapshot.experiences.filter((item) => selectedExperienceIds.includes(item.id))
      : [],
    educations: selectedEducationIds.length > 0
      ? resume.snapshot.educations.filter((item) => selectedEducationIds.includes(item.id))
      : [],
    certifications: selectedCertificationIds.length > 0
      ? resume.snapshot.certifications.filter((item) => selectedCertificationIds.includes(item.id))
      : [],
    skills: shouldIncludeSkills ? resume.snapshot.skills : [],
  };
  const hasSelectedContent = (
    nextSnapshot.experiences.length > 0
    || nextSnapshot.educations.length > 0
    || nextSnapshot.certifications.length > 0
    || nextSnapshot.skills.length > 0
  );
  if (!hasSelectedContent) {
    return null;
  }
  const isAllExperiencesSelected = sourceExperienceIds.length > 0
    && selectedExperienceIds.length === sourceExperienceIds.length;
  return {
    ...resume,
    ...(selectedExperienceIds.length > 0 ? {
      selection: {
        mode: isAllExperiencesSelected ? 'all' : 'subset',
        experienceIds: selectedExperienceIds,
      },
    } : { selection: undefined }),
    snapshot: nextSnapshot,
  };
};
