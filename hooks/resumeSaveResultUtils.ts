import type { Resume, ResumeDetail } from '../services/resumeService';
import type { ResumeEditorConfig, ResumeJDAnalysis } from '../types/resume';
import {
    buildJDAnalysisPersistenceFingerprint,
    graftJDAnalysisAuthority,
    type JDAnalysisCacheRecord,
} from '../services/jdAnalysisStorage';

type ResumeSaveResultMergeOptions = {
    savedConfigSignature: string;
    latestConfigSignature: string;
    latestConfigSnapshot?: ResumeEditorConfig;
    pendingJDAnalysisCache?: JDAnalysisCacheRecord | null;
    savedJDAnalysis?: ResumeJDAnalysis | null;
};

export const mergeResumeSaveResultIntoDetail = (
    detail: ResumeDetail | null,
    updatedResume: Resume,
    options: ResumeSaveResultMergeOptions
): ResumeDetail | null => {
    if (!detail || detail.resume.id !== updatedResume.id) {
        return detail;
    }

    const mergedResume = {
        ...detail.resume,
        ...updatedResume,
    };
    const {
        savedConfigSignature,
        latestConfigSignature,
        latestConfigSnapshot,
        pendingJDAnalysisCache,
        savedJDAnalysis = null,
    } = options;
    const hasNewerPendingJDAnalysis = Boolean(
        pendingJDAnalysisCache?.pendingSync
        && buildJDAnalysisPersistenceFingerprint(pendingJDAnalysisCache.payload)
            !== buildJDAnalysisPersistenceFingerprint(savedJDAnalysis)
    );
    if (savedConfigSignature !== latestConfigSignature || hasNewerPendingJDAnalysis) {
        // Keep ordinary draft fields, but never retain stale JD authority after
        // a server acknowledgement. Otherwise a newer pending cache that was
        // based on the pre-save backend payload can appear safe to re-submit.
        mergedResume.config = Object.prototype.hasOwnProperty.call(options, 'savedJDAnalysis')
            ? graftJDAnalysisAuthority(
                latestConfigSnapshot ?? detail.resume.config ?? {},
                savedJDAnalysis
            )
            : detail.resume.config;
    }

    return {
        ...detail,
        resume: mergedResume,
    };
};
