import apiClient, {
    assertAuthCacheKey,
    captureAuthCacheKey,
    type AuthOwnerOptions,
} from './apiClient';
import { bumpResumePreviewDataRevision } from './resumePreviewDataRevision';
import type { SkillCreatePayload, SkillUpdatePayload, UserSkill } from '../types/skill';

export type { SkillCreatePayload, SkillUpdatePayload, UserSkill } from '../types/skill';

const SKILLS_CACHE_TTL_MS = 10_000;

let cachedSkills: UserSkill[] | null = null;
let cachedSkillsAt = 0;
let inFlightSkillsRequest: Promise<UserSkill[]> | null = null;
let skillsCacheRevision = 0;
let skillsCacheOwnerKey: string | null = null;

const isSkillsCacheFresh = (now: number) => {
    return !!cachedSkills && now - cachedSkillsAt < SKILLS_CACHE_TTL_MS;
};

const requestSkills = async (expectedAuthCacheKey: string): Promise<UserSkill[]> => {
    const response = await apiClient.get<UserSkill[]>('/skills', {
        expectedAuthCacheKey,
    });
    return response.data;
};

const getCachedSkills = (options?: { allowStale?: boolean }) => {
    const now = Date.now();
    if (!cachedSkills) {
        return null;
    }
    if (!options?.allowStale && !isSkillsCacheFresh(now)) {
        return null;
    }
    return cachedSkills;
};

const clearSkillsCache = () => {
    skillsCacheRevision += 1;
    cachedSkills = null;
    cachedSkillsAt = 0;
    inFlightSkillsRequest = null;
};

const ensureSkillsCacheOwner = async (expectedAuthCacheKey?: string) => {
    const cacheOwnerKey = await captureAuthCacheKey(expectedAuthCacheKey);
    if (skillsCacheOwnerKey !== cacheOwnerKey) {
        clearSkillsCache();
        skillsCacheOwnerKey = cacheOwnerKey;
    }
    return cacheOwnerKey;
};

export const skillsService = {
    peekList(options?: { allowStale?: boolean }) {
        return getCachedSkills(options);
    },

    async peekListForCurrentUser(
        options?: { allowStale?: boolean; expectedAuthCacheKey?: string }
    ) {
        await ensureSkillsCacheOwner(options?.expectedAuthCacheKey);
        return getCachedSkills(options);
    },

    async list(options?: { force?: boolean; expectedAuthCacheKey?: string }) {
        const requestOwnerKey = await ensureSkillsCacheOwner(options?.expectedAuthCacheKey);
        const shouldUseCache = !options?.force;
        const now = Date.now();
        if (shouldUseCache && isSkillsCacheFresh(now) && cachedSkills) {
            return cachedSkills;
        }
        if (inFlightSkillsRequest) {
            return inFlightSkillsRequest;
        }
        const requestRevision = skillsCacheRevision;
        const requestPromise = requestSkills(requestOwnerKey);
        const guardedPromise = (async () => {
            const data = await requestPromise;
            await assertAuthCacheKey(requestOwnerKey);
            if (skillsCacheRevision === requestRevision) {
                cachedSkills = data;
                cachedSkillsAt = Date.now();
                return data;
            }
            return cachedSkills ?? data;
        })();
        inFlightSkillsRequest = guardedPromise;
        try {
            return await guardedPromise;
        } finally {
            if (inFlightSkillsRequest === guardedPromise) {
                inFlightSkillsRequest = null;
            }
        }
    },

    async create(data: SkillCreatePayload, options?: AuthOwnerOptions) {
        const requestOwnerKey = await captureAuthCacheKey(options?.expectedAuthCacheKey);
        const response = await apiClient.post<UserSkill>('/skills', data, {
            expectedAuthCacheKey: requestOwnerKey,
        });
        await assertAuthCacheKey(requestOwnerKey);
        clearSkillsCache();
        bumpResumePreviewDataRevision();
        return response.data;
    },

    async update(id: string, data: SkillUpdatePayload, options?: AuthOwnerOptions) {
        const requestOwnerKey = await captureAuthCacheKey(options?.expectedAuthCacheKey);
        const response = await apiClient.patch<UserSkill>(`/skills/${id}`, data, {
            expectedAuthCacheKey: requestOwnerKey,
        });
        await assertAuthCacheKey(requestOwnerKey);
        clearSkillsCache();
        bumpResumePreviewDataRevision();
        return response.data;
    },

    async delete(id: string, options?: AuthOwnerOptions) {
        const requestOwnerKey = await captureAuthCacheKey(options?.expectedAuthCacheKey);
        await apiClient.delete(`/skills/${id}`, {
            expectedAuthCacheKey: requestOwnerKey,
        });
        await assertAuthCacheKey(requestOwnerKey);
        clearSkillsCache();
        bumpResumePreviewDataRevision();
    },
};
