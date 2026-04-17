import type { AssistantDraftCard } from '../services/aiService';
import { normalizeAiRichText, splitRichTextLines } from './richText';

const normalizeExperienceActionText = (value: string) =>
    normalizeAiRichText(value, { allowList: false });

const shouldNormalizeExperienceAction = (card: AssistantDraftCard) =>
    card.type === 'experience' && card.data.category !== 'education';

export const normalizeAssistantDraftCard = (card: AssistantDraftCard): AssistantDraftCard => {
    if (!shouldNormalizeExperienceAction(card)) {
        return card;
    }

    return {
        ...card,
        data: {
            ...card.data,
            star: {
                ...card.data.star,
                a: normalizeExperienceActionText(card.data.star.a),
            },
        },
    };
};

export const getAssistantActionPreviewLines = (card: AssistantDraftCard) =>
    shouldNormalizeExperienceAction(card)
        ? splitRichTextLines(normalizeExperienceActionText(card.data.star.a))
        : [];
