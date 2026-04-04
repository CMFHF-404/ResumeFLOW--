import {
  DEFAULT_RESUME_TEMPLATE_ID,
  normalizeResumeTemplateId,
  resolveDefaultResumeThemeColorPresetId,
  type ResumeTemplateId,
} from '../constants/resumeTemplates';
import type { ResumeEditorConfig } from '../types/resume';

const PREFERRED_RESUME_TEMPLATE_STORAGE_KEY = 'yuanzijianli.preferredResumeTemplate';

type StoredPreferredResumeTemplate = {
  templateId?: string;
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

export const buildPreferredResumeCreateConfig = (): ResumeEditorConfig => {
  const templateId = loadPreferredResumeTemplateId();
  return {
    layout: {
      templateId,
      themeColorPresetId: resolveDefaultResumeThemeColorPresetId(templateId),
    },
  };
};
