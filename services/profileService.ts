import apiClient from './apiClient';

export interface Profile {
    user_id: string;
    full_name?: string;
    title?: string;
    summary?: string;
    location?: string;
    phone?: string;
    email?: string;
    social_links?: Record<string, any>;
    extra_json?: Record<string, any>;
    updated_at: string;
}

export interface ProfileUpdate {
    full_name?: string;
    title?: string;
    summary?: string;
    location?: string;
    phone?: string;
    email?: string;
    social_links?: Record<string, any>;
    extra_json?: Record<string, any>;
}

export const profileService = {
    async getProfile() {
        const response = await apiClient.get<Profile>('/profile');
        return response.data;
    },

    async updateProfile(data: ProfileUpdate) {
        const response = await apiClient.patch<Profile>('/profile', data);
        return response.data;
    },
};
