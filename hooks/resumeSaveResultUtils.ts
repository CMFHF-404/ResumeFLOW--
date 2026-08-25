import type { Resume, ResumeDetail } from '../services/resumeService';
import type { ResumeJDAnalysis } from '../types/resume';
import {
    buildJDAnalysisPersistenceFingerprint,
    type JDAnalysisCacheRecord,
} from '../services/jdAnalysisStorage';

type ResumeSaveResultMergeOptions = {
    savedConfigSignature: string;
    latestConfigSignature: string;
    pendingJDAnalysisCache?: JDAnalysisCacheRecord | null;
    savedJDAnalysis?: ResumeJDAnalysis | null;
};

export const mergeResumeSaveResultIntoDetail = (
    detail: ResumeDetail | null,
    updatedResume: Resume,
    {
        savedConfigSignature,
        latestConfigSignature,
        pendingJDAnalysisCache,
        savedJDAnalysis = null,
    }: ResumeSaveResultMergeOptions
): ResumeDetail | null => {
    if (!detail || detail.resume.id !== updatedResume.id) {
        return detail;
    }

    const mergedResume = {
        ...detail.resume,
        ...updatedResume,
    };
    const hasNewerPendingJDAnalysis = Boolean(
        pendingJDAnalysisCache?.pendingSync
        && buildJDAnalysisPersistenceFingerprint(pendingJDAnalysisCache.payload)
            !== buildJDAnalysisPersistenceFingerprint(savedJDAnalysis)
    );
    if (savedConfigSignature !== latestConfigSignature || hasNewerPendingJDAnalysis) {
        mergedResume.config = detail.resume.config;
    }

    return {
        ...detail,
        resume: mergedResume,
    };
};
