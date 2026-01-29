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

export const resumeService = {
    async list() {
        const response = await apiClient.get<Resume[]>('/resumes');
        return response.data;
    },

    async create(data: ResumeCreatePayload) {
        const response = await apiClient.post<Resume>('/resumes', data);
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
};
