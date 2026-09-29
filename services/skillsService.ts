import apiClient, {
    assertAuthCacheKey,
    captureAuthCacheKey,
    type AuthOwnerOptions,
} from './apiClient';
import { bumpResumePreviewDataRevision } from './resumePreviewDataRevision';
import { createOwnerScopedListCache } from './ownerScopedListCache';
import type { SkillCreatePayload, SkillUpdatePayload, UserSkill } from '../types/skill';

export type { SkillCreatePayload, SkillUpdatePayload, UserSkill } from '../types/skill';

const SKILLS_CACHE_TTL_MS = 10_000;

const requestSkills = async (expectedAuthCacheKey: string): Promise<UserSkill[]> => {
    const response = await apiClient.get<UserSkill[]>('/skills', {
        expectedAuthCacheKey,
    });
    return response.data;
};

const skillsCache = createOwnerScopedListCache(requestSkills, SKILLS_CACHE_TTL_MS);

export const skillsService = {
    peekList: skillsCache.peekList,
    peekListForCurrentUser: skillsCache.peekListForCurrentUser,
    list: skillsCache.list,

    async create(data: SkillCreatePayload, options?: AuthOwnerOptions) {
        const requestOwnerKey = await captureAuthCacheKey(options?.expectedAuthCacheKey);
        const response = await apiClient.post<UserSkill>('/skills', data, {
            expectedAuthCacheKey: requestOwnerKey,
        });
        await assertAuthCacheKey(requestOwnerKey);
        skillsCache.clear();
        bumpResumePreviewDataRevision();
        return response.data;
    },

    async update(id: string, data: SkillUpdatePayload, options?: AuthOwnerOptions) {
        const requestOwnerKey = await captureAuthCacheKey(options?.expectedAuthCacheKey);
        const response = await apiClient.patch<UserSkill>(`/skills/${id}`, data, {
            expectedAuthCacheKey: requestOwnerKey,
        });
        await assertAuthCacheKey(requestOwnerKey);
        skillsCache.clear();
        bumpResumePreviewDataRevision();
        return response.data;
    },

    async delete(id: string, options?: AuthOwnerOptions) {
        const requestOwnerKey = await captureAuthCacheKey(options?.expectedAuthCacheKey);
        await apiClient.delete(`/skills/${id}`, {
            expectedAuthCacheKey: requestOwnerKey,
        });
        await assertAuthCacheKey(requestOwnerKey);
        skillsCache.clear();
        bumpResumePreviewDataRevision();
    },
};
