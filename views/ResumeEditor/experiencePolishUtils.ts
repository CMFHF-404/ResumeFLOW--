import type {
    PolishExperiencePayload,
    PolishExperienceResponse,
    PolishMode,
} from '../../services/aiService';
import type { ExperienceEditDraft } from '../../types/resume';
import { normalizeAiRichText } from '../../utils/richText';
import { buildSmartCompletionCustomPrompt } from './smartCompletionUtils';

type ResumePolishMode = Exclude<PolishMode, 'assistant'>;

type ExperiencePolishCustomPromptInput = {
    mode: ResumePolishMode;
    customPrompt: string;
    smartCompletionAnswer?: string;
    jdCapabilityPolishContext?: string;
};

export const buildExperiencePolishPayloadContent = (
    draft: ExperienceEditDraft
): PolishExperiencePayload['content'] => ({
    company: draft.company,
    role: draft.title,
    s: draft.star.s,
    t: draft.star.t,
    a: draft.star.a,
    r: draft.star.r,
});

export const resolveExperiencePolishCustomPrompt = ({
    mode,
    customPrompt,
    smartCompletionAnswer = '',
    jdCapabilityPolishContext = '',
}: ExperiencePolishCustomPromptInput) => {
    if (mode === 'custom') {
        return customPrompt.trim();
    }
    if (mode === 'smart_complete') {
        return buildSmartCompletionCustomPrompt(
            smartCompletionAnswer,
            jdCapabilityPolishContext
        );
    }
    return undefined;
};

export const shouldAskBeforeSmartCompletionRewrite = (
    mode: ResumePolishMode,
    result: PolishExperienceResponse
) => (
    mode === 'smart_complete'
    && (
        result.recommendedRewriteMode === 'ask_before_rewrite'
        || result.recommendedRewriteMode === 'not_recommended_for_this_role'
    )
);

const normalizePolishedField = (value?: string) => {
    if (!value) {
        return undefined;
    }
    const normalized = normalizeAiRichText(value, { allowList: false });
    return normalized.trim() ? normalized : undefined;
};

export const buildPolishedExperienceDraft = (
    draft: ExperienceEditDraft,
    result: PolishExperienceResponse
): ExperienceEditDraft => ({
    ...draft,
    star: {
        s: normalizePolishedField(result?.s) ?? draft.star.s,
        t: normalizePolishedField(result?.t) ?? draft.star.t,
        a: normalizePolishedField(result?.a) ?? draft.star.a,
        r: normalizePolishedField(result?.r) ?? draft.star.r,
    },
    starTouched: true,
});
