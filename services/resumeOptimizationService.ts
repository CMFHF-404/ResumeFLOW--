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
]);

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
  const stringDetail = typeof data?.detail === 'string' ? data.detail.trim() : '';
  const code = typeof publicError?.code === 'string' && publicError.code.trim()
    ? publicError.code.trim()
    : `resume_optimization_http_${status}`;
  const message = typeof publicError?.message === 'string' && publicError.message.trim()
    ? publicError.message.trim()
    : stringDetail
      || (error instanceof Error && error.message.trim()
        ? error.message.trim()
        : '简历优化请求失败，请稍后重试。');
  const requestId = typeof publicError?.requestId === 'string' && publicError.requestId.trim()
    ? publicError.requestId.trim()
    : undefined;
  const explicitRetryable = typeof publicError?.retryable === 'boolean'
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
    return new ResumeOptimizationServiceError(error.message, {
      code: error.code,
      statusCode: error.statusCode,
      retryable: error.retryable,
      requestId: error.requestId,
      cause: error,
    });
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
    error instanceof Error && error.message.trim()
      ? error.message
      : '简历优化请求失败，请稍后重试。',
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
    payload: ResumeOptimizationTimestampInput,
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

  async revert(
    runId: string,
    payload: ResumeOptimizationTimestampInput,
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
