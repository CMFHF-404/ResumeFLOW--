import apiClient from './apiClient';

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

export const skillsService = {
    async list() {
        const response = await apiClient.get<UserSkill[]>('/skills');
        return response.data;
    },

    async create(data: SkillCreatePayload) {
        const response = await apiClient.post<UserSkill>('/skills', data);
        return response.data;
    },

    async update(id: string, data: SkillUpdatePayload) {
        const response = await apiClient.patch<UserSkill>(`/skills/${id}`, data);
        return response.data;
    },

    async delete(id: string) {
        await apiClient.delete(`/skills/${id}`);
    },
};
