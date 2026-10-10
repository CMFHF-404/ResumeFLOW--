import apiClient, {
    assertAuthCacheKey,
    AuthContextChangedError,
    captureAuthCacheKey,
    type AuthOwnerOptions,
} from './apiClient';
import { prepareAvatarOriginalForSave } from './avatarImage';
import { bumpResumePreviewDataRevision } from './resumePreviewDataRevision';
import type { Profile, ProfileUpdate } from '../types/profile';

export type { Profile, ProfileLink, ProfileUpdate } from '../types/profile';

// 缓存 + in-flight 去重，避免视图频繁挂载导致 /profile 请求风暴
let cachedProfile: Profile | null = null;
let inFlightProfileRequest: Promise<Profile> | null = null;
let cacheRevision = 0;
let profileCacheOwnerKey: string | null = null;
async function requestProfile(expectedAuthCacheKey?: string): Promise<Profile> {
    const response = await apiClient.get<Profile>('/profile', expectedAuthCacheKey
        ? { expectedAuthCacheKey }
        : undefined);
    return response.data;
}

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

    async peekProfileForCurrentUser(options?: AuthOwnerOptions) {
        const cacheOwnerKey = await captureAuthCacheKey(options?.expectedAuthCacheKey);
        if (profileCacheOwnerKey !== cacheOwnerKey) {
            clearProfileCache();
            profileCacheOwnerKey = cacheOwnerKey;
        }
        return cachedProfile;
    },

    async getProfile(options?: { force?: boolean; expectedAuthCacheKey?: string }) {
        const cacheOwnerKey = await captureAuthCacheKey(options?.expectedAuthCacheKey);
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
        const requestPromise = requestProfile(cacheOwnerKey);
        const guardedPromise = (async () => {
            const data = await requestPromise;
            await assertAuthCacheKey(cacheOwnerKey);
            if (
                profileCacheOwnerKey !== cacheOwnerKey
            ) {
                throw new AuthContextChangedError(
                    'Authentication context changed while loading profile'
                );
            }
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

    async updateProfile(
        data: ProfileUpdate,
        options?: { expectedAuthCacheKey?: string },
    ) {
        const expectedOwnerKey = await captureAuthCacheKey(options?.expectedAuthCacheKey);
        const ownerKeyAtStart = profileCacheOwnerKey;
        cacheRevision += 1;
        const originalSource = data.extra_json?.avatar_original_data_url;
        const preparedData = typeof originalSource === 'string'
            ? {
                ...data,
                extra_json: {
                    ...data.extra_json,
                    avatar_original_data_url: await prepareAvatarOriginalForSave(originalSource),
                },
            }
            : data;
        await assertAuthCacheKey(expectedOwnerKey);
        const activeOwnerKey = expectedOwnerKey;
        if (
            ownerKeyAtStart && ownerKeyAtStart !== activeOwnerKey
        ) {
            throw new AuthContextChangedError(
                'Authentication context changed before profile update'
            );
        }
        if (profileCacheOwnerKey !== activeOwnerKey) {
            clearProfileCache();
            profileCacheOwnerKey = activeOwnerKey;
        }
        const response = await apiClient.patch<Profile>('/profile', preparedData, {
            expectedAuthCacheKey: expectedOwnerKey,
        });
        await assertAuthCacheKey(expectedOwnerKey);
        if (profileCacheOwnerKey === activeOwnerKey) {
            cachedProfile = response.data;
            bumpResumePreviewDataRevision();
        }
        return response.data;
    },

    clearProfileCache() {
        clearProfileCache();
    },
};
