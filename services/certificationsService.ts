import apiClient, {
    assertAuthCacheKey,
    captureAuthCacheKey,
    type AuthOwnerOptions,
} from './apiClient';
import { bumpResumePreviewDataRevision } from './resumePreviewDataRevision';
import type {
    Certification,
    CertificationCreatePayload,
    CertificationUpdatePayload,
} from '../types/certification';

export type {
    Certification,
    CertificationCreatePayload,
    CertificationUpdatePayload,
} from '../types/certification';

const CERTIFICATIONS_CACHE_TTL_MS = 10_000;

let cachedCertifications: Certification[] | null = null;
let cachedCertificationsAt = 0;
let inFlightCertificationsRequest: Promise<Certification[]> | null = null;
let certificationsCacheRevision = 0;
let certificationsCacheOwnerKey: string | null = null;

const isCertificationsCacheFresh = (now: number) => {
    return !!cachedCertifications && now - cachedCertificationsAt < CERTIFICATIONS_CACHE_TTL_MS;
};

const requestCertifications = async (expectedAuthCacheKey: string): Promise<Certification[]> => {
    const response = await apiClient.get<Certification[]>('/certifications', {
        expectedAuthCacheKey,
    });
    return response.data;
};

const getCachedCertifications = (options?: { allowStale?: boolean }) => {
    const now = Date.now();
    if (!cachedCertifications) {
        return null;
    }
    if (!options?.allowStale && !isCertificationsCacheFresh(now)) {
        return null;
    }
    return cachedCertifications;
};

const clearCertificationsCache = () => {
    certificationsCacheRevision += 1;
    cachedCertifications = null;
    cachedCertificationsAt = 0;
    inFlightCertificationsRequest = null;
};

const ensureCertificationsCacheOwner = async (expectedAuthCacheKey?: string) => {
    const cacheOwnerKey = await captureAuthCacheKey(expectedAuthCacheKey);
    if (certificationsCacheOwnerKey !== cacheOwnerKey) {
        clearCertificationsCache();
        certificationsCacheOwnerKey = cacheOwnerKey;
    }
    return cacheOwnerKey;
};

export const certificationsService = {
    peekList(options?: { allowStale?: boolean }) {
        return getCachedCertifications(options);
    },

    async peekListForCurrentUser(
        options?: { allowStale?: boolean; expectedAuthCacheKey?: string }
    ) {
        await ensureCertificationsCacheOwner(options?.expectedAuthCacheKey);
        return getCachedCertifications(options);
    },

    async list(options?: { force?: boolean; expectedAuthCacheKey?: string }) {
        const requestOwnerKey = await ensureCertificationsCacheOwner(
            options?.expectedAuthCacheKey
        );
        const shouldUseCache = !options?.force;
        const now = Date.now();
        if (shouldUseCache && isCertificationsCacheFresh(now) && cachedCertifications) {
            return cachedCertifications;
        }
        if (inFlightCertificationsRequest) {
            return inFlightCertificationsRequest;
        }
        const requestRevision = certificationsCacheRevision;
        const requestPromise = requestCertifications(requestOwnerKey);
        const guardedPromise = (async () => {
            const data = await requestPromise;
            await assertAuthCacheKey(requestOwnerKey);
            if (certificationsCacheRevision === requestRevision) {
                cachedCertifications = data;
                cachedCertificationsAt = Date.now();
                return data;
            }
            return cachedCertifications ?? data;
        })();
        inFlightCertificationsRequest = guardedPromise;
        try {
            return await guardedPromise;
        } finally {
            if (inFlightCertificationsRequest === guardedPromise) {
                inFlightCertificationsRequest = null;
            }
        }
    },

    async create(data: CertificationCreatePayload, options?: AuthOwnerOptions) {
        const requestOwnerKey = await captureAuthCacheKey(options?.expectedAuthCacheKey);
        const response = await apiClient.post<Certification>('/certifications', data, {
            expectedAuthCacheKey: requestOwnerKey,
        });
        await assertAuthCacheKey(requestOwnerKey);
        clearCertificationsCache();
        bumpResumePreviewDataRevision();
        return response.data;
    },

    async get(id: string, options?: AuthOwnerOptions) {
        const requestOwnerKey = await captureAuthCacheKey(options?.expectedAuthCacheKey);
        const response = await apiClient.get<Certification>(`/certifications/${id}`, {
            expectedAuthCacheKey: requestOwnerKey,
        });
        await assertAuthCacheKey(requestOwnerKey);
        return response.data;
    },

    async update(id: string, data: CertificationUpdatePayload, options?: AuthOwnerOptions) {
        const requestOwnerKey = await captureAuthCacheKey(options?.expectedAuthCacheKey);
        const response = await apiClient.patch<Certification>(`/certifications/${id}`, data, {
            expectedAuthCacheKey: requestOwnerKey,
        });
        await assertAuthCacheKey(requestOwnerKey);
        clearCertificationsCache();
        bumpResumePreviewDataRevision();
        return response.data;
    },

    async delete(id: string, options?: AuthOwnerOptions) {
        const requestOwnerKey = await captureAuthCacheKey(options?.expectedAuthCacheKey);
        await apiClient.delete(`/certifications/${id}`, {
            expectedAuthCacheKey: requestOwnerKey,
        });
        await assertAuthCacheKey(requestOwnerKey);
        clearCertificationsCache();
        bumpResumePreviewDataRevision();
    },
};
