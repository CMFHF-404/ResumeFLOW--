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
        star?: Record<string, any>;
    };
}

export const experienceService = {
    async list(category?: ExperienceCategory) {
        const response = await apiClient.get<ExperienceListItem[]>('/experiences', {
            params: category ? { category } : {},
        });
        return response.data;
    },

    async create(data: ExperienceCreatePayload) {
        const response = await apiClient.post<ExperienceDetail>('/experiences', data);
        return response.data;
    },

    async get(id: string) {
        const response = await apiClient.get<ExperienceDetail>(`/experiences/${id}`);
        return response.data;
    },

    async update(id: string, data: ExperienceUpdatePayload) {
        const response = await apiClient.patch<ExperienceDetail>(`/experiences/${id}`, data);
        return response.data;
    },

    async delete(id: string) {
        const response = await apiClient.delete<ExperienceDetail>(`/experiences/${id}`);
        return response.data;
    },
};
