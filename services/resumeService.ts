import apiClient from './apiClient';

export interface Resume {
    id: string;
    user_id: string;
    title: string;
    target_role?: string;
    config?: Record<string, any>;
    created_at: string;
    updated_at: string;
}

export interface ResumeCreatePayload {
    title: string;
    target_role?: string;
}

// 简历列表缓存 + in-flight 去重，避免视图切换导致请求风暴
let cachedResumeList: Resume[] | null = null;
let inFlightResumeListRequest: Promise<Resume[]> | null = null;

const requestResumeList = async (): Promise<Resume[]> => {
    const response = await apiClient.get<Resume[]>('/resumes');
    return response.data;
};

export const resumeService = {
    async list(options?: { force?: boolean }) {
        const shouldUseCache = !options?.force;
        if (shouldUseCache && cachedResumeList) {
            return cachedResumeList;
        }
        if (inFlightResumeListRequest) {
            return inFlightResumeListRequest;
        }
        inFlightResumeListRequest = requestResumeList();
        try {
            cachedResumeList = await inFlightResumeListRequest;
            return cachedResumeList;
        } finally {
            inFlightResumeListRequest = null;
        }
    },

    async create(data: ResumeCreatePayload) {
        const response = await apiClient.post<Resume>('/resumes', data);
        if (cachedResumeList) {
            cachedResumeList = [response.data, ...cachedResumeList];
        }
        return response.data;
    },

    async get(id: string) {
        const response = await apiClient.get<any>(`/resumes/${id}`);
        return response.data;
    },

    async updateAssembly(id: string, data: any) {
        const response = await apiClient.patch<any>(`/resumes/${id}/assembly`, data);
        return response.data;
    },

    clearListCache() {
        cachedResumeList = null;
        inFlightResumeListRequest = null;
    },
};
