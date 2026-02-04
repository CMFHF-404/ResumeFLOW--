import type { JDAnalysisResult } from '../services/aiService';

const JD_ANALYSIS_CACHE_PREFIX = 'resumeFlow.jdAnalysisCache';

export type JDAnalysisCachePayload = {
    jdText: string;
    experienceSignature: string;
    result: JDAnalysisResult;
};

const buildCacheKey = (resumeId: string) => `${JD_ANALYSIS_CACHE_PREFIX}:${resumeId}`;

const isJDAnalysisCachePayload = (value: unknown): value is JDAnalysisCachePayload => {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const record = value as JDAnalysisCachePayload;
    return typeof record.jdText === 'string'
        && typeof record.experienceSignature === 'string'
        && Boolean(record.result);
};

export const loadJDAnalysisCache = (resumeId: string): JDAnalysisCachePayload | null => {
    if (!resumeId) {
        return null;
    }
    const raw = localStorage.getItem(buildCacheKey(resumeId));
    if (!raw) {
        return null;
    }
    try {
        const parsed = JSON.parse(raw) as JDAnalysisCachePayload;
        if (!isJDAnalysisCachePayload(parsed)) {
            localStorage.removeItem(buildCacheKey(resumeId));
            return null;
        }
        return parsed;
    } catch {
        localStorage.removeItem(buildCacheKey(resumeId));
        return null;
    }
};

export const saveJDAnalysisCache = (resumeId: string, payload: JDAnalysisCachePayload) => {
    if (!resumeId) {
        return;
    }
    localStorage.setItem(buildCacheKey(resumeId), JSON.stringify(payload));
};

export const clearJDAnalysisCache = (resumeId: string) => {
    if (!resumeId) {
        return;
    }
    localStorage.removeItem(buildCacheKey(resumeId));
};
