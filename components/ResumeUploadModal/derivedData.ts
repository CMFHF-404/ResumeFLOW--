import { certificationsService } from '../../services/certificationsService';
import type { Certification } from '../../services/certificationsService';
import { skillsService, type UserSkill } from '../../services/skillsService';
import type {
  ParsedCertification,
  ParsedPersonalInfo,
  ParsedPersonalInfoSelection,
  ParsedSkillGroup,
} from '../../services/parserService';
import { convertDateToISO } from '../../views/experienceUtils';
import {
  buildEmptySet,
  normalizeKey,
  normalizeParsedOptionalText,
  normalizeParsedText,
} from './parseUtils';

const SUPPORTED_EXTENSIONS = ['pdf', 'docx'];
const DEFAULT_SKILL_CATEGORY = '未分类';
const SKILL_DUPLICATE_MIN_CONTAINMENT_LENGTH = 4;
const SKILL_PROFICIENCY_PREFIX_PATTERN =
  /^(熟练掌握|熟练使用|熟练运用|熟悉|了解|掌握|具备|擅长|精通|能够|可独立|独立完成)\s*/i;
const CERTIFICATION_ISSUER_SUFFIX_PATTERN =
  /(股份有限公司|有限责任公司|有限公司|公司|集团)$/;

export type ParsedCertificationView = ParsedCertification & { id: string };

export type ParsedSkillTagView = {
  id: string;
  name: string;
  category: string;
};

export type ParsedSkillGroupView = {
  category: string;
  tags: ParsedSkillTagView[];
};

export const normalizeSkillCategoryName = (value?: string) =>
  value?.trim() || DEFAULT_SKILL_CATEGORY;

const buildCertificationViewId = (item: ParsedCertification, index: number) => {
  const name = item.name?.trim() || 'cert';
  return `cert-${index}-${normalizeKey(name)}`;
};

const buildSkillTagId = (category: string, tag: string) =>
  `${normalizeKey(category)}::${normalizeKey(tag)}`;

export const buildParsedCertifications = (items: ParsedCertification[]) => {
  return items.map((item, index) => ({
    ...item,
    id: buildCertificationViewId(item, index),
  }));
};

export const buildParsedSkillGroups = (items: ParsedSkillGroup[]): ParsedSkillGroupView[] => {
  const groups = new Map<string, ParsedSkillGroupView>();
  const order: string[] = [];
  items.forEach((entry) => {
    const category = normalizeParsedText(normalizeSkillCategoryName(entry.category)) || DEFAULT_SKILL_CATEGORY;
    const categoryKey = normalizeKey(category);
    if (!groups.has(categoryKey)) {
      groups.set(categoryKey, { category, tags: [] });
      order.push(categoryKey);
    }
    const group = groups.get(categoryKey);
    if (!group) {
      return;
    }
    const seen = new Set(group.tags.map((tag) => tag.id));
    const nextTags = Array.isArray(entry.tags) ? entry.tags : [];
    nextTags.forEach((rawTag) => {
      const tag = normalizeParsedText(rawTag);
      if (!tag) {
        return;
      }
      const tagId = buildSkillTagId(category, tag);
      if (seen.has(tagId)) {
        return;
      }
      seen.add(tagId);
      group.tags.push({ id: tagId, name: tag, category });
    });
  });
  return order.map((key) => groups.get(key)!).filter(Boolean);
};

export const flattenSkillTags = (groups: ParsedSkillGroupView[]) =>
  groups.flatMap((group) => group.tags);

export const buildPersonalInfoSelection = (
  info?: ParsedPersonalInfo,
  profileSnapshot?: {
    name?: string;
    email?: string;
    phone?: string;
    location?: string;
  }
): ParsedPersonalInfoSelection => ({
  full_name: Boolean(info?.full_name?.trim()) && !profileSnapshot?.name?.trim(),
  email: Boolean(info?.email?.trim()) && !profileSnapshot?.email?.trim(),
  phone: Boolean(info?.phone?.trim()) && !profileSnapshot?.phone?.trim(),
  location: Boolean(info?.location?.trim()) && !profileSnapshot?.location?.trim(),
});

const normalizeCertificationDate = (value?: string) => {
  if (!value) {
    return '';
  }
  return convertDateToISO(value) || value.trim();
};

const normalizeCertificationIssuerForDuplicate = (value?: string) => {
  let normalized = normalizeKey(value || '');
  let previous = '';
  while (normalized && normalized !== previous) {
    previous = normalized;
    normalized = normalized.replace(CERTIFICATION_ISSUER_SUFFIX_PATTERN, '');
  }
  return normalized;
};

const buildCertificationSignature = (item: {
  name: string;
  issuer?: string;
  issue_date?: string;
}) => {
  return [
    normalizeKey(item.name),
    normalizeCertificationIssuerForDuplicate(item.issuer),
    normalizeKey(normalizeCertificationDate(item.issue_date)),
  ].join('::');
};

const buildSkillSignature = (item: { name: string; category?: string }) => {
  return [
    normalizeKey(normalizeSkillCategoryName(item.category)),
    normalizeKey(item.name),
  ].join('::');
};

const normalizeSkillDuplicateName = (value: string) => {
  let normalized = normalizeKey(value).replace(SKILL_PROFICIENCY_PREFIX_PATTERN, '').trim();
  normalized = normalized
    .replace(/文档/g, '')
    .replace(/[\s\-_/\\()[\]{}（）【】《》<>·•、，,.;；:：]/g, '');
  return normalized;
};

const isDuplicateSkillName = (candidateName: string, existingName: string) => {
  const candidate = normalizeSkillDuplicateName(candidateName);
  const existing = normalizeSkillDuplicateName(existingName);
  if (!candidate || !existing) {
    return false;
  }
  if (candidate === existing) {
    return true;
  }
  const shorterLength = Math.min(candidate.length, existing.length);
  return (
    shorterLength >= SKILL_DUPLICATE_MIN_CONTAINMENT_LENGTH
    && (candidate.includes(existing) || existing.includes(candidate))
  );
};

const isDuplicateSkillTag = (
  item: { name: string },
  existingSkills: Array<Pick<UserSkill, 'name'>>
) => existingSkills.some((skill) => isDuplicateSkillName(item.name, skill.name));

export const buildSkillDuplicateIds = (
  groups: ParsedSkillGroupView[],
  existingSkills: UserSkill[]
) => {
  if (!groups.length || !existingSkills.length) {
    return buildEmptySet();
  }
  const duplicates = new Set<string>();
  flattenSkillTags(groups).forEach((tag) => {
    if (isDuplicateSkillTag(tag, existingSkills)) {
      duplicates.add(tag.id);
    }
  });
  return duplicates;
};

export const buildCertificationDuplicateIds = (
  items: ParsedCertificationView[],
  existingCertifications: Array<Pick<Certification, 'name' | 'issuer' | 'issue_date'>>
) => {
  if (!items.length || !existingCertifications.length) {
    return buildEmptySet();
  }
  const existingSignatures = new Set(
    existingCertifications.map((cert) =>
      buildCertificationSignature({
        name: cert.name,
        issuer: cert.issuer,
        issue_date: cert.issue_date || undefined,
      })
    )
  );
  const duplicates = new Set<string>();
  items.forEach((item) => {
    if (existingSignatures.has(buildCertificationSignature(item))) {
      duplicates.add(item.id);
    }
  });
  return duplicates;
};

const dedupeBySignature = <T,>(items: T[], getSignature: (item: T) => string) => {
  const seen = new Set<string>();
  const output: T[] = [];
  items.forEach((item) => {
    const signature = getSignature(item);
    if (!signature || seen.has(signature)) {
      return;
    }
    seen.add(signature);
    output.push(item);
  });
  return output;
};

export const countSelectedPersonalInfo = (selection?: ParsedPersonalInfoSelection) => {
  if (!selection) {
    return 0;
  }
  return Object.values(selection).filter(Boolean).length;
};

export const buildCertificationImportPayloads = async (items: ParsedCertificationView[]) => {
  const validItems = items.filter((item) => item.name?.trim());
  if (!validItems.length) {
    return [];
  }
  const existing = await certificationsService.list({ force: true });
  const existingSignatures = new Set(
    existing.map((cert) =>
      buildCertificationSignature({
        name: cert.name,
        issuer: cert.issuer,
        issue_date: cert.issue_date || undefined,
      })
    )
  );
  return dedupeBySignature<ParsedCertificationView>(validItems, buildCertificationSignature)
    .filter((item) => !existingSignatures.has(buildCertificationSignature(item)))
    .map((item) => ({
      name: normalizeParsedText(item.name),
      issuer: normalizeParsedOptionalText(item.issuer),
      issue_date: normalizeCertificationDate(item.issue_date) || undefined,
      expiry_date: normalizeCertificationDate(item.expiry_date) || undefined,
      credential_id: normalizeParsedOptionalText(item.credential_id),
      credential_url: normalizeParsedOptionalText(item.credential_url),
      description: normalizeParsedOptionalText(item.description),
    }));
};

export const buildSkillImportPayloads = async (items: ParsedSkillTagView[]) => {
  const validItems = items.filter((item) => item.name?.trim());
  if (!validItems.length) {
    return [];
  }
  const existing = await skillsService.list({ force: true });
  return dedupeBySignature(
    validItems,
    (item) => buildSkillSignature({ name: item.name, category: item.category })
  )
    .filter((item) => !isDuplicateSkillTag(item, existing))
    .map((item) => ({
      name: normalizeParsedText(item.name),
      category: normalizeParsedText(normalizeSkillCategoryName(item.category)),
    }));
};

export const isSupportedFile = (file: File) => {
  const extension = file.name.split('.').pop()?.toLowerCase();
  return extension ? SUPPORTED_EXTENSIONS.includes(extension) : false;
};

export const buildDefaultSelection = <T extends { id: string; duplicate?: { is_duplicate?: boolean } }>(
  items: T[]
) => new Set(items.filter((item) => !item.duplicate?.is_duplicate).map((item) => item.id));
