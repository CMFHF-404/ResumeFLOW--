import axios from 'axios';
import apiClient, {
    assertAuthCacheKey,
    AuthContextChangedError,
    captureAuthCacheKey,
    isAuthContextChangedError,
    type AuthOwnerOptions,
} from './apiClient';
import { normalizeAvatarImageToSquare } from './avatarImage';
import { bumpResumePreviewDataRevision } from './resumePreviewDataRevision';
import type { Profile, ProfileUpdate } from '../types/profile';

export type { Profile, ProfileLink, ProfileUpdate } from '../types/profile';

// 缓存 + in-flight 去重，避免视图频繁挂载导致 /profile 请求风暴
let cachedProfile: Profile | null = null;
let inFlightProfileRequest: Promise<Profile> | null = null;
let cacheRevision = 0;
let profileCacheOwnerKey: string | null = null;
let inFlightAvatarNormalization: Promise<Profile> | null = null;
let inFlightAvatarSource: string | null = null;

const readProfileAvatarSource = (profile: Profile): string => (
    typeof profile.extra_json?.avatar_data_url === 'string'
        ? profile.extra_json.avatar_data_url.trim()
        : ''
);

const isProfileUpdateConflict = (error: unknown): boolean => (
    axios.isAxiosError(error) && error.response?.status === 409
);

async function requestProfile(expectedAuthCacheKey?: string): Promise<Profile> {
    const response = await apiClient.get<Profile>('/profile', expectedAuthCacheKey
        ? { expectedAuthCacheKey }
        : undefined);
    return response.data;
}

const normalizeAndPersistProfileAvatar = async (profile: Profile): Promise<Profile> => {
    const avatarSource = readProfileAvatarSource(profile);
    if (!avatarSource) {
        return profile;
    }
    if (inFlightAvatarNormalization && inFlightAvatarSource === avatarSource) {
        return inFlightAvatarNormalization;
    }

    const ownerKeyAtStart = profileCacheOwnerKey;
    const cacheRevisionAtStart = cacheRevision;
    const normalizationPromise = (async () => {
        let candidateProfile = profile;
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const candidateAvatarSource = readProfileAvatarSource(candidateProfile);
            if (!candidateAvatarSource) {
                return candidateProfile;
            }
            try {
                const normalizedAvatar = await normalizeAvatarImageToSquare(candidateAvatarSource);
                if (normalizedAvatar === candidateAvatarSource) {
                    return candidateProfile;
                }
                if (
                    !ownerKeyAtStart
                    || profileCacheOwnerKey !== ownerKeyAtStart
                    || cacheRevision !== cacheRevisionAtStart
                ) {
                    return cachedProfile ?? candidateProfile;
                }
                const response = await apiClient.patch<Profile>('/profile', {
                    extra_json: {
                        ...(candidateProfile.extra_json ?? {}),
                        avatar_data_url: normalizedAvatar,
                    },
                    expected_updated_at: candidateProfile.updated_at,
                }, {
                    expectedAuthCacheKey: ownerKeyAtStart,
                });
                if (
                    profileCacheOwnerKey === ownerKeyAtStart
                    && cacheRevision === cacheRevisionAtStart
                ) {
                    cacheRevision += 1;
                    cachedProfile = response.data;
                    bumpResumePreviewDataRevision();
                }
                return response.data;
            } catch (error) {
                if (isAuthContextChangedError(error)) {
                    throw error;
                }
                if (attempt !== 0 || !ownerKeyAtStart || !isProfileUpdateConflict(error)) {
                    return candidateProfile;
                }
                try {
                    const latestProfile = await requestProfile(ownerKeyAtStart);
                    if (
                        profileCacheOwnerKey !== ownerKeyAtStart
                        || cacheRevision !== cacheRevisionAtStart
                    ) {
                        return cachedProfile ?? latestProfile;
                    }
                    cachedProfile = latestProfile;
                    candidateProfile = latestProfile;
                } catch (latestProfileError) {
                    if (isAuthContextChangedError(latestProfileError)) {
                        throw latestProfileError;
                    }
                    return cachedProfile ?? candidateProfile;
                }
            }
        }
        return candidateProfile;
    })();

    inFlightAvatarNormalization = normalizationPromise;
    inFlightAvatarSource = avatarSource;
    try {
        return await normalizationPromise;
    } finally {
        if (inFlightAvatarNormalization === normalizationPromise) {
            inFlightAvatarNormalization = null;
            inFlightAvatarSource = null;
        }
    }
};

const clearProfileCache = () => {
    cacheRevision += 1;
    cachedProfile = null;
    inFlightProfileRequest = null;
    inFlightAvatarNormalization = null;
    inFlightAvatarSource = null;
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
            return normalizeAndPersistProfileAvatar(cachedProfile);
        }
        if (inFlightProfileRequest) {
            return normalizeAndPersistProfileAvatar(await inFlightProfileRequest);
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
            return await normalizeAndPersistProfileAvatar(await guardedPromise);
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
        const pendingAvatarNormalization = inFlightAvatarNormalization;
        cacheRevision += 1;
        if (pendingAvatarNormalization) {
            await pendingAvatarNormalization;
        }
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
        const response = await apiClient.patch<Profile>('/profile', data, {
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
