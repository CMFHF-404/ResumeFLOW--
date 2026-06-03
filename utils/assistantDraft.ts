import type { AssistantDraftCard } from '../services/aiService';
import { formatYearMonth } from './dateUtils';
import { normalizeAiRichText, splitRichTextLines } from './richText';

const normalizeExperienceActionText = (value: string) =>
    normalizeAiRichText(value, { allowList: false });

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeDraftText = (value: unknown) =>
    typeof value === 'string' ? value.trim() : '';

type NormalizedSkillDraft = {
    name: string;
    targetUserSkillId?: string | null;
};

const normalizeSkillDraft = (value: unknown): NormalizedSkillDraft | null => {
    if (typeof value === 'string') {
        const name = normalizeDraftText(value);
        return name ? { name } : null;
    }
    if (!isRecord(value)) {
        return null;
    }
    const name = normalizeDraftText(value.name);
    if (!name) {
        return null;
    }
    const targetUserSkillId = normalizeDraftText(value.targetUserSkillId);
    return targetUserSkillId ? { name, targetUserSkillId } : { name };
};

const normalizeSkillGroupDraftCard = (card: Extract<AssistantDraftCard, { type: 'skill_group' }>): AssistantDraftCard => {
    const rawData = card.data as unknown;
    const data = isRecord(rawData) ? rawData : {};
    const skills = Array.isArray(data.skills)
        ? data.skills.map(normalizeSkillDraft).filter((skill): skill is NormalizedSkillDraft => Boolean(skill))
        : [];
    return {
        ...card,
        data: {
            category: normalizeDraftText(data.category),
            skills,
        },
    };
};

const shouldNormalizeExperienceAction = (card: AssistantDraftCard) =>
    card.type === 'experience' && card.data.category !== 'education';

export const normalizeAssistantDraftCard = (card: AssistantDraftCard): AssistantDraftCard => {
    if (card.type === 'skill_group') {
        return normalizeSkillGroupDraftCard(card);
    }

    if (card.type !== 'experience') {
        return card;
    }

    const shouldNormalizeAction = shouldNormalizeExperienceAction(card);
    return {
        ...card,
        data: {
            ...card.data,
            startDate: formatYearMonth(card.data.startDate),
            endDate: formatYearMonth(card.data.endDate),
            star: {
                ...card.data.star,
                a: shouldNormalizeAction
                    ? normalizeExperienceActionText(card.data.star.a)
                    : card.data.star.a,
            },
        },
    };
};

export const isAssistantDraftCardDisplayable = (card: AssistantDraftCard | null | undefined): card is AssistantDraftCard => {
    if (!card) {
        return false;
    }
    return card.type !== 'skill_group' || card.data.skills.length > 0;
};

export const getAssistantActionPreviewLines = (card: AssistantDraftCard) => {
    if (card.type !== 'experience' || !shouldNormalizeExperienceAction(card)) {
        return [];
    }
    return splitRichTextLines(normalizeExperienceActionText(card.data.star.a));
};
