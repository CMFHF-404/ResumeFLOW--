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
    tags: string[];
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
}

export interface ResumeUpdatePayload {
    title?: string;
    target_role?: string;
    config?: Record<string, any>;
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
        const response = await apiClient.get<ResumeDetail>(`/resumes/${id}`);
        return response.data;
    },

    async update(id: string, data: ResumeUpdatePayload) {
        const response = await apiClient.patch<Resume>(`/resumes/${id}`, data);
        if (cachedResumeList) {
            cachedResumeList = cachedResumeList.map((item) =>
                item.id === id ? response.data : item
            );
        }
        return response.data;
    },

    async updateAssembly(id: string, data: any) {
        const response = await apiClient.patch<ResumeDetail>(`/resumes/${id}/assembly`, data);
        return response.data;
    },

    clearListCache() {
        cachedResumeList = null;
        inFlightResumeListRequest = null;
    },
};
