import apiClient, { getAuthCacheKey } from './apiClient';
import { bumpResumePreviewDataRevision } from './resumePreviewDataRevision';

export interface Resume {
    id: string;
    user_id: string;
    title: string;
    target_role?: string;
    config?: Record<string, any>;
    created_at: string;
    updated_at: string;
}

export interface ResumeExperienceMerged {
    id: string;
    master_experience_id: string;
    version: number;
    title: string;
    org?: string;
    location?: string;
    start_date?: string;
    end_date?: string;
    is_current: boolean;
    summary?: string;
    highlights: string[];
    star: Record<string, any>;
}

export interface ResumeExperienceItem {
    id: string;
    resume_id: string;
    experience_version_id: string;
    display_order: number;
    overrides_json: Record<string, any>;
    experience: ResumeExperienceMerged;
}

export interface ResumeDetail {
    resume: Resume;
    experiences: ResumeExperienceItem[];
}

export interface ResumeCreatePayload {
    title: string;
    target_role?: string;
    config?: Record<string, any>;
}

export interface ResumeUpdatePayload {
    title?: string;
    target_role?: string;
    config?: Record<string, any>;
    expected_updated_at?: string;
}

export interface ResumeAssemblyPatchPayload {
    operations: Array<Record<string, any>>;
    expected_updated_at?: string;
}

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

// 简历列表缓存 + in-flight 去重，避免视图切换导致请求风暴
let cachedResumeList: Resume[] | null = null;
let inFlightResumeListRequest: Promise<Resume[]> | null = null;
let resumeListRequestVersion = 0;
let resumeListCacheOwnerKey: string | null = null;

const requestResumeList = async (options?: { cacheBust?: boolean }): Promise<Resume[]> => {
    const observedMutationEpochs = new Map(resumeMutationEpochs);
    const requestConfig = options?.cacheBust
        ? {
            params: { _ts: Date.now() },
            headers: { 'Cache-Control': 'no-cache' },
        }
        : undefined;
    const response = await apiClient.get<Resume[]>('/resumes', requestConfig);
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
    async list(options?: { force?: boolean }) {
        const cacheOwnerKey = await getAuthCacheKey();
        if (resumeListCacheOwnerKey !== cacheOwnerKey) {
            clearResumeListCache();
            resumeListCacheOwnerKey = cacheOwnerKey;
        }
        const shouldUseCache = !options?.force;
        if (shouldUseCache && cachedResumeList) {
            return cachedResumeList;
        }
        if (!options?.force && inFlightResumeListRequest) {
            return inFlightResumeListRequest;
        }
        const requestVersion = (resumeListRequestVersion += 1);
        const requestPromise = requestResumeList({ cacheBust: options?.force });
        inFlightResumeListRequest = requestPromise;
        try {
            const data = await requestPromise;
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

    async create(data: ResumeCreatePayload) {
        const response = await apiClient.post<Resume>('/resumes', data);
        trackResume(response.data);
        if (cachedResumeList) {
            cachedResumeList = [response.data, ...cachedResumeList];
        }
        return response.data;
    },

    async get(id: string) {
        const observedMutationEpoch = resumeMutationEpochs.get(id) ?? 0;
        const response = await apiClient.get<ResumeDetail>(`/resumes/${id}`);
        trackResume(response.data.resume, { observedMutationEpoch });
        return response.data;
    },

    async update(id: string, data: ResumeUpdatePayload) {
        return runVersionedResumeMutation(id, async (knownUpdatedAt) => {
            const response = await apiClient.patch<Resume>(`/resumes/${id}`, {
                ...data,
                expected_updated_at: knownUpdatedAt ?? data.expected_updated_at,
            });
            trackResume(response.data, { mutationSuccess: true });
            if (cachedResumeList) {
                cachedResumeList = cachedResumeList.map((item) =>
                    item.id === id ? response.data : item
                );
            }
            bumpResumePreviewDataRevision();
            return response.data;
        });
    },

    async remove(id: string) {
        await apiClient.delete(`/resumes/${id}`);
        if (cachedResumeList) {
            cachedResumeList = cachedResumeList.filter((item) => item.id !== id);
        }
    },

    async duplicate(id: string, payload?: { title?: string }) {
        const response = await apiClient.post<Resume>(`/resumes/${id}/duplicate`, payload ?? {});
        trackResume(response.data);
        if (cachedResumeList) {
            cachedResumeList = [response.data, ...cachedResumeList];
        }
        return response.data;
    },

    async updateAssembly(id: string, data: ResumeAssemblyPatchPayload) {
        return runVersionedResumeMutation(id, async (knownUpdatedAt) => {
            const response = await apiClient.patch<ResumeDetail>(`/resumes/${id}/assembly`, {
                ...data,
                expected_updated_at: knownUpdatedAt ?? data.expected_updated_at,
            });
            trackResume(response.data.resume, { mutationSuccess: true });
            if (cachedResumeList) {
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
