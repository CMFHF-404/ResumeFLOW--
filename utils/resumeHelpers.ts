import { parseYearMonthValue } from "../views/experienceUtils";
import {
  decodeRichTextEntitiesDeep,
  hasRichTextDecoration,
  sanitizeRichTextHtml,
  stripRichTextToText,
} from "./richText";
import type { JDAnalysisItemSignatures } from "../types/analysis";
import type { ResumeExperienceView, StarFields } from "../types/resume";

const EMPTY_TEXT_SIGNATURE = "";
const EXPERIENCE_CATEGORY_ORDER: Array<ResumeExperienceView["category"]> = [
  "work",
  "project",
];
const STAR_FIELD_KEYS: Array<keyof StarFields> = ["s", "t", "a", "r"];

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
