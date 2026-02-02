import apiClient from './apiClient';

export type ExperienceCategory = 'work' | 'project' | 'education';

export interface ExperienceVersion {
    id: string;
    title: string;
    org?: string;
    location?: string;
    start_date?: string;
    end_date?: string;
    is_current?: boolean;
    summary?: string;
    highlights?: string[];
    tags?: string[];
    star?: Record<string, any>;
}

export interface ExperienceListItem {
    master: {
        id: string;
        category: ExperienceCategory;
        is_archived: boolean;
    };
    latest_version?: ExperienceVersion;
}

export interface ExperienceDetail {
    master: {
        id: string;
        category: ExperienceCategory;
        is_archived: boolean;
    };
    latest_version?: ExperienceVersion;
    versions: ExperienceVersion[];
}

export interface ExperienceCreatePayload {
    category: ExperienceCategory;
    version: {
        title: string;
        org?: string;
        location?: string;
        start_date?: string;
        end_date?: string;
        is_current?: boolean;
        summary?: string;
        highlights?: string[];
        tags?: string[];
        star?: Record<string, any>;
    };
}

export interface ExperienceUpdatePayload {
    category?: ExperienceCategory;
    is_archived?: boolean;
    version?: {
        title: string;
        org?: string;
        location?: string;
        start_date?: string;
        end_date?: string;
        is_current?: boolean;
        summary?: string;
        highlights?: string[];
        tags?: string[];
        star?: Record<string, any>;
    };
}

type ExperienceListCacheKey = ExperienceCategory | 'all';

interface ExperienceListOptions {
    force?: boolean;
}

interface ExperienceListCacheEntry {
    data: ExperienceListItem[];
    fetchedAt: number;
}

// 短期缓存窗口：避免频繁挂载导致列表请求风暴
const EXPERIENCE_LIST_CACHE_TTL_MS = 10_000;

const buildExperienceListCacheKey = (category?: ExperienceCategory): ExperienceListCacheKey => {
    return category ?? 'all';
};

const isExperienceListCacheFresh = (entry: ExperienceListCacheEntry, now: number): boolean => {
    return now - entry.fetchedAt < EXPERIENCE_LIST_CACHE_TTL_MS;
};

const experienceListCache = new Map<ExperienceListCacheKey, ExperienceListCacheEntry>();
const experienceListInFlight = new Map<ExperienceListCacheKey, Promise<ExperienceListItem[]>>();
let experienceListCacheVersion = 0;

const clearExperienceListCache = () => {
    experienceListCacheVersion += 1;
    experienceListCache.clear();
    experienceListInFlight.clear();
};

const filterArchivedExperiences = (items: ExperienceListItem[]): ExperienceListItem[] => {
    return items.filter((item) => !item.master.is_archived);
};

const getCachedExperienceList = (category?: ExperienceCategory): ExperienceListItem[] | null => {
    const cacheKey = buildExperienceListCacheKey(category);
    const cached = experienceListCache.get(cacheKey);
    if (!cached) {
        return null;
    }
    if (!isExperienceListCacheFresh(cached, Date.now())) {
        return null;
    }
    return filterArchivedExperiences(cached.data);
};

export const experienceService = {
    peekList(category?: ExperienceCategory) {
        return getCachedExperienceList(category);
    },

    async list(category?: ExperienceCategory, options?: ExperienceListOptions) {
        const cacheKey = buildExperienceListCacheKey(category);
        const now = Date.now();
        const shouldUseCache = !options?.force;
        const requestVersion = experienceListCacheVersion;

        if (shouldUseCache) {
            const cached = experienceListCache.get(cacheKey);
            if (cached && isExperienceListCacheFresh(cached, now)) {
                return filterArchivedExperiences(cached.data);
            }
        }

        const inFlight = experienceListInFlight.get(cacheKey);
        if (inFlight) {
            return inFlight;
        }

        const requestPromise = apiClient
            .get<ExperienceListItem[]>('/experiences', {
                params: category ? { category } : {},
            })
            .then((response) => filterArchivedExperiences(response.data));

        experienceListInFlight.set(cacheKey, requestPromise);

        try {
            const data = await requestPromise;
            if (experienceListCacheVersion === requestVersion) {
                experienceListCache.set(cacheKey, { data, fetchedAt: Date.now() });
            }
            return data;
        } finally {
            if (experienceListInFlight.get(cacheKey) === requestPromise) {
                experienceListInFlight.delete(cacheKey);
            }
        }
    },

    async create(data: ExperienceCreatePayload) {
        const response = await apiClient.post<ExperienceDetail>('/experiences', data);
        clearExperienceListCache();
        return response.data;
    },

    async get(id: string) {
        const response = await apiClient.get<ExperienceDetail>(`/experiences/${id}`);
        return response.data;
    },

    async update(id: string, data: ExperienceUpdatePayload) {
        const response = await apiClient.patch<ExperienceDetail>(`/experiences/${id}`, data);
        clearExperienceListCache();
        return response.data;
    },

    async delete(id: string) {
        const response = await apiClient.delete<ExperienceDetail>(`/experiences/${id}`);
        clearExperienceListCache();
        return response.data;
    },
};
