import type { JDAnalysisResult } from '../services/aiService';

const JD_ANALYSIS_CACHE_PREFIX = 'yuanzijianli.jdAnalysisCache';

export type JDAnalysisItemSignatures = {
    experiences: Record<string, string>;
    certifications: Record<string, string>;
    skills: Record<string, string>;
};

/** JD 输入方式：text = 手动粘贴文本，attachment = 上传附件 */
export type JDInputMode = 'text' | 'attachment';

export type JDAnalysisCachePayload = {
    jdText: string;
    jdInputSignature?: string;
    experienceSignature: string;
    result: JDAnalysisResult;
    itemSignatures?: JDAnalysisItemSignatures;
    experienceText?: string;
    /** 本次分析的输入方式 */
    inputMode?: JDInputMode;
    /** 附件模式下的文件名，用于 UI 展示 */
    attachmentName?: string;
    /** 附件成功转成文本后保留的原始提取正文 */
    attachmentExtractedText?: string;
};

const buildCacheKey = (resumeId: string) => `${JD_ANALYSIS_CACHE_PREFIX}:${resumeId}`;

const isStringRecord = (value: unknown): value is Record<string, string> => {
    if (!value || typeof value !== 'object') {
        return false;
    }
    return Object.values(value as Record<string, unknown>).every((entry) => typeof entry === 'string');
};

const isJDAnalysisItemSignatures = (value: unknown): value is JDAnalysisItemSignatures => {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const record = value as JDAnalysisItemSignatures;
    return isStringRecord(record.experiences)
        && isStringRecord(record.certifications)
        && isStringRecord(record.skills);
};

const isJDAnalysisCachePayload = (value: unknown): value is JDAnalysisCachePayload => {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const record = value as JDAnalysisCachePayload;
    return typeof record.jdText === 'string'
        && (record.jdInputSignature === undefined || typeof record.jdInputSignature === 'string')
        && typeof record.experienceSignature === 'string'
        && Boolean(record.result)
        && (!record.itemSignatures || isJDAnalysisItemSignatures(record.itemSignatures))
        && (record.experienceText === undefined || typeof record.experienceText === 'string')
        && (record.inputMode === undefined || record.inputMode === 'text' || record.inputMode === 'attachment')
        && (record.attachmentName === undefined || typeof record.attachmentName === 'string')
        && (record.attachmentExtractedText === undefined || typeof record.attachmentExtractedText === 'string');
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
