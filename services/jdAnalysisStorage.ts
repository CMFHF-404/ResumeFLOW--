import type { ResumeJDAnalysis } from '../types/resume';
import {
    normalizeJDAnalysisResult,
    type RawJDAnalysisResult,
} from './aiNormalizeUtils';
import { canonicalStringify } from '../utils/canonicalStringify';

const JD_ANALYSIS_CACHE_PREFIX = 'yuanzijianli.jdAnalysisCache';

export type JDAnalysisCacheRecord = {
    payload: ResumeJDAnalysis;
    pendingSync: boolean;
    basePersistedFingerprint: string | null;
};

export type PreferredPersistedJDAnalysis =
    | {
        kind: 'keep_pending_local' | 'adopt_backend' | 'in_sync';
        payload: ResumeJDAnalysis;
        shouldKeepLocalPendingSync: boolean;
        basePersistedFingerprint: string | null;
    }
    | {
        kind: 'adopt_backend_null' | 'in_sync_empty';
        payload: null;
        shouldKeepLocalPendingSync: false;
        basePersistedFingerprint: string;
    };

type LegacyJDAnalysisRecord = Partial<ResumeJDAnalysis> & {
    jdText?: unknown;
    jdInputSignature?: unknown;
    experienceSignature?: unknown;
    analysisSignatureVersion?: unknown;
    evaluationSignature?: unknown;
    evaluationSignatureVersion?: unknown;
    targetRoleSignature?: unknown;
    result?: unknown;
    itemSignatures?: unknown;
    experienceText?: unknown;
    inputMode?: unknown;
    attachmentName?: unknown;
    attachmentExtractedText?: unknown;
    isOutdated?: unknown;
    evaluationIsOutdated?: unknown;
    updatedAt?: unknown;
};

type RawJDAnalysisCacheRecord = {
    payload?: unknown;
    pendingSync?: unknown;
    basePersistedFingerprint?: unknown;
};

const isAuthenticatedOwnerKey = (ownerKey: string | null | undefined): ownerKey is string => (
    typeof ownerKey === 'string'
    && ownerKey.trim().length > 0
    && ownerKey !== 'anonymous'
);

const buildLegacyCacheKey = (resumeId: string) => `${JD_ANALYSIS_CACHE_PREFIX}:${resumeId}`;

export const buildJDAnalysisCacheKey = (ownerKey: string, resumeId: string) => (
    `${JD_ANALYSIS_CACHE_PREFIX}:${encodeURIComponent(ownerKey)}:${encodeURIComponent(resumeId)}`
);

const removeLegacyJDAnalysisCache = (resumeId: string) => {
    if (typeof localStorage === 'undefined' || !resumeId) {
        return;
    }
    localStorage.removeItem(buildLegacyCacheKey(resumeId));
};

export const clearLegacyJDAnalysisCaches = () => {
    if (typeof localStorage === 'undefined') {
        return;
    }
    const legacyPrefix = `${JD_ANALYSIS_CACHE_PREFIX}:`;
    const legacyKeys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key?.startsWith(legacyPrefix) && !key.slice(legacyPrefix.length).includes(':')) {
            legacyKeys.push(key);
        }
    }
    legacyKeys.forEach((key) => localStorage.removeItem(key));
};

export const clearJDAnalysisCachesForOwner = (ownerKey: string | null | undefined) => {
    if (typeof localStorage === 'undefined' || !isAuthenticatedOwnerKey(ownerKey)) {
        return;
    }
    const ownerPrefix = `${JD_ANALYSIS_CACHE_PREFIX}:${encodeURIComponent(ownerKey)}:`;
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key?.startsWith(ownerPrefix)) {
            keys.push(key);
        }
    }
    keys.forEach((key) => localStorage.removeItem(key));
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
        analysisSignatureVersion:
            record.analysisSignatureVersion === 'agent_final_snapshot_v1'
                ? record.analysisSignatureVersion
                : undefined,
        evaluationSignature:
            typeof record.evaluationSignature === 'string'
                ? record.evaluationSignature
                : undefined,
        evaluationSignatureVersion:
            record.evaluationSignatureVersion === 'agent_final_snapshot_v1'
                ? record.evaluationSignatureVersion
                : undefined,
        targetRoleSignature:
            typeof record.targetRoleSignature === 'string'
                ? record.targetRoleSignature
                : undefined,
        result: normalizeJDAnalysisResult(record.result as RawJDAnalysisResult),
        itemSignatures,
        experienceText: typeof record.experienceText === 'string' ? record.experienceText : undefined,
        inputMode: record.inputMode === 'attachment' ? 'attachment' : 'text',
        attachmentName: typeof record.attachmentName === 'string' ? record.attachmentName : undefined,
        attachmentExtractedText:
            typeof record.attachmentExtractedText === 'string'
                ? record.attachmentExtractedText
                : undefined,
        isOutdated: typeof record.isOutdated === 'boolean' ? record.isOutdated : undefined,
        evaluationIsOutdated:
            typeof record.evaluationIsOutdated === 'boolean'
                ? record.evaluationIsOutdated
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
): PreferredPersistedJDAnalysis => {
    const backendFingerprint = buildJDAnalysisPersistenceFingerprint(backend);

    if (backend) {
        if (
            local?.pendingSync
            && local.basePersistedFingerprint === backendFingerprint
            && !arePersistedJDAnalysisEqual(backend, local.payload)
        ) {
            return {
                kind: 'keep_pending_local',
                payload: local.payload,
                shouldKeepLocalPendingSync: true,
                basePersistedFingerprint: local.basePersistedFingerprint,
            };
        }
        return {
            kind: local && arePersistedJDAnalysisEqual(backend, local.payload)
                ? 'in_sync'
                : 'adopt_backend',
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
            kind: 'keep_pending_local',
            payload: local.payload,
            shouldKeepLocalPendingSync: true,
            basePersistedFingerprint: local.basePersistedFingerprint,
        };
    }
    return {
        kind: local ? 'adopt_backend_null' : 'in_sync_empty',
        payload: null,
        shouldKeepLocalPendingSync: false,
        basePersistedFingerprint: backendFingerprint,
    };
};

export const resolveLocalJDAnalysisWriteBase = (
    backend: ResumeJDAnalysis | null,
    local: JDAnalysisCacheRecord | null,
    currentPersisted: ResumeJDAnalysis | null | undefined
): string | null | undefined => {
    const decision = selectPreferredPersistedJDAnalysis(backend, local);
    if (decision.kind === 'keep_pending_local') {
        return currentPersisted
            && arePersistedJDAnalysisEqual(currentPersisted, decision.payload)
            ? decision.basePersistedFingerprint
            : undefined;
    }
    return arePersistedJDAnalysisEqual(currentPersisted ?? null, backend)
        ? decision.basePersistedFingerprint
        : undefined;
};

export const loadJDAnalysisCache = (
    ownerKey: string | null | undefined,
    resumeId: string
): JDAnalysisCacheRecord | null => {
    if (!resumeId || !isAuthenticatedOwnerKey(ownerKey) || typeof localStorage === 'undefined') {
        removeLegacyJDAnalysisCache(resumeId);
        return null;
    }
    removeLegacyJDAnalysisCache(resumeId);
    const cacheKey = buildJDAnalysisCacheKey(ownerKey, resumeId);
    const raw = localStorage.getItem(cacheKey);
    if (!raw) {
        return null;
    }
    try {
        const parsed = normalizeJDAnalysisCacheRecord(JSON.parse(raw));
        if (!parsed) {
            localStorage.removeItem(cacheKey);
            return null;
        }
        return parsed;
    } catch {
        localStorage.removeItem(cacheKey);
        return null;
    }
};

export const saveJDAnalysisCache = (
    ownerKey: string | null | undefined,
    resumeId: string,
    payload: ResumeJDAnalysis,
    options?: {
        pendingSync?: boolean;
        basePersistedFingerprint?: string | null;
    }
) => {
    if (!resumeId || !isAuthenticatedOwnerKey(ownerKey) || typeof localStorage === 'undefined') {
        removeLegacyJDAnalysisCache(resumeId);
        return;
    }
    removeLegacyJDAnalysisCache(resumeId);
    const record: JDAnalysisCacheRecord = {
        payload,
        pendingSync: options?.pendingSync === true,
        basePersistedFingerprint: options?.basePersistedFingerprint ?? null,
    };
    localStorage.setItem(buildJDAnalysisCacheKey(ownerKey, resumeId), JSON.stringify(record));
};

export const clearJDAnalysisCache = (ownerKey: string | null | undefined, resumeId: string) => {
    if (!resumeId || typeof localStorage === 'undefined') {
        return;
    }
    removeLegacyJDAnalysisCache(resumeId);
    if (!isAuthenticatedOwnerKey(ownerKey)) {
        return;
    }
    localStorage.removeItem(buildJDAnalysisCacheKey(ownerKey, resumeId));
};
