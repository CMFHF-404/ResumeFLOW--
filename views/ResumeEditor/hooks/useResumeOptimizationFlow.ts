import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useAuthOwnerOperationGuard } from '../../../hooks/useAuthOwnerOperationGuard';
import type { ResumeEvaluationOutcome } from '../../../hooks/useResumeEvaluation';
import {
  createResumeOptimizationIdempotencyKey,
  isResumeOptimizationServiceError,
  resumeOptimizationService,
} from '../../../services/resumeOptimizationService';
import type { ResumeEvaluation } from '../../../types/ai';
import type {
  ResumeOptimizationAnswer,
  ResumeOptimizationAnswerState,
  ResumeOptimizationProgressNode,
  ResumeOptimizationRun,
  ResumeOptimizationStatus,
  ResumeOptimizationUiState,
} from '../../../types/resumeOptimization';
import { canonicalStringify } from '../../../utils/canonicalStringify';
import { canonicalizeResumeOptimizationTimestamp } from '../../../utils/resumeOptimizationNormalize.mjs';
import {
  toResumeOptimizationAnalyticsFailureCode,
  trackResumeOptimizationApplyResult,
  trackResumeOptimizationApplyStart,
  trackResumeOptimizationChangeToggle,
  trackResumeOptimizationPlanResult,
  trackResumeOptimizationPlanStart,
  trackResumeOptimizationQuestionsSubmit,
  trackResumeOptimizationRescoreResult,
  trackResumeOptimizationRevertResult,
} from '../../../utils/analyticsTracker';

export const TERMINAL_RESUME_OPTIMIZATION_STATUSES = new Set<ResumeOptimizationStatus>([
  'completed',
  'cancelled',
  'reverted',
]);

const RESUME_OPTIMIZATION_PROGRESS_TITLES: Record<ResumeOptimizationProgressNode, string> = {
  freeze_snapshot: '冻结当前简历版本',
  prepare_context: '整理六维问题与经历信息',
  plan_changes: '生成优化方案',
  verify_changes: '检查事实边界',
  persist_run: '保存优化方案',
  rewrite_answers: '根据补充信息更新方案',
};

export const resolveResumeOptimizationProgressTitle = (
  node: ResumeOptimizationProgressNode | null,
): string => node ? RESUME_OPTIMIZATION_PROGRESS_TITLES[node] : '正在准备优化方案…';

const ACTIVE_STREAM_UI_STATES = new Set<ResumeOptimizationUiState>([
  'starting',
  'answering',
]);

const summarizeResumeOptimizationPlan = (run: ResumeOptimizationRun) => {
  const plan = run.result ?? run.plan;
  return {
    beforeScore: run.sourceBeforeScore,
    directChangeCount: plan.changes.filter((change) => (
      change.safetyStatus === 'allowed'
      && change.actionKind === 'rewrite_now'
      && change.targetedValue !== null
    )).length,
    questionCount: plan.questions.length,
    blockedChangeCount: plan.changes.filter((change) => change.safetyStatus === 'blocked').length,
    bankSuggestionCount: plan.bankSuggestions.length,
  };
};

const summarizeResumeOptimizationAnswers = (answers: ResumeOptimizationAnswer[]) => ({
  questionCount: answers.length,
  answeredCount: answers.filter((answer) => answer.state === 'answered').length,
  noDataCount: answers.filter((answer) => answer.state === 'no_data').length,
  unknownCount: answers.filter((answer) => answer.state === 'unknown').length,
  notMyWorkCount: answers.filter((answer) => answer.state === 'not_my_work').length,
  skippedCount: answers.filter((answer) => answer.state === 'skipped').length,
});

type ResumeOptimizationSelectionSnapshot = {
  runId: string;
  acceptedChangeIds: string[];
};

const resumeOptimizationSelectionSnapshots = new Map<string, ResumeOptimizationSelectionSnapshot>();

const resumeOptimizationSelectionSnapshotKey = (
  authUserKey: string | null,
  resumeId: string | null,
) => authUserKey && resumeId ? JSON.stringify([authUserKey, resumeId]) : null;

export const saveResumeOptimizationSelectionSnapshot = (
  authUserKey: string | null,
  resumeId: string | null,
  runId: string,
  acceptedChangeIds: string[],
) => {
  const key = resumeOptimizationSelectionSnapshotKey(authUserKey, resumeId);
  if (!key || !runId) return;
  resumeOptimizationSelectionSnapshots.set(key, {
    runId,
    acceptedChangeIds: [...new Set(acceptedChangeIds)],
  });
};

export const readResumeOptimizationSelectionSnapshot = (
  authUserKey: string | null,
  resumeId: string | null,
  runId: string,
): string[] | null => {
  const key = resumeOptimizationSelectionSnapshotKey(authUserKey, resumeId);
  const snapshot = key ? resumeOptimizationSelectionSnapshots.get(key) : undefined;
  return snapshot?.runId === runId ? [...snapshot.acceptedChangeIds] : null;
};

export const clearResumeOptimizationSelectionSnapshot = (
  authUserKey: string | null,
  resumeId: string | null,
) => {
  const key = resumeOptimizationSelectionSnapshotKey(authUserKey, resumeId);
  if (key) resumeOptimizationSelectionSnapshots.delete(key);
};

type ResumeOptimizationStartAvailabilityInput = {
  enabled: boolean;
  authUserKey: string | null;
  resumeId: string | null;
  sourceResumeUpdatedAt: string | null | undefined;
  evaluationSignature: string;
  persistedEvaluationSignature: string | null;
  evaluation: ResumeEvaluation | null;
  isEvaluationOutdated: boolean;
  hasResumeVersionConflict: boolean;
  isEvaluationRunning: boolean;
  isPolishing: boolean;
  isAutoAssembling: boolean;
  isFlowBusy: boolean;
};

export const resolveResumeOptimizationRunUiState = (
  status: ResumeOptimizationStatus,
  automaticHydration = false,
): ResumeOptimizationUiState => {
  if (automaticHydration && TERMINAL_RESUME_OPTIMIZATION_STATUSES.has(status)) {
    return 'closed';
  }
  switch (status) {
    case 'planning':
      return 'starting';
    case 'awaiting_answers':
      return 'awaiting_answers';
    case 'preview_ready':
      return 'preview';
    case 'applying':
      return 'applying';
    case 'rescoring':
      return 'rescoring';
    case 'completed':
    case 'cancelled':
    case 'reverted':
      return 'completed';
    case 'stale':
      return 'stale';
    case 'applied':
    case 'failed':
      return 'error';
    default:
      return 'error';
  }
};

const effectivePlan = (
  run: Pick<ResumeOptimizationRun, 'plan' | 'result'>,
) => run.result ?? run.plan;

export const canonicalizeResumeOptimizationFlowTimestamp = (
  value: string | null | undefined,
): string | null => (
  value === null || value === undefined || !value.trim()
    ? null
    : canonicalizeResumeOptimizationTimestamp(value, 'resume optimization flow timestamp')
);

export const resumeOptimizationFlowTimestampsEqual = (
  left: string | null | undefined,
  right: string | null | undefined,
): boolean => {
  const canonicalLeft = canonicalizeResumeOptimizationFlowTimestamp(left);
  const canonicalRight = canonicalizeResumeOptimizationFlowTimestamp(right);
  return canonicalLeft !== null && canonicalLeft === canonicalRight;
};

export const isResumeOptimizationRunContextCurrent = (
  run: Pick<ResumeOptimizationRun, 'sourceResumeUpdatedAt' | 'sourceEvaluationSignature'>,
  sourceResumeUpdatedAt: string | null | undefined,
  evaluationSignature: string,
) => Boolean(
  sourceResumeUpdatedAt
  && resumeOptimizationFlowTimestampsEqual(run.sourceResumeUpdatedAt, sourceResumeUpdatedAt)
  && run.sourceEvaluationSignature === evaluationSignature,
);

export const isResumeOptimizationChangeSelectable = (
  change: Pick<
    ResumeOptimizationRun['plan']['changes'][number],
    'safetyStatus' | 'actionKind' | 'targetedValue'
  >,
): boolean => (
  change.safetyStatus === 'allowed'
  && (change.actionKind === 'rewrite_now' || change.actionKind === 'ask_user')
  && change.targetedValue !== null
);

export const filterResumeOptimizationSelectableChangeIds = (
  changes: ResumeOptimizationRun['plan']['changes'],
  changeIds: string[],
): string[] => {
  const selectable = new Set(
    changes.filter(isResumeOptimizationChangeSelectable).map((change) => change.changeId),
  );
  return [...new Set(changeIds)].filter((changeId) => selectable.has(changeId));
};

export type ResumeOptimizationApplyAttempt = {
  runId: string;
  acceptedChangeIds: string[];
  sourceResumeUpdatedAt: string;
  previewReadyConfirmations: number;
};

export const freezeResumeOptimizationApplyAttempt = (
  run: Pick<ResumeOptimizationRun, 'id' | 'sourceResumeUpdatedAt' | 'plan' | 'result'>,
  acceptedChangeIds: string[],
): ResumeOptimizationApplyAttempt | null => {
  const frozenIds = filterResumeOptimizationSelectableChangeIds(
    effectivePlan(run).changes,
    acceptedChangeIds,
  );
  return frozenIds.length > 0 ? {
    runId: run.id,
    acceptedChangeIds: [...frozenIds],
    sourceResumeUpdatedAt: run.sourceResumeUpdatedAt,
    previewReadyConfirmations: 0,
  } : null;
};

export const buildResumeOptimizationInitialAcceptedIds = (
  run: Pick<ResumeOptimizationRun, 'acceptedChangeIds' | 'plan' | 'result'>,
): string[] => {
  const plan = run.result ?? run.plan;
  const persisted = filterResumeOptimizationSelectableChangeIds(
    plan.changes,
    run.acceptedChangeIds,
  );
  if (persisted.length > 0) return persisted;
  return plan.changes
    .filter((change) => isResumeOptimizationChangeSelectable(change) && change.defaultSelected)
    .map((change) => change.changeId);
};

export const resolveResumeOptimizationStartAvailability = (
  input: ResumeOptimizationStartAvailabilityInput,
): { canStart: boolean; disabledReason: string | null } => {
  let disabledReason: string | null = null;
  if (!input.enabled) disabledReason = '简历优化功能暂未开放。';
  else if (!input.authUserKey || input.authUserKey === 'anonymous') disabledReason = '请先登录。';
  else if (!input.resumeId) disabledReason = '请先选择简历。';
  else if (!input.evaluation || !input.evaluationSignature.trim()) disabledReason = '请先生成最新六维报告。';
  else if (
    input.isEvaluationOutdated
    || input.persistedEvaluationSignature !== input.evaluationSignature
  ) disabledReason = '六维报告已过期，请重新生成。';
  else if (!input.sourceResumeUpdatedAt) disabledReason = '简历仍在加载，请稍候。';
  else if (input.hasResumeVersionConflict) disabledReason = '简历存在版本冲突，请先处理。';
  else if (input.isEvaluationRunning) disabledReason = '六维报告正在生成。';
  else if (input.isPolishing) disabledReason = '简历润色正在进行。';
  else if (input.isAutoAssembling) disabledReason = '智能排版正在进行。';
  else if (input.isFlowBusy) disabledReason = '简历优化正在进行。';
  return { canStart: disabledReason === null, disabledReason };
};

type ReloadResumeContextResult =
  | { status: 'success'; resumeId: string; context?: unknown }
  | { status: 'failed'; reason: string; error?: unknown };

type ToastPort = {
  success: (message: string) => unknown;
  error: (message: string) => unknown;
  info?: (message: string) => unknown;
};

type AnswerDraft = Pick<ResumeOptimizationAnswer, 'state' | 'value'>;
export type ResumeOptimizationAnswerDrafts = Record<string, AnswerDraft>;

const VALID_ANSWER_STATES = new Set<ResumeOptimizationAnswerState>([
  'answered',
  'no_data',
  'unknown',
  'not_my_work',
  'skipped',
]);

export type UseResumeOptimizationFlowOptions = {
  enabled: boolean;
  authUserKey: string | null;
  resumeId: string | null;
  sourceResumeUpdatedAt: string | null | undefined;
  evaluationSignature: string;
  evaluation: ResumeEvaluation | null;
  persistedEvaluationSignature: string | null;
  persistedEvaluation: ResumeEvaluation | null;
  isEvaluationOutdated: boolean;
  jdText: string;
  hasResumeVersionConflict: boolean;
  isEvaluationRunning: boolean;
  isPolishing: boolean;
  isAutoAssembling: boolean;
  reloadResumeContext: (resumeId?: string | null) => Promise<ReloadResumeContextResult>;
  generateEvaluation: () => Promise<ResumeEvaluationOutcome>;
  flushResumeConfig: () => Promise<string | undefined>;
  commitLatestResumeConfigIfNeeded: () => Promise<string | undefined>;
  toast: ToastPort;
  confirmCancelActiveRun?: () => boolean | Promise<boolean>;
};

type FlowOperation = Awaited<
  ReturnType<ReturnType<typeof useAuthOwnerOperationGuard>['beginOperation']>
>;

type SourceCommit = {
  resumeUpdatedAt: string;
  evaluationSignature: string;
};

type SourceWaiter = {
  generation: number;
  expectedResumeUpdatedAt: string;
  previousEvaluationSignature: string;
  minimumInputRevision: number;
  resolve: (commit: SourceCommit) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type EvaluationWaiter = {
  generation: number;
  evaluationSignature: string;
  evaluationReceipt: ResumeEvaluation;
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export const doesResumeOptimizationEvaluationReceiptMatch = (
  persistedEvaluationSignature: string | null,
  persistedEvaluation: ResumeEvaluation | null,
  expectedEvaluationSignature: string,
  evaluationReceipt: ResumeEvaluation,
) => Boolean(
  persistedEvaluation
  && persistedEvaluationSignature === expectedEvaluationSignature
  && canonicalStringify(persistedEvaluation) === canonicalStringify(evaluationReceipt)
);

export type ResumeOptimizationPostApplyCheckpoint = {
  runId: string;
  phase: 'needs_reload';
  appliedResumeUpdatedAt: string;
  previousEvaluationSignature: string;
} | {
  runId: string;
  phase: 'needs_evaluation';
  sourceEvaluationSignature: string;
} | {
  runId: string;
  phase: 'evaluation_ready';
  sourceEvaluationSignature: string;
  evaluationReceipt: ResumeEvaluation;
} | {
  runId: string;
  phase: 'report_committed';
  sourceEvaluationSignature: string;
  evaluationReceipt: ResumeEvaluation;
  committedResumeUpdatedAt: string;
};

const resumeOptimizationPostApplyCheckpoints = new Map<
  string,
  ResumeOptimizationPostApplyCheckpoint
>();

const cloneResumeOptimizationPostApplyCheckpoint = (
  checkpoint: ResumeOptimizationPostApplyCheckpoint,
): ResumeOptimizationPostApplyCheckpoint => ({ ...checkpoint });

export const saveResumeOptimizationPostApplyCheckpoint = (
  authUserKey: string | null,
  resumeId: string | null,
  checkpoint: ResumeOptimizationPostApplyCheckpoint,
) => {
  const key = resumeOptimizationSelectionSnapshotKey(authUserKey, resumeId);
  if (!key || !checkpoint.runId) return;
  resumeOptimizationPostApplyCheckpoints.set(
    key,
    cloneResumeOptimizationPostApplyCheckpoint(checkpoint),
  );
};

export const readResumeOptimizationPostApplyCheckpoint = (
  authUserKey: string | null,
  resumeId: string | null,
  runId: string,
): ResumeOptimizationPostApplyCheckpoint | null => {
  const key = resumeOptimizationSelectionSnapshotKey(authUserKey, resumeId);
  const checkpoint = key ? resumeOptimizationPostApplyCheckpoints.get(key) : undefined;
  return checkpoint?.runId === runId
    ? cloneResumeOptimizationPostApplyCheckpoint(checkpoint)
    : null;
};

export const clearResumeOptimizationPostApplyCheckpoint = (
  authUserKey: string | null,
  resumeId: string | null,
) => {
  const key = resumeOptimizationSelectionSnapshotKey(authUserKey, resumeId);
  if (key) resumeOptimizationPostApplyCheckpoints.delete(key);
};

const abortError = () => {
  const error = new Error('Resume optimization operation was aborted.');
  error.name = 'AbortError';
  return error;
};

const waitForResumeOptimizationApplyConfirmationBackoff = (
  signal: AbortSignal,
) => {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      reject(abortError());
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, 500);
    signal.addEventListener('abort', onAbort, { once: true });
  });
};

const isAbortLike = (error: unknown) => (
  error instanceof Error
  && ['AbortError', 'CanceledError', 'AuthContextChangedError', 'ResumeAuthContextChangedError']
    .includes(error.name)
);

const STALE_RESUME_OPTIMIZATION_ERROR_CODES = new Set([
  'resume_optimization_context_stale',
  'resume_optimization_content_conflict',
]);

const EVALUATION_PENDING_ERROR_CODE = 'resume_optimization_evaluation_pending';

const rawHttpStatus = (error: unknown): number | undefined => (
  typeof error === 'object'
  && error !== null
  && 'response' in error
  && typeof (error as { response?: { status?: unknown } }).response?.status === 'number'
    ? (error as { response: { status: number } }).response.status
    : undefined
);

const isResumeVersionConflictLike = (error: unknown) => {
  if (
    error instanceof Error
    && ['ResumeConfigMutationBarrierError', 'ResumeReloadConflictError'].includes(error.name)
  ) return true;
  if (isResumeOptimizationServiceError(error)) {
    return error.statusCode === 409
      && error.code !== EVALUATION_PENDING_ERROR_CODE
      && STALE_RESUME_OPTIMIZATION_ERROR_CODES.has(error.code);
  }
  return rawHttpStatus(error) === 409;
};

const isStaleOptimizationError = (error: unknown) => (
  isResumeVersionConflictLike(error)
);

const errorMessage = (error: unknown, fallback: string) => (
  error instanceof Error && error.message.trim() ? error.message : fallback
);

export const buildResumeOptimizationAnswerDrafts = (
  run: Pick<ResumeOptimizationRun, 'id' | 'answers' | 'plan' | 'result'>,
  previousRunId: string | null = null,
  previousDrafts: ResumeOptimizationAnswerDrafts = {},
): ResumeOptimizationAnswerDrafts => {
  const persisted = new Map(run.answers.map((answer) => [answer.questionId, answer]));
  return Object.fromEntries(effectivePlan(run).questions.map((question) => {
    const answer = persisted.get(question.questionId);
    const localDraft = previousRunId === run.id ? previousDrafts[question.questionId] : undefined;
    const validLocalDraft = localDraft
      && VALID_ANSWER_STATES.has(localDraft.state)
      && typeof localDraft.value === 'string'
      ? localDraft
      : undefined;
    return [question.questionId, {
      state: answer?.state ?? validLocalDraft?.state ?? 'answered',
      value: answer?.value ?? validLocalDraft?.value ?? '',
    }];
  }));
};

export const buildResumeOptimizationAnswerPayload = (
  run: Pick<ResumeOptimizationRun, 'answers' | 'plan' | 'result'>,
  drafts: ResumeOptimizationAnswerDrafts,
): ResumeOptimizationAnswer[] | null => {
  const questions = effectivePlan(run).questions;
  if (questions.length === 0 || questions.length > 5) return null;
  const questionIds = questions.map((question) => question.questionId);
  if (new Set(questionIds).size !== questionIds.length) return null;
  const persistedIds = run.answers.map((answer) => answer.questionId);
  if (new Set(persistedIds).size !== persistedIds.length) return null;
  const knownQuestionIds = new Set(questionIds);
  if (persistedIds.some((questionId) => !knownQuestionIds.has(questionId))) return null;
  const persisted = new Map(run.answers.map((answer) => [answer.questionId, answer]));
  const answers: ResumeOptimizationAnswer[] = [];
  for (const questionId of questionIds) {
    const authoritative = persisted.get(questionId);
    if (authoritative) {
      if (
        !VALID_ANSWER_STATES.has(authoritative.state)
        || typeof authoritative.value !== 'string'
        || (authoritative.state === 'answered' && !authoritative.value.trim())
      ) return null;
      answers.push({ ...authoritative });
      continue;
    }
    const draft = drafts[questionId];
    if (
      !draft
      || !VALID_ANSWER_STATES.has(draft.state)
      || typeof draft.value !== 'string'
      || (draft.state === 'answered' && !draft.value.trim())
    ) return null;
    answers.push({
      questionId,
      state: draft.state,
      value: draft.state === 'answered' ? draft.value : '',
    });
  }
  return answers;
};

export const useResumeOptimizationFlow = ({
  enabled,
  authUserKey,
  resumeId,
  sourceResumeUpdatedAt,
  evaluationSignature,
  evaluation,
  persistedEvaluationSignature,
  persistedEvaluation,
  isEvaluationOutdated,
  jdText,
  hasResumeVersionConflict,
  isEvaluationRunning,
  isPolishing,
  isAutoAssembling,
  reloadResumeContext,
  generateEvaluation,
  flushResumeConfig,
  commitLatestResumeConfigIfNeeded,
  toast,
  confirmCancelActiveRun = () => window.confirm('优化仍在进行，关闭将取消本次运行，是否继续？'),
}: UseResumeOptimizationFlowOptions) => {
  const canonicalSourceResumeUpdatedAt = canonicalizeResumeOptimizationFlowTimestamp(
    sourceResumeUpdatedAt,
  );
  const ownerGuard = useAuthOwnerOperationGuard(authUserKey);
  const [uiState, setUiState] = useState<ResumeOptimizationUiState>('closed');
  const [run, setRun] = useState<ResumeOptimizationRun | null>(null);
  const [progressText, setProgressText] = useState('');
  const [progressNode, setProgressNode] = useState<ResumeOptimizationProgressNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answerDrafts, setAnswerDrafts] = useState<ResumeOptimizationAnswerDrafts>({});
  const [isAnswerSubmissionFrozen, setIsAnswerSubmissionFrozen] = useState(false);
  const [acceptedChangeIds, setAcceptedChangeIds] = useState<string[]>([]);
  const [isHydrating, setIsHydrating] = useState(false);

  const controllerRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const activeRunIdRef = useRef<string | null>(null);
  const latestRunRef = useRef<ResumeOptimizationRun | null>(null);
  const frozenAnswerSubmissionRef = useRef<{
    runId: string;
    answers: ResumeOptimizationAnswer[];
  } | null>(null);
  const startAttemptRef = useRef<{
    resumeId: string;
    evaluationSignature: string;
    expectedResumeUpdatedAt: string;
    idempotencyKey: string;
  } | null>(null);
  const applyAttemptRef = useRef<ResumeOptimizationApplyAttempt | null>(null);
  const applyAnalyticsAttemptRef = useRef<{
    runId: string;
    resumeId: string;
    beforeScore: number | null;
    acceptedChangeCount: number;
    blockedChangeCount: number;
    bankSuggestionCount: number;
    startedAt: number;
    resultTracked: boolean;
  } | null>(null);
  const rescoreResultTrackedRunIdsRef = useRef(new Set<string>());
  const postApplyCheckpointRef = useRef<ResumeOptimizationPostApplyCheckpoint | null>(null);
  const sourceWaiterRef = useRef<SourceWaiter | null>(null);
  const evaluationWaiterRef = useRef<EvaluationWaiter | null>(null);

  const trackCompletedResumeOptimizationRescore = useCallback((
    completedRun: ResumeOptimizationRun,
    startedAt?: number,
  ) => {
    const postEvaluation = completedRun.postEvaluation;
    if (
      completedRun.status !== 'completed'
      || !postEvaluation
      || rescoreResultTrackedRunIdsRef.current.has(completedRun.id)
    ) return;
    rescoreResultTrackedRunIdsRef.current.add(completedRun.id);
    const planMetrics = summarizeResumeOptimizationPlan(completedRun);
    trackResumeOptimizationRescoreResult({
      resumeId: completedRun.resumeId,
      runId: completedRun.id,
      action: 'success',
      beforeScore: postEvaluation.beforeScore,
      afterScore: postEvaluation.afterScore,
      scoreDelta: postEvaluation.scoreDelta,
      acceptedChangeCount: completedRun.acceptedChangeIds.length,
      blockedChangeCount: planMetrics.blockedChangeCount,
      bankSuggestionCount: planMetrics.bankSuggestionCount,
      durationMs: startedAt === undefined ? undefined : Date.now() - startedAt,
    });
  }, []);
  const selfOwnedResumeTimestampsRef = useRef(new Set<string>());
  const selfOwnedResumeAndEvaluationTimestampsRef = useRef(new Set<string>());
  const latestToastRef = useRef(toast);
  const latestGenerateEvaluationRef = useRef(generateEvaluation);
  const latestFlushResumeConfigRef = useRef(flushResumeConfig);
  const commitLatestResumeConfigIfNeededRef = useRef(commitLatestResumeConfigIfNeeded);
  const latestInputsRef = useRef({
    authUserKey,
    resumeId,
    sourceResumeUpdatedAt: canonicalSourceResumeUpdatedAt,
    evaluationSignature,
    persistedEvaluationSignature,
    persistedEvaluation,
  });
  const latestInputsRevisionRef = useRef(0);
  const identityRef = useRef({
    authUserKey,
    resumeId,
    sourceResumeUpdatedAt: canonicalSourceResumeUpdatedAt,
    evaluationSignature,
  });

  const publishPostApplyCheckpoint = useCallback((
    checkpoint: ResumeOptimizationPostApplyCheckpoint,
  ) => {
    postApplyCheckpointRef.current = checkpoint;
    saveResumeOptimizationPostApplyCheckpoint(authUserKey, resumeId, checkpoint);
  }, [authUserKey, resumeId]);

  const clearPostApplyCheckpoint = useCallback(() => {
    postApplyCheckpointRef.current = null;
    clearResumeOptimizationPostApplyCheckpoint(authUserKey, resumeId);
  }, [authUserKey, resumeId]);

  const rejectPendingWaiters = useCallback((cause: Error) => {
    if (sourceWaiterRef.current) {
      clearTimeout(sourceWaiterRef.current.timeout);
      sourceWaiterRef.current.reject(cause);
      sourceWaiterRef.current = null;
    }
    if (evaluationWaiterRef.current) {
      clearTimeout(evaluationWaiterRef.current.timeout);
      evaluationWaiterRef.current.reject(cause);
      evaluationWaiterRef.current = null;
    }
  }, []);

  const invalidateGeneration = useCallback((clearVisibleRun: boolean, markStale = false) => {
    generationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    rejectPendingWaiters(abortError());
    selfOwnedResumeTimestampsRef.current.clear();
    selfOwnedResumeAndEvaluationTimestampsRef.current.clear();
    applyAnalyticsAttemptRef.current = null;
    setProgressText('');
    setProgressNode(null);
    if (clearVisibleRun) {
      setIsHydrating(false);
      activeRunIdRef.current = null;
      latestRunRef.current = null;
      frozenAnswerSubmissionRef.current = null;
      startAttemptRef.current = null;
      applyAttemptRef.current = null;
      rescoreResultTrackedRunIdsRef.current.clear();
      clearPostApplyCheckpoint();
      setRun(null);
      setAnswerDrafts({});
      setIsAnswerSubmissionFrozen(false);
      setAcceptedChangeIds([]);
      setError(null);
      setUiState('closed');
    } else if (markStale && latestRunRef.current) {
      startAttemptRef.current = null;
      applyAttemptRef.current = null;
      clearPostApplyCheckpoint();
      setError('简历或六维报告已变化，请重新生成优化方案。');
      setUiState('stale');
    } else if (markStale) {
      startAttemptRef.current = null;
      applyAttemptRef.current = null;
      clearPostApplyCheckpoint();
    }
  }, [clearPostApplyCheckpoint, rejectPendingWaiters]);

  const applyRunToState = useCallback((
    nextRun: ResumeOptimizationRun,
    automaticHydration = false,
    preserveLocalSelections = false,
  ) => {
    const previousRunId = latestRunRef.current?.id ?? null;
    const isSameRun = previousRunId === nextRun.id;
    const restoredCheckpoint = nextRun.status === 'applied'
      ? readResumeOptimizationPostApplyCheckpoint(authUserKey, resumeId, nextRun.id)
      : null;
    if (!isSameRun) {
      applyAttemptRef.current = null;
      postApplyCheckpointRef.current = restoredCheckpoint;
      if (!restoredCheckpoint) {
        clearResumeOptimizationPostApplyCheckpoint(authUserKey, resumeId);
      }
    }
    if (TERMINAL_RESUME_OPTIMIZATION_STATUSES.has(nextRun.status)) {
      applyAttemptRef.current = null;
      clearPostApplyCheckpoint();
    } else if (
      nextRun.status === 'applied'
      && !postApplyCheckpointRef.current
      && nextRun.appliedAt
      && latestInputsRef.current.sourceResumeUpdatedAt
      && !resumeOptimizationFlowTimestampsEqual(
        latestInputsRef.current.sourceResumeUpdatedAt,
        nextRun.sourceResumeUpdatedAt,
      )
      && evaluationSignature !== nextRun.sourceEvaluationSignature
      && persistedEvaluationSignature
      && persistedEvaluationSignature === evaluationSignature
      && persistedEvaluation
    ) {
      publishPostApplyCheckpoint({
        runId: nextRun.id,
        phase: 'evaluation_ready',
        sourceEvaluationSignature: evaluationSignature,
        evaluationReceipt: persistedEvaluation,
      });
    }
    const hasFrozenAnswerRetry = Boolean(
      isSameRun
      && nextRun.status === 'awaiting_answers'
      && frozenAnswerSubmissionRef.current?.runId === nextRun.id,
    );
    if (!hasFrozenAnswerRetry) {
      frozenAnswerSubmissionRef.current = null;
      setIsAnswerSubmissionFrozen(false);
    }
    latestRunRef.current = nextRun;
    activeRunIdRef.current = nextRun.id;
    setRun(nextRun);
    setAnswerDrafts((current) => buildResumeOptimizationAnswerDrafts(
      nextRun,
      previousRunId,
      current,
    ));
    const restoredSelections = nextRun.status === 'preview_ready'
      ? readResumeOptimizationSelectionSnapshot(authUserKey, resumeId, nextRun.id)
      : null;
    if (nextRun.status !== 'preview_ready') {
      clearResumeOptimizationSelectionSnapshot(authUserKey, resumeId);
    }
    setAcceptedChangeIds((current) => (
      preserveLocalSelections && isSameRun
        ? filterResumeOptimizationSelectableChangeIds(effectivePlan(nextRun).changes, current)
        : restoredSelections !== null
          ? filterResumeOptimizationSelectableChangeIds(
            effectivePlan(nextRun).changes,
            restoredSelections,
          )
          : buildResumeOptimizationInitialAcceptedIds(nextRun)
    ));
    setUiState(hasFrozenAnswerRetry
      ? 'error'
      : resolveResumeOptimizationRunUiState(nextRun.status, automaticHydration));
  }, [
    authUserKey, clearPostApplyCheckpoint, evaluationSignature, persistedEvaluation,
    persistedEvaluationSignature, publishPostApplyCheckpoint, resumeId,
  ]);

  const markSelfOwnedResumeTimestamp = useCallback((updatedAt: string) => {
    const canonicalUpdatedAt = canonicalizeResumeOptimizationFlowTimestamp(updatedAt);
    if (!canonicalUpdatedAt) throw new Error('Missing committed resume timestamp.');
    selfOwnedResumeTimestampsRef.current.add(canonicalUpdatedAt);
  }, []);

  const markSelfOwnedResumeAndEvaluationTimestamp = useCallback((updatedAt: string) => {
    const canonicalUpdatedAt = canonicalizeResumeOptimizationFlowTimestamp(updatedAt);
    if (!canonicalUpdatedAt) throw new Error('Missing committed resume timestamp.');
    selfOwnedResumeAndEvaluationTimestampsRef.current.add(canonicalUpdatedAt);
  }, []);

  const waitForCommittedSource = useCallback((
    expectedResumeUpdatedAt: string,
    previousEvaluationSignature: string,
    generation: number,
  ): Promise<SourceCommit> => {
    const canonicalExpectedResumeUpdatedAt = canonicalizeResumeOptimizationFlowTimestamp(
      expectedResumeUpdatedAt,
    );
    if (!canonicalExpectedResumeUpdatedAt) {
      return Promise.reject(new Error('Missing applied resume timestamp.'));
    }
    const latest = latestInputsRef.current;
    if (
      latest.sourceResumeUpdatedAt === canonicalExpectedResumeUpdatedAt
      && latest.evaluationSignature
      && latest.evaluationSignature !== previousEvaluationSignature
    ) {
      return Promise.resolve({
        resumeUpdatedAt: canonicalExpectedResumeUpdatedAt,
        evaluationSignature: latest.evaluationSignature,
      });
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (sourceWaiterRef.current?.generation === generation) sourceWaiterRef.current = null;
        reject(new Error('等待应用后的简历上下文超时。'));
      }, 8000);
      sourceWaiterRef.current = {
        generation,
        expectedResumeUpdatedAt: canonicalExpectedResumeUpdatedAt,
        previousEvaluationSignature,
        minimumInputRevision: latestInputsRevisionRef.current + 1,
        resolve,
        reject,
        timeout,
      };
    });
  }, []);

  const settleCommittedSourceAfterReload = useCallback(async (
    expectedResumeUpdatedAt: string,
    generation: number,
  ) => {
    const afterNextPaint = () => new Promise<void>((resolve) => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => resolve());
      } else {
        setTimeout(resolve, 0);
      }
    });
    await afterNextPaint();
    await afterNextPaint();
    if (generationRef.current !== generation) throw abortError();
    const canonicalExpectedResumeUpdatedAt = canonicalizeResumeOptimizationFlowTimestamp(
      expectedResumeUpdatedAt,
    );
    const waiter = sourceWaiterRef.current;
    const latest = latestInputsRef.current;
    if (
      canonicalExpectedResumeUpdatedAt
      && waiter
      && waiter.generation === generation
      && waiter.expectedResumeUpdatedAt === canonicalExpectedResumeUpdatedAt
      && latest.sourceResumeUpdatedAt === canonicalExpectedResumeUpdatedAt
      && latest.evaluationSignature
      && latestInputsRevisionRef.current >= waiter.minimumInputRevision
    ) {
      clearTimeout(waiter.timeout);
      sourceWaiterRef.current = null;
      waiter.resolve({
        resumeUpdatedAt: canonicalExpectedResumeUpdatedAt,
        evaluationSignature: latest.evaluationSignature,
      });
    }
  }, []);

  const waitForPersistedEvaluationReceipt = useCallback((
    expectedEvaluationSignature: string,
    evaluationReceipt: ResumeEvaluation,
    generation: number,
  ): Promise<void> => {
    const latest = latestInputsRef.current;
    if (doesResumeOptimizationEvaluationReceiptMatch(
      latest.persistedEvaluationSignature,
      latest.persistedEvaluation,
      expectedEvaluationSignature,
      evaluationReceipt,
    )) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (evaluationWaiterRef.current?.generation === generation) evaluationWaiterRef.current = null;
        reject(new Error('等待六维报告写入本地配置超时。'));
      }, 8000);
      evaluationWaiterRef.current = {
        generation,
        evaluationSignature: expectedEvaluationSignature,
        evaluationReceipt,
        resolve,
        reject,
        timeout,
      };
    });
  }, []);

  useLayoutEffect(() => {
    latestToastRef.current = toast;
    latestGenerateEvaluationRef.current = generateEvaluation;
    latestFlushResumeConfigRef.current = flushResumeConfig;
    commitLatestResumeConfigIfNeededRef.current = commitLatestResumeConfigIfNeeded;
    latestInputsRef.current = {
      authUserKey,
      resumeId,
      sourceResumeUpdatedAt: canonicalSourceResumeUpdatedAt,
      evaluationSignature,
      persistedEvaluationSignature,
      persistedEvaluation,
    };
    latestInputsRevisionRef.current += 1;

    const previous = identityRef.current;
    const ownerChanged = previous.authUserKey !== authUserKey;
    const resumeChanged = previous.resumeId !== resumeId;
    const timestampChanged = previous.sourceResumeUpdatedAt !== canonicalSourceResumeUpdatedAt;
    const signatureChanged = previous.evaluationSignature !== evaluationSignature;
    const waiter = sourceWaiterRef.current;
    const waiterOwnsSource = Boolean(
      waiter
      && waiter.generation === generationRef.current
      && waiter.expectedResumeUpdatedAt === canonicalSourceResumeUpdatedAt,
    );
    const timestampOwnsEvaluation = Boolean(
      canonicalSourceResumeUpdatedAt
      && selfOwnedResumeAndEvaluationTimestampsRef.current.delete(canonicalSourceResumeUpdatedAt),
    );
    const timestampOwned = !timestampChanged || Boolean(
      canonicalSourceResumeUpdatedAt
      && (
        selfOwnedResumeTimestampsRef.current.delete(canonicalSourceResumeUpdatedAt)
        || timestampOwnsEvaluation
        || waiterOwnsSource
      ),
    );
    const signatureOwned = !signatureChanged || waiterOwnsSource || timestampOwnsEvaluation;

    if (ownerChanged || resumeChanged) {
      clearResumeOptimizationSelectionSnapshot(previous.authUserKey, previous.resumeId);
      clearResumeOptimizationPostApplyCheckpoint(previous.authUserKey, previous.resumeId);
    }

    identityRef.current = {
      authUserKey,
      resumeId,
      sourceResumeUpdatedAt: canonicalSourceResumeUpdatedAt,
      evaluationSignature,
    };

    if (!enabled || ownerChanged || resumeChanged) {
      invalidateGeneration(true);
      return;
    }
    if (!timestampOwned || !signatureOwned) {
      invalidateGeneration(false, true);
      return;
    }
    if (
      waiterOwnsSource
      && waiter
      && evaluationSignature
      && evaluationSignature !== waiter.previousEvaluationSignature
    ) {
      clearTimeout(waiter.timeout);
      sourceWaiterRef.current = null;
      waiter.resolve({
        resumeUpdatedAt: canonicalSourceResumeUpdatedAt as string,
        evaluationSignature,
      });
    }
    const evaluationWaiter = evaluationWaiterRef.current;
    if (
      evaluationWaiter
      && evaluationWaiter.generation === generationRef.current
      && doesResumeOptimizationEvaluationReceiptMatch(
        persistedEvaluationSignature,
        persistedEvaluation,
        evaluationWaiter.evaluationSignature,
        evaluationWaiter.evaluationReceipt,
      )
    ) {
      clearTimeout(evaluationWaiter.timeout);
      evaluationWaiterRef.current = null;
      evaluationWaiter.resolve();
    }
  }, [authUserKey, resumeId, evaluationSignature, canonicalSourceResumeUpdatedAt,
    commitLatestResumeConfigIfNeeded, enabled, flushResumeConfig, generateEvaluation, invalidateGeneration,
    persistedEvaluation, persistedEvaluationSignature, toast]);

  useLayoutEffect(() => {
    if (hasResumeVersionConflict && latestRunRef.current) {
      invalidateGeneration(false, true);
    }
  }, [hasResumeVersionConflict, invalidateGeneration]);

  useEffect(() => () => {
    generationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    rejectPendingWaiters(abortError());
  }, [rejectPendingWaiters]);

  const beginOperation = useCallback(async () => {
    generationRef.current += 1;
    const generation = generationRef.current;
    controllerRef.current?.abort();
    setIsHydrating(false);
    rejectPendingWaiters(abortError());
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const operation = await ownerGuard.beginOperation();
      if (generationRef.current !== generation) throw abortError();
      return { generation, controller, operation };
    } catch (cause) {
      if (generationRef.current === generation && controllerRef.current === controller) {
        controllerRef.current = null;
      }
      throw cause;
    }
  }, [ownerGuard, rejectPendingWaiters]);

  const assertCurrent = useCallback(async (
    generation: number,
    operation: FlowOperation,
    expectedRunId?: string | null,
  ) => {
    if (
      generationRef.current !== generation
      || (expectedRunId !== undefined && activeRunIdRef.current !== expectedRunId)
    ) {
      throw abortError();
    }
    await ownerGuard.assertOperationCurrent(operation);
    if (generationRef.current !== generation) throw abortError();
  }, [ownerGuard]);

  const shouldHandleOperationError = useCallback(async (
    cause: unknown,
    generation: number,
    operation: FlowOperation | null,
    expectedRunId?: string | null,
  ): Promise<boolean> => {
    if (isAbortLike(cause) || !operation) return false;
    try {
      await assertCurrent(generation, operation, expectedRunId);
      return true;
    } catch {
      return false;
    }
  }, [assertCurrent]);

  const handleOperationError = useCallback((cause: unknown, fallback: string) => {
    if (isAbortLike(cause)) return;
    const message = errorMessage(cause, fallback);
    setError(message);
    if (isStaleOptimizationError(cause)) {
      applyAttemptRef.current = null;
      clearPostApplyCheckpoint();
      setUiState('stale');
      latestToastRef.current.error('简历已变化，当前优化方案已失效；本地草稿已保留。');
    } else {
      setUiState('error');
      latestToastRef.current.error(message);
    }
  }, [clearPostApplyCheckpoint]);

  const beginHandledOperation = useCallback(async (fallback: string) => {
    try {
      return await beginOperation();
    } catch (cause) {
      handleOperationError(cause, fallback);
      return null;
    }
  }, [beginOperation, handleOperationError]);

  useEffect(() => {
    if (!enabled || !resumeId || !authUserKey || authUserKey === 'anonymous') return undefined;
    const controller = new AbortController();
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    controllerRef.current?.abort();
    controllerRef.current = controller;
    setIsHydrating(true);
    let operation: FlowOperation | null = null;
    void (async () => {
      try {
        operation = await ownerGuard.beginOperation();
        const latest = await resumeOptimizationService.getLatest(resumeId, {
          signal: controller.signal,
          expectedAuthCacheKey: operation.expectedAuthCacheKey,
        });
        await assertCurrent(generation, operation);
        if (!latest) {
          latestRunRef.current = null;
          setUiState('closed');
          return;
        }
        latestRunRef.current = latest;
        if (TERMINAL_RESUME_OPTIMIZATION_STATUSES.has(latest.status)) {
          activeRunIdRef.current = null;
          setRun(null);
          setUiState('closed');
          return;
        }
        applyRunToState(latest, true);
      } catch (cause) {
        if (await shouldHandleOperationError(cause, generation, operation)) {
          handleOperationError(cause, '加载最近优化记录失败。');
        }
      } finally {
        if (generationRef.current === generation) {
          setIsHydrating(false);
          if (controllerRef.current === controller) controllerRef.current = null;
        }
      }
    })();
    return () => {
      controller.abort();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [
    enabled, authUserKey, resumeId, ownerGuard, assertCurrent, applyRunToState,
    handleOperationError, shouldHandleOperationError,
  ]);

  const isFlowBusy = isHydrating || controllerRef.current !== null
    || ['starting', 'answering', 'applying', 'rescoring'].includes(uiState);
  const persistedAnswerIds = useMemo(
    () => [...new Set((run?.answers ?? []).map((answer) => answer.questionId))],
    [run],
  );
  const startAvailability = useMemo(() => resolveResumeOptimizationStartAvailability({
    enabled,
    authUserKey,
    resumeId,
    sourceResumeUpdatedAt: canonicalSourceResumeUpdatedAt,
    evaluationSignature,
    persistedEvaluationSignature,
    evaluation,
    isEvaluationOutdated,
    hasResumeVersionConflict,
    isEvaluationRunning,
    isPolishing,
    isAutoAssembling,
    isFlowBusy,
  }), [
    enabled, authUserKey, resumeId, canonicalSourceResumeUpdatedAt, evaluationSignature,
    persistedEvaluationSignature, evaluation, isEvaluationOutdated,
    hasResumeVersionConflict, isEvaluationRunning, isPolishing,
    isAutoAssembling, isFlowBusy,
  ]);

  const startOptimization = useCallback(async () => {
    if (!startAvailability.canStart || !resumeId) {
      setError(startAvailability.disabledReason);
      return null;
    }
    const started = await beginHandledOperation('启动简历优化失败。');
    if (!started) return null;
    const { generation, controller, operation } = started;
    const planStartedAt = Date.now();
    let planRequestStarted = false;
    activeRunIdRef.current = null;
    setUiState('starting');
    setError(null);
    setProgressText('正在保存当前简历…');
    setProgressNode('freeze_snapshot');
    try {
      let attempt = startAttemptRef.current;
      if (
        !attempt
        || attempt.resumeId !== resumeId
        || attempt.evaluationSignature !== evaluationSignature
      ) {
        const flushedUpdatedAt = await latestFlushResumeConfigRef.current();
        const updatedAt = canonicalizeResumeOptimizationFlowTimestamp(flushedUpdatedAt);
        if (!updatedAt) throw new Error('无法确认当前简历版本。');
        await assertCurrent(generation, operation);
        markSelfOwnedResumeTimestamp(updatedAt);
        attempt = {
          resumeId,
          evaluationSignature,
          expectedResumeUpdatedAt: updatedAt,
          idempotencyKey: createResumeOptimizationIdempotencyKey(),
        };
        startAttemptRef.current = attempt;
      }
      await assertCurrent(generation, operation);
      planRequestStarted = true;
      trackResumeOptimizationPlanStart({
        resumeId: attempt.resumeId,
        beforeScore: evaluation?.overallScore,
      });
      const nextRun = await resumeOptimizationService.start({
        resumeId: attempt.resumeId,
        evaluationSignature: attempt.evaluationSignature,
        expectedResumeUpdatedAt: attempt.expectedResumeUpdatedAt,
        includeBankSuggestions: true,
      }, {
        idempotencyKey: attempt.idempotencyKey,
        signal: controller.signal,
        expectedAuthCacheKey: operation.expectedAuthCacheKey,
        onEvent: (event) => {
          if (generationRef.current === generation && event.type === 'progress') {
            setProgressNode(event.node);
            setProgressText(resolveResumeOptimizationProgressTitle(event.node));
          }
        },
      });
      await assertCurrent(generation, operation);
      const planMetrics = summarizeResumeOptimizationPlan(nextRun);
      trackResumeOptimizationPlanResult({
        resumeId: nextRun.resumeId,
        runId: nextRun.id,
        action: 'success',
        ...planMetrics,
        beforeScore: planMetrics.beforeScore ?? evaluation?.overallScore,
        durationMs: Date.now() - planStartedAt,
      });
      startAttemptRef.current = null;
      applyRunToState(nextRun);
      setProgressText('');
      setProgressNode(null);
      return nextRun;
    } catch (cause) {
      if (await shouldHandleOperationError(cause, generation, operation)) {
        if (planRequestStarted) {
          trackResumeOptimizationPlanResult({
            resumeId: startAttemptRef.current?.resumeId ?? resumeId,
            action: 'failure',
            beforeScore: evaluation?.overallScore,
            durationMs: Date.now() - planStartedAt,
            failureCode: toResumeOptimizationAnalyticsFailureCode(cause),
          });
        }
        handleOperationError(cause, '启动简历优化失败。');
      }
      return null;
    } finally {
      if (generationRef.current === generation) controllerRef.current = null;
    }
  }, [
    applyRunToState, assertCurrent, beginHandledOperation, evaluationSignature,
    evaluation?.overallScore, handleOperationError, markSelfOwnedResumeTimestamp, resumeId,
    shouldHandleOperationError, startAvailability,
  ]);

  const setAnswer = useCallback((
    questionId: string,
    state: ResumeOptimizationAnswerState,
    value = '',
  ) => {
    if (!enabled) return;
    const currentRun = latestRunRef.current;
    if (!currentRun || currentRun.status !== 'awaiting_answers' || uiState === 'stale') {
      throw new Error('当前优化问题不可编辑。');
    }
    if (!effectivePlan(currentRun).questions.some((question) => question.questionId === questionId)) {
      throw new Error('未知的优化问题。');
    }
    const persistedAnswerIds = new Set(currentRun.answers.map((answer) => answer.questionId));
    if (persistedAnswerIds.has(questionId)) {
      throw new Error('已保存的回答不可修改。');
    }
    if (frozenAnswerSubmissionRef.current?.runId === currentRun.id) {
      throw new Error('本次回答已冻结，请直接重试提交。');
    }
    if (!VALID_ANSWER_STATES.has(state)) throw new Error('不支持的回答状态。');
    setAnswerDrafts((current) => ({
      ...current,
      [questionId]: { state, value: state === 'answered' ? value : '' },
    }));
  }, [enabled, uiState]);

  const submitAnswers = useCallback(async () => {
    if (!enabled) return null;
    const currentRun = latestRunRef.current;
    if (
      !currentRun
      || currentRun.status !== 'awaiting_answers'
      || uiState === 'stale'
      || controllerRef.current !== null
    ) return null;
    if (!isResumeOptimizationRunContextCurrent(
      currentRun,
      latestInputsRef.current.sourceResumeUpdatedAt,
      latestInputsRef.current.evaluationSignature,
    )) {
      setError('简历或六维报告已变化，请重新生成优化方案。');
      setUiState('stale');
      return null;
    }
    const frozenSubmission = frozenAnswerSubmissionRef.current?.runId === currentRun.id
      ? frozenAnswerSubmissionRef.current
      : null;
    const preparedAnswers = frozenSubmission?.answers
      ?? buildResumeOptimizationAnswerPayload(currentRun, answerDrafts);
    if (!preparedAnswers) return null;
    const answerAttempt = frozenSubmission ?? {
      runId: currentRun.id,
      answers: preparedAnswers.map((answer) => ({ ...answer })),
    };
    if (!frozenSubmission) {
      frozenAnswerSubmissionRef.current = answerAttempt;
      setIsAnswerSubmissionFrozen(true);
      const answerMetrics = summarizeResumeOptimizationAnswers(answerAttempt.answers);
      trackResumeOptimizationQuestionsSubmit({
        resumeId: currentRun.resumeId,
        runId: currentRun.id,
        ...answerMetrics,
      });
    }
    setUiState('answering');
    setError(null);
    const started = await beginHandledOperation('提交补充信息失败。');
    if (!started) {
      if (!frozenSubmission && frozenAnswerSubmissionRef.current === answerAttempt) {
        frozenAnswerSubmissionRef.current = null;
        setIsAnswerSubmissionFrozen(false);
      }
      return null;
    }
    const { generation, controller, operation } = started;
    const answers = answerAttempt.answers.map((answer) => ({ ...answer }));
    try {
      if (frozenSubmission) {
        const authoritativeRun = await resumeOptimizationService.get(currentRun.id, {
          signal: controller.signal,
          expectedAuthCacheKey: operation.expectedAuthCacheKey,
        });
        await assertCurrent(generation, operation, currentRun.id);
        if (authoritativeRun.id !== currentRun.id) throw new Error('优化运行身份不匹配。');
        if (authoritativeRun.status !== 'awaiting_answers') {
          frozenAnswerSubmissionRef.current = null;
          setIsAnswerSubmissionFrozen(false);
          applyRunToState(authoritativeRun);
          setProgressText('');
          setProgressNode(null);
          return authoritativeRun;
        }
      }
      const nextRun = await resumeOptimizationService.answer(currentRun.id, { answers }, {
        signal: controller.signal,
        expectedAuthCacheKey: operation.expectedAuthCacheKey,
        onEvent: (event) => {
          if (generationRef.current === generation && event.type === 'progress') {
            setProgressNode(event.node);
            setProgressText(resolveResumeOptimizationProgressTitle(event.node));
          }
        },
      });
      await assertCurrent(generation, operation, currentRun.id);
      frozenAnswerSubmissionRef.current = null;
      setIsAnswerSubmissionFrozen(false);
      applyRunToState(nextRun);
      setProgressText('');
      setProgressNode(null);
      return nextRun;
    } catch (cause) {
      if (await shouldHandleOperationError(cause, generation, operation, currentRun.id)) {
        handleOperationError(cause, '提交补充信息失败。');
      }
      return null;
    } finally {
      if (generationRef.current === generation) controllerRef.current = null;
    }
  }, [
    answerDrafts, applyRunToState, assertCurrent, beginHandledOperation, enabled,
    handleOperationError, shouldHandleOperationError, uiState,
  ]);

  const toggleChange = useCallback((changeId: string) => {
    if (!enabled) return;
    const currentRun = latestRunRef.current;
    if (
      !currentRun
      || !isResumeOptimizationRunContextCurrent(
        currentRun,
        latestInputsRef.current.sourceResumeUpdatedAt,
        latestInputsRef.current.evaluationSignature,
      )
    ) return;
    const change = currentRun && effectivePlan(currentRun).changes.find((item) => item.changeId === changeId);
    if (!change || !isResumeOptimizationChangeSelectable(change) || currentRun?.status !== 'preview_ready') return;
    const next = acceptedChangeIds.includes(changeId)
      ? acceptedChangeIds.filter((item) => item !== changeId)
      : [...acceptedChangeIds, changeId];
    setAcceptedChangeIds(next);
    saveResumeOptimizationSelectionSnapshot(authUserKey, resumeId, currentRun.id, next);
    trackResumeOptimizationChangeToggle({
      resumeId: currentRun.resumeId,
      runId: currentRun.id,
      acceptedChangeCount: next.length,
    });
  }, [acceptedChangeIds, authUserKey, enabled, resumeId]);

  const runPostApplyEvaluation = useCallback(async (
    appliedRun: ResumeOptimizationRun,
    generation: number,
    controller: AbortController,
    operation: FlowOperation,
  ) => {
    const rescoreStartedAt = Date.now();
    let rescoreFailureTracked = false;
    const trackRescoreFailure = (cause: unknown, fallbackCode = 'resume_optimization_rescore_failed') => {
      if (rescoreFailureTracked || rescoreResultTrackedRunIdsRef.current.has(appliedRun.id)) return;
      rescoreFailureTracked = true;
      const planMetrics = summarizeResumeOptimizationPlan(appliedRun);
      trackResumeOptimizationRescoreResult({
        resumeId: appliedRun.resumeId,
        runId: appliedRun.id,
        action: 'failure',
        beforeScore: appliedRun.sourceBeforeScore,
        acceptedChangeCount: appliedRun.acceptedChangeIds.length,
        blockedChangeCount: planMetrics.blockedChangeCount,
        bankSuggestionCount: planMetrics.bankSuggestionCount,
        durationMs: Date.now() - rescoreStartedAt,
        failureCode: toResumeOptimizationAnalyticsFailureCode(cause) ?? fallbackCode,
      });
    };
    try {
    setUiState('rescoring');
    setProgressText('正在生成应用后的六维报告…');
    let checkpoint = postApplyCheckpointRef.current;
    if (!checkpoint || checkpoint.runId !== appliedRun.id) {
      checkpoint = {
        runId: appliedRun.id,
        phase: 'needs_evaluation',
        sourceEvaluationSignature: latestInputsRef.current.evaluationSignature,
      };
      publishPostApplyCheckpoint(checkpoint);
    }
    if (checkpoint.phase === 'needs_reload') {
      throw new Error('应用后的简历上下文尚未加载。');
    }
    if (checkpoint.phase === 'needs_evaluation') {
      const outcome = await latestGenerateEvaluationRef.current();
      await assertCurrent(generation, operation, appliedRun.id);
      if (outcome.status !== 'success') {
        if (outcome.status === 'error') {
          trackRescoreFailure(undefined, 'resume_evaluation_failed');
        }
        setRun(appliedRun);
        latestRunRef.current = appliedRun;
        setUiState('error');
        setError('应用已完成，但六维复评失败；可重试复评。');
        return null;
      }
      checkpoint = {
        runId: appliedRun.id,
        phase: 'evaluation_ready',
        sourceEvaluationSignature: checkpoint.sourceEvaluationSignature,
        evaluationReceipt: outcome.evaluation,
      };
      publishPostApplyCheckpoint(checkpoint);
    }
    if (checkpoint.phase === 'evaluation_ready') {
      await waitForPersistedEvaluationReceipt(
        checkpoint.sourceEvaluationSignature,
        checkpoint.evaluationReceipt,
        generation,
      );
      await assertCurrent(generation, operation, appliedRun.id);
      const flushedUpdatedAt = await latestFlushResumeConfigRef.current();
      const finalizedUpdatedAt = canonicalizeResumeOptimizationFlowTimestamp(flushedUpdatedAt);
      if (!finalizedUpdatedAt) throw new Error('六维报告尚未保存。');
      markSelfOwnedResumeTimestamp(finalizedUpdatedAt);
      checkpoint = {
        runId: appliedRun.id,
        phase: 'report_committed',
        sourceEvaluationSignature: checkpoint.sourceEvaluationSignature,
        evaluationReceipt: checkpoint.evaluationReceipt,
        committedResumeUpdatedAt: finalizedUpdatedAt,
      };
      publishPostApplyCheckpoint(checkpoint);
      await assertCurrent(generation, operation, appliedRun.id);
    }
    const reportIsCommitted = checkpoint.phase === 'report_committed';
    if (!reportIsCommitted) {
      throw new Error('应用后复评状态无效。');
    }
    try {
      const finalized = await resumeOptimizationService.finalize(appliedRun.id, {
        expectedResumeUpdatedAt: checkpoint.committedResumeUpdatedAt,
      }, {
        signal: controller.signal,
        expectedAuthCacheKey: operation.expectedAuthCacheKey,
      });
      await assertCurrent(generation, operation, appliedRun.id);
      trackCompletedResumeOptimizationRescore(finalized.run, rescoreStartedAt);
      applyRunToState(finalized.run);
      setProgressText('');
      setProgressNode(null);
      latestToastRef.current.success('简历优化与复评已完成。');
      return finalized.run;
    } catch (cause) {
      if (
        isResumeOptimizationServiceError(cause)
        && cause.code === EVALUATION_PENDING_ERROR_CODE
      ) {
        publishPostApplyCheckpoint({
          runId: appliedRun.id,
          phase: 'needs_evaluation',
          sourceEvaluationSignature: checkpoint.sourceEvaluationSignature,
        });
      }
      try {
        const authoritativeRun = await resumeOptimizationService.get(appliedRun.id, {
          signal: controller.signal,
          expectedAuthCacheKey: operation.expectedAuthCacheKey,
        });
        await assertCurrent(generation, operation, appliedRun.id);
        if (authoritativeRun.status === 'completed') {
          trackCompletedResumeOptimizationRescore(authoritativeRun, rescoreStartedAt);
          applyRunToState(authoritativeRun);
          setProgressText('');
          setProgressNode(null);
          latestToastRef.current.success('简历优化与复评已完成。');
          return authoritativeRun;
        }
        applyRunToState(authoritativeRun, false, true);
      } catch (refreshError) {
        if (isAbortLike(refreshError)) throw refreshError;
      }
      throw cause;
    }
    } catch (cause) {
      if (!isAbortLike(cause)) trackRescoreFailure(cause);
      throw cause;
    }
  }, [
    applyRunToState, assertCurrent, markSelfOwnedResumeTimestamp,
    publishPostApplyCheckpoint, trackCompletedResumeOptimizationRescore,
    waitForPersistedEvaluationReceipt,
  ]);

  const recoverUncertainApplyAttempt = useCallback(async (
    attempt: ResumeOptimizationApplyAttempt,
    activeOperation?: {
      generation: number;
      controller: AbortController;
      operation: FlowOperation;
    },
    originalCause?: unknown,
  ) => {
    if (!enabled || (!activeOperation && controllerRef.current)) return null;
    setUiState('applying');
    setError(null);
    const started = activeOperation ?? await beginHandledOperation('无法确认简历优化是否已应用。');
    if (!started) {
      setUiState('preview');
      return null;
    }
    const ownsOperation = !activeOperation;
    const { generation, controller, operation } = started;
    let applyWasConfirmed = false;
    const trackPendingApplyResult = (
      action: 'success' | 'failure',
      failureCode?: string,
    ) => {
      const analyticsAttempt = applyAnalyticsAttemptRef.current;
      if (!analyticsAttempt || analyticsAttempt.runId !== attempt.runId || analyticsAttempt.resultTracked) return;
      analyticsAttempt.resultTracked = true;
      trackResumeOptimizationApplyResult({
        resumeId: analyticsAttempt.resumeId,
        runId: analyticsAttempt.runId,
        action,
        beforeScore: analyticsAttempt.beforeScore,
        acceptedChangeCount: analyticsAttempt.acceptedChangeCount,
        blockedChangeCount: analyticsAttempt.blockedChangeCount,
        bankSuggestionCount: analyticsAttempt.bankSuggestionCount,
        durationMs: Date.now() - analyticsAttempt.startedAt,
        failureCode,
      });
      applyAnalyticsAttemptRef.current = null;
    };
    try {
      if (attempt.previewReadyConfirmations > 0) {
        await waitForResumeOptimizationApplyConfirmationBackoff(controller.signal);
      }
      const authoritativeRun = await resumeOptimizationService.get(attempt.runId, {
        signal: controller.signal,
        expectedAuthCacheKey: operation.expectedAuthCacheKey,
      });
      await assertCurrent(generation, operation, attempt.runId);
      if (authoritativeRun.status === 'preview_ready') {
        const previewReadyConfirmations = attempt.previewReadyConfirmations + 1;
        if (previewReadyConfirmations < 2) {
          if (applyAttemptRef.current === attempt) {
            applyAttemptRef.current = { ...attempt, previewReadyConfirmations };
          }
          applyRunToState(authoritativeRun, false, true);
          setUiState('preview');
          const message = '上次应用仍在确认中；再次点击只会复核服务端状态。';
          setError(message);
          latestToastRef.current.info?.(message);
          return authoritativeRun;
        }
        if (applyAttemptRef.current === attempt) applyAttemptRef.current = null;
        trackPendingApplyResult(
          'failure',
          toResumeOptimizationAnalyticsFailureCode(originalCause)
            ?? 'resume_optimization_not_applied',
        );
        applyRunToState(authoritativeRun, false, true);
        setUiState('preview');
        if (originalCause !== undefined) {
          const message = errorMessage(originalCause, '应用简历优化失败。');
          setError(message);
          latestToastRef.current.error(message);
        } else {
          setError(null);
          latestToastRef.current.info?.('已确认上次应用未生效，请再次确认应用。');
        }
        return authoritativeRun;
      }
      if (authoritativeRun.status === 'completed') {
        applyWasConfirmed = true;
        trackPendingApplyResult('success');
        trackCompletedResumeOptimizationRescore(authoritativeRun);
        if (applyAttemptRef.current === attempt) applyAttemptRef.current = null;
        applyRunToState(authoritativeRun);
        setProgressText('');
        setProgressNode(null);
        latestToastRef.current.success('简历优化与复评已完成。');
        return authoritativeRun;
      }
      if (authoritativeRun.status === 'applied') {
        applyWasConfirmed = true;
        trackPendingApplyResult('success');
        if (applyAttemptRef.current === attempt) applyAttemptRef.current = null;
        applyRunToState(authoritativeRun, false, true);
        setUiState('rescoring');
        let checkpoint = postApplyCheckpointRef.current;
        if (!checkpoint || checkpoint.runId !== authoritativeRun.id) {
          const appliedResumeUpdatedAt = canonicalizeResumeOptimizationFlowTimestamp(
            authoritativeRun.appliedResumeUpdatedAt,
          );
          if (!appliedResumeUpdatedAt) throw new Error('无法确认应用后的简历版本。');
          markSelfOwnedResumeTimestamp(appliedResumeUpdatedAt);
          checkpoint = {
            runId: authoritativeRun.id,
            phase: 'needs_reload',
            appliedResumeUpdatedAt,
            previousEvaluationSignature: latestInputsRef.current.evaluationSignature,
          };
          publishPostApplyCheckpoint(checkpoint);
        }
        if (checkpoint.phase === 'needs_reload') {
          markSelfOwnedResumeTimestamp(checkpoint.appliedResumeUpdatedAt);
          const sourceCommitPromise = waitForCommittedSource(
            checkpoint.appliedResumeUpdatedAt,
            checkpoint.previousEvaluationSignature,
            generation,
          );
          void sourceCommitPromise.catch(() => undefined);
          const reload = await reloadResumeContext(resumeId);
          if (reload.status !== 'success') {
            throw reload.error ?? new Error('应用后重新加载简历失败。');
          }
          await settleCommittedSourceAfterReload(
            checkpoint.appliedResumeUpdatedAt,
            generation,
          );
          const sourceCommit = await sourceCommitPromise;
          await assertCurrent(generation, operation, authoritativeRun.id);
          publishPostApplyCheckpoint({
            runId: authoritativeRun.id,
            phase: 'needs_evaluation',
            sourceEvaluationSignature: sourceCommit.evaluationSignature,
          });
        }
        return await runPostApplyEvaluation(
          authoritativeRun,
          generation,
          controller,
          operation,
        );
      }
      if (['applying', 'rescoring', 'planning'].includes(authoritativeRun.status)) {
        setError('服务端仍在处理上次应用；再次点击只会继续确认状态。');
        setUiState('preview');
        return null;
      }
      if (applyAttemptRef.current === attempt) applyAttemptRef.current = null;
      trackPendingApplyResult(
        'failure',
        toResumeOptimizationAnalyticsFailureCode(originalCause)
          ?? 'resume_optimization_not_applied',
      );
      applyRunToState(authoritativeRun);
      return authoritativeRun;
    } catch (cause) {
      if (await shouldHandleOperationError(cause, generation, operation, attempt.runId)) {
        rejectPendingWaiters(cause instanceof Error ? cause : new Error('确认应用状态失败。'));
        if (
          !applyWasConfirmed
          && applyAttemptRef.current === attempt
          && !isStaleOptimizationError(cause)
        ) {
          const message = '暂时无法确认上次应用结果；再次点击只会重试状态确认。';
          setError(message);
          setUiState('preview');
          latestToastRef.current.error(message);
        } else {
          handleOperationError(cause, '确认简历优化状态失败。');
        }
      }
      return null;
    } finally {
      if (ownsOperation && generationRef.current === generation) controllerRef.current = null;
    }
  }, [
    applyRunToState, assertCurrent, beginHandledOperation, enabled, handleOperationError,
    markSelfOwnedResumeTimestamp, publishPostApplyCheckpoint, rejectPendingWaiters,
    reloadResumeContext, resumeId, runPostApplyEvaluation, settleCommittedSourceAfterReload,
    shouldHandleOperationError, trackCompletedResumeOptimizationRescore, waitForCommittedSource,
  ]);

  const applyAcceptedChanges = useCallback(async () => {
    if (!enabled) return null;
    const currentRun = latestRunRef.current;
    if (
      !currentRun
      || currentRun.status !== 'preview_ready'
      || controllerRef.current
    ) return null;
    const pendingAttempt = applyAttemptRef.current;
    if (pendingAttempt) {
      if (pendingAttempt.runId !== currentRun.id) {
        applyAttemptRef.current = null;
      } else {
        return await recoverUncertainApplyAttempt(pendingAttempt);
      }
    }
    const attempt = freezeResumeOptimizationApplyAttempt(currentRun, acceptedChangeIds);
    if (!attempt) return null;
    const applyPlanMetrics = summarizeResumeOptimizationPlan(currentRun);
    if (!isResumeOptimizationRunContextCurrent(
      currentRun,
      latestInputsRef.current.sourceResumeUpdatedAt,
      latestInputsRef.current.evaluationSignature,
    )) {
      setError('简历或六维报告已变化，请重新生成优化方案。');
      setUiState('stale');
      return null;
    }
    applyAttemptRef.current = attempt;
    setUiState('applying');
    setError(null);
    const started = await beginHandledOperation('应用简历优化失败。');
    if (!started) {
      if (applyAttemptRef.current === attempt) applyAttemptRef.current = null;
      return null;
    }
    const { generation, controller, operation } = started;
    let applyRequestStarted = false;
    try {
      const committedToken = await commitLatestResumeConfigIfNeededRef.current();
      const committedSourceUpdatedAt = canonicalizeResumeOptimizationFlowTimestamp(committedToken);
      if (
        !committedSourceUpdatedAt
        || !resumeOptimizationFlowTimestampsEqual(
          committedSourceUpdatedAt,
          attempt.sourceResumeUpdatedAt,
        )
      ) {
        invalidateGeneration(false, true);
        return null;
      }
      await assertCurrent(generation, operation, attempt.runId);
      const applyStartedAt = Date.now();
      applyAnalyticsAttemptRef.current = {
        runId: attempt.runId,
        resumeId: currentRun.resumeId,
        beforeScore: currentRun.sourceBeforeScore,
        acceptedChangeCount: attempt.acceptedChangeIds.length,
        blockedChangeCount: applyPlanMetrics.blockedChangeCount,
        bankSuggestionCount: applyPlanMetrics.bankSuggestionCount,
        startedAt: applyStartedAt,
        resultTracked: false,
      };
      trackResumeOptimizationApplyStart({
        resumeId: currentRun.resumeId,
        runId: currentRun.id,
        beforeScore: currentRun.sourceBeforeScore,
        acceptedChangeCount: attempt.acceptedChangeIds.length,
        blockedChangeCount: applyPlanMetrics.blockedChangeCount,
        bankSuggestionCount: applyPlanMetrics.bankSuggestionCount,
      });
      applyRequestStarted = true;
      const applied = await resumeOptimizationService.apply(attempt.runId, {
        acceptedChangeIds: attempt.acceptedChangeIds,
        expectedResumeUpdatedAt: committedSourceUpdatedAt,
      }, {
        signal: controller.signal,
        expectedAuthCacheKey: operation.expectedAuthCacheKey,
      });
      await assertCurrent(generation, operation, attempt.runId);
      trackResumeOptimizationApplyResult({
        resumeId: currentRun.resumeId,
        runId: currentRun.id,
        action: 'success',
        beforeScore: currentRun.sourceBeforeScore,
        acceptedChangeCount: attempt.acceptedChangeIds.length,
        blockedChangeCount: applyPlanMetrics.blockedChangeCount,
        bankSuggestionCount: applyPlanMetrics.bankSuggestionCount,
        durationMs: Date.now() - applyStartedAt,
      });
      applyAnalyticsAttemptRef.current = null;
      applyAttemptRef.current = null;
      markSelfOwnedResumeTimestamp(applied.resumeUpdatedAt);
      latestRunRef.current = applied.run;
      setRun(applied.run);
      setUiState('rescoring');
      publishPostApplyCheckpoint({
        runId: applied.run.id,
        phase: 'needs_reload',
        appliedResumeUpdatedAt: applied.resumeUpdatedAt,
        previousEvaluationSignature: latestInputsRef.current.evaluationSignature,
      });
      const sourceCommitPromise = waitForCommittedSource(
        applied.resumeUpdatedAt,
        latestInputsRef.current.evaluationSignature,
        generation,
      );
      void sourceCommitPromise.catch(() => undefined);
      const reload = await reloadResumeContext(resumeId);
      if (reload.status !== 'success') throw reload.error ?? new Error('应用后重新加载简历失败。');
      await settleCommittedSourceAfterReload(applied.resumeUpdatedAt, generation);
      const sourceCommit = await sourceCommitPromise;
      await assertCurrent(generation, operation, attempt.runId);
      publishPostApplyCheckpoint({
        runId: applied.run.id,
        phase: 'needs_evaluation',
        sourceEvaluationSignature: sourceCommit.evaluationSignature,
      });
      return await runPostApplyEvaluation(
        applied.run,
        generation,
        controller,
        operation,
      );
    } catch (cause) {
      if (!await shouldHandleOperationError(cause, generation, operation, attempt.runId)) {
        return null;
      }
      rejectPendingWaiters(cause instanceof Error ? cause : new Error('应用流程失败。'));
      if (applyRequestStarted && applyAttemptRef.current === attempt) {
        if (isStaleOptimizationError(cause)) {
          const analyticsAttempt = applyAnalyticsAttemptRef.current;
          if (analyticsAttempt && analyticsAttempt.runId === attempt.runId && !analyticsAttempt.resultTracked) {
            trackResumeOptimizationApplyResult({
              resumeId: analyticsAttempt.resumeId,
              runId: analyticsAttempt.runId,
              action: 'failure',
              beforeScore: analyticsAttempt.beforeScore,
              acceptedChangeCount: analyticsAttempt.acceptedChangeCount,
              blockedChangeCount: analyticsAttempt.blockedChangeCount,
              bankSuggestionCount: analyticsAttempt.bankSuggestionCount,
              durationMs: Date.now() - analyticsAttempt.startedAt,
              failureCode: toResumeOptimizationAnalyticsFailureCode(cause),
            });
            applyAnalyticsAttemptRef.current = null;
          }
          applyAttemptRef.current = null;
          handleOperationError(cause, '应用简历优化失败。');
          return null;
        }
        return await recoverUncertainApplyAttempt(
          attempt,
          { generation, controller, operation },
          cause,
        );
      } else if (!applyRequestStarted && applyAttemptRef.current === attempt) {
        applyAttemptRef.current = null;
      }
      handleOperationError(cause, '应用简历优化失败。');
      return null;
    } finally {
      if (generationRef.current === generation) controllerRef.current = null;
    }
  }, [
    acceptedChangeIds, assertCurrent, beginHandledOperation, enabled, handleOperationError,
    invalidateGeneration, markSelfOwnedResumeTimestamp, reloadResumeContext, resumeId,
    publishPostApplyCheckpoint, recoverUncertainApplyAttempt, rejectPendingWaiters, runPostApplyEvaluation,
    settleCommittedSourceAfterReload, shouldHandleOperationError, waitForCommittedSource,
  ]);

  const retryRescore = useCallback(async () => {
    if (!enabled) return null;
    const currentRun = latestRunRef.current;
    if (!currentRun || currentRun.status !== 'applied' || controllerRef.current) return null;
    setUiState('rescoring');
    setError(null);
    const started = await beginHandledOperation('六维复评失败，可稍后重试。');
    if (!started) return null;
    const { generation, controller, operation } = started;
    const rescoreRetryStartedAt = Date.now();
    try {
      const authoritativeRun = await resumeOptimizationService.get(currentRun.id, {
        signal: controller.signal,
        expectedAuthCacheKey: operation.expectedAuthCacheKey,
      });
      await assertCurrent(generation, operation, currentRun.id);
      if (authoritativeRun.status === 'completed') {
        const postEvaluation = authoritativeRun.postEvaluation;
        if (postEvaluation && !rescoreResultTrackedRunIdsRef.current.has(authoritativeRun.id)) {
          trackCompletedResumeOptimizationRescore(authoritativeRun, rescoreRetryStartedAt);
        }
        applyRunToState(authoritativeRun);
        setProgressText('');
        setProgressNode(null);
        return authoritativeRun;
      }
      if (authoritativeRun.status !== 'applied') {
        applyRunToState(authoritativeRun);
        return authoritativeRun;
      }
      applyRunToState(authoritativeRun, false, true);
      let checkpoint = postApplyCheckpointRef.current;
      if (!checkpoint || checkpoint.runId !== authoritativeRun.id) {
        const appliedResumeUpdatedAt = canonicalizeResumeOptimizationFlowTimestamp(
          authoritativeRun.appliedResumeUpdatedAt,
        );
        if (!appliedResumeUpdatedAt) throw new Error('无法确认应用后的简历版本。');
        markSelfOwnedResumeTimestamp(appliedResumeUpdatedAt);
        checkpoint = {
          runId: authoritativeRun.id,
          phase: 'needs_reload',
          appliedResumeUpdatedAt,
          previousEvaluationSignature: latestInputsRef.current.evaluationSignature,
        };
        publishPostApplyCheckpoint(checkpoint);
      }
      if (checkpoint.phase === 'needs_reload') {
        const sourceCommitPromise = waitForCommittedSource(
          checkpoint.appliedResumeUpdatedAt,
          checkpoint.previousEvaluationSignature,
          generation,
        );
        void sourceCommitPromise.catch(() => undefined);
        const reload = await reloadResumeContext(resumeId);
        if (reload.status !== 'success') throw reload.error ?? new Error('应用后重新加载简历失败。');
        await settleCommittedSourceAfterReload(checkpoint.appliedResumeUpdatedAt, generation);
        const sourceCommit = await sourceCommitPromise;
        await assertCurrent(generation, operation, currentRun.id);
        publishPostApplyCheckpoint({
          runId: authoritativeRun.id,
          phase: 'needs_evaluation',
          sourceEvaluationSignature: sourceCommit.evaluationSignature,
        });
      }
      return await runPostApplyEvaluation(
        authoritativeRun,
        generation,
        controller,
        operation,
      );
    } catch (cause) {
      if (await shouldHandleOperationError(cause, generation, operation, currentRun.id)) {
        handleOperationError(cause, '六维复评失败，可稍后重试。');
      }
      return null;
    } finally {
      if (generationRef.current === generation) controllerRef.current = null;
    }
  }, [
    applyRunToState, assertCurrent, beginHandledOperation, enabled, handleOperationError,
    markSelfOwnedResumeTimestamp, publishPostApplyCheckpoint, reloadResumeContext, resumeId, runPostApplyEvaluation,
    settleCommittedSourceAfterReload, shouldHandleOperationError,
    trackCompletedResumeOptimizationRescore, waitForCommittedSource,
  ]);

  const revertRun = useCallback(async () => {
    if (!enabled) return null;
    const currentRun = latestRunRef.current;
    const currentUpdatedAt = latestInputsRef.current.sourceResumeUpdatedAt;
    if (
      !currentRun
      || !currentUpdatedAt
      || !['applied', 'completed'].includes(currentRun.status)
      || controllerRef.current
    ) return null;
    setUiState('applying');
    setError(null);
    const started = await beginHandledOperation('撤销简历优化失败。');
    if (!started) return null;
    const { generation, controller, operation } = started;
    const revertStartedAt = Date.now();
    let revertMutationStarted = false;
    let revertMutationSucceeded = false;
    try {
      const committedToken = await commitLatestResumeConfigIfNeededRef.current();
      const committedCurrentUpdatedAt = canonicalizeResumeOptimizationFlowTimestamp(committedToken);
      if (
        !committedCurrentUpdatedAt
        || !resumeOptimizationFlowTimestampsEqual(committedCurrentUpdatedAt, currentUpdatedAt)
      ) {
        invalidateGeneration(false, true);
        return null;
      }
      await assertCurrent(generation, operation, currentRun.id);
      revertMutationStarted = true;
      const reverted = await resumeOptimizationService.revert(currentRun.id, {
        expectedResumeUpdatedAt: committedCurrentUpdatedAt,
      }, {
        signal: controller.signal,
        expectedAuthCacheKey: operation.expectedAuthCacheKey,
      });
      await assertCurrent(generation, operation, currentRun.id);
      revertMutationSucceeded = true;
      trackResumeOptimizationRevertResult({
        resumeId: currentRun.resumeId,
        runId: currentRun.id,
        action: 'success',
        durationMs: Date.now() - revertStartedAt,
      });
      markSelfOwnedResumeAndEvaluationTimestamp(reverted.resumeUpdatedAt);
      const reloaded = await reloadResumeContext(resumeId);
      if (reloaded.status !== 'success') throw reloaded.error ?? new Error('撤销后重新加载失败。');
      await assertCurrent(generation, operation, currentRun.id);
      applyAttemptRef.current = null;
      clearPostApplyCheckpoint();
      latestRunRef.current = reverted.run;
      setRun(reverted.run);
      setUiState('closed');
      setProgressText('');
      setProgressNode(null);
      latestToastRef.current.success('已撤销本次简历优化。');
      return reverted.run;
    } catch (cause) {
      if (await shouldHandleOperationError(cause, generation, operation, currentRun.id)) {
        if (revertMutationStarted && !revertMutationSucceeded) {
          trackResumeOptimizationRevertResult({
            resumeId: currentRun.resumeId,
            runId: currentRun.id,
            action: 'failure',
            durationMs: Date.now() - revertStartedAt,
            failureCode: toResumeOptimizationAnalyticsFailureCode(cause),
          });
        }
        handleOperationError(cause, '撤销简历优化失败。');
      }
      return null;
    } finally {
      if (generationRef.current === generation) controllerRef.current = null;
    }
  }, [
    assertCurrent, beginHandledOperation, clearPostApplyCheckpoint, enabled, handleOperationError,
    invalidateGeneration,
    markSelfOwnedResumeAndEvaluationTimestamp, reloadResumeContext, resumeId,
    shouldHandleOperationError,
  ]);

  const cancelRun = useCallback(async () => {
    if (!enabled) return null;
    const currentRun = latestRunRef.current;
    const currentRunId = activeRunIdRef.current;
    const started = await beginHandledOperation('取消简历优化失败。');
    if (!started) return null;
    const { generation, controller, operation } = started;
    if (!currentRun || !currentRunId || currentRun.id !== currentRunId) {
      if (generationRef.current === generation) controllerRef.current = null;
      setUiState('closed');
      return null;
    }
    try {
      const cancelled = await resumeOptimizationService.cancel(currentRun.id, {
        signal: controller.signal,
        expectedAuthCacheKey: operation.expectedAuthCacheKey,
      });
      await assertCurrent(generation, operation, currentRun.id);
      applyRunToState(cancelled);
      setUiState('closed');
      return cancelled;
    } catch (cause) {
      if (await shouldHandleOperationError(cause, generation, operation, currentRun.id)) {
        handleOperationError(cause, '取消简历优化失败。');
      }
      return null;
    } finally {
      if (generationRef.current === generation) controllerRef.current = null;
    }
  }, [
    applyRunToState, assertCurrent, beginHandledOperation, enabled, handleOperationError,
    shouldHandleOperationError,
  ]);

  const closeWorkspace = useCallback(async () => {
    const currentRun = latestRunRef.current;
    if (currentRun?.status === 'preview_ready') {
      setUiState('closed');
      return true;
    }
    const hasPendingAnswerSubmission = Boolean(
      currentRun
      && frozenAnswerSubmissionRef.current?.runId === currentRun.id,
    );
    if (
      controllerRef.current
      && (ACTIVE_STREAM_UI_STATES.has(uiState) || hasPendingAnswerSubmission)
    ) {
      if (!await confirmCancelActiveRun()) return false;
      await cancelRun();
      return true;
    }
    setUiState('closed');
    return true;
  }, [cancelRun, confirmCancelActiveRun, uiState]);

  const reopenLatestRun = useCallback(async () => {
    if (!enabled || !resumeId) return null;
    if (latestRunRef.current) {
      const cachedRun = latestRunRef.current;
      const requiresCurrentContext = cachedRun.status === 'awaiting_answers'
        || cachedRun.status === 'preview_ready';
      if (
        requiresCurrentContext
        && !isResumeOptimizationRunContextCurrent(
          cachedRun,
          latestInputsRef.current.sourceResumeUpdatedAt,
          latestInputsRef.current.evaluationSignature,
        )
      ) {
        setError('简历或六维报告已变化，请重新生成优化方案。');
        setUiState('stale');
        return cachedRun;
      }
      applyRunToState(latestRunRef.current, false, true);
      return latestRunRef.current;
    }
    const started = await beginHandledOperation('重新打开优化记录失败。');
    if (!started) return null;
    const { generation, controller, operation } = started;
    try {
      const latest = await resumeOptimizationService.getLatest(resumeId, {
        signal: controller.signal,
        expectedAuthCacheKey: operation.expectedAuthCacheKey,
      });
      await assertCurrent(generation, operation);
      if (latest) applyRunToState(latest, false);
      return latest;
    } catch (cause) {
      if (await shouldHandleOperationError(cause, generation, operation)) {
        handleOperationError(cause, '重新打开优化记录失败。');
      }
      return null;
    } finally {
      if (generationRef.current === generation) controllerRef.current = null;
    }
  }, [
    applyRunToState, assertCurrent, beginHandledOperation, enabled,
    handleOperationError, resumeId, shouldHandleOperationError,
  ]);

  return {
    uiState,
    run,
    progressText,
    progressNode,
    error,
    answerDrafts,
    persistedAnswerIds,
    isAnswerSubmissionFrozen,
    acceptedChangeIds,
    canStart: startAvailability.canStart,
    disabledReason: startAvailability.disabledReason,
    startOptimization,
    setAnswer,
    submitAnswers,
    toggleChange,
    applyAcceptedChanges,
    retryRescore,
    revertRun,
    cancelRun,
    closeWorkspace,
    reopenLatestRun,
  };
};
