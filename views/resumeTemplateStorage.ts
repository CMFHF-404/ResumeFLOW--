import {
  DEFAULT_RESUME_TEMPLATE_ID,
  RESUME_TEMPLATE_DEFINITIONS,
  RESUME_THEME_COLOR_PRESETS,
  normalizeResumeTemplateId,
  resolveDefaultResumeThemeColorPresetId,
  type ResumeTemplateId,
  type ResumeThemeColorPresetId,
} from '../constants/resumeTemplates';
import { profileService } from '../services/profileService';
import type { ResumeEditorConfig } from '../types/resume';
import {
  DEFAULT_RESUME_EXPERIENCE_LIST_MARKER_STYLE,
  DEFAULT_RESUME_SKILL_TAG_SEPARATOR,
  normalizeResumeExperienceListMarkerStyle,
  normalizeResumeSkillTagSeparator,
} from '../utils/resumeCustomization';
import { DEFAULT_SECTION_ORDER, RESUME_SECTION_IDS } from './ResumeEditor/constants';

const PREFERRED_RESUME_TEMPLATE_STORAGE_KEY = 'yuanzijianli.preferredResumeTemplate';
const RESUME_TEMPLATE_PRESETS_STORAGE_KEY = 'yuanzijianli.resumeTemplatePresets';
const PROFILE_RESUME_TEMPLATE_PRESETS_KEY = 'resumeTemplatePresets';

type StoredPreferredResumeTemplate = {
  templateId?: string;
};

type RawResumeTemplatePreset = {
  sectionOrder?: string[];
  themeColorPresetId?: string;
  experienceListMarkerStyle?: string;
  skillTagSeparator?: string;
  updatedAt?: string;
};

type RawResumeTemplatePresetMap = Record<string, RawResumeTemplatePreset>;

export type ResumeTemplatePreset = {
  templateId: ResumeTemplateId;
  sectionOrder: string[];
  themeColorPresetId: ResumeThemeColorPresetId;
  experienceListMarkerStyle: ReturnType<typeof normalizeResumeExperienceListMarkerStyle>;
  skillTagSeparator: string;
  updatedAt: string;
};

export type ResumeTemplatePresetMap = Partial<Record<ResumeTemplateId, ResumeTemplatePreset>>;

const RESUME_TEMPLATE_ID_SET = new Set<string>(RESUME_TEMPLATE_DEFINITIONS.map((item) => item.id));
const RESUME_THEME_COLOR_PRESET_ID_SET = new Set<string>(RESUME_THEME_COLOR_PRESETS.map((item) => item.id));

const normalizeSectionOrder = (order?: string[]) => {
  const filtered = (order || []).filter((sectionId) => RESUME_SECTION_IDS.has(sectionId));
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

const resolveUpdatedAt = (value?: string) => {
  if (!value) {
    return new Date(0).toISOString();
  }
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : new Date(0).toISOString();
};

const normalizeResumeThemeColorPresetId = (
  templateId: ResumeTemplateId,
  themeColorPresetId?: string | null
): ResumeThemeColorPresetId => (
  (themeColorPresetId && RESUME_THEME_COLOR_PRESET_ID_SET.has(themeColorPresetId))
    ? (themeColorPresetId as ResumeThemeColorPresetId)
    : resolveDefaultResumeThemeColorPresetId(templateId)
);

const normalizeResumeTemplatePreset = (
  templateId: string,
  preset?: RawResumeTemplatePreset | null
): ResumeTemplatePreset | null => {
  if (!RESUME_TEMPLATE_ID_SET.has(templateId)) {
    return null;
  }
  const resolvedTemplateId = normalizeResumeTemplateId(templateId);
  return {
    templateId: resolvedTemplateId,
    sectionOrder: normalizeSectionOrder(preset?.sectionOrder),
    themeColorPresetId: normalizeResumeThemeColorPresetId(
      resolvedTemplateId,
      preset?.themeColorPresetId
    ),
    experienceListMarkerStyle: normalizeResumeExperienceListMarkerStyle(
      preset?.experienceListMarkerStyle
    ),
    skillTagSeparator: normalizeResumeSkillTagSeparator(preset?.skillTagSeparator),
    updatedAt: resolveUpdatedAt(preset?.updatedAt),
  };
};

const normalizeResumeTemplatePresetMap = (value: unknown): ResumeTemplatePresetMap => {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const rawMap = value as RawResumeTemplatePresetMap;
  return Object.entries(rawMap).reduce<ResumeTemplatePresetMap>((result, [templateId, preset]) => {
    const normalized = normalizeResumeTemplatePreset(templateId, preset);
    if (normalized) {
      result[normalized.templateId] = normalized;
    }
    return result;
  }, {});
};

const serializeResumeTemplatePresetMap = (presetMap: ResumeTemplatePresetMap): RawResumeTemplatePresetMap => (
  Object.values(presetMap).reduce<RawResumeTemplatePresetMap>((result, preset) => {
    if (!preset) {
      return result;
    }
    result[preset.templateId] = {
      sectionOrder: [...preset.sectionOrder],
      themeColorPresetId: preset.themeColorPresetId,
      experienceListMarkerStyle: preset.experienceListMarkerStyle,
      skillTagSeparator: preset.skillTagSeparator,
      updatedAt: preset.updatedAt,
    };
    return result;
  }, {})
);

const getPresetUpdatedAtMs = (preset?: ResumeTemplatePreset) => {
  if (!preset) {
    return Number.NEGATIVE_INFINITY;
  }
  const time = Date.parse(preset.updatedAt);
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
};

const arePresetMapsEqual = (left: ResumeTemplatePresetMap, right: ResumeTemplatePresetMap) => (
  JSON.stringify(serializeResumeTemplatePresetMap(left)) === JSON.stringify(serializeResumeTemplatePresetMap(right))
);

const mergeResumeTemplatePresetMaps = (
  ...presetMaps: ResumeTemplatePresetMap[]
): ResumeTemplatePresetMap => {
  const merged: ResumeTemplatePresetMap = {};
  presetMaps.forEach((presetMap) => {
    Object.entries(presetMap).forEach(([templateId, preset]) => {
      if (!preset) {
        return;
      }
      const resolvedTemplateId = normalizeResumeTemplateId(templateId);
      const current = merged[resolvedTemplateId];
      if (!current || getPresetUpdatedAtMs(preset) >= getPresetUpdatedAtMs(current)) {
        merged[resolvedTemplateId] = preset;
      }
    });
  });
  return merged;
};

const resolveResumeTemplatePresetStorageOwnerId = (ownerId?: string | null) => (
  ownerId ?? null
);

const buildResumeTemplatePresetStorageKey = (ownerId: string) => (
  `${RESUME_TEMPLATE_PRESETS_STORAGE_KEY}:${ownerId}`
);

const writeResumeTemplatePresetMapToStorage = (
  presetMap: ResumeTemplatePresetMap,
  ownerId?: string | null
) => {
  if (typeof window === 'undefined') {
    return;
  }
  const resolvedOwnerId = resolveResumeTemplatePresetStorageOwnerId(ownerId);
  if (!resolvedOwnerId) {
    return;
  }
  window.localStorage.setItem(
    buildResumeTemplatePresetStorageKey(resolvedOwnerId),
    JSON.stringify(serializeResumeTemplatePresetMap(presetMap))
  );
};

export const loadPreferredResumeTemplateId = (): ResumeTemplateId => {
  const fallback = DEFAULT_RESUME_TEMPLATE_ID;
  if (typeof window === 'undefined') {
    return fallback;
  }

  const raw = window.localStorage.getItem(PREFERRED_RESUME_TEMPLATE_STORAGE_KEY);
  if (!raw) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw) as StoredPreferredResumeTemplate;
    return normalizeResumeTemplateId(parsed.templateId);
  } catch {
    window.localStorage.removeItem(PREFERRED_RESUME_TEMPLATE_STORAGE_KEY);
    return fallback;
  }
};

export const savePreferredResumeTemplateId = (templateId: ResumeTemplateId) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(
    PREFERRED_RESUME_TEMPLATE_STORAGE_KEY,
    JSON.stringify({ templateId })
  );
};

export const loadResumeTemplatePresetMap = (
  ownerId?: string | null
): ResumeTemplatePresetMap => {
  if (typeof window === 'undefined') {
    return {};
  }
  const resolvedOwnerId = resolveResumeTemplatePresetStorageOwnerId(ownerId);
  if (!resolvedOwnerId) {
    return {};
  }
  const raw = window.localStorage.getItem(buildResumeTemplatePresetStorageKey(resolvedOwnerId));
  if (!raw) {
    return {};
  }
  try {
    return normalizeResumeTemplatePresetMap(JSON.parse(raw));
  } catch {
    window.localStorage.removeItem(buildResumeTemplatePresetStorageKey(resolvedOwnerId));
    return {};
  }
};

export const extractResumeTemplatePresetMapFromProfile = (
  extraJson?: Record<string, any> | null
): ResumeTemplatePresetMap => (
  normalizeResumeTemplatePresetMap(extraJson?.[PROFILE_RESUME_TEMPLATE_PRESETS_KEY])
);

export const syncResumeTemplatePresetsFromProfile = (
  extraJson?: Record<string, any> | null,
  ownerId?: string | null
): ResumeTemplatePresetMap => {
  const remotePresetMap = extractResumeTemplatePresetMapFromProfile(extraJson);
  if (typeof window === 'undefined') {
    return remotePresetMap;
  }
  const localPresetMap = loadResumeTemplatePresetMap(ownerId);
  const mergedPresetMap = mergeResumeTemplatePresetMaps(localPresetMap, remotePresetMap);
  if (!arePresetMapsEqual(localPresetMap, mergedPresetMap)) {
    writeResumeTemplatePresetMapToStorage(mergedPresetMap, ownerId);
  }
  return mergedPresetMap;
};

export const loadResumeTemplatePreset = (
  templateId: ResumeTemplateId,
  ownerId?: string | null
): ResumeTemplatePreset | null => {
  const presetMap = loadResumeTemplatePresetMap(ownerId);
  return presetMap[templateId] ?? null;
};

export const resolveResumeTemplatePreset = (
  templateId: ResumeTemplateId,
  extraJson?: Record<string, any> | null,
  ownerId?: string | null
): ResumeTemplatePreset | null => {
  if (extraJson) {
    const remotePresetMap = extractResumeTemplatePresetMapFromProfile(extraJson);
    if (typeof window === 'undefined') {
      return remotePresetMap[templateId] ?? null;
    }
    return mergeResumeTemplatePresetMaps(
      loadResumeTemplatePresetMap(ownerId),
      remotePresetMap
    )[templateId] ?? null;
  }
  return loadResumeTemplatePresetMap(ownerId)[templateId] ?? null;
};

export const saveResumeTemplatePreset = async (
  preset: Pick<
    ResumeTemplatePreset,
    'templateId' | 'sectionOrder' | 'themeColorPresetId' | 'experienceListMarkerStyle' | 'skillTagSeparator'
  >
): Promise<ResumeTemplatePreset> => {
  const normalizedPreset = normalizeResumeTemplatePreset(preset.templateId, {
    sectionOrder: preset.sectionOrder,
    themeColorPresetId: preset.themeColorPresetId,
    experienceListMarkerStyle: preset.experienceListMarkerStyle,
    skillTagSeparator: preset.skillTagSeparator,
    updatedAt: new Date().toISOString(),
  });
  if (!normalizedPreset) {
    throw new Error('无效的简历模板预设');
  }
  const profile = await profileService.getProfile({ force: true });
  const nextExtraJson = {
    ...(profile?.extra_json || {}),
    [PROFILE_RESUME_TEMPLATE_PRESETS_KEY]: serializeResumeTemplatePresetMap(
      mergeResumeTemplatePresetMaps(
        extractResumeTemplatePresetMapFromProfile(profile?.extra_json),
        { [normalizedPreset.templateId]: normalizedPreset }
      )
    ),
  };
  const updatedProfile = await profileService.updateProfile({ extra_json: nextExtraJson });
  syncResumeTemplatePresetsFromProfile(updatedProfile.extra_json, updatedProfile.user_id);
  return normalizedPreset;
};

export const buildPreferredResumeCreateConfig = (
  extraJson?: Record<string, any> | null,
  ownerId?: string | null
): ResumeEditorConfig => {
  const templateId = loadPreferredResumeTemplateId();
  const preset = resolveResumeTemplatePreset(templateId, extraJson, ownerId);
  return {
    layout: {
      templateId,
      themeColorPresetId: preset?.themeColorPresetId ?? resolveDefaultResumeThemeColorPresetId(templateId),
      experienceListMarkerStyle:
        preset?.experienceListMarkerStyle ?? DEFAULT_RESUME_EXPERIENCE_LIST_MARKER_STYLE,
      skillTagSeparator: preset?.skillTagSeparator ?? DEFAULT_RESUME_SKILL_TAG_SEPARATOR,
      ...(preset ? { sectionOrder: [...preset.sectionOrder] } : {}),
    },
  };
};
