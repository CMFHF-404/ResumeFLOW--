import apiClient, {
    assertAuthCacheKey,
    captureAuthCacheKey,
    type AuthOwnerOptions,
} from './apiClient';
import { bumpResumePreviewDataRevision } from './resumePreviewDataRevision';
import { createOwnerScopedListCache } from './ownerScopedListCache';
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

const requestCertifications = async (expectedAuthCacheKey: string): Promise<Certification[]> => {
    const response = await apiClient.get<Certification[]>('/certifications', {
        expectedAuthCacheKey,
    });
    return response.data;
};

const certificationsCache = createOwnerScopedListCache(
    requestCertifications,
    CERTIFICATIONS_CACHE_TTL_MS,
);

export const certificationsService = {
    peekList: certificationsCache.peekList,
    peekListForCurrentUser: certificationsCache.peekListForCurrentUser,
    list: certificationsCache.list,

    async create(data: CertificationCreatePayload, options?: AuthOwnerOptions) {
        const requestOwnerKey = await captureAuthCacheKey(options?.expectedAuthCacheKey);
        const response = await apiClient.post<Certification>('/certifications', data, {
            expectedAuthCacheKey: requestOwnerKey,
        });
        await assertAuthCacheKey(requestOwnerKey);
        certificationsCache.clear();
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
        certificationsCache.clear();
        bumpResumePreviewDataRevision();
        return response.data;
    },

    async delete(id: string, options?: AuthOwnerOptions) {
        const requestOwnerKey = await captureAuthCacheKey(options?.expectedAuthCacheKey);
        await apiClient.delete(`/certifications/${id}`, {
            expectedAuthCacheKey: requestOwnerKey,
        });
        await assertAuthCacheKey(requestOwnerKey);
        certificationsCache.clear();
        bumpResumePreviewDataRevision();
    },
};
