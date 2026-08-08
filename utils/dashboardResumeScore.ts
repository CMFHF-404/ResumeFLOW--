import { normalizeResumeEvaluation } from '../services/aiNormalizeUtils';

/**
 * Dashboard scores intentionally trust only the versioned full-resume evaluation.
 * Legacy JD matchPercentage values are job-specific and must not leak into this UI.
 */
export const resolveDashboardResumeEvaluationScore = (value: unknown): number | null => {
    return normalizeResumeEvaluation(value)?.overallScore ?? null;
};
