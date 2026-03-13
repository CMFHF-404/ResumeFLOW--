import type { Resume as ResumeRecord } from '../services/resumeService';
import type { Resume as DashboardResume } from '../types';
import { clampMatchScore } from './resumeHelpers';
import { formatDateLabel, formatRelativeTime } from './timeUtils';
import { loadJDAnalysisCache } from '../views/jdAnalysisStorage';

const DEFAULT_MATCH_RATE = 0;

export const resolveDashboardResumeMatchRate = (resumeId: string) => {
    const cached = loadJDAnalysisCache(resumeId);
    const score = clampMatchScore(cached?.result?.matchPercentage);
    return typeof score === 'number' ? score : DEFAULT_MATCH_RATE;
};

export const mapResumeToDashboard = (
    resume: Pick<ResumeRecord, 'id' | 'title' | 'target_role' | 'created_at' | 'updated_at'>
): DashboardResume => ({
    id: resume.id,
    name: resume.title,
    targetRole: resume.target_role || '通用',
    matchRate: resolveDashboardResumeMatchRate(resume.id),
    createdAt: formatDateLabel(resume.created_at),
    lastModified: formatRelativeTime(resume.updated_at),
    status: 'draft',
    type: 'general',
});

export const mapResumesToDashboard = (
    resumes: Array<Pick<ResumeRecord, 'id' | 'title' | 'target_role' | 'created_at' | 'updated_at'>>
) => resumes.map(mapResumeToDashboard);
