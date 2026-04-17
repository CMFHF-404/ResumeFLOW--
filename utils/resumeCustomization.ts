import type { ResumeExperienceListMarkerStyle } from '../types/resume';

export const DEFAULT_RESUME_EXPERIENCE_LIST_MARKER_STYLE: ResumeExperienceListMarkerStyle = 'unordered';
export const DEFAULT_RESUME_SKILL_TAG_SEPARATOR = '，';

const RESUME_EXPERIENCE_LIST_MARKER_STYLE_SET = new Set<ResumeExperienceListMarkerStyle>([
  'ordered',
  'unordered',
  'none',
]);

export const normalizeResumeExperienceListMarkerStyle = (
  value?: string | null
): ResumeExperienceListMarkerStyle => (
  value && RESUME_EXPERIENCE_LIST_MARKER_STYLE_SET.has(value as ResumeExperienceListMarkerStyle)
    ? (value as ResumeExperienceListMarkerStyle)
    : DEFAULT_RESUME_EXPERIENCE_LIST_MARKER_STYLE
);

export const normalizeResumeSkillTagSeparator = (value?: string | null): string => (
  typeof value === 'string' && value.length > 0
    ? value
    : DEFAULT_RESUME_SKILL_TAG_SEPARATOR
);
