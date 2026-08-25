export const DEFAULT_SECTION_ORDER = [
  'summary',
  'education',
  'work',
  'project',
  'certifications',
  'skills',
] as const;

export const RESUME_SECTION_IDS = new Set<string>(DEFAULT_SECTION_ORDER);
