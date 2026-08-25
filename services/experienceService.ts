import apiClient, {
    assertAuthCacheKey,
    captureAuthCacheKey,
    type AuthOwnerOptions,
} from './apiClient';
import { trackFirstExperienceCreated } from '../utils/analyticsTracker';
import { bumpResumePreviewDataRevision } from './resumePreviewDataRevision';
import type {
    ExperienceCategory,
    ExperienceCreatePayload,
    ExperienceDetail,
    ExperienceListItem,
    ExperienceUpdatePayload,
} from '../types/experience';

export type {
    ExperienceCategory,
    ExperienceCreatePayload,
    ExperienceDetail,
    ExperienceListItem,
    ExperienceUpdatePayload,
    ExperienceVersion,
} from '../types/experience';

type ExperienceListCacheKey = ExperienceCategory | 'all';

interface ExperienceListOptions extends AuthOwnerOptions {
    force?: boolean;
}

interface ExperienceListCacheEntry {
    data: ExperienceListItem[];
    fetchedAt: number;
}

// 短期缓存窗口：避免频繁挂载导致列表请求风暴
const EXPERIENCE_LIST_CACHE_TTL_MS = 10_000;
const EXPERIENCE_LIST_PAGE_SIZE = 200;

const buildExperienceListCacheKey = (category?: ExperienceCategory): ExperienceListCacheKey => {
    return category ?? 'all';
};

const isExperienceListCacheFresh = (entry: ExperienceListCacheEntry, now: number): boolean => {
    return now - entry.fetchedAt < EXPERIENCE_LIST_CACHE_TTL_MS;
};

const experienceListCache = new Map<ExperienceListCacheKey, ExperienceListCacheEntry>();
const completeExperienceListCache = new Map<ExperienceListCacheKey, ExperienceListCacheEntry>();
const experienceListInFlight = new Map<ExperienceListCacheKey, Promise<ExperienceListItem[]>>();
let experienceListCacheVersion = 0;
let experienceListCacheOwnerKey: string | null = null;

const clearExperienceListCache = () => {
    experienceListCacheVersion += 1;
    experienceListCache.clear();
    completeExperienceListCache.clear();
    experienceListInFlight.clear();
    experienceListCacheOwnerKey = null;
};

const filterArchivedExperiences = (items: ExperienceListItem[]): ExperienceListItem[] => {
    return items.filter((item) => !item.master.is_archived);
};

const getCachedExperienceList = (
    category?: ExperienceCategory,
    options?: { allowStale?: boolean }
): ExperienceListItem[] | null => {
    const cacheKey = buildExperienceListCacheKey(category);
    const cached = experienceListCache.get(cacheKey);
    if (!cached) {
        return null;
    }
    if (!options?.allowStale && !isExperienceListCacheFresh(cached, Date.now())) {
        return null;
    }
    return filterArchivedExperiences(cached.data);
};

const ensureExperienceCacheOwner = async (expectedAuthCacheKey?: string) => {
    const cacheOwnerKey = await captureAuthCacheKey(expectedAuthCacheKey);
    if (experienceListCacheOwnerKey !== cacheOwnerKey) {
        clearExperienceListCache();
        experienceListCacheOwnerKey = cacheOwnerKey;
    }
    return cacheOwnerKey;
};

export const experienceService = {
    peekList(
        category?: ExperienceCategory,
        options?: { allowStale?: boolean; expectedAuthCacheKey?: string }
    ) {
        if (
            !options?.expectedAuthCacheKey
            || options.expectedAuthCacheKey === 'anonymous'
            || experienceListCacheOwnerKey !== options.expectedAuthCacheKey
        ) {
            return null;
        }
        return getCachedExperienceList(category, options);
    },

    async peekListForCurrentUser(
        category?: ExperienceCategory,
        options?: { allowStale?: boolean; expectedAuthCacheKey?: string }
    ) {
        await ensureExperienceCacheOwner(options?.expectedAuthCacheKey);
        return experienceService.peekList(category, options);
    },

    async peekCompleteListForCurrentUser(
        category?: ExperienceCategory,
        options?: { allowStale?: boolean; expectedAuthCacheKey?: string }
    ) {
        await ensureExperienceCacheOwner(options?.expectedAuthCacheKey);
        const cached = completeExperienceListCache.get(buildExperienceListCacheKey(category));
        if (!cached) {
            return null;
        }
        if (!options?.allowStale && !isExperienceListCacheFresh(cached, Date.now())) {
            return null;
        }
        return filterArchivedExperiences(cached.data);
    },

    async list(category?: ExperienceCategory, options?: ExperienceListOptions) {
        const requestOwnerKey = await ensureExperienceCacheOwner(
            options?.expectedAuthCacheKey
        );
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
                expectedAuthCacheKey: requestOwnerKey,
            })
            .then((response) => filterArchivedExperiences(response.data));

        experienceListInFlight.set(cacheKey, requestPromise);

        try {
            const data = await requestPromise;
            await assertAuthCacheKey(requestOwnerKey);
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

    async listAll(category?: ExperienceCategory, options?: AuthOwnerOptions) {
        const requestOwnerKey = await ensureExperienceCacheOwner(
            options?.expectedAuthCacheKey
        );
        const requestVersion = experienceListCacheVersion;
        const allItems: ExperienceListItem[] = [];
        let offset = 0;

        while (true) {
            const response = await apiClient.get<ExperienceListItem[]>('/experiences', {
                params: {
                    ...(category ? { category } : {}),
                    include_archived: false,
                    limit: EXPERIENCE_LIST_PAGE_SIZE,
                    offset,
                },
                expectedAuthCacheKey: requestOwnerKey,
            });
            await assertAuthCacheKey(requestOwnerKey);
            const batch = filterArchivedExperiences(response.data);
            allItems.push(...batch);
            if (response.data.length < EXPERIENCE_LIST_PAGE_SIZE) {
                break;
            }
            offset += EXPERIENCE_LIST_PAGE_SIZE;
        }

        await assertAuthCacheKey(requestOwnerKey);
        if (experienceListCacheVersion === requestVersion) {
            completeExperienceListCache.set(buildExperienceListCacheKey(category), {
                data: allItems,
                fetchedAt: Date.now(),
            });
        }

        return allItems;
    },

    async create(data: ExperienceCreatePayload, options?: AuthOwnerOptions) {
        const requestOwnerKey = await captureAuthCacheKey(options?.expectedAuthCacheKey);
        const response = await apiClient.post<ExperienceDetail>('/experiences', data, {
            expectedAuthCacheKey: requestOwnerKey,
        });
        await assertAuthCacheKey(requestOwnerKey);
        clearExperienceListCache();
        bumpResumePreviewDataRevision();
        trackFirstExperienceCreated(data.category);
        return response.data;
    },

    async get(id: string, options?: AuthOwnerOptions) {
        const requestOwnerKey = await captureAuthCacheKey(options?.expectedAuthCacheKey);
        const response = await apiClient.get<ExperienceDetail>(`/experiences/${id}`, {
            expectedAuthCacheKey: requestOwnerKey,
        });
        await assertAuthCacheKey(requestOwnerKey);
        return response.data;
    },

    async update(id: string, data: ExperienceUpdatePayload, options?: AuthOwnerOptions) {
        const requestOwnerKey = await captureAuthCacheKey(options?.expectedAuthCacheKey);
        const response = await apiClient.patch<ExperienceDetail>(`/experiences/${id}`, data, {
            expectedAuthCacheKey: requestOwnerKey,
        });
        await assertAuthCacheKey(requestOwnerKey);
        clearExperienceListCache();
        bumpResumePreviewDataRevision();
        return response.data;
    },

    async delete(id: string, options?: AuthOwnerOptions) {
        const requestOwnerKey = await captureAuthCacheKey(options?.expectedAuthCacheKey);
        const response = await apiClient.delete<ExperienceDetail>(`/experiences/${id}`, {
            expectedAuthCacheKey: requestOwnerKey,
        });
        await assertAuthCacheKey(requestOwnerKey);
        clearExperienceListCache();
        bumpResumePreviewDataRevision();
        return response.data;
    },

    clearListCache() {
        clearExperienceListCache();
    },
};
