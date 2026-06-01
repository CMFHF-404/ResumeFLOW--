import type { UserSkill } from '../../services/skillsService';

export type AssistantSkillDraftPayload = {
    name: string;
    category?: string;
    targetUserSkillId?: string;
};

export const normalizeAssistantSkillDraftText = (value?: string | null) => (
    (value || '').trim().replace(/\s+/g, ' ')
);

export const buildAssistantSkillDraftKey = (name?: string | null, category?: string | null) => (
    `${normalizeAssistantSkillDraftText(category).toLocaleLowerCase()}::${normalizeAssistantSkillDraftText(name).toLocaleLowerCase()}`
);

export const findExistingSkillForAssistantDraft = (
    existingSkills: UserSkill[],
    payload: AssistantSkillDraftPayload,
) => {
    if (payload.targetUserSkillId) {
        const byTargetId = existingSkills.find((item) => item.id === payload.targetUserSkillId);
        if (byTargetId) {
            return byTargetId;
        }
    }
    const targetKey = buildAssistantSkillDraftKey(payload.name, payload.category);
    return existingSkills.find((item) => buildAssistantSkillDraftKey(item.name, item.category) === targetKey) ?? null;
};
