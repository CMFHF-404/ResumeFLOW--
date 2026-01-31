import apiClient, { getAuthCacheKey } from './apiClient';

export interface UserSkill {
    id: string;
    user_id: string;
    skill_id: string;
    name: string;
    category?: string;
    proficiency?: number;
}

export interface SkillCreatePayload {
    name: string;
    category?: string;
    proficiency?: number;
}

export interface SkillUpdatePayload {
    name?: string;
    category?: string;
    proficiency?: number;
}

const SKILLS_CACHE_TTL_MS = 10_000;

let cachedSkills: UserSkill[] | null = null;
let cachedSkillsAt = 0;
let inFlightSkillsRequest: Promise<UserSkill[]> | null = null;
let skillsCacheRevision = 0;
let skillsCacheOwnerKey: string | null = null;

const isSkillsCacheFresh = (now: number) => {
    return !!cachedSkills && now - cachedSkillsAt < SKILLS_CACHE_TTL_MS;
};

const requestSkills = async (): Promise<UserSkill[]> => {
    const response = await apiClient.get<UserSkill[]>('/skills');
    return response.data;
};

const clearSkillsCache = () => {
    skillsCacheRevision += 1;
    cachedSkills = null;
    cachedSkillsAt = 0;
    inFlightSkillsRequest = null;
};

export const skillsService = {
    async list(options?: { force?: boolean }) {
        const cacheOwnerKey = await getAuthCacheKey();
        if (skillsCacheOwnerKey !== cacheOwnerKey) {
            clearSkillsCache();
            skillsCacheOwnerKey = cacheOwnerKey;
        }
        const shouldUseCache = !options?.force;
        const now = Date.now();
        if (shouldUseCache && isSkillsCacheFresh(now) && cachedSkills) {
            return cachedSkills;
        }
        if (inFlightSkillsRequest) {
            return inFlightSkillsRequest;
        }
        const requestRevision = skillsCacheRevision;
        const requestPromise = requestSkills();
        const guardedPromise = (async () => {
            const data = await requestPromise;
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

    async create(data: SkillCreatePayload) {
        const response = await apiClient.post<UserSkill>('/skills', data);
        clearSkillsCache();
        return response.data;
    },

    async update(id: string, data: SkillUpdatePayload) {
        const response = await apiClient.patch<UserSkill>(`/skills/${id}`, data);
        clearSkillsCache();
        return response.data;
    },

    async delete(id: string) {
        await apiClient.delete(`/skills/${id}`);
        clearSkillsCache();
    },
};
