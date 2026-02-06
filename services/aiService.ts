import apiClient from './apiClient';
import type { MatchScoreEntry, MatchTrend } from '../types/analysis';

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
    targetField?: 's' | 't' | 'a' | 'r';
    jdText?: string;
}

export interface PolishExperienceResponse {
    s?: string;
    t?: string;
    a?: string;
    r?: string;
}

export interface JDAnalysisResult {
    matchPercentage: number;
    matchTrend?: MatchTrend;
    jobKeywords: string[];
    missingKeywords: string[];
    jobTitle?: string;
    company?: string;
    summary: string;
    experienceMatches?: MatchScoreEntry[];
    certificationMatches?: MatchScoreEntry[];
    skillMatches?: MatchScoreEntry[];
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
            ...(data.targetField ? { target_field: data.targetField } : {}),
            ...(data.jdText ? { jd_text: data.jdText } : {}),
        };
        const response = await apiClient.post<PolishExperienceResponse>(
            '/api/polish-text',
            payload
        );
        return response.data;
    },

    async analyzeJD(
        text: string,
        resumeText?: string,
        prevResult?: {
            matchPercentage?: number;
            experienceMatches?: Array<Pick<MatchScoreEntry, 'id' | 'score'>>;
            certificationMatches?: Array<Pick<MatchScoreEntry, 'id' | 'score'>>;
            skillMatches?: Array<Pick<MatchScoreEntry, 'id' | 'score'>>;
        }
    ) {
        const response = await apiClient.post<JDAnalysisResult>('/api/analyze-jd', {
            text,
            resume_text: resumeText,
            prev_result: prevResult,
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
