import apiClient, { getAuthCacheKey } from './apiClient';
import { bumpResumePreviewDataRevision } from './resumePreviewDataRevision';

export interface Profile {
    user_id: string;
    full_name?: string;
    title?: string;
    summary?: string;
    location?: string;
    phone?: string;
    email?: string;
    social_links?: Record<string, any>;
    links?: ProfileLink[];
    extra_json?: Record<string, any>;
    updated_at: string;
}

export interface ProfileLink {
    label: string;
    url: string;
    position?: number;
}

export interface ProfileUpdate {
    full_name?: string;
    title?: string;
    summary?: string;
    location?: string;
    phone?: string;
    email?: string;
    social_links?: Record<string, any>;
    extra_json?: Record<string, any>;
    links?: ProfileLink[];
}

// 缓存 + in-flight 去重，避免视图频繁挂载导致 /profile 请求风暴
let cachedProfile: Profile | null = null;
let inFlightProfileRequest: Promise<Profile> | null = null;
let cacheRevision = 0;
let profileCacheOwnerKey: string | null = null;

const requestProfile = async (): Promise<Profile> => {
    const response = await apiClient.get<Profile>('/profile');
    return response.data;
};

const clearProfileCache = () => {
    cacheRevision += 1;
    cachedProfile = null;
    inFlightProfileRequest = null;
    profileCacheOwnerKey = null;
};

export const profileService = {
    peekProfile() {
        return cachedProfile;
    },

    async peekProfileForCurrentUser() {
        const cacheOwnerKey = await getAuthCacheKey();
        if (profileCacheOwnerKey !== cacheOwnerKey) {
            clearProfileCache();
            profileCacheOwnerKey = cacheOwnerKey;
        }
        return cachedProfile;
    },

    async getProfile(options?: { force?: boolean }) {
        const cacheOwnerKey = await getAuthCacheKey();
        if (profileCacheOwnerKey !== cacheOwnerKey) {
            clearProfileCache();
            profileCacheOwnerKey = cacheOwnerKey;
        }
        const shouldUseCache = !options?.force;
        if (shouldUseCache && cachedProfile) {
            return cachedProfile;
        }
        if (inFlightProfileRequest) {
            return inFlightProfileRequest;
        }
        const requestRevision = cacheRevision;
        const requestPromise = requestProfile();
        const guardedPromise = (async () => {
            const data = await requestPromise;
            if (cacheRevision === requestRevision) {
                cachedProfile = data;
                return data;
            }
            return cachedProfile ?? data;
        })();
        inFlightProfileRequest = guardedPromise;
        try {
            return await guardedPromise;
        } finally {
            if (inFlightProfileRequest === guardedPromise) {
                inFlightProfileRequest = null;
            }
        }
    },

    async updateProfile(data: ProfileUpdate) {
        const response = await apiClient.patch<Profile>('/profile', data);
        cacheRevision += 1;
        cachedProfile = response.data;
        bumpResumePreviewDataRevision();
        return response.data;
    },

    clearProfileCache() {
        clearProfileCache();
    },
};
