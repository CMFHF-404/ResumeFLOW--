export type SmartCompletionPromptState = {
    diagnosis: string;
    questions: string[];
    answer: string;
};

export const buildSmartCompletionCustomPrompt = (answer: string, capabilityContext: string) => {
    const trimmedAnswer = answer.trim();
    const trimmedCapabilityContext = capabilityContext.trim();
    return [
        trimmedCapabilityContext,
        trimmedAnswer ? `用户补充的真实事实：${trimmedAnswer}` : '',
    ].filter(Boolean).join('\n\n') || undefined;
};

export const buildSmartCompletionPromptState = (
    result: {
        evidenceDiagnosis?: string;
        followUpQuestions?: string[];
    },
    previous?: SmartCompletionPromptState | null
): SmartCompletionPromptState => ({
    diagnosis: result.evidenceDiagnosis?.trim() || '这段经历证据不足，建议先补充事实后再润色。',
    questions: (result.followUpQuestions ?? [])
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 3),
    answer: previous?.answer ?? '',
});
