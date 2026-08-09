import type { Resume as ResumeRecord } from '../services/resumeService';
import type { Resume as DashboardResume } from '../types';
import { clampMatchScore } from './resumeHelpers';
import { resolveDashboardResumeEvaluationScore } from './dashboardResumeScore';
import { formatDateLabel, formatRelativeTime } from './timeUtils';
import {
    buildJDAnalysisPersistenceFingerprint,
    loadJDAnalysisCache,
    normalizeJDAnalysisPersistence,
    selectPreferredPersistedJDAnalysis,
} from '../views/jdAnalysisStorage';
import type { ResumeEditorConfig } from '../types/resume';
import { canonicalStringify } from './canonicalStringify';

const DEFAULT_MATCH_RATE = 0;

const resolvePreferredLocalJDAnalysis = (resumeId: string) => (
    selectPreferredPersistedJDAnalysis(null, loadJDAnalysisCache(resumeId))?.payload ?? null
);

export const buildDashboardTargetRoleSignature = (targetRole: string | null | undefined) => (
    canonicalStringify({ targetRole: (targetRole ?? '').trim() })
);

const hasCurrentEvaluationSignatures = (
    persistedJDAnalysis: ReturnType<typeof normalizeJDAnalysisPersistence>,
    expectedTargetRoleSignature?: string
) => Boolean(
    persistedJDAnalysis?.evaluationSignature?.trim()
    && persistedJDAnalysis.targetRoleSignature?.trim()
    && expectedTargetRoleSignature !== undefined
    && persistedJDAnalysis.targetRoleSignature === expectedTargetRoleSignature
);

const resolvePersistedJDAnalysis = (
    resumeId: string,
    config?: ResumeRecord['config']
) => {
    const localCachedJDAnalysis = loadJDAnalysisCache(resumeId);
    if (config === undefined) {
        return localCachedJDAnalysis?.pendingSync === true
            ? localCachedJDAnalysis.payload
            : null;
    }
    const backendPersistedJDAnalysis = normalizeJDAnalysisPersistence(
        (config as ResumeEditorConfig | undefined)?.jdAnalysis
    );
    return selectPreferredPersistedJDAnalysis(
        backendPersistedJDAnalysis,
        localCachedJDAnalysis
    )?.payload ?? backendPersistedJDAnalysis;
};

export const resolveDashboardResumeEvaluationScoreForResume = (
    resumeId: string,
    config?: ResumeRecord['config'],
    expectedTargetRoleSignature?: string
) => {
    const persistedJDAnalysis = resolvePersistedJDAnalysis(resumeId, config);
    if (
        (persistedJDAnalysis?.evaluationIsOutdated ?? persistedJDAnalysis?.isOutdated) === true
        || !hasCurrentEvaluationSignatures(persistedJDAnalysis, expectedTargetRoleSignature)
    ) {
        return null;
    }
    return resolveDashboardResumeEvaluationScore(persistedJDAnalysis?.result?.resumeEvaluation);
};

export const resolveDashboardResumeMatchRate = (
    resumeId: string,
    config?: ResumeRecord['config']
) => {
    const persistedJDAnalysis = config === undefined
        ? resolvePreferredLocalJDAnalysis(resumeId)
        : resolvePersistedJDAnalysis(resumeId, config);
    if (persistedJDAnalysis?.isOutdated === true) {
        return DEFAULT_MATCH_RATE;
    }
    const score = clampMatchScore(persistedJDAnalysis?.result?.matchPercentage);
    return typeof score === 'number' ? score : DEFAULT_MATCH_RATE;
};

export const resolveDashboardResumeLocalMatchRate = (resumeId: string) => {
    const preferredLocalJDAnalysis = resolvePreferredLocalJDAnalysis(resumeId);
    if (preferredLocalJDAnalysis?.isOutdated === true) {
        return null;
    }
    const score = clampMatchScore(preferredLocalJDAnalysis?.result?.matchPercentage);
    return typeof score === 'number' ? score : null;
};

export const resolveDashboardResumeLocalEvaluationScore = (
    resumeId: string,
    expectedBaseFingerprint?: string | null,
    expectedTargetRoleSignature?: string
) => {
    const localCachedJDAnalysis = loadJDAnalysisCache(resumeId);
    if (
        !localCachedJDAnalysis?.pendingSync
        || expectedBaseFingerprint === undefined
        || localCachedJDAnalysis.basePersistedFingerprint !== expectedBaseFingerprint
    ) {
        return undefined;
    }
    const preferredLocalJDAnalysis = localCachedJDAnalysis.payload;
    if (
        (preferredLocalJDAnalysis?.evaluationIsOutdated ?? preferredLocalJDAnalysis?.isOutdated) === true
        || !hasCurrentEvaluationSignatures(
            preferredLocalJDAnalysis,
            expectedTargetRoleSignature
        )
    ) {
        return null;
    }
    return resolveDashboardResumeEvaluationScore(preferredLocalJDAnalysis?.result?.resumeEvaluation);
};

export const mapResumeToDashboard = (
    resume: Pick<ResumeRecord, 'id' | 'title' | 'target_role' | 'config' | 'created_at' | 'updated_at'>
): DashboardResume => {
    const evaluationTargetRoleSignature = buildDashboardTargetRoleSignature(resume.target_role);
    const backendPersistedJDAnalysis = normalizeJDAnalysisPersistence(
        (resume.config as ResumeEditorConfig | undefined)?.jdAnalysis
    );
    const evaluationScore = resolveDashboardResumeEvaluationScoreForResume(
        resume.id,
        resume.config,
        evaluationTargetRoleSignature
    );
    const matchRate = resolveDashboardResumeMatchRate(resume.id, resume.config);
    return {
        id: resume.id,
        name: resume.title,
        targetRole: resume.target_role || '通用',
        matchRate,
        evaluationScore,
        evaluationBaseFingerprint: buildJDAnalysisPersistenceFingerprint(
            backendPersistedJDAnalysis
        ),
        evaluationTargetRoleSignature,
        createdAt: formatDateLabel(resume.created_at),
        createdAtValue: resume.created_at,
        lastModified: formatRelativeTime(resume.updated_at),
        updatedAtValue: resume.updated_at,
        status: matchRate > 0 || evaluationScore !== null ? 'final' : 'draft',
        type: 'general',
    };
};

export const mapResumesToDashboard = (
    resumes: Array<Pick<ResumeRecord, 'id' | 'title' | 'target_role' | 'config' | 'created_at' | 'updated_at'>>
) => resumes.map(mapResumeToDashboard);

export const replaceDashboardResumeFromServer = (
    resumes: DashboardResume[],
    updated: ResumeRecord
) => {
    const mapped = mapResumeToDashboard(updated);
    return resumes.map((resume) => (
        resume.id === mapped.id ? mapped : resume
    ));
};
