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

export type AnalyzeJDParams = {
    text: string;
    resumeText?: string;
    prevResult?: {
        matchPercentage?: number;
        experienceMatches?: Array<Pick<MatchScoreEntry, 'id' | 'score'>>;
        certificationMatches?: Array<Pick<MatchScoreEntry, 'id' | 'score'>>;
        skillMatches?: Array<Pick<MatchScoreEntry, 'id' | 'score'>>;
    };
    experienceText?: string;
    prevExperienceText?: string;
};

export type AnalyzeJDWithAttachmentParams = {
    /** 待分析的 JD 附件文件（图像或 PDF/DOCX） */
    file: File;
    /** 用户手动补充的 JD 文本 */
    jdText?: string;
    /** 简历数据 JSON 序列化字符串 */
    resumeText?: string;
    /** 经历内容快照，用于增量分析 */
    experienceText?: string;
    /** 上一次分析结果（JSON 序列化），供模型参考 */
    prevResult?: object;
    /** 上一次经历内容快照，用于增量分析 */
    prevExperienceText?: string;
};

export interface GenerateTagsResponse {
    tags: string[];
}

export interface GenerateBossGreetingParams {
    jdText: string;
    analysisSummary: string;
    jobTitle?: string;
    company?: string;
    resumeText: string;
}

export interface GenerateBossGreetingResponse {
    greeting: string;
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

    async analyzeJD({
        text,
        resumeText,
        prevResult,
        experienceText,
        prevExperienceText,
    }: AnalyzeJDParams) {
        const response = await apiClient.post<JDAnalysisResult>('/api/analyze-jd', {
            text,
            resume_text: resumeText,
            prev_result: prevResult,
            experience_text: experienceText,
            prev_experience_text: prevExperienceText,
        });
        return response.data;
    },

    async generateTags(text: string) {
        const response = await apiClient.post<GenerateTagsResponse>('/api/generate-tags', {
            text,
        });
        return response.data;
    },

    async generateBossGreeting(data: GenerateBossGreetingParams) {
        const response = await apiClient.post<GenerateBossGreetingResponse>(
            '/api/generate-boss-greeting',
            {
                jd_text: data.jdText,
                analysis_summary: data.analysisSummary,
                job_title: data.jobTitle,
                company: data.company,
                resume_text: data.resumeText,
            }
        );
        return response.data;
    },

    /**
     * 附件 JD 分析：将文件（图像/PDF/DOCX）以 FormData 上传，
     * 后端根据文件类型自动选择 vision 或文本提取路径。
     */
    async analyzeJDWithAttachment({
        file,
        jdText,
        resumeText,
        experienceText,
        prevResult,
        prevExperienceText,
    }: AnalyzeJDWithAttachmentParams): Promise<JDAnalysisResult> {
        const formData = new FormData();
        formData.append('file', file);
        if (jdText) {
            formData.append('jd_text', jdText);
        }
        if (resumeText) {
            formData.append('resume_text', resumeText);
        }
        if (experienceText) {
            formData.append('experience_text', experienceText);
        }
        if (prevResult) {
            formData.append('prev_result', JSON.stringify(prevResult));
        }
        if (prevExperienceText) {
            formData.append('prev_experience_text', prevExperienceText);
        }
        const response = await apiClient.post<JDAnalysisResult>(
            '/api/analyze-jd-attachment',
            formData,
            { headers: { 'Content-Type': null } }
        );
        return response.data;
    },
};

