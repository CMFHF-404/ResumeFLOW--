import type { Resume as ResumeRecord } from '../services/resumeService';
import type { Resume as DashboardResume } from '../types';
import { clampMatchScore } from './resumeHelpers';
import { formatDateLabel, formatRelativeTime } from './timeUtils';
import {
    loadJDAnalysisCache,
    normalizeJDAnalysisPersistence,
    selectPreferredPersistedJDAnalysis,
} from '../views/jdAnalysisStorage';
import type { ResumeEditorConfig } from '../types/resume';

const DEFAULT_MATCH_RATE = 0;

const resolvePreferredLocalJDAnalysis = (resumeId: string) => {
    return selectPreferredPersistedJDAnalysis(
        null,
        loadJDAnalysisCache(resumeId)
    )?.payload ?? null;
};

const resolvePersistedJDAnalysis = (
    resumeId: string,
    config?: ResumeRecord['config']
) => {
    const localCachedJDAnalysis = loadJDAnalysisCache(resumeId);
    if (config === undefined) {
        return resolvePreferredLocalJDAnalysis(resumeId);
    }
    const backendPersistedJDAnalysis = normalizeJDAnalysisPersistence(
        (config as ResumeEditorConfig | undefined)?.jdAnalysis
    );
    return selectPreferredPersistedJDAnalysis(
        backendPersistedJDAnalysis,
        localCachedJDAnalysis
    )?.payload ?? backendPersistedJDAnalysis;
};

export const resolveDashboardResumeMatchRate = (
    resumeId: string,
    config?: ResumeRecord['config']
) => {
    const persistedJDAnalysis = resolvePersistedJDAnalysis(resumeId, config);
    const score = clampMatchScore(persistedJDAnalysis?.result?.matchPercentage);
    return typeof score === 'number' ? score : DEFAULT_MATCH_RATE;
};

export const resolveDashboardResumeLocalMatchRate = (resumeId: string) => {
    const preferredLocalJDAnalysis = resolvePreferredLocalJDAnalysis(resumeId);
    const score = clampMatchScore(preferredLocalJDAnalysis?.result?.matchPercentage);
    return typeof score === 'number' ? score : null;
};

export const mapResumeToDashboard = (
    resume: Pick<ResumeRecord, 'id' | 'title' | 'target_role' | 'config' | 'created_at' | 'updated_at'>
): DashboardResume => {
    const matchRate = resolveDashboardResumeMatchRate(resume.id, resume.config);
    return {
        id: resume.id,
        name: resume.title,
        targetRole: resume.target_role || '通用',
        matchRate,
        createdAt: formatDateLabel(resume.created_at),
        createdAtValue: resume.created_at,
        lastModified: formatRelativeTime(resume.updated_at),
        updatedAtValue: resume.updated_at,
        status: matchRate > 0 ? 'final' : 'draft',
        type: 'general',
    };
};

export const mapResumesToDashboard = (
    resumes: Array<Pick<ResumeRecord, 'id' | 'title' | 'target_role' | 'config' | 'created_at' | 'updated_at'>>
) => resumes.map(mapResumeToDashboard);
