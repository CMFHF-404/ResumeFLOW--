import type { AssistantDraftCard } from '../services/aiService';
import { formatYearMonth } from './dateUtils';
import { normalizeAiRichText, splitRichTextLines } from './richText';

const normalizeExperienceActionText = (value: string) =>
    normalizeAiRichText(value, { allowList: false });

const shouldNormalizeExperienceAction = (card: AssistantDraftCard) =>
    card.type === 'experience' && card.data.category !== 'education';

export const normalizeAssistantDraftCard = (card: AssistantDraftCard): AssistantDraftCard => {
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

export const getAssistantActionPreviewLines = (card: AssistantDraftCard) => {
    if (card.type !== 'experience' || !shouldNormalizeExperienceAction(card)) {
        return [];
    }
    return splitRichTextLines(normalizeExperienceActionText(card.data.star.a));
};
