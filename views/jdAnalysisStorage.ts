import type { ResumeJDAnalysis } from '../types/resume';

const JD_ANALYSIS_CACHE_PREFIX = 'yuanzijianli.jdAnalysisCache';

export type JDAnalysisCacheRecord = {
    payload: ResumeJDAnalysis;
    pendingSync: boolean;
    basePersistedFingerprint: string | null;
};

type LegacyJDAnalysisRecord = Partial<ResumeJDAnalysis> & {
    jdText?: unknown;
    jdInputSignature?: unknown;
    experienceSignature?: unknown;
    result?: unknown;
    itemSignatures?: unknown;
    experienceText?: unknown;
    inputMode?: unknown;
    attachmentName?: unknown;
    attachmentExtractedText?: unknown;
    updatedAt?: unknown;
};

type RawJDAnalysisCacheRecord = {
    payload?: unknown;
    pendingSync?: unknown;
    basePersistedFingerprint?: unknown;
};

const buildCacheKey = (resumeId: string) => `${JD_ANALYSIS_CACHE_PREFIX}:${resumeId}`;

const canonicalStringify = (obj: unknown): string => {
    const stringifyValue = (value: unknown): string | undefined => {
        if (value === undefined) {
            return undefined;
        }
        if (value === null || typeof value !== 'object') {
            return JSON.stringify(value);
        }
        if (Array.isArray(value)) {
            const items = value.map((item) => stringifyValue(item) ?? 'null');
            return `[${items.join(',')}]`;
        }
        const record = value as Record<string, unknown>;
        const keys = Object.keys(record).sort();
        const entries: string[] = [];
        keys.forEach((key) => {
            const serialized = stringifyValue(record[key]);
            if (serialized !== undefined) {
                entries.push(`${JSON.stringify(key)}:${serialized}`);
            }
        });
        return `{${entries.join(',')}}`;
    };

    return stringifyValue(obj) ?? 'null';
};

const arePersistedJDAnalysisEqual = (
    left: ResumeJDAnalysis | null,
    right: ResumeJDAnalysis | null
) => {
    if (!left || !right) {
        return left === right;
    }
    return canonicalStringify(left) === canonicalStringify(right);
};

export const buildJDAnalysisPersistenceFingerprint = (
    payload: ResumeJDAnalysis | null
) => (payload ? canonicalStringify(payload) : '__null__');

const isStringRecord = (value: unknown): value is Record<string, string> => {
    if (!value || typeof value !== 'object') {
        return false;
    }
    return Object.values(value as Record<string, unknown>).every((entry) => typeof entry === 'string');
};

const isJDAnalysisItemSignatures = (value: unknown): value is ResumeJDAnalysis['itemSignatures'] => {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const record = value as ResumeJDAnalysis['itemSignatures'];
    return isStringRecord(record.experiences)
        && isStringRecord(record.certifications)
        && isStringRecord(record.skills);
};

export const normalizeJDAnalysisPersistence = (value: unknown): ResumeJDAnalysis | null => {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const record = value as LegacyJDAnalysisRecord;
    if (
        typeof record.jdText !== 'string'
        || typeof record.experienceSignature !== 'string'
        || !record.result
    ) {
        return null;
    }

    const itemSignatures = isJDAnalysisItemSignatures(record.itemSignatures)
        ? record.itemSignatures
        : {
            experiences: {},
            certifications: {},
            skills: {},
        };

    return {
        jdText: record.jdText,
        jdInputSignature: typeof record.jdInputSignature === 'string' ? record.jdInputSignature : '',
        experienceSignature: record.experienceSignature,
        result: record.result as ResumeJDAnalysis['result'],
        itemSignatures,
        experienceText: typeof record.experienceText === 'string' ? record.experienceText : undefined,
        inputMode: record.inputMode === 'attachment' ? 'attachment' : 'text',
        attachmentName: typeof record.attachmentName === 'string' ? record.attachmentName : undefined,
        attachmentExtractedText:
            typeof record.attachmentExtractedText === 'string'
                ? record.attachmentExtractedText
                : undefined,
        updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : '',
    };
};

const normalizeJDAnalysisCacheRecord = (value: unknown): JDAnalysisCacheRecord | null => {
    const normalizedPayload = normalizeJDAnalysisPersistence(value);
    if (normalizedPayload) {
        return {
            payload: normalizedPayload,
            pendingSync: false,
            basePersistedFingerprint: null,
        };
    }
    if (!value || typeof value !== 'object') {
        return null;
    }
    const record = value as RawJDAnalysisCacheRecord;
    const payload = normalizeJDAnalysisPersistence(record.payload);
    if (!payload) {
        return null;
    }
    return {
        payload,
        pendingSync: record.pendingSync === true,
        basePersistedFingerprint:
            typeof record.basePersistedFingerprint === 'string'
                ? record.basePersistedFingerprint
                : null,
    };
};

export const selectPreferredPersistedJDAnalysis = (
    backend: ResumeJDAnalysis | null,
    local: JDAnalysisCacheRecord | null
) => {
    const backendFingerprint = buildJDAnalysisPersistenceFingerprint(backend);

    if (backend) {
        if (
            local?.pendingSync
            && local.basePersistedFingerprint === backendFingerprint
            && !arePersistedJDAnalysisEqual(backend, local.payload)
        ) {
            return {
                payload: local.payload,
                shouldKeepLocalPendingSync: true,
                basePersistedFingerprint: local.basePersistedFingerprint,
            };
        }
        return {
            payload: backend,
            shouldKeepLocalPendingSync: false,
            basePersistedFingerprint: backendFingerprint,
        };
    }
    if (
        local?.pendingSync
        && local.basePersistedFingerprint === backendFingerprint
    ) {
        return {
            payload: local.payload,
            shouldKeepLocalPendingSync: true,
            basePersistedFingerprint: local.basePersistedFingerprint,
        };
    }
    return null;
};

export const loadJDAnalysisCache = (resumeId: string): JDAnalysisCacheRecord | null => {
    if (!resumeId) {
        return null;
    }
    const raw = localStorage.getItem(buildCacheKey(resumeId));
    if (!raw) {
        return null;
    }
    try {
        const parsed = normalizeJDAnalysisCacheRecord(JSON.parse(raw));
        if (!parsed) {
            localStorage.removeItem(buildCacheKey(resumeId));
            return null;
        }
        return parsed;
    } catch {
        localStorage.removeItem(buildCacheKey(resumeId));
        return null;
    }
};

export const saveJDAnalysisCache = (
    resumeId: string,
    payload: ResumeJDAnalysis,
    options?: {
        pendingSync?: boolean;
        basePersistedFingerprint?: string | null;
    }
) => {
    if (!resumeId) {
        return;
    }
    const record: JDAnalysisCacheRecord = {
        payload,
        pendingSync: options?.pendingSync === true,
        basePersistedFingerprint: options?.basePersistedFingerprint ?? null,
    };
    localStorage.setItem(buildCacheKey(resumeId), JSON.stringify(record));
};

export const clearJDAnalysisCache = (resumeId: string) => {
    if (!resumeId) {
        return;
    }
    localStorage.removeItem(buildCacheKey(resumeId));
};
