import apiClient, { getApiBaseUrl, getAuthorizationHeader } from './apiClient';
import { dispatchLoginRequired } from './authRedirect';
import type { MatchScoreEntry, MatchTrend } from '../types/analysis';
import type { ExperienceCategory } from './experienceService';
import type { ResumeAISnapshot } from '../utils/resumeHelpers';

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
    mode?: PolishMode;
    customPrompt?: string;
    entrySource?: 'experience_bank' | 'resume_editor';
}

export interface PolishExperienceResponse {
    s?: string;
    t?: string;
    a?: string;
    r?: string;
    recommendedRewriteMode?: 'rewrite_now' | 'ask_before_rewrite' | 'not_recommended_for_this_role';
    evidenceDiagnosis?: string;
    followUpQuestions?: string[];
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
    jdInterpretation?: JDInterpretation;
    capabilityAnalysis?: JDCapabilityAnalysis;
    experienceMatches?: MatchScoreEntry[];
    certificationMatches?: MatchScoreEntry[];
    skillMatches?: MatchScoreEntry[];
}

export interface JDCoreCapability {
    id: string;
    name: string;
    weight: number;
    jdEvidence: string;
    resumeEvidenceLevel: 0 | 1 | 2 | 3 | 4;
    resumeEvidenceSummary: string;
    risk: 'none' | 'weak_evidence' | 'keyword_only' | 'missing' | 'mispositioned';
    likelyUnwritten?: boolean;
    followUpQuestions: string[];
}

export interface ExperienceEvidenceDiagnosis {
    experienceId: string;
    currentPositioning: string;
    targetRolePositioning: string;
    provenCapabilities: string[];
    weakCapabilities: string[];
    unsupportedClaims: string[];
    missingButAskableEvidence: Array<{
        capability: string;
        question: string;
        exampleAnswerHint: string;
    }>;
    recommendedRewriteMode: 'rewrite_now' | 'ask_before_rewrite' | 'not_recommended_for_this_role';
}

export interface JDCapabilityAnalysis {
    roleFamily: string;
    coreCapabilities: JDCoreCapability[];
    overallEvidenceCompleteness: number;
    scoreConfidence: 'high' | 'medium' | 'low';
    scoreWarnings: string[];
    experienceDiagnoses: ExperienceEvidenceDiagnosis[];
}

export interface JDInterpretation {
    roleFamily: string;
    normalizedTitle: string;
    seniority: string;
    businessDomain?: string;
    roleIntent: string;
    coreResponsibilities: Array<{
        label: string;
        evidence: string;
        weight: 'high' | 'medium' | 'low';
    }>;
    mustHave: Array<{
        label: string;
        type: 'skill' | 'experience' | 'domain' | 'education' | 'tool' | 'other';
        evidence: string;
    }>;
    niceToHave: Array<{
        label: string;
        evidence: string;
    }>;
    hardFilters: Array<{
        label: string;
        evidence: string;
    }>;
    sameTypeJobStrategy: {
        recommendedTitles: Array<{
            title: string;
            reason: string;
            confidence: number;
        }>;
        searchQueries: Array<{
            label: string;
            query: string;
            includeKeywords: string[];
            excludeKeywords: string[];
        }>;
        avoidTitles: Array<{
            title: string;
            reason: string;
        }>;
    };
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

export type PolishMode = 'default' | 'highlight' | 'smart_complete' | 'shorten' | 'expand' | 'custom' | 'assistant';

export type AssistantMode = 'general' | 'experience' | 'certification' | 'skill';
export type AssistantSkillId = 'star_guidance' | 'experience_completion' | 'mock_interview';
export type AssistantEntrySource = 'direct' | 'experience_bank' | 'resume_editor';
export type AssistantMessageType = 'user_text' | 'assistant_text' | 'draft_card';
export type AssistantDraftCardType = 'experience' | 'certification' | 'skill_group';
export const MAX_ASSISTANT_SELECTED_EXPERIENCES = 20;

export interface AssistantExperienceDraft {
    category: 'work' | 'project' | 'education';
    org: string;
    title: string;
    startDate: string;
    endDate: string;
    isCurrent?: boolean;
    targetMasterId?: string | null;
    star: {
        s: string;
        t: string;
        a: string;
        r: string;
    };
}

export interface AssistantCertificationDraft {
    name: string;
    issuer: string;
    issueDate: string;
    expiryDate: string;
    credentialId: string;
    credentialUrl: string;
    description: string;
}

export interface AssistantSkillDraftGroup {
    category: string;
    skills: Array<{
        name: string;
        proficiency?: number | null;
    }>;
}

export type AssistantDraftCard =
    | {
        type: 'experience';
        status: 'draft_ready';
        summary?: string;
        data: AssistantExperienceDraft;
    }
    | {
        type: 'certification';
        status: 'draft_ready';
        summary?: string;
        data: AssistantCertificationDraft;
    }
    | {
        type: 'skill_group';
        status: 'draft_ready';
        summary?: string;
        data: AssistantSkillDraftGroup;
    };

export interface AssistantSession {
    id: string;
    user_id: string;
    title: string;
    mode: AssistantMode;
    entry_source: AssistantEntrySource;
    context_json: Record<string, unknown>;
    latest_preview: Record<string, unknown>;
    created_at: string;
    updated_at: string;
}

export interface AssistantMessage {
    id: string;
    role: 'user' | 'assistant';
    message_type: AssistantMessageType;
    content_json: Record<string, unknown>;
    created_at: string;
}

export interface AssistantMessageApplyResponse {
    message: AssistantMessage;
}

export interface AssistantSelectedExperience {
    masterId: string;
    category: ExperienceCategory;
    org: string;
    title: string;
    startDate: string;
    endDate: string;
    isCurrent: boolean;
    summary?: string;
    star?: {
        s?: string;
        t?: string;
        a?: string;
        r?: string;
    };
}

export interface AssistantSelectedResume {
    resumeId: string;
    masterId?: string;
    resumeName: string;
    snapshot: ResumeAISnapshot;
    jdContext?: string;
}

export interface AssistantSessionDetail {
    session: AssistantSession;
    messages: AssistantMessage[];
}

export interface AssistantSessionCreatePayload {
    mode?: AssistantMode;
    title?: string;
    entrySource?: AssistantEntrySource;
    contextJson?: Record<string, unknown>;
}

export interface AssistantEntryContext {
    mode?: AssistantMode;
    title?: string;
    entrySource?: AssistantEntrySource;
    contextJson?: Record<string, unknown>;
}

export interface AssistantTurnResult {
    assistantText: string;
    draftCard?: AssistantDraftCard | null;
    title?: string;
}

export type AssistantProgressNode =
    | 'read_attachment'
    | 'prepare_context'
    | 'request_ai'
    | 'persist_result';

export type AssistantProgressEvent = {
    type: 'progress';
    node: AssistantProgressNode;
    title?: string;
};

type AssistantFinalEvent = {
    type: 'final';
    result: AssistantTurnResult;
};

type AssistantErrorEvent = {
    type: 'error';
    message?: string;
};

export type AssistantStreamEvent =
    | AssistantProgressEvent
    | AIThoughtEvent
    | AssistantFinalEvent
    | AssistantErrorEvent;

type RawJDAnalysisResult = JDAnalysisResult & {
    extracted_jd_text?: unknown;
    jd_interpretation?: unknown;
    capability_analysis?: unknown;
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

const streamAssistantRequest = async (
    sessionId: string,
    body: BodyInit,
    options: {
        onEvent?: (event: AssistantStreamEvent) => void;
        contentType?: string | null;
    } = {}
): Promise<AssistantTurnResult> => {
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

    const response = await fetch(resolveApiUrl(`/api/assistant/sessions/${sessionId}/stream`), {
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
    let finalResult: AssistantTurnResult | null = null;

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
            let parsed: AssistantStreamEvent;
            try {
                parsed = JSON.parse(line) as AssistantStreamEvent;
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

const normalizeJDAnalysisResult = (result: RawJDAnalysisResult): JDAnalysisResult => {
    const extractedJdText = typeof result.extractedJdText === 'string'
        ? result.extractedJdText
        : typeof result.extracted_jd_text === 'string'
            ? result.extracted_jd_text
            : undefined;
    const jdInterpretation = result.jdInterpretation && typeof result.jdInterpretation === 'object'
        ? result.jdInterpretation
        : result.jd_interpretation && typeof result.jd_interpretation === 'object'
            ? (result.jd_interpretation as JDInterpretation)
            : undefined;
    const capabilityAnalysis = result.capabilityAnalysis && typeof result.capabilityAnalysis === 'object'
        ? result.capabilityAnalysis
        : result.capability_analysis && typeof result.capability_analysis === 'object'
            ? (result.capability_analysis as JDCapabilityAnalysis)
            : undefined;
    return {
        ...result,
        ...(extractedJdText ? { extractedJdText } : {}),
        ...(jdInterpretation ? { jdInterpretation } : {}),
        ...(capabilityAnalysis ? { capabilityAnalysis } : {}),
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
            ...(data.mode ? { mode: data.mode } : {}),
            ...(data.customPrompt ? { custom_prompt: data.customPrompt } : {}),
            ...(data.entrySource ? { entry_source: data.entrySource } : {}),
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
            ...(data.mode ? { mode: data.mode } : {}),
            ...(data.customPrompt ? { custom_prompt: data.customPrompt } : {}),
            ...(data.entrySource ? { entry_source: data.entrySource } : {}),
        };
        return streamPolishRequest(payload, { onEvent });
    },

    async listAssistantSessions() {
        const response = await apiClient.get<AssistantSession[]>('/api/assistant/sessions');
        return response.data;
    },

    async createAssistantSession(data: AssistantSessionCreatePayload) {
        const response = await apiClient.post<AssistantSession>('/api/assistant/sessions', {
            mode: data.mode ?? 'general',
            title: data.title,
            entry_source: data.entrySource ?? 'direct',
            context_json: data.contextJson ?? {},
        });
        return response.data;
    },

    async getAssistantSession(sessionId: string) {
        const response = await apiClient.get<AssistantSessionDetail>(`/api/assistant/sessions/${sessionId}`);
        return response.data;
    },

    async deleteAssistantSession(sessionId: string) {
        await apiClient.delete(`/api/assistant/sessions/${sessionId}`);
    },

    async updateAssistantSession(sessionId: string, data: { title?: string }) {
        const response = await apiClient.patch<AssistantSession>(`/api/assistant/sessions/${sessionId}`, data);
        return response.data;
    },

    async markAssistantMessageApplied(
        sessionId: string,
        messageId: string,
        options?: { skipApply?: boolean },
    ) {
        const query = options?.skipApply ? '?skip_apply=true' : '';
        const response = await apiClient.post<AssistantMessageApplyResponse>(`/api/assistant/sessions/${sessionId}/messages/${messageId}/apply${query}`);
        return response.data.message;
    },

    async sendAssistantMessage(
        sessionId: string,
        payload: {
            userMessage: string;
            displayMessage?: string;
            mode?: AssistantMode;
            skillId?: AssistantSkillId | null;
            attachments?: File[];
            selectedExperiences?: AssistantSelectedExperience[];
            selectedResume?: AssistantSelectedResume | null;
        },
        onEvent?: (event: AssistantStreamEvent) => void
    ) {
        if ((payload.attachments?.length ?? 0) > 0) {
            const formData = new FormData();
            formData.append('user_message', payload.userMessage);
            formData.append('display_message', payload.displayMessage ?? payload.userMessage);
            if (payload.mode) {
                formData.append('mode', payload.mode);
            }
            if (payload.skillId) {
                formData.append('skill_id', payload.skillId);
            }
            if (payload.selectedExperiences?.length) {
                formData.append('selected_experiences', JSON.stringify(payload.selectedExperiences));
            }
            if (payload.selectedResume) {
                formData.append('selected_resume', JSON.stringify(payload.selectedResume));
            }
            payload.attachments?.forEach((attachment) => {
                formData.append('files', attachment);
            });
            return streamAssistantRequest(sessionId, formData, {
                onEvent,
                contentType: null,
            });
        }

        return streamAssistantRequest(sessionId, JSON.stringify({
            user_message: payload.userMessage,
            display_message: payload.displayMessage ?? payload.userMessage,
            ...(payload.mode ? { mode: payload.mode } : {}),
            ...(payload.skillId ? { skill_id: payload.skillId } : {}),
            ...(payload.selectedExperiences?.length ? { selected_experiences: payload.selectedExperiences } : {}),
            ...(payload.selectedResume ? { selected_resume: payload.selectedResume } : {}),
        }), {
            onEvent,
            contentType: 'application/json',
        });
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
