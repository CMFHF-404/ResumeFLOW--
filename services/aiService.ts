import apiClient from './apiClient';
import { normalizeJDAnalysisResult } from './aiNormalizeUtils';
import { postStreamRequest } from './aiStreamUtils';
import type { MatchScoreEntry } from '../types/analysis';
import type {
    AssistantDraftCard,
    JDAnalysisResult,
    PolishMode,
    RawJDAnalysisResult,
} from '../types/ai';
import type { ExperienceCategory } from './experienceService';
import type { ResumeAISnapshot } from '../utils/resumeHelpers';

export type {
    AssistantCertificationDraft,
    AssistantDraftCard,
    AssistantDraftCardType,
    AssistantExperienceDraft,
    AssistantSkillDraftGroup,
    ExperienceEvidenceDiagnosis,
    JDCapabilityAnalysis,
    JDAnalysisResult,
    JDCoreCapability,
    JDInterpretation,
    PolishMode,
} from '../types/ai';

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

export interface SplitExperienceTextResponse {
    s: string;
    t: string;
    a: string;
    r: string;
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

export type AssistantMode = 'general' | 'experience' | 'certification' | 'skill';
export type AssistantSkillId = 'star_guidance' | 'experience_completion' | 'mock_interview';
export type AssistantEntrySource = 'direct' | 'experience_bank' | 'resume_editor';
export type AssistantMessageType = 'user_text' | 'assistant_text' | 'draft_card';
export const MAX_ASSISTANT_SELECTED_EXPERIENCES = 20;

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

export interface AssistantDraftApplyNavigation {
    targetView: 'experience_bank' | 'resume_editor';
    targetId?: string | null;
    resumeId?: string | null;
    category?: ExperienceCategory | null;
}

export interface AssistantMessageApplyResponse {
    message: AssistantMessage;
    navigation?: AssistantDraftApplyNavigation | null;
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

export interface AssistantSelectedResumeSelection {
    mode: 'all' | 'subset';
    experienceIds: string[];
    moduleIds?: string[];
}

export interface AssistantSelectedResume {
    resumeId: string;
    masterId?: string;
    resumeName: string;
    snapshot: ResumeAISnapshot;
    jdContext?: string;
    contextSource?: 'implicit_current_resume' | 'explicit_resume_picker' | 'history_replay';
    selection?: AssistantSelectedResumeSelection;
}

export interface AssistantSuggestedFollowup {
    label: string;
    prompt: string;
    skillId: AssistantSkillId;
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
    suggestedFollowups?: AssistantSuggestedFollowup[];
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

type AssistantDeltaEvent = {
    type: 'assistant_delta';
    delta?: string;
    text?: string;
};

type AssistantTextResetEvent = {
    type: 'assistant_text_reset';
};

type AssistantErrorEvent = {
    type: 'error';
    message?: string;
};

export type AssistantStreamEvent =
    | AssistantProgressEvent
    | AIThoughtEvent
    | AIThoughtResetEvent
    | AIThoughtStatusEvent
    | AssistantDeltaEvent
    | AssistantTextResetEvent
    | AssistantFinalEvent
    | AssistantErrorEvent;

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

export type AIThoughtResetEvent = {
    type: 'thought_reset';
};

export type AIThoughtStatusEvent = {
    type: 'thought_status';
    status?: 'fallback' | 'hidden';
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
    | AIThoughtResetEvent
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

const streamAnalyzeRequest = async (
    path: string,
    body: BodyInit,
    options: {
        onEvent?: (event: AnalyzeStreamEvent) => void;
        onProgress?: (event: AnalyzeProgressEvent) => void;
        contentType?: string | null;
        signal?: AbortSignal;
    } = {}
): Promise<JDAnalysisResult> => {
    return postStreamRequest<AnalyzeStreamEvent, JDAnalysisResult>({
        path,
        body,
        contentType: options.contentType,
        onEvent: options.onEvent,
        signal: options.signal,
        onParsedEvent: (parsed) => {
            if (parsed.type === 'progress') {
                options.onProgress?.(parsed);
            }
        },
        getFinalResult: (parsed) => {
            if (parsed.type === 'final') {
                return normalizeJDAnalysisResult(parsed.result);
            }
            return null;
        },
    });
};

const streamPolishRequest = async (
    payload: Record<string, unknown>,
    options: {
        onEvent?: (event: PolishStreamEvent) => void;
        signal?: AbortSignal;
    } = {}
): Promise<PolishExperienceResponse> => {
    return postStreamRequest<PolishStreamEvent, PolishExperienceResponse>({
        path: '/api/polish-text/stream',
        body: JSON.stringify(payload),
        contentType: 'application/json',
        onEvent: options.onEvent,
        signal: options.signal,
        getFinalResult: (parsed) => {
            if (parsed.type === 'final') {
                return parsed.result;
            }
            return null;
        },
    });
};

const streamBossGreetingRequest = async (
    payload: Record<string, unknown>,
    options: {
        onEvent?: (event: BossGreetingStreamEvent) => void;
    } = {}
): Promise<GenerateBossGreetingResponse> => {
    const finalResult = await postStreamRequest<BossGreetingStreamEvent, GenerateBossGreetingResponse>({
        path: '/api/generate-boss-greeting/stream',
        body: JSON.stringify(payload),
        contentType: 'application/json',
        onEvent: options.onEvent,
        getFinalResult: (parsed) => {
            if (parsed.type === 'final') {
                return parsed.result;
            }
            return null;
        },
    });
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
    const finalResult = await postStreamRequest<PersonalSummaryStreamEvent, GeneratePersonalSummaryResponse>({
        path: '/api/generate-personal-summary/stream',
        body: JSON.stringify(payload),
        contentType: 'application/json',
        onEvent: options.onEvent,
        getFinalResult: (parsed) => {
            if (parsed.type === 'final') {
                return parsed.result;
            }
            return null;
        },
    });
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
    return postStreamRequest<AssistantStreamEvent, AssistantTurnResult>({
        path: `/api/assistant/sessions/${sessionId}/stream`,
        body,
        contentType: options.contentType,
        onEvent: options.onEvent,
        getFinalResult: (parsed) => {
            if (parsed.type === 'final') {
                return parsed.result;
            }
            return null;
        },
    });
};

const applyAssistantMessageDraftRequest = async (
    sessionId: string,
    messageId: string,
    options?: { skipApply?: boolean },
) => {
    const query = options?.skipApply ? '?skip_apply=true' : '';
    const response = await apiClient.post<AssistantMessageApplyResponse>(
        `/api/assistant/sessions/${sessionId}/messages/${messageId}/apply${query}`
    );
    return response.data;
};

export const aiService = {
    async splitExperienceText(data: {
        rawText: string;
        category: ExperienceCategory;
        org?: string;
        title?: string;
    }) {
        const response = await apiClient.post<SplitExperienceTextResponse>(
            '/api/split-experience-text',
            {
                raw_text: data.rawText,
                category: data.category,
                org: data.org,
                title: data.title,
            }
        );
        return response.data;
    },

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
        onEvent?: (event: PolishStreamEvent) => void,
        signal?: AbortSignal
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
        return streamPolishRequest(payload, { onEvent, signal });
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
        const response = await applyAssistantMessageDraftRequest(sessionId, messageId, options);
        return response.message;
    },

    async applyAssistantMessageDraft(
        sessionId: string,
        messageId: string,
        options?: { skipApply?: boolean },
    ) {
        return applyAssistantMessageDraftRequest(sessionId, messageId, options);
    },

    async sendAssistantMessage(
        sessionId: string,
        payload: {
            userMessage: string;
            displayMessage?: string;
            mode?: AssistantMode;
            skillId?: AssistantSkillId | null;
            enableThinking?: boolean;
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
            formData.append('enable_thinking', payload.enableThinking ? 'true' : 'false');
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
            enable_thinking: Boolean(payload.enableThinking),
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
    }: AnalyzeJDParams, onEvent?: (event: AnalyzeStreamEvent) => void, signal?: AbortSignal) {
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
            signal,
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
    }: AnalyzeJDWithAttachmentParams, onEvent?: (event: AnalyzeStreamEvent) => void, signal?: AbortSignal): Promise<JDAnalysisResult> {
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
            signal,
        });
    },
};
