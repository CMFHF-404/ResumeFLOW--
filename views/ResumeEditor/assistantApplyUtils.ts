import type { AssistantExperienceDraft } from '../../services/aiService';
import type { EducationEditDraft, ExperienceEditDraft } from '../../types/resume';
import { normalizeDateInput } from '../../utils/dateUtils';

export const applyAssistantExperienceDraftToDraft = (
    baseDraft: ExperienceEditDraft,
    assistantDraft: AssistantExperienceDraft
): ExperienceEditDraft => ({
    ...baseDraft,
    company: assistantDraft.org,
    title: assistantDraft.title,
    startDate: assistantDraft.startDate || '',
    endDate: assistantDraft.isCurrent ? '' : (assistantDraft.endDate || ''),
    isCurrent: Boolean(assistantDraft.isCurrent),
    star: {
        s: assistantDraft.star.s,
        t: assistantDraft.star.t,
        a: assistantDraft.star.a,
        r: assistantDraft.star.r,
    },
    starTouched: true,
});

export const buildAssistantEducationDraft = (
    assistantDraft: AssistantExperienceDraft
): EducationEditDraft => ({
    school: assistantDraft.org.trim(),
    major: assistantDraft.title.trim(),
    degree: assistantDraft.star.s.trim(),
    startDate: assistantDraft.startDate.trim(),
    endDate: assistantDraft.isCurrent ? '至今' : assistantDraft.endDate.trim(),
    gpa: assistantDraft.star.t.trim(),
    courses: assistantDraft.star.a.trim(),
});

export const buildAssistantExperienceAssemblyOverride = (
    assistantDraft: AssistantExperienceDraft,
    title: string
) => {
    const overrides: Record<string, unknown> = {
        star: assistantDraft.star,
        is_current: Boolean(assistantDraft.isCurrent),
    };
    const clearOverrideKeys = new Set<string>();
    const org = assistantDraft.org.trim();
    const startDate = normalizeDateInput(assistantDraft.startDate);
    const endDate = assistantDraft.isCurrent ? undefined : normalizeDateInput(assistantDraft.endDate);
    if (title) {
        overrides.title = title;
    }
    if (org) {
        overrides.org = org;
    }
    if (startDate) {
        overrides.start_date = startDate;
    }
    if (endDate) {
        overrides.end_date = endDate;
    } else {
        clearOverrideKeys.add('end_date');
    }
    return {
        overrides_json: overrides,
        ...(clearOverrideKeys.size > 0 ? { clear_override_keys: Array.from(clearOverrideKeys) } : {}),
    };
};

export const buildAssistantExperienceCreateVersionPayload = (
    assistantDraft: AssistantExperienceDraft,
    title: string
) => ({
    title,
    org: assistantDraft.org.trim() || undefined,
    start_date: normalizeDateInput(assistantDraft.startDate),
    end_date: assistantDraft.isCurrent ? undefined : normalizeDateInput(assistantDraft.endDate),
    is_current: Boolean(assistantDraft.isCurrent),
    star: assistantDraft.star,
});
