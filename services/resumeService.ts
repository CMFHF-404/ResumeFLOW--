import apiClient, { getAuthCacheKey } from './apiClient';
import { bumpResumePreviewDataRevision } from './resumePreviewDataRevision';
import type {
    Resume,
    ResumeAssemblyPatchPayload,
    ResumeCreatePayload,
    ResumeDetail,
    ResumeUpdatePayload,
} from '../types/resume';

export type {
    Resume,
    ResumeAssemblyPatchPayload,
    ResumeCreatePayload,
    ResumeDetail,
    ResumeExperienceItem,
    ResumeExperienceMerged,
    ResumeUpdatePayload,
} from '../types/resume';

const knownResumeUpdatedAt = new Map<string, string>();
const resumeMutationQueues = new Map<string, Promise<unknown>>();
const resumeMutationEpochs = new Map<string, number>();
const blockedResumeMutations = new Set<string>();
const resumeVersionConflictListeners = new Map<string, Set<() => void>>();

export const getKnownResumeUpdatedAt = (resumeId: string) => knownResumeUpdatedAt.get(resumeId);

export const recordKnownResumeUpdatedAt = (
    resumeId: string,
    updatedAt?: string,
    options: { observedMutationEpoch?: number; mutationSuccess?: boolean } = {}
) => {
    if (!updatedAt) {
        return;
    }
    if (
        options.observedMutationEpoch !== undefined
        && options.observedMutationEpoch !== (resumeMutationEpochs.get(resumeId) ?? 0)
    ) {
        return;
    }
    const current = knownResumeUpdatedAt.get(resumeId);
    const currentTime = current ? Date.parse(current) : Number.NaN;
    const candidateTime = Date.parse(updatedAt);
    if (
        current
        && Number.isFinite(currentTime)
        && Number.isFinite(candidateTime)
        && candidateTime < currentTime
    ) {
        return;
    }
    knownResumeUpdatedAt.set(resumeId, updatedAt);
    if (options.mutationSuccess || options.observedMutationEpoch !== undefined) {
        blockedResumeMutations.delete(resumeId);
    }
};

const trackResume = <T extends Resume>(
    resume: T,
    options?: { observedMutationEpoch?: number; mutationSuccess?: boolean }
): T => {
    recordKnownResumeUpdatedAt(resume.id, resume.updated_at, options);
    return resume;
};

export const isResumeVersionConflict = (error: unknown) => (
    typeof error === 'object'
    && error !== null
    && (error as { response?: { status?: number } }).response?.status === 409
);

export const subscribeToResumeVersionConflicts = (
    resumeId: string,
    listener: () => void
) => {
    const listeners = resumeVersionConflictListeners.get(resumeId) ?? new Set();
    listeners.add(listener);
    resumeVersionConflictListeners.set(resumeId, listeners);
    return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
            resumeVersionConflictListeners.delete(resumeId);
        }
    };
};

const notifyResumeVersionConflict = (resumeId: string) => {
    for (const listener of resumeVersionConflictListeners.get(resumeId) ?? []) {
        listener();
    }
};

const runVersionedResumeMutation = async <T,>(
    resumeId: string,
    mutation: (expectedUpdatedAt: string | undefined) => Promise<T>
): Promise<T> => {
    const previous = resumeMutationQueues.get(resumeId) ?? Promise.resolve();
    const scheduled = previous
        .catch(() => undefined)
        .then(async () => {
            if (blockedResumeMutations.has(resumeId)) {
                throw new Error('Resume version conflict requires a reload before further changes.');
            }
            resumeMutationEpochs.set(
                resumeId,
                (resumeMutationEpochs.get(resumeId) ?? 0) + 1
            );
            try {
                return await mutation(getKnownResumeUpdatedAt(resumeId));
            } catch (error) {
                if (isResumeVersionConflict(error)) {
                    knownResumeUpdatedAt.delete(resumeId);
                    blockedResumeMutations.add(resumeId);
                    notifyResumeVersionConflict(resumeId);
                }
                throw error;
            }
        });
    resumeMutationQueues.set(resumeId, scheduled);
    try {
        return await scheduled;
    } finally {
        if (resumeMutationQueues.get(resumeId) === scheduled) {
            resumeMutationQueues.delete(resumeId);
        }
    }
};

export const waitForResumeMutations = async (resumeId?: string | null): Promise<void> => {
    if (!resumeId) {
        return;
    }
    while (true) {
        const observed = resumeMutationQueues.get(resumeId);
        if (!observed) {
            return;
        }
        await observed.catch(() => undefined);
        if (resumeMutationQueues.get(resumeId) === observed) {
            return;
        }
    }
};

export class ResumeAuthContextChangedError extends Error {
    constructor() {
        super('Authentication context changed during resume operation');
        this.name = 'ResumeAuthContextChangedError';
    }
}

export const assertResumeAuthContext = async (expectedAuthCacheKey: string): Promise<void> => {
    if (await getAuthCacheKey() !== expectedAuthCacheKey) {
        throw new ResumeAuthContextChangedError();
    }
};

export const captureResumeAuthCacheKey = async (
    authUserKey?: string | null
): Promise<string> => {
    const expectedAuthCacheKey = authUserKey ?? await getAuthCacheKey();
    await assertResumeAuthContext(expectedAuthCacheKey);
    return expectedAuthCacheKey;
};

// 简历列表缓存 + in-flight 去重，避免视图切换导致请求风暴
let cachedResumeList: Resume[] | null = null;
let inFlightResumeListRequest: Promise<Resume[]> | null = null;
let resumeListRequestVersion = 0;
let resumeListCacheOwnerKey: string | null = null;

const requestResumeList = async (options?: {
    cacheBust?: boolean;
    expectedAuthCacheKey?: string;
}): Promise<Resume[]> => {
    const observedMutationEpochs = new Map(resumeMutationEpochs);
    const requestConfig = options?.cacheBust || options?.expectedAuthCacheKey
        ? {
            ...(options?.cacheBust
                ? {
                    params: { _ts: Date.now() },
                    headers: { 'Cache-Control': 'no-cache' },
                }
                : {}),
            ...(options?.expectedAuthCacheKey
                ? { expectedAuthCacheKey: options.expectedAuthCacheKey }
                : {}),
        }
        : undefined;
    const response = await apiClient.get<Resume[]>('/resumes', requestConfig);
    if (options?.expectedAuthCacheKey) {
        await assertResumeAuthContext(options.expectedAuthCacheKey);
    }
    return response.data.map((resume) => trackResume(resume, {
        observedMutationEpoch: observedMutationEpochs.get(resume.id) ?? 0,
    }));
};

const clearResumeListCache = () => {
    resumeListRequestVersion += 1;
    cachedResumeList = null;
    inFlightResumeListRequest = null;
    resumeListCacheOwnerKey = null;
};

export const resumeService = {
    async list(options?: { force?: boolean; expectedAuthCacheKey?: string }) {
        const cacheOwnerKey = await getAuthCacheKey();
        if (
            options?.expectedAuthCacheKey
            && options.expectedAuthCacheKey !== cacheOwnerKey
        ) {
            throw new ResumeAuthContextChangedError();
        }
        if (resumeListCacheOwnerKey !== cacheOwnerKey) {
            clearResumeListCache();
            resumeListCacheOwnerKey = cacheOwnerKey;
        }
        const shouldUseCache = !options?.force;
        if (shouldUseCache && cachedResumeList) {
            return cachedResumeList;
        }
        if (!options?.force && inFlightResumeListRequest) {
            const data = await inFlightResumeListRequest;
            await assertResumeAuthContext(cacheOwnerKey);
            return data;
        }
        const requestVersion = (resumeListRequestVersion += 1);
        const requestPromise = requestResumeList({
            cacheBust: options?.force,
            expectedAuthCacheKey: cacheOwnerKey,
        });
        inFlightResumeListRequest = requestPromise;
        try {
            const data = await requestPromise;
            await assertResumeAuthContext(cacheOwnerKey);
            if (requestVersion === resumeListRequestVersion) {
                cachedResumeList = data;
            }
            return data;
        } finally {
            if (inFlightResumeListRequest === requestPromise) {
                inFlightResumeListRequest = null;
            }
        }
    },

    async create(
        data: ResumeCreatePayload,
        options?: { expectedAuthCacheKey?: string }
    ) {
        const expectedAuthCacheKey = options?.expectedAuthCacheKey;
        const response = await apiClient.post<Resume>(
            '/resumes',
            data,
            expectedAuthCacheKey ? { expectedAuthCacheKey } : undefined
        );
        if (expectedAuthCacheKey) {
            await assertResumeAuthContext(expectedAuthCacheKey);
        }
        trackResume(response.data);
        if (
            cachedResumeList
            && (!expectedAuthCacheKey || resumeListCacheOwnerKey === expectedAuthCacheKey)
        ) {
            cachedResumeList = [response.data, ...cachedResumeList];
        }
        return response.data;
    },

    async get(id: string, options?: { expectedAuthCacheKey?: string }) {
        const observedMutationEpoch = resumeMutationEpochs.get(id) ?? 0;
        const response = await apiClient.get<ResumeDetail>(
            `/resumes/${id}`,
            options?.expectedAuthCacheKey
                ? { expectedAuthCacheKey: options.expectedAuthCacheKey }
                : undefined
        );
        if (options?.expectedAuthCacheKey) {
            await assertResumeAuthContext(options.expectedAuthCacheKey);
        }
        trackResume(response.data.resume, { observedMutationEpoch });
        return response.data;
    },

    async update(
        id: string,
        data: ResumeUpdatePayload,
        options?: { expectedAuthCacheKey?: string }
    ) {
        return runVersionedResumeMutation(id, async (knownUpdatedAt) => {
            const response = await apiClient.patch<Resume>(`/resumes/${id}`, {
                ...data,
                expected_updated_at: knownUpdatedAt ?? data.expected_updated_at,
            }, options?.expectedAuthCacheKey
                ? { expectedAuthCacheKey: options.expectedAuthCacheKey }
                : undefined);
            if (options?.expectedAuthCacheKey) {
                await assertResumeAuthContext(options.expectedAuthCacheKey);
            }
            trackResume(response.data, { mutationSuccess: true });
            if (
                cachedResumeList
                && (!options?.expectedAuthCacheKey
                    || resumeListCacheOwnerKey === options.expectedAuthCacheKey)
            ) {
                cachedResumeList = cachedResumeList.map((item) =>
                    item.id === id ? response.data : item
                );
            }
            bumpResumePreviewDataRevision();
            return response.data;
        });
    },

    async remove(id: string, options?: { expectedAuthCacheKey?: string }) {
        await apiClient.delete(
            `/resumes/${id}`,
            options?.expectedAuthCacheKey
                ? { expectedAuthCacheKey: options.expectedAuthCacheKey }
                : undefined
        );
        if (options?.expectedAuthCacheKey) {
            await assertResumeAuthContext(options.expectedAuthCacheKey);
        }
        if (
            cachedResumeList
            && (!options?.expectedAuthCacheKey
                || resumeListCacheOwnerKey === options.expectedAuthCacheKey)
        ) {
            cachedResumeList = cachedResumeList.filter((item) => item.id !== id);
        }
    },

    async duplicate(
        id: string,
        payload?: { title?: string },
        options?: { expectedAuthCacheKey?: string }
    ) {
        const response = await apiClient.post<Resume>(
            `/resumes/${id}/duplicate`,
            payload ?? {},
            options?.expectedAuthCacheKey
                ? { expectedAuthCacheKey: options.expectedAuthCacheKey }
                : undefined
        );
        if (options?.expectedAuthCacheKey) {
            await assertResumeAuthContext(options.expectedAuthCacheKey);
        }
        trackResume(response.data);
        if (
            cachedResumeList
            && (!options?.expectedAuthCacheKey
                || resumeListCacheOwnerKey === options.expectedAuthCacheKey)
        ) {
            cachedResumeList = [response.data, ...cachedResumeList];
        }
        return response.data;
    },

    async updateAssembly(
        id: string,
        data: ResumeAssemblyPatchPayload,
        options?: { expectedAuthCacheKey?: string }
    ) {
        return runVersionedResumeMutation(id, async (knownUpdatedAt) => {
            const response = await apiClient.patch<ResumeDetail>(`/resumes/${id}/assembly`, {
                ...data,
                expected_updated_at: knownUpdatedAt ?? data.expected_updated_at,
            }, options?.expectedAuthCacheKey
                ? { expectedAuthCacheKey: options.expectedAuthCacheKey }
                : undefined);
            if (options?.expectedAuthCacheKey) {
                await assertResumeAuthContext(options.expectedAuthCacheKey);
            }
            trackResume(response.data.resume, { mutationSuccess: true });
            if (
                cachedResumeList
                && (!options?.expectedAuthCacheKey
                    || resumeListCacheOwnerKey === options.expectedAuthCacheKey)
            ) {
                cachedResumeList = cachedResumeList.map((item) =>
                    item.id === id ? response.data.resume : item
                );
            }
            bumpResumePreviewDataRevision();
            return response.data;
        });
    },

    clearListCache() {
        clearResumeListCache();
    },
};
