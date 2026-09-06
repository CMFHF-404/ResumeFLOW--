import type { ResumeJDAnalysis } from '../types/resume';
import {
    normalizeJDAnalysisResult,
    type RawJDAnalysisResult,
} from './aiNormalizeUtils';
import { canonicalStringify } from '../utils/canonicalStringify';
import { isAuthenticatedOwnerKey } from '../utils/authOwner';

const JD_ANALYSIS_CACHE_PREFIX = 'yuanzijianli.jdAnalysisCache';
export const JD_ANALYSIS_CACHE_SCHEMA_VERSION = 2 as const;
const JD_ANALYSIS_FINGERPRINT_PREFIX = 'jd-analysis-normalized-v2:';

export type JDAnalysisCacheRecord = {
    schemaVersion: typeof JD_ANALYSIS_CACHE_SCHEMA_VERSION;
    basePersistedFingerprintVersion: 1 | typeof JD_ANALYSIS_CACHE_SCHEMA_VERSION;
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
    }
    | {
        kind: 'pending_conflict';
        payload: ResumeJDAnalysis | null;
        pendingPayload: ResumeJDAnalysis;
        shouldKeepLocalPendingSync: false;
        basePersistedFingerprint: string | null;
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
    schemaVersion?: unknown;
    basePersistedFingerprintVersion?: unknown;
    payload?: unknown;
    pendingSync?: unknown;
    basePersistedFingerprint?: unknown;
};

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
) => `${JD_ANALYSIS_FINGERPRINT_PREFIX}${payload ? canonicalStringify(payload) : '__null__'}`;

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
    // Records written before input provenance existed are text-mode records.
    // A present but unknown value is corrupt provenance, and must not be
    // silently upgraded to a complete text JD.
    const hasInputMode = Object.hasOwn(record, 'inputMode');
    if (hasInputMode && record.inputMode !== 'text' && record.inputMode !== 'attachment') {
        return null;
    }

    const itemSignatures = isJDAnalysisItemSignatures(record.itemSignatures)
        ? record.itemSignatures
        : {
            experiences: {},
            certifications: {},
            skills: {},
        };
    const normalizedResult = normalizeJDAnalysisResult(record.result as RawJDAnalysisResult);
    const rawResult = record.result && typeof record.result === 'object'
        ? record.result as unknown as Record<string, unknown>
        : null;
    const discardedEvaluation = Boolean(
        rawResult
        && ('resumeEvaluation' in rawResult || 'resume_evaluation' in rawResult)
        && !normalizedResult.resumeEvaluation
    );

    return {
        jdText: record.jdText,
        jdInputSignature: typeof record.jdInputSignature === 'string' ? record.jdInputSignature : '',
        experienceSignature: record.experienceSignature,
        analysisSignatureVersion:
            record.analysisSignatureVersion === 'agent_final_snapshot_v1'
                ? record.analysisSignatureVersion
                : undefined,
        evaluationSignature:
            !discardedEvaluation && typeof record.evaluationSignature === 'string'
                ? record.evaluationSignature
                : undefined,
        evaluationSignatureVersion:
            !discardedEvaluation && record.evaluationSignatureVersion === 'agent_final_snapshot_v1'
                ? record.evaluationSignatureVersion
                : undefined,
        targetRoleSignature:
            typeof record.targetRoleSignature === 'string'
                ? record.targetRoleSignature
                : undefined,
        result: normalizedResult,
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
            discardedEvaluation
                ? true
                : typeof record.evaluationIsOutdated === 'boolean'
                ? record.evaluationIsOutdated
                : undefined,
        updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : '',
    };
};

type BaseFingerprintResolution =
    | { status: 'current' | 'migrated'; fingerprint: string }
    | { status: 'unverifiable'; fingerprint: string | null };

/**
 * Legacy fingerprints embedded the full normalized base payload without a
 * schema marker. Re-normalize that embedded payload before comparing it with
 * today's backend snapshot so a normalizer upgrade cannot discard pending
 * local work merely because derived evaluation fields were repaired.
 */
const resolveBasePersistedFingerprint = (
    value: string | null
): BaseFingerprintResolution => {
    if (typeof value === 'string' && value.startsWith(JD_ANALYSIS_FINGERPRINT_PREFIX)) {
        return { status: 'current', fingerprint: value };
    }
    if (value === '__null__') {
        return {
            status: 'migrated',
            fingerprint: buildJDAnalysisPersistenceFingerprint(null),
        };
    }
    if (typeof value !== 'string' || !value) {
        return { status: 'unverifiable', fingerprint: value };
    }
    try {
        const legacyBase = normalizeJDAnalysisPersistence(JSON.parse(value));
        if (!legacyBase) {
            return { status: 'unverifiable', fingerprint: value };
        }
        return {
            status: 'migrated',
            fingerprint: buildJDAnalysisPersistenceFingerprint(legacyBase),
        };
    } catch {
        return { status: 'unverifiable', fingerprint: value };
    }
};

const normalizeJDAnalysisCacheRecord = (value: unknown): JDAnalysisCacheRecord | null => {
    const normalizedPayload = normalizeJDAnalysisPersistence(value);
    if (normalizedPayload) {
        return {
            schemaVersion: JD_ANALYSIS_CACHE_SCHEMA_VERSION,
            basePersistedFingerprintVersion: JD_ANALYSIS_CACHE_SCHEMA_VERSION,
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
    const rawBasePersistedFingerprint =
        typeof record.basePersistedFingerprint === 'string'
            ? record.basePersistedFingerprint
            : null;
    const baseResolution = record.pendingSync === true
        ? resolveBasePersistedFingerprint(rawBasePersistedFingerprint)
        : null;
    return {
        schemaVersion: JD_ANALYSIS_CACHE_SCHEMA_VERSION,
        basePersistedFingerprintVersion:
            baseResolution && baseResolution.status !== 'unverifiable'
                ? JD_ANALYSIS_CACHE_SCHEMA_VERSION
                : record.basePersistedFingerprintVersion === JD_ANALYSIS_CACHE_SCHEMA_VERSION
                    ? JD_ANALYSIS_CACHE_SCHEMA_VERSION
                    : 1,
        payload,
        pendingSync: record.pendingSync === true,
        basePersistedFingerprint:
            baseResolution && baseResolution.status !== 'unverifiable'
                ? baseResolution.fingerprint
                : rawBasePersistedFingerprint,
    };
};

export const selectPreferredPersistedJDAnalysis = (
    backend: ResumeJDAnalysis | null,
    local: JDAnalysisCacheRecord | null
): PreferredPersistedJDAnalysis => {
    const backendFingerprint = buildJDAnalysisPersistenceFingerprint(backend);
    const localBase = local?.pendingSync
        ? resolveBasePersistedFingerprint(local.basePersistedFingerprint)
        : null;

    if (local?.pendingSync) {
        const localPayloadMatchesBackend = arePersistedJDAnalysisEqual(
            backend,
            local.payload
        );
        if (localPayloadMatchesBackend && backend) {
            return {
                kind: 'in_sync',
                payload: backend,
                shouldKeepLocalPendingSync: false,
                basePersistedFingerprint: backendFingerprint,
            };
        }
        if (
            localBase?.status === 'unverifiable'
            || localBase?.fingerprint !== backendFingerprint
        ) {
            return {
                kind: 'pending_conflict',
                payload: backend,
                pendingPayload: local.payload,
                shouldKeepLocalPendingSync: false,
                basePersistedFingerprint:
                    localBase?.status === 'unverifiable'
                        ? local.basePersistedFingerprint
                        : localBase?.fingerprint ?? local.basePersistedFingerprint,
            };
        }
    }

    if (backend) {
        if (
            local?.pendingSync
            && localBase?.fingerprint === backendFingerprint
            && !arePersistedJDAnalysisEqual(backend, local.payload)
        ) {
            return {
                kind: 'keep_pending_local',
                payload: local.payload,
                shouldKeepLocalPendingSync: true,
                basePersistedFingerprint: localBase.fingerprint,
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
        && localBase?.fingerprint === backendFingerprint
    ) {
        return {
            kind: 'keep_pending_local',
            payload: local.payload,
            shouldKeepLocalPendingSync: true,
            basePersistedFingerprint: localBase.fingerprint,
        };
    }
    return {
        kind: local ? 'adopt_backend_null' : 'in_sync_empty',
        payload: null,
        shouldKeepLocalPendingSync: false,
        basePersistedFingerprint: backendFingerprint,
    };
};

/**
 * Resolve the JD payload embedded in a whole-resume config save.
 *
 * A pending cache is the cross-render/cross-tab authority: a valid same-base
 * payload remains local, while a divergent payload resolves to the backend
 * side of `pending_conflict` until the user explicitly restores it.
 */
export const resolveJDAnalysisForConfigSnapshot = (
    backend: ResumeJDAnalysis | null,
    local: JDAnalysisCacheRecord | null
): ResumeJDAnalysis | null => {
    const decision = selectPreferredPersistedJDAnalysis(backend, local);
    return decision.payload;
};

export const graftJDAnalysisAuthority = <T extends { jdAnalysis?: ResumeJDAnalysis }>(
    draft: T,
    authority: ResumeJDAnalysis | null
): T => {
    const { jdAnalysis: _discardedJDAnalysis, ...ordinaryConfig } = draft;
    return (
        authority
            ? { ...ordinaryConfig, jdAnalysis: authority }
            : ordinaryConfig
    ) as T;
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
    if (decision.kind === 'pending_conflict') {
        return undefined;
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
        schemaVersion: JD_ANALYSIS_CACHE_SCHEMA_VERSION,
        basePersistedFingerprintVersion: JD_ANALYSIS_CACHE_SCHEMA_VERSION,
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
