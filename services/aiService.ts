import apiClient, { getApiBaseUrl, getAuthorizationHeader } from './apiClient';
import { dispatchLoginRequired } from './authRedirect';
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
    extractedJdText?: string;
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
    resumeId?: string;
    signature?: string;
}

export interface GenerateBossGreetingResponse {
    greeting: string;
}

export interface GeneratePersonalSummaryParams {
    mode: 'bank' | 'resume';
    profile?: Record<string, unknown>;
    workExperiences?: Array<Record<string, unknown>>;
    projectExperiences?: Array<Record<string, unknown>>;
    educationExperiences?: Array<Record<string, unknown>>;
    certifications?: Array<Record<string, unknown>>;
    skills?: Array<Record<string, unknown>>;
    jdText?: string;
}

export interface GeneratePersonalSummaryResponse {
    summary: string;
}

type RawJDAnalysisResult = JDAnalysisResult & {
    extracted_jd_text?: unknown;
};


export type JDAnalyzeProgressNode =
    | 'prepare_context'
    | 'request_ai'
    | 'merge_result'
    | 'apply_score'
    | 'persist_result';

export type AIThoughtEvent = {
    type: 'thought';
    summary: string;
};

export type AnalyzeProgressEvent = {
    type: 'progress';
    node: JDAnalyzeProgressNode;
    title?: string;
};

type AnalyzeFinalEvent = {
    type: 'final';
    result: RawJDAnalysisResult;
};

type AnalyzeErrorEvent = {
    type: 'error';
    message?: string;
};

export type AnalyzeStreamEvent =
    | AnalyzeProgressEvent
    | AIThoughtEvent
    | AnalyzeFinalEvent
    | AnalyzeErrorEvent;

export type PolishProgressNode =
    | 'prepare_context'
    | 'request_ai'
    | 'persist_result';

export type PolishProgressEvent = {
    type: 'progress';
    node: PolishProgressNode;
    title?: string;
};

type PolishFinalEvent = {
    type: 'final';
    result: PolishExperienceResponse;
};

type PolishErrorEvent = {
    type: 'error';
    message?: string;
};

export type PolishStreamEvent =
    | PolishProgressEvent
    | AIThoughtEvent
    | PolishFinalEvent
    | PolishErrorEvent;

export type BossGreetingProgressNode =
    | 'prepare_context'
    | 'request_ai'
    | 'persist_result';

export type BossGreetingProgressEvent = {
    type: 'progress';
    node: BossGreetingProgressNode;
    title?: string;
};

type BossGreetingFinalEvent = {
    type: 'final';
    result: GenerateBossGreetingResponse;
};

type BossGreetingErrorEvent = {
    type: 'error';
    message?: string;
};

export type BossGreetingStreamEvent =
    | BossGreetingProgressEvent
    | AIThoughtEvent
    | BossGreetingFinalEvent
    | BossGreetingErrorEvent;

export type PersonalSummaryProgressNode =
    | 'prepare_context'
    | 'request_ai'
    | 'persist_result';

export type PersonalSummaryProgressEvent = {
    type: 'progress';
    node: PersonalSummaryProgressNode;
    title?: string;
};

type PersonalSummaryFinalEvent = {
    type: 'final';
    result: GeneratePersonalSummaryResponse;
};

type PersonalSummaryErrorEvent = {
    type: 'error';
    message?: string;
};

export type PersonalSummaryStreamEvent =
    | PersonalSummaryProgressEvent
    | AIThoughtEvent
    | PersonalSummaryFinalEvent
    | PersonalSummaryErrorEvent;

const parseNdjsonLines = (chunk: string) => chunk.split('\n').map((line) => line.trim()).filter(Boolean);

const resolveApiUrl = (path: string) => {
    const base = getApiBaseUrl();
    if (!base) {
        return path;
    }
    const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${normalizedBase}${normalizedPath}`;
};

const ensureStreamResponseOk = (response: Response) => {
    if (response.ok) {
        return;
    }
    if (response.status === 401) {
        dispatchLoginRequired('unauthorized-write');
    }
    throw new Error(`AI stream request failed: ${response.status}`);
};

const streamAnalyzeRequest = async (
    path: string,
    body: BodyInit,
    options: {
        onEvent?: (event: AnalyzeStreamEvent) => void;
        onProgress?: (event: AnalyzeProgressEvent) => void;
        contentType?: string | null;
    } = {}
): Promise<JDAnalysisResult> => {
    const headers = new Headers();
    const authHeader = await getAuthorizationHeader();
    if (!authHeader) {
        dispatchLoginRequired('write-operation');
        throw new Error('Authentication required for write operation');
    }
    headers.set('Authorization', authHeader);
    if (options.contentType !== null) {
        headers.set('Content-Type', options.contentType ?? 'application/json');
    }

    const response = await fetch(resolveApiUrl(path), {
        method: 'POST',
        headers,
        body,
    });

    ensureStreamResponseOk(response);
    if (!response.body) {
        throw new Error('AI stream response body is empty');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult: JDAnalysisResult | null = null;

    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = parseNdjsonLines(buffer);
        const hasTrailingNewline = buffer.endsWith('\n');
        buffer = hasTrailingNewline ? '' : lines.pop() ?? '';

        lines.forEach((line) => {
            let parsed: AnalyzeStreamEvent;
            try {
                parsed = JSON.parse(line) as AnalyzeStreamEvent;
            } catch (error) {
                console.warn('Failed to parse stream line', error);
                return;
            }
            options.onEvent?.(parsed);
            if (parsed.type === 'progress') {
                options.onProgress?.(parsed);
                return;
            }
            if (parsed.type === 'thought') {
                return;
            }
            if (parsed.type === 'error') {
                throw new Error(parsed.message || 'AI stream error');
            }
            if (parsed.type === 'final') {
                finalResult = normalizeJDAnalysisResult(parsed.result);
            }
        });
    }

    if (!finalResult) {
        throw new Error('AI stream did not return final result');
    }
    return finalResult;
};

const streamPolishRequest = async (
    payload: Record<string, unknown>,
    options: {
        onEvent?: (event: PolishStreamEvent) => void;
    } = {}
): Promise<PolishExperienceResponse> => {
    const headers = new Headers();
    const authHeader = await getAuthorizationHeader();
    if (!authHeader) {
        dispatchLoginRequired('write-operation');
        throw new Error('Authentication required for write operation');
    }
    headers.set('Authorization', authHeader);
    headers.set('Content-Type', 'application/json');

    const response = await fetch(resolveApiUrl('/api/polish-text/stream'), {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
    });

    ensureStreamResponseOk(response);
    if (!response.body) {
        throw new Error('AI stream response body is empty');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult: PolishExperienceResponse | null = null;

    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = parseNdjsonLines(buffer);
        const hasTrailingNewline = buffer.endsWith('\n');
        buffer = hasTrailingNewline ? '' : lines.pop() ?? '';

        lines.forEach((line) => {
            let parsed: PolishStreamEvent;
            try {
                parsed = JSON.parse(line) as PolishStreamEvent;
            } catch (error) {
                console.warn('Failed to parse stream line', error);
                return;
            }
            options.onEvent?.(parsed);
            if (parsed.type === 'error') {
                throw new Error(parsed.message || 'AI stream error');
            }
            if (parsed.type === 'final') {
                finalResult = parsed.result;
            }
        });
    }

    if (!finalResult) {
        throw new Error('AI stream did not return final result');
    }
    return finalResult;
};

const streamBossGreetingRequest = async (
    payload: Record<string, unknown>,
    options: {
        onEvent?: (event: BossGreetingStreamEvent) => void;
    } = {}
): Promise<GenerateBossGreetingResponse> => {
    const headers = new Headers();
    const authHeader = await getAuthorizationHeader();
    if (!authHeader) {
        dispatchLoginRequired('write-operation');
        throw new Error('Authentication required for write operation');
    }
    headers.set('Authorization', authHeader);
    headers.set('Content-Type', 'application/json');

    const response = await fetch(resolveApiUrl('/api/generate-boss-greeting/stream'), {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
    });

    ensureStreamResponseOk(response);
    if (!response.body) {
        throw new Error('AI stream response body is empty');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult: GenerateBossGreetingResponse | null = null;

    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = parseNdjsonLines(buffer);
        const hasTrailingNewline = buffer.endsWith('\n');
        buffer = hasTrailingNewline ? '' : lines.pop() ?? '';

        lines.forEach((line) => {
            let parsed: BossGreetingStreamEvent;
            try {
                parsed = JSON.parse(line) as BossGreetingStreamEvent;
            } catch (error) {
                console.warn('Failed to parse stream line', error);
                return;
            }
            options.onEvent?.(parsed);
            if (parsed.type === 'error') {
                throw new Error(parsed.message || 'AI stream error');
            }
            if (parsed.type === 'final') {
                finalResult = parsed.result;
            }
        });
    }

    if (!finalResult) {
        throw new Error('AI stream did not return final result');
    }
    if (!finalResult.greeting?.trim()) {
        throw new Error('AI 未生成有效的 BOSS 招呼语，请稍后重试');
    }
    return finalResult;
};

const streamPersonalSummaryRequest = async (
    payload: Record<string, unknown>,
    options: {
        onEvent?: (event: PersonalSummaryStreamEvent) => void;
    } = {}
): Promise<GeneratePersonalSummaryResponse> => {
    const headers = new Headers();
    const authHeader = await getAuthorizationHeader();
    if (!authHeader) {
        dispatchLoginRequired('write-operation');
        throw new Error('Authentication required for write operation');
    }
    headers.set('Authorization', authHeader);
    headers.set('Content-Type', 'application/json');

    const response = await fetch(resolveApiUrl('/api/generate-personal-summary/stream'), {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
    });

    ensureStreamResponseOk(response);
    if (!response.body) {
        throw new Error('AI stream response body is empty');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult: GeneratePersonalSummaryResponse | null = null;

    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = parseNdjsonLines(buffer);
        const hasTrailingNewline = buffer.endsWith('\n');
        buffer = hasTrailingNewline ? '' : lines.pop() ?? '';

        lines.forEach((line) => {
            let parsed: PersonalSummaryStreamEvent;
            try {
                parsed = JSON.parse(line) as PersonalSummaryStreamEvent;
            } catch (error) {
                console.warn('Failed to parse stream line', error);
                return;
            }
            options.onEvent?.(parsed);
            if (parsed.type === 'error') {
                throw new Error(parsed.message || 'AI stream error');
            }
            if (parsed.type === 'final') {
                finalResult = parsed.result;
            }
        });
    }

    if (!finalResult) {
        throw new Error('AI stream did not return final result');
    }
    if (!finalResult.summary?.trim()) {
        throw new Error('AI 未生成有效的个人评价，请稍后重试');
    }
    return finalResult;
};

const normalizeJDAnalysisResult = (result: RawJDAnalysisResult): JDAnalysisResult => {
    const extractedJdText = typeof result.extractedJdText === 'string'
        ? result.extractedJdText
        : typeof result.extracted_jd_text === 'string'
            ? result.extracted_jd_text
            : undefined;
    return {
        ...result,
        ...(extractedJdText ? { extractedJdText } : {}),
    };
};

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

    async polishExperienceStream(
        data: PolishExperiencePayload,
        onEvent?: (event: PolishStreamEvent) => void
    ) {
        const { rawText, ...rest } = data.content;
        const payload = {
            content: {
                ...rest,
                ...(rawText ? { raw_text: rawText } : {}),
            },
            ...(data.targetField ? { target_field: data.targetField } : {}),
            ...(data.jdText ? { jd_text: data.jdText } : {}),
        };
        return streamPolishRequest(payload, { onEvent });
    },

    async analyzeJD({
        text,
        resumeText,
        prevResult,
        experienceText,
        prevExperienceText,
    }: AnalyzeJDParams, onEvent?: (event: AnalyzeStreamEvent) => void) {
        const payload = {
            text,
            resume_text: resumeText,
            prev_result: prevResult,
            experience_text: experienceText,
            prev_experience_text: prevExperienceText,
        };
        return streamAnalyzeRequest('/api/analyze-jd/stream', JSON.stringify(payload), {
            onEvent,
            contentType: 'application/json',
        });
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
                resume_id: data.resumeId,
                signature: data.signature,
            }
        );
        return response.data;
    },

    async generateBossGreetingStream(
        data: GenerateBossGreetingParams,
        onEvent?: (event: BossGreetingStreamEvent) => void
    ) {
        const payload = {
            jd_text: data.jdText,
            analysis_summary: data.analysisSummary,
            job_title: data.jobTitle,
            company: data.company,
            resume_text: data.resumeText,
            resume_id: data.resumeId,
            signature: data.signature,
        };
        return streamBossGreetingRequest(payload, { onEvent });
    },

    async generatePersonalSummaryStream(
        data: GeneratePersonalSummaryParams,
        onEvent?: (event: PersonalSummaryStreamEvent) => void
    ) {
        const payload = {
            mode: data.mode,
            profile: data.profile ?? {},
            work_experiences: data.workExperiences ?? [],
            project_experiences: data.projectExperiences ?? [],
            education_experiences: data.educationExperiences ?? [],
            certifications: data.certifications ?? [],
            skills: data.skills ?? [],
            ...(data.jdText ? { jd_text: data.jdText } : {}),
        };
        return streamPersonalSummaryRequest(payload, { onEvent });
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
    }: AnalyzeJDWithAttachmentParams, onEvent?: (event: AnalyzeStreamEvent) => void): Promise<JDAnalysisResult> {
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
        return streamAnalyzeRequest('/api/analyze-jd-attachment/stream', formData, {
            onEvent,
            contentType: null,
        });
    },
};
