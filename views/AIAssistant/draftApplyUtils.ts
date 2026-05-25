import type { AssistantDraftCard } from '../../services/aiService';
import { normalizeDateInput } from '../../utils/dateUtils';

type ExperienceDraftData = Extract<AssistantDraftCard, { type: 'experience' }>['data'];

export const buildResumeExperienceOverrideOperation = (draft: ExperienceDraftData) => {
  const overrides: Record<string, unknown> = {
    star: draft.star,
    is_current: Boolean(draft.isCurrent),
  };
  const clearOverrideKeys = new Set<string>();
  if (draft.title.trim()) {
    overrides.title = draft.title.trim();
  }
  if (draft.org.trim()) {
    overrides.org = draft.org.trim();
  }
  if (draft.startDate.trim()) {
    overrides.start_date = normalizeDateInput(draft.startDate) ?? draft.startDate.trim();
  }
  if (!draft.isCurrent && draft.endDate.trim()) {
    overrides.end_date = normalizeDateInput(draft.endDate) ?? draft.endDate.trim();
  } else {
    clearOverrideKeys.add('end_date');
  }
  return {
    overrides_json: overrides,
    ...(clearOverrideKeys.size > 0 ? { clear_override_keys: Array.from(clearOverrideKeys) } : {}),
  };
};
