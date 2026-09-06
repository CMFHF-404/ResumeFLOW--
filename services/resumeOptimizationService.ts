import apiClient from './apiClient';
import {
  postStreamRequest,
  StreamRequestError,
  type StreamEventBase,
} from './aiStreamUtils';
import { recordKnownResumeUpdatedAt } from './resumeService';
import {
  canonicalizeResumeOptimizationTimestamp,
  canonicalizeResumeOptimizationUuid,
  normalizeResumeOptimizationApplyResponse,
  normalizeResumeOptimizationFinalizeResponse,
  normalizeResumeOptimizationRevertResponse,
  normalizeResumeOptimizationRun,
  normalizeResumeOptimizationStreamEvent,
  ResumeOptimizationNormalizationError,
} from '../utils/resumeOptimizationNormalize.mjs';
import type {
  ResumeOptimizationAnswersInput,
  ResumeOptimizationApplyInput,
  ResumeOptimizationApplyResponse,
  ResumeOptimizationFinalizeResponse,
  ResumeOptimizationRequestOptions,
  ResumeOptimizationRevertResponse,
  ResumeOptimizationRun,
  ResumeOptimizationStartInput,
  ResumeOptimizationStartOptions,
  ResumeOptimizationStreamEvent,
  ResumeOptimizationStreamOptions,
  ResumeOptimizationTimestampInput,
} from '../types/resumeOptimization';

type HttpErrorMetadata = {
  code: string;
  message: string;
  statusCode: number;
  retryable: boolean;
  requestId?: string;
};

type RawStreamEvent = StreamEventBase & {
  node?: unknown;
  title?: unknown;
  result?: unknown;
  code?: unknown;
  requestId?: unknown;
  statusCode?: unknown;
  retryable?: unknown;
};

const RETRYABLE_ERROR_CODES = new Set([
  'ai_provider_unavailable',
  'ai_runtime_timeout',
  'resume_optimization_answer_in_progress',
  'resume_optimization_answer_claim_lost',
  'resume_optimization_planning_claim_lost',
  'resume_optimization_evaluation_pending',
  'resume_optimization_rescore_in_progress',
  'resume_optimization_rescore_claim_lost',
]);

const DEFAULT_RESUME_OPTIMIZATION_ERROR_MESSAGE = '简历优化请求失败，请稍后重试。';

const SAFE_PUBLIC_ERROR_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  resume_optimization_run_not_found: '未找到该简历优化记录。',
  resume_optimization_idempotency_conflict: '该幂等键已用于不同的优化请求。',
  resume_optimization_idempotency_key_required: '缺少 Idempotency-Key 请求头。',
  resume_optimization_idempotency_key_invalid: 'Idempotency-Key 格式无效。',
  invalid_optimization_transition: '当前优化状态不允许执行此操作。',
  resume_optimization_context_error: '无法准备简历优化上下文。',
  resume_optimization_context_request_invalid: '简历优化请求无效。',
  resume_optimization_context_not_found: '未找到待优化的简历。',
  resume_optimization_context_stale: '简历内容或六维评估已更新，请重新生成优化方案。',
  resume_optimization_evaluation_invalid: '当前六维评估不可用于优化。',
  resume_optimization_selection_invalid: '当前简历经历选择不可用于优化。',
  resume_optimization_answers_invalid: '补充信息与当前优化问题不匹配，请刷新后重试。',
  resume_optimization_answer_in_progress: '补充信息正在处理中，请稍后重试。',
  resume_optimization_answer_claim_lost: '本次补充处理已失效，请刷新优化方案后重试。',
  resume_optimization_planning_claim_lost: '本次优化规划已失效，请刷新后重试。',
  resume_optimization_plan_invalid: 'AI 返回的优化结果结构异常，请重试。',
  resume_optimization_run_invalid: '简历优化记录数据异常，请重新生成优化方案。',
  resume_optimization_apply_invalid: '优化方案或应用选择无效，请刷新后重试。',
  resume_optimization_apply_conflict: '当前优化方案状态不允许再次应用。',
  resume_optimization_evaluation_pending: '复评结果尚未就绪或已过期，请重新生成六维评估后重试。',
  resume_optimization_rescore_in_progress: '该优化记录正在复评，请稍后刷新。',
  resume_optimization_rescore_claim_lost: '本次复评租约已失效，请刷新后重试。',
  resume_optimization_content_conflict: '简历内容已在优化后发生变化，请刷新后再操作。',
  ai_runtime_budget_exceeded: 'AI 请求或响应超过安全处理上限，请缩短内容后重试。',
  ai_runtime_timeout: 'AI 请求处理超时，请稍后重试。',
  ai_usage_accounting_failed: 'AI 用量记录失败，请稍后重试。',
  ai_stream_consumer_failed: 'AI 流式响应传递失败，请稍后重试。',
  ai_usage_payload_invalid: 'AI 服务返回了无效的用量数据，请稍后重试。',
  ai_provider_invalid_response: 'AI 返回的优化结果结构异常，请重试。',
  ai_provider_unavailable: 'AI provider is temporarily unavailable. Please retry.',
  ai_token_quota_exhausted: 'AI Token 额度已用完，请购买套餐或兑换卡密后继续使用。',
  auth_dependency_unavailable: '认证服务暂时不可用',
  internal_error: DEFAULT_RESUME_OPTIMIZATION_ERROR_MESSAGE,
});

const readSafePublicError = (
  value: unknown,
): { code: string; message: string } | null => {
  if (typeof value !== 'string') return null;
  const code = value.trim();
  if (!code) return null;
  const message = SAFE_PUBLIC_ERROR_MESSAGES[code];
  return typeof message === 'string' ? { code, message } : null;
};

export class ResumeOptimizationServiceError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly retryable: boolean;
  readonly requestId?: string;

  constructor(
    message: string,
    {
      code = 'resume_optimization_request_failed',
      statusCode = 500,
      retryable = false,
      requestId,
      cause,
    }: {
      code?: string;
      statusCode?: number;
      retryable?: boolean;
      requestId?: string;
      cause?: unknown;
    } = {},
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ResumeOptimizationServiceError';
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
    this.requestId = requestId;
  }
}

export const isResumeOptimizationServiceError = (
  error: unknown,
): error is ResumeOptimizationServiceError => (
  error instanceof ResumeOptimizationServiceError
);

const isPassThroughOperationError = (error: unknown): error is Error => (
  error instanceof Error
  && (
    [
      'AbortError',
      'CanceledError',
      'AuthContextChangedError',
      'ResumeAuthContextChangedError',
    ].includes(error.name)
    || (error as Error & { code?: unknown }).code === 'ERR_CANCELED'
  )
);

const toRecord = (value: unknown): Record<string, unknown> | null => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const readHttpErrorMetadata = (error: unknown): HttpErrorMetadata | null => {
  const errorRecord = toRecord(error);
  const response = toRecord(errorRecord?.response);
  const status = response?.status;
  if (!Number.isInteger(status)) return null;
  const data = toRecord(response?.data);
  const detail = toRecord(data?.detail);
  const publicError = toRecord(data?.error) ?? toRecord(detail?.error) ?? detail;
  const safeError = readSafePublicError(publicError?.code);
  const code = safeError?.code ?? 'resume_optimization_request_failed';
  const message = safeError?.message ?? DEFAULT_RESUME_OPTIMIZATION_ERROR_MESSAGE;
  const requestId = safeError
    && typeof publicError?.requestId === 'string'
    && publicError.requestId.trim()
    ? publicError.requestId.trim()
    : undefined;
  const explicitRetryable = safeError && typeof publicError?.retryable === 'boolean'
    ? publicError.retryable
    : undefined;
  return {
    code,
    message,
    statusCode: status as number,
    retryable: explicitRetryable
      ?? (RETRYABLE_ERROR_CODES.has(code) || status === 503 || status === 504),
    requestId,
  };
};

const toServiceError = (error: unknown): Error => {
  if (isPassThroughOperationError(error) || error instanceof ResumeOptimizationServiceError) {
    return error;
  }
  if (error instanceof StreamRequestError) {
    const safeError = readSafePublicError(error.code);
    return new ResumeOptimizationServiceError(
      safeError?.message ?? DEFAULT_RESUME_OPTIMIZATION_ERROR_MESSAGE,
      {
      code: safeError?.code ?? 'resume_optimization_request_failed',
      statusCode: error.statusCode,
      retryable: error.retryable,
      requestId: safeError ? error.requestId : undefined,
      cause: error,
      },
    );
  }
  const http = readHttpErrorMetadata(error);
  if (http) {
    return new ResumeOptimizationServiceError(http.message, {
      ...http,
      cause: error,
    });
  }
  if (
    error instanceof ResumeOptimizationNormalizationError
    || (error instanceof Error && error.name === 'ResumeOptimizationNormalizationError')
  ) {
    return new ResumeOptimizationServiceError('简历优化响应结构无效，请刷新后重试。', {
      code: 'resume_optimization_response_invalid',
      statusCode: 500,
      retryable: false,
      cause: error,
    });
  }
  return new ResumeOptimizationServiceError(
    DEFAULT_RESUME_OPTIMIZATION_ERROR_MESSAGE,
    { cause: error },
  );
};

const requiredText = (value: unknown, fieldName: string): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ResumeOptimizationServiceError(`${fieldName} 不能为空。`, {
      code: 'resume_optimization_request_invalid',
      statusCode: 400,
    });
  }
  return value.trim();
};

const uniqueIds = (
  value: unknown,
  fieldName: string,
  { allowEmpty = true }: { allowEmpty?: boolean } = {},
): string[] => {
  if (!Array.isArray(value)) {
    throw new ResumeOptimizationServiceError(`${fieldName} 必须是数组。`, {
      code: 'resume_optimization_request_invalid',
      statusCode: 400,
    });
  }
  const resolved = value.map((item) => requiredText(item, fieldName));
  if ((!allowEmpty && resolved.length === 0) || new Set(resolved).size !== resolved.length) {
    throw new ResumeOptimizationServiceError(`${fieldName} 无效或包含重复项。`, {
      code: 'resume_optimization_request_invalid',
      statusCode: 400,
    });
  }
  return resolved;
};

const canonicalUuid = (value: string, fieldName: string): string => {
  try {
    return canonicalizeResumeOptimizationUuid(value, fieldName) as string;
  } catch (error) {
    throw new ResumeOptimizationServiceError(`${fieldName} 格式无效。`, {
      code: 'resume_optimization_request_invalid',
      statusCode: 400,
      cause: error,
    });
  }
};

const canonicalTimestamp = (value: string, fieldName: string): string => {
  try {
    return canonicalizeResumeOptimizationTimestamp(value, fieldName) as string;
  } catch (error) {
    throw new ResumeOptimizationServiceError(`${fieldName} 格式无效。`, {
      code: 'resume_optimization_request_invalid',
      statusCode: 400,
      cause: error,
    });
  }
};

const normalizeRun = (value: unknown): ResumeOptimizationRun => {
  try {
    return normalizeResumeOptimizationRun(value) as ResumeOptimizationRun;
  } catch (error) {
    throw toServiceError(error);
  }
};

const streamRun = async (
  path: string,
  body: Record<string, unknown>,
  options: ResumeOptimizationStreamOptions,
  headers?: HeadersInit,
): Promise<ResumeOptimizationRun> => {
  try {
    return await postStreamRequest<RawStreamEvent, ResumeOptimizationRun>({
      path,
      body: JSON.stringify(body),
      contentType: 'application/json',
      headers,
      signal: options.signal,
      expectedAuthCacheKey: options.expectedAuthCacheKey,
      onParsedEvent: (rawEvent) => {
        const event = normalizeResumeOptimizationStreamEvent(
          rawEvent,
        ) as ResumeOptimizationStreamEvent;
        options.onEvent?.(event);
      },
      getFinalResult: (rawEvent) => (
        rawEvent.type === 'final' ? normalizeRun(rawEvent.result) : null
      ),
    });
  } catch (error) {
    throw toServiceError(error);
  }
};

const requestConfig = (options: ResumeOptimizationRequestOptions = {}) => ({
  signal: options.signal,
  expectedAuthCacheKey: options.expectedAuthCacheKey,
});

export const createResumeOptimizationIdempotencyKey = (): string => {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new ResumeOptimizationServiceError('当前浏览器无法生成安全的请求标识。', {
      code: 'resume_optimization_idempotency_unavailable',
      statusCode: 500,
    });
  }
  return canonicalUuid(globalThis.crypto.randomUUID(), 'Idempotency-Key');
};

export const resumeOptimizationService = {
  async start(
    payload: ResumeOptimizationStartInput,
    options: ResumeOptimizationStartOptions,
  ): Promise<ResumeOptimizationRun> {
    const resumeId = canonicalUuid(payload.resumeId, 'resumeId');
    const idempotencyKey = canonicalUuid(options?.idempotencyKey, 'Idempotency-Key');
    return streamRun(
      '/api/resume-optimizations/stream',
      {
        resume_id: resumeId,
        evaluation_signature: requiredText(
          payload.evaluationSignature,
          'evaluationSignature',
        ),
        expected_resume_updated_at: canonicalTimestamp(
          payload.expectedResumeUpdatedAt,
          'expectedResumeUpdatedAt',
        ),
        include_bank_suggestions: payload.includeBankSuggestions ?? true,
      },
      options,
      { 'Idempotency-Key': idempotencyKey },
    );
  },

  async answer(
    runId: string,
    payload: ResumeOptimizationAnswersInput,
    options: ResumeOptimizationStreamOptions = {},
  ): Promise<ResumeOptimizationRun> {
    const canonicalRunId = canonicalUuid(runId, 'runId');
    if (!Array.isArray(payload.answers) || payload.answers.length > 5) {
      throw new ResumeOptimizationServiceError('补充回答数量无效。', {
        code: 'resume_optimization_answers_invalid',
        statusCode: 400,
      });
    }
    const questionIds = uniqueIds(
      payload.answers.map((answer) => answer.questionId),
      'questionId',
    );
    const answers = payload.answers.map((answer, index) => {
      const state = answer.state;
      if (!['answered', 'no_data', 'unknown', 'not_my_work', 'skipped'].includes(state)) {
        throw new ResumeOptimizationServiceError('补充回答状态无效。', {
          code: 'resume_optimization_answers_invalid',
          statusCode: 400,
        });
      }
      if (typeof answer.value !== 'string' || (state === 'answered' && !answer.value.trim())) {
        throw new ResumeOptimizationServiceError('已回答的问题必须包含内容。', {
          code: 'resume_optimization_answers_invalid',
          statusCode: 400,
        });
      }
      return {
        question_id: questionIds[index],
        state,
        value: answer.value,
      };
    });
    return streamRun(
      `/api/resume-optimizations/${encodeURIComponent(canonicalRunId)}/answers/stream`,
      { answers },
      options,
    );
  },

  async get(
    runId: string,
    options: ResumeOptimizationRequestOptions = {},
  ): Promise<ResumeOptimizationRun> {
    const canonicalRunId = canonicalUuid(runId, 'runId');
    try {
      const response = await apiClient.get(
        `/api/resume-optimizations/${encodeURIComponent(canonicalRunId)}`,
        requestConfig(options),
      );
      return normalizeRun(response.data);
    } catch (error) {
      throw toServiceError(error);
    }
  },

  async getLatest(
    resumeId: string,
    options: ResumeOptimizationRequestOptions = {},
  ): Promise<ResumeOptimizationRun | null> {
    const canonicalResumeId = canonicalUuid(resumeId, 'resumeId');
    try {
      const response = await apiClient.get(
        '/api/resume-optimizations/latest',
        {
          ...requestConfig(options),
          params: { resume_id: canonicalResumeId },
        },
      );
      return normalizeRun(response.data);
    } catch (error) {
      const http = readHttpErrorMetadata(error);
      if (
        http?.statusCode === 404
        && http.code === 'resume_optimization_run_not_found'
      ) {
        return null;
      }
      throw toServiceError(error);
    }
  },

  async apply(
    runId: string,
    payload: ResumeOptimizationApplyInput,
    options: ResumeOptimizationRequestOptions = {},
  ): Promise<ResumeOptimizationApplyResponse> {
    const canonicalRunId = canonicalUuid(runId, 'runId');
    const acceptedChangeIds = uniqueIds(
      payload.acceptedChangeIds,
      'acceptedChangeIds',
      { allowEmpty: false },
    );
    try {
      const response = await apiClient.post(
        `/api/resume-optimizations/${encodeURIComponent(canonicalRunId)}/apply`,
        {
          accepted_change_ids: acceptedChangeIds,
          expected_resume_updated_at: canonicalTimestamp(
            payload.expectedResumeUpdatedAt,
            'expectedResumeUpdatedAt',
          ),
        },
        requestConfig(options),
      );
      const result = normalizeResumeOptimizationApplyResponse(
        response.data,
      ) as ResumeOptimizationApplyResponse;
      recordKnownResumeUpdatedAt(
        result.run.resumeId,
        result.resumeUpdatedAt,
        { mutationSuccess: true },
      );
      return result;
    } catch (error) {
      throw toServiceError(error);
    }
  },

  async finalize(
    runId: string,
    payload: ResumeOptimizationTimestampInput & { claimId: string },
    options: ResumeOptimizationRequestOptions = {},
  ): Promise<ResumeOptimizationFinalizeResponse> {
    const canonicalRunId = canonicalUuid(runId, 'runId');
    try {
      const response = await apiClient.post(
        `/api/resume-optimizations/${encodeURIComponent(canonicalRunId)}/finalize`,
        {
          expected_resume_updated_at: canonicalTimestamp(
            payload.expectedResumeUpdatedAt,
            'expectedResumeUpdatedAt',
          ),
          claim_id: canonicalUuid(payload.claimId, 'claimId'),
        },
        requestConfig(options),
      );
      return normalizeResumeOptimizationFinalizeResponse(
        response.data,
      ) as ResumeOptimizationFinalizeResponse;
    } catch (error) {
      throw toServiceError(error);
    }
  },

  async claimRescore(
    runId: string,
    payload: ResumeOptimizationTimestampInput & { claimId: string },
    options: ResumeOptimizationRequestOptions = {},
  ): Promise<ResumeOptimizationRun> {
    const canonicalRunId = canonicalUuid(runId, 'runId');
    try {
      const response = await apiClient.post(
        `/api/resume-optimizations/${encodeURIComponent(canonicalRunId)}/rescore-claim`,
        {
          claim_id: canonicalUuid(payload.claimId, 'claimId'),
          expected_resume_updated_at: canonicalTimestamp(
            payload.expectedResumeUpdatedAt,
            'expectedResumeUpdatedAt',
          ),
        },
        requestConfig(options),
      );
      return normalizeRun(response.data);
    } catch (error) {
      throw toServiceError(error);
    }
  },

  async revert(
    runId: string,
    payload: ResumeOptimizationTimestampInput & { claimId?: string },
    options: ResumeOptimizationRequestOptions = {},
  ): Promise<ResumeOptimizationRevertResponse> {
    const canonicalRunId = canonicalUuid(runId, 'runId');
    try {
      const response = await apiClient.post(
        `/api/resume-optimizations/${encodeURIComponent(canonicalRunId)}/revert`,
        {
          expected_resume_updated_at: canonicalTimestamp(
            payload.expectedResumeUpdatedAt,
            'expectedResumeUpdatedAt',
          ),
          ...(payload.claimId ? {
            claim_id: canonicalUuid(payload.claimId, 'claimId'),
          } : {}),
        },
        requestConfig(options),
      );
      const result = normalizeResumeOptimizationRevertResponse(
        response.data,
      ) as ResumeOptimizationRevertResponse;
      recordKnownResumeUpdatedAt(
        result.run.resumeId,
        result.resumeUpdatedAt,
        { mutationSuccess: true },
      );
      return result;
    } catch (error) {
      throw toServiceError(error);
    }
  },

  async cancel(
    runId: string,
    options: ResumeOptimizationRequestOptions = {},
  ): Promise<ResumeOptimizationRun> {
    const canonicalRunId = canonicalUuid(runId, 'runId');
    try {
      const response = await apiClient.post(
        `/api/resume-optimizations/${encodeURIComponent(canonicalRunId)}/cancel`,
        undefined,
        requestConfig(options),
      );
      return normalizeRun(response.data);
    } catch (error) {
      throw toServiceError(error);
    }
  },
};
