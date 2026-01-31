import apiClient, { getAuthCacheKey } from './apiClient';

export interface Certification {
    id: string;
    user_id: string;
    name: string;
    issuer?: string;
    issue_date?: string;
    expiry_date?: string;
    credential_id?: string;
    credential_url?: string;
    description?: string;
    created_at: string;
    updated_at: string;
}

export interface CertificationCreatePayload {
    name: string;
    issuer?: string;
    issue_date?: string;
    expiry_date?: string;
    credential_id?: string;
    credential_url?: string;
    description?: string;
}

export interface CertificationUpdatePayload {
    name?: string;
    issuer?: string;
    issue_date?: string;
    expiry_date?: string;
    credential_id?: string;
    credential_url?: string;
    description?: string;
}

const CERTIFICATIONS_CACHE_TTL_MS = 10_000;

let cachedCertifications: Certification[] | null = null;
let cachedCertificationsAt = 0;
let inFlightCertificationsRequest: Promise<Certification[]> | null = null;
let certificationsCacheRevision = 0;
let certificationsCacheOwnerKey: string | null = null;

const isCertificationsCacheFresh = (now: number) => {
    return !!cachedCertifications && now - cachedCertificationsAt < CERTIFICATIONS_CACHE_TTL_MS;
};

const requestCertifications = async (): Promise<Certification[]> => {
    const response = await apiClient.get<Certification[]>('/certifications');
    return response.data;
};

const clearCertificationsCache = () => {
    certificationsCacheRevision += 1;
    cachedCertifications = null;
    cachedCertificationsAt = 0;
    inFlightCertificationsRequest = null;
};

export const certificationsService = {
    async list(options?: { force?: boolean }) {
        const cacheOwnerKey = await getAuthCacheKey();
        if (certificationsCacheOwnerKey !== cacheOwnerKey) {
            clearCertificationsCache();
            certificationsCacheOwnerKey = cacheOwnerKey;
        }
        const shouldUseCache = !options?.force;
        const now = Date.now();
        if (shouldUseCache && isCertificationsCacheFresh(now) && cachedCertifications) {
            return cachedCertifications;
        }
        if (inFlightCertificationsRequest) {
            return inFlightCertificationsRequest;
        }
        const requestRevision = certificationsCacheRevision;
        const requestPromise = requestCertifications();
        const guardedPromise = (async () => {
            const data = await requestPromise;
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

    async create(data: CertificationCreatePayload) {
        const response = await apiClient.post<Certification>('/certifications', data);
        clearCertificationsCache();
        return response.data;
    },

    async get(id: string) {
        const response = await apiClient.get<Certification>(`/certifications/${id}`);
        return response.data;
    },

    async update(id: string, data: CertificationUpdatePayload) {
        const response = await apiClient.patch<Certification>(`/certifications/${id}`, data);
        clearCertificationsCache();
        return response.data;
    },

    async delete(id: string) {
        await apiClient.delete(`/certifications/${id}`);
        clearCertificationsCache();
    },
};
