import type { AssistantDraftCard, AssistantExperienceDraft } from '../services/aiService';
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

const normalizeExperienceDraftStar = (value: unknown): AssistantExperienceDraft['star'] => {
    const star = isRecord(value) ? value : {};
    return {
        s: normalizeDraftText(star.s),
        t: normalizeDraftText(star.t),
        a: normalizeDraftText(star.a),
        r: normalizeDraftText(star.r),
    };
};

const normalizeEducationDraftStar = (data: Record<string, unknown>): AssistantExperienceDraft['star'] => {
    const star = normalizeExperienceDraftStar(data.star);
    return {
        s: normalizeDraftText(data.degree) || star.s,
        t: normalizeDraftText(data.gpa) || star.t,
        a: normalizeDraftText(data.courses) || star.a,
        r: '',
    };
};

const normalizeLegacyEducationDraftCard = (card: Record<string, unknown>): AssistantDraftCard => {
    const data = isRecord(card.data) ? card.data : {};
    const targetMasterId = normalizeDraftText(data.targetMasterId);
    return {
        type: 'experience',
        status: 'draft_ready',
        ...(normalizeDraftText(card.summary) ? { summary: normalizeDraftText(card.summary) } : {}),
        data: {
            category: 'education',
            org: normalizeDraftText(data.org),
            title: normalizeDraftText(data.title),
            startDate: formatYearMonth(normalizeDraftText(data.startDate)),
            endDate: formatYearMonth(normalizeDraftText(data.endDate)),
            isCurrent: Boolean(data.isCurrent),
            ...(targetMasterId ? { targetMasterId } : {}),
            star: normalizeEducationDraftStar(data),
        },
    };
};

const shouldNormalizeExperienceAction = (card: AssistantDraftCard) =>
    card.type === 'experience' && card.data.category !== 'education';

const normalizeEducationExperienceDraftCard = (
    card: Extract<AssistantDraftCard, { type: 'experience' }>
): AssistantDraftCard => {
    const data = isRecord(card.data) ? card.data : {};
    const targetMasterId = normalizeDraftText(data.targetMasterId);
    return {
        ...card,
        data: {
            category: 'education',
            org: normalizeDraftText(data.org),
            title: normalizeDraftText(data.title),
            startDate: formatYearMonth(normalizeDraftText(data.startDate)),
            endDate: formatYearMonth(normalizeDraftText(data.endDate)),
            isCurrent: Boolean(data.isCurrent),
            ...(targetMasterId ? { targetMasterId } : {}),
            star: normalizeEducationDraftStar(data),
        },
    };
};

export const normalizeAssistantDraftCard = (card: AssistantDraftCard): AssistantDraftCard => {
    const cardType = (card as { type?: unknown }).type;
    if (cardType === 'education') {
        return normalizeLegacyEducationDraftCard(card as unknown as Record<string, unknown>);
    }

    if (card.type === 'skill_group') {
        return normalizeSkillGroupDraftCard(card);
    }

    if (card.type !== 'experience') {
        return card;
    }

    if (card.data.category === 'education') {
        return normalizeEducationExperienceDraftCard(card);
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

export const getAssistantEducationDraftFields = (card: AssistantDraftCard): Array<[string, string]> => {
    if (card.type !== 'experience' || card.data.category !== 'education') {
        return [];
    }
    return [
        ['学校', card.data.org],
        ['专业', card.data.title],
        ['学位', card.data.star.s],
        ['GPA/绩点', card.data.star.t],
        ['课程', card.data.star.a],
    ];
};

export const isAssistantDraftCardDisplayable = (card: AssistantDraftCard | null | undefined): card is AssistantDraftCard => {
    if (!card) {
        return false;
    }
    const cardType = (card as { type?: unknown }).type;
    if (cardType === 'skill_group') {
        return Array.isArray((card as Extract<AssistantDraftCard, { type: 'skill_group' }>).data?.skills)
            && (card as Extract<AssistantDraftCard, { type: 'skill_group' }>).data.skills.length > 0;
    }
    return cardType === 'experience' || cardType === 'certification';
};

export const getAssistantActionPreviewLines = (card: AssistantDraftCard) => {
    if (card.type !== 'experience' || !shouldNormalizeExperienceAction(card)) {
        return [];
    }
    return splitRichTextLines(normalizeExperienceActionText(card.data.star.a));
};
