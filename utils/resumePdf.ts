import type {
  CertificationView,
  EducationView,
  ResumeEditorProfile,
  ResumeExperienceView,
  ResumePdfRenderSnapshot,
  SkillGroupView,
} from '../types/resume';
import type { ResumeTemplateId } from '../constants/resumeTemplates';
import {
  FONT_SIZE_DEFAULT,
  LINE_HEIGHT_DEFAULT,
} from '../views/ResumeEditor/constants';

type ResumePdfSnapshotInput = {
  resumeName: string;
  profile: ResumeEditorProfile;
  lineHeight: number;
  fontSize: number;
  listSpacingValue: string;
  bulletSpacingValue: string;
  topPaddingPx: number;
  sectionSpacingClass: string;
  listSpacingClass: string;
  sectionOrder: string[];
  selectedWorkItems: ResumeExperienceView[];
  selectedProjectItems: ResumeExperienceView[];
  educations: EducationView[];
  selectedEduIds: Set<string>;
  sortedCertifications: CertificationView[];
  selectedCertIds: Set<string>;
  selectedSkillGroups: SkillGroupView[];
  templateId: ResumeTemplateId;
};

const cloneExperience = (item: ResumeExperienceView) => ({
  ...item,
  star: { ...item.star },
});

const cloneSkillGroup = (group: SkillGroupView) => ({
  ...group,
  skills: group.skills.map((skill) => ({ ...skill })),
});

const normalizeFiniteNumber = (value: number, fallback: number) => (
  Number.isFinite(value) ? value : fallback
);

export const buildResumePdfRenderSnapshot = ({
  resumeName,
  profile,
  lineHeight,
  fontSize,
  listSpacingValue,
  bulletSpacingValue,
  topPaddingPx,
  sectionSpacingClass,
  listSpacingClass,
  sectionOrder,
  selectedWorkItems,
  selectedProjectItems,
  educations,
  selectedEduIds,
  sortedCertifications,
  selectedCertIds,
  selectedSkillGroups,
  templateId,
}: ResumePdfSnapshotInput): ResumePdfRenderSnapshot => ({
  resumeName,
  profile: { ...profile },
  lineHeight: normalizeFiniteNumber(lineHeight, LINE_HEIGHT_DEFAULT),
  fontSize: normalizeFiniteNumber(fontSize, FONT_SIZE_DEFAULT),
  listSpacingValue,
  bulletSpacingValue,
  topPaddingPx: normalizeFiniteNumber(topPaddingPx, 0),
  sectionSpacingClass,
  listSpacingClass,
  sectionOrder: [...sectionOrder],
  selectedWorkItems: selectedWorkItems.map(cloneExperience),
  selectedProjectItems: selectedProjectItems.map(cloneExperience),
  educations: educations.map((item) => ({ ...item })),
  selectedEduIds: Array.from(selectedEduIds),
  sortedCertifications: sortedCertifications.map((item) => ({ ...item })),
  selectedCertIds: Array.from(selectedCertIds),
  selectedSkillGroups: selectedSkillGroups.map(cloneSkillGroup),
  templateId,
});
