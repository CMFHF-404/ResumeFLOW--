import apiClient from './apiClient';

export interface Certification {
    id: string;
    user_id: string;
    name: string;
    issuer?: string;
    issue_date?: string;
    expiry_date?: string;
    credential_id?: string;
    credential_url?: string;
    description?: string;
    created_at: string;
    updated_at: string;
}

export interface CertificationCreatePayload {
    name: string;
    issuer?: string;
    issue_date?: string;
    expiry_date?: string;
    credential_id?: string;
    credential_url?: string;
    description?: string;
}

export interface CertificationUpdatePayload {
    name?: string;
    issuer?: string;
    issue_date?: string;
    expiry_date?: string;
    credential_id?: string;
    credential_url?: string;
    description?: string;
}

export const certificationsService = {
    async list() {
        const response = await apiClient.get<Certification[]>('/certifications');
        return response.data;
    },

    async create(data: CertificationCreatePayload) {
        const response = await apiClient.post<Certification>('/certifications', data);
        return response.data;
    },

    async get(id: string) {
        const response = await apiClient.get<Certification>(`/certifications/${id}`);
        return response.data;
    },

    async update(id: string, data: CertificationUpdatePayload) {
        const response = await apiClient.patch<Certification>(`/certifications/${id}`, data);
        return response.data;
    },

    async delete(id: string) {
        await apiClient.delete(`/certifications/${id}`);
    },
};
