import type {
  CertificationView,
  EducationView,
  ResumeEditorProfile,
  ResumeExperienceListMarkerStyle,
  ResumeExperienceView,
  ResumePdfRenderSnapshot,
  SkillGroupView,
} from '../types/resume';
import type { ResumeTemplateId, ResumeThemeColorPresetId } from '../constants/resumeTemplates';
import {
  FONT_SIZE_DEFAULT,
  LINE_HEIGHT_DEFAULT,
} from '../views/ResumeEditor/constants';

type ResumePdfSnapshotInput = {
  resumeName: string;
  targetRole: string;
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
  themeColorPresetId: ResumeThemeColorPresetId;
  experienceListMarkerStyle: ResumeExperienceListMarkerStyle;
  skillTagSeparator: string;
};

const MAX_AVATAR_DATA_URL_BYTES = 2 * 1024 * 1024;
const SAFE_AVATAR_DATA_URL_PATTERN = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]*={0,2})$/i;

export const normalizeAvatarDataUrlForPdf = (value: string | null | undefined) => {
  const normalized = value?.trim() ?? '';
  if (!normalized) {
    return '';
  }
  const match = normalized.match(SAFE_AVATAR_DATA_URL_PATTERN);
  if (!match) {
    return '';
  }
  const encoded = match[1];
  const paddingLength = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  const decodedLength = Math.floor((encoded.length * 3) / 4) - paddingLength;
  if (decodedLength <= 0 || decodedLength > MAX_AVATAR_DATA_URL_BYTES) {
    return '';
  }
  try {
    atob(encoded);
  } catch {
    return '';
  }
  return normalized;
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
  targetRole,
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
  themeColorPresetId,
  experienceListMarkerStyle,
  skillTagSeparator,
}: ResumePdfSnapshotInput): ResumePdfRenderSnapshot => ({
  resumeName,
  targetRole: targetRole.trim(),
  profile: {
    ...profile,
    avatarDataUrl: normalizeAvatarDataUrlForPdf(profile.avatarDataUrl),
  },
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
  themeColorPresetId,
  experienceListMarkerStyle,
  skillTagSeparator,
});
