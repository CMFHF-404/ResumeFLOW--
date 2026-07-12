import { parseYearMonthValue } from "./dateUtils";
import {
  decodeRichTextEntitiesDeep,
  hasRichTextDecoration,
  sanitizeRichTextHtml,
  stripRichTextToText,
} from "./richText";
import type { JDAnalysisItemSignatures } from "../types/analysis";
import type {
  CertificationView,
  EducationView,
  ResumeExperienceView,
  SkillGroupView,
  SkillItemView,
  StarFields,
} from "../types/resume";

const EMPTY_TEXT_SIGNATURE = "";
const EXPERIENCE_CATEGORY_ORDER: Array<ResumeExperienceView["category"]> = [
  "work",
  "project",
];
const STAR_FIELD_KEYS: Array<keyof StarFields> = ["s", "t", "a", "r"];

export type ResumeAIExperienceEntry = {
  id: string;
  title: string;
  org: string;
  start_date?: string;
  end_date?: string;
  star: StarFields;
};

export type ResumeAICertificationEntry = {
  id: string;
  name: string;
  issuer?: string;
  issue_date: string;
};

export type ResumeAIEducationEntry = {
  id: string;
  school: string;
  major: string;
  degree: string;
  start_date?: string;
  end_date?: string;
  gpa?: string;
  courses?: string;
};

export type ResumeAISkillEntry = {
  id: string;
  name: string;
  category: string;
};

export type ResumeAISnapshot = {
  experiences: ResumeAIExperienceEntry[];
  educations: ResumeAIEducationEntry[];
  certifications: ResumeAICertificationEntry[];
  skills: ResumeAISkillEntry[];
};

export const normalizeStarValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }
  const hasDocument = typeof document !== "undefined";
  const shouldSanitize = (text: string) => hasDocument && hasRichTextDecoration(text);
  if (Array.isArray(value)) {
    const joined = value.join("、");
    const decoded = decodeRichTextEntitiesDeep(joined);
    return shouldSanitize(decoded) ? sanitizeRichTextHtml(decoded) : decoded;
  }
  const text = String(value);
  const decoded = decodeRichTextEntitiesDeep(text);
  return shouldSanitize(decoded) ? sanitizeRichTextHtml(decoded) : decoded;
};

export const buildStarFields = (star?: Record<string, any>): StarFields => ({
  s: normalizeStarValue(star?.s),
  t: normalizeStarValue(star?.t),
  a: normalizeStarValue(star?.a),
  r: normalizeStarValue(star?.r),
});

export const normalizeEducationStar = (star?: Record<string, any>) => ({
  degree: normalizeStarValue(star?.degree),
  gpa: normalizeStarValue(star?.gpa),
  courses: normalizeStarValue(star?.courses),
});

export const buildExperienceAnalyzeEntry = (
  item: ResumeExperienceView
): ResumeAIExperienceEntry => ({
  id: item.id,
  title: item.title,
  org: item.company,
  start_date: item.startDate,
  end_date: item.endDate,
  star: item.star,
});

export const buildCertificationAnalyzeEntry = (
  cert: CertificationView
): ResumeAICertificationEntry => ({
  id: cert.id,
  name: cert.name,
  issuer: cert.issuer,
  issue_date: cert.date,
});

export const buildEducationAnalyzeEntry = (
  education: EducationView
): ResumeAIEducationEntry => ({
  id: education.id,
  school: education.school,
  major: education.major,
  degree: education.degree,
  start_date: education.startDate || undefined,
  end_date: education.endDate || undefined,
  gpa: education.gpa || undefined,
  courses: education.courses || undefined,
});

export const buildSkillAnalyzeEntry = (
  group: SkillGroupView,
  skill: SkillItemView
): ResumeAISkillEntry => ({
  id: skill.id,
  name: skill.name,
  category: group.name,
});

export const buildSkillAnalyzePayload = (
  groups: SkillGroupView[]
): ResumeAISkillEntry[] =>
  groups.flatMap((group) =>
    group.skills.map((skill) => buildSkillAnalyzeEntry(group, skill))
  );

export const buildResumeAISnapshot = (
  experiences: ResumeExperienceView[],
  certifications: CertificationView[],
  skillGroups: SkillGroupView[],
  educations: EducationView[] = []
): ResumeAISnapshot => ({
  experiences: experiences.map(buildExperienceAnalyzeEntry),
  educations: educations.map(buildEducationAnalyzeEntry),
  certifications: certifications.map(buildCertificationAnalyzeEntry),
  skills: buildSkillAnalyzePayload(skillGroups),
});

const resolveStarFieldWithSource = (draftValue: string, sourceValue: string) => {
  if (!draftValue || !sourceValue) {
    return draftValue;
  }
  const draftText = stripRichTextToText(draftValue);
  const sourceText = stripRichTextToText(sourceValue);
  if (!draftText || draftText !== sourceText) {
    return draftValue;
  }
  if (!hasRichTextDecoration(draftValue) && hasRichTextDecoration(sourceValue)) {
    return sourceValue;
  }
  return draftValue;
};

export const mergeStarFieldsWithSource = (
  draft: StarFields,
  sourceStar?: Record<string, any>
) => {
  if (!sourceStar) {
    return draft;
  }
  const sourceFields = buildStarFields(sourceStar);
  let changed = false;
  const next: StarFields = { ...draft };
  STAR_FIELD_KEYS.forEach((key) => {
    const resolved = resolveStarFieldWithSource(draft[key], sourceFields[key]);
    if (resolved !== draft[key]) {
      next[key] = resolved;
      changed = true;
    }
  });
  return changed ? next : draft;
};

export const buildJDTextSignature = (value: string) => {
  const trimmed = value.trim();
  return trimmed || EMPTY_TEXT_SIGNATURE;
};

const diffSignatureMap = (
  prev: Record<string, string>,
  next: Record<string, string>
) => {
  const changed = new Set<string>();
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  keys.forEach((key) => {
    if (prev[key] !== next[key]) {
      changed.add(key);
    }
  });
  return changed;
};

export const diffJDItemSignatures = (
  prev: JDAnalysisItemSignatures,
  next: JDAnalysisItemSignatures
) => ({
  experiences: diffSignatureMap(prev.experiences, next.experiences),
  certifications: diffSignatureMap(prev.certifications, next.certifications),
  skills: diffSignatureMap(prev.skills, next.skills),
});

export const clampMatchScore = (value: unknown): number | undefined => {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  return Math.min(100, Math.max(0, Math.round(numeric)));
};

const compareByDateDesc = (a: ResumeExperienceView, b: ResumeExperienceView) => {
  const valA = parseYearMonthValue(a.startDate) ?? -1;
  const valB = parseYearMonthValue(b.startDate) ?? -1;
  return valB - valA;
};

const compareByScoreThenDate = (
  a: ResumeExperienceView,
  b: ResumeExperienceView
) => {
  const scoreA = a.matchScore ?? -1;
  const scoreB = b.matchScore ?? -1;
  if (scoreA !== scoreB) {
    return scoreB - scoreA;
  }
  return compareByDateDesc(a, b);
};

const sortByCategory = (
  items: ResumeExperienceView[],
  compare: (a: ResumeExperienceView, b: ResumeExperienceView) => number
) => {
  return EXPERIENCE_CATEGORY_ORDER.flatMap((category) =>
    [...items].filter((item) => item.category === category).sort(compare)
  );
};

export const sortExperienceItemsForMatch = (items: ResumeExperienceView[]) => {
  const hasScore = items.some((item) => typeof item.matchScore === "number");
  const comparator = hasScore ? compareByScoreThenDate : compareByDateDesc;
  return sortByCategory(items, comparator);
};
