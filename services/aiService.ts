import apiClient from './apiClient';

export interface PolishExperiencePayload {
    content: {
        company?: string;
        role?: string;
        rawText?: string;
        s?: string;  // Situation
        t?: string;  // Task
        a?: string;  // Action
        r?: string;  // Result
    };
}

export interface PolishExperienceResponse {
    s?: string;
    t?: string;
    a?: string;
    r?: string;
}

export interface JDAnalysisResult {
    matchPercentage: number;
    missingKeywords: string[];
    summary: string;
}

export interface GenerateTagsResponse {
    tags: string[];
}

export const aiService = {
    async polishExperience(data: PolishExperiencePayload) {
        const { rawText, ...rest } = data.content;
        const payload = {
            content: {
                ...rest,
                ...(rawText ? { raw_text: rawText } : {}),
            },
        };
        const response = await apiClient.post<PolishExperienceResponse>(
            '/api/polish-text',
            payload
        );
        return response.data;
    },

    async analyzeJD(text: string, resumeText?: string) {
        const response = await apiClient.post<JDAnalysisResult>('/api/analyze-jd', {
            text,
            resume_text: resumeText,
        });
        return response.data;
    },

    async generateTags(text: string) {
        const response = await apiClient.post<GenerateTagsResponse>('/api/generate-tags', {
            text,
        });
        return response.data;
    },
};
