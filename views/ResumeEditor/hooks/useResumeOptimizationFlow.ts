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
import { canonicalizeResumeOptimizationTimestamp } from '../../../utils/resumeOptimizationNormalize.mjs';

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
  resolve: (commit: SourceCommit) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type EvaluationWaiter = {
  generation: number;
  evaluationSignature: string;
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const abortError = () => {
  const error = new Error('Resume optimization operation was aborted.');
  error.name = 'AbortError';
  return error;
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

const isStaleOptimizationError = (error: unknown) => (
  isResumeOptimizationServiceError(error)
  && error.statusCode === 409
  && STALE_RESUME_OPTIMIZATION_ERROR_CODES.has(error.code)
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
  const sourceWaiterRef = useRef<SourceWaiter | null>(null);
  const evaluationWaiterRef = useRef<EvaluationWaiter | null>(null);
  const selfOwnedResumeTimestampsRef = useRef(new Set<string>());
  const selfOwnedResumeAndEvaluationTimestampsRef = useRef(new Set<string>());
  const latestToastRef = useRef(toast);
  const latestGenerateEvaluationRef = useRef(generateEvaluation);
  const latestFlushResumeConfigRef = useRef(flushResumeConfig);
  const latestInputsRef = useRef({
    authUserKey,
    resumeId,
    sourceResumeUpdatedAt: canonicalSourceResumeUpdatedAt,
    evaluationSignature,
    persistedEvaluationSignature,
    persistedEvaluation,
  });
  const identityRef = useRef({
    authUserKey,
    resumeId,
    sourceResumeUpdatedAt: canonicalSourceResumeUpdatedAt,
    evaluationSignature,
  });

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
    setProgressText('');
    setProgressNode(null);
    if (clearVisibleRun) {
      setIsHydrating(false);
      activeRunIdRef.current = null;
      latestRunRef.current = null;
      frozenAnswerSubmissionRef.current = null;
      startAttemptRef.current = null;
      setRun(null);
      setAnswerDrafts({});
      setIsAnswerSubmissionFrozen(false);
      setAcceptedChangeIds([]);
      setError(null);
      setUiState('closed');
    } else if (markStale && latestRunRef.current) {
      startAttemptRef.current = null;
      setError('简历或六维报告已变化，请重新生成优化方案。');
      setUiState('stale');
    } else if (markStale) {
      startAttemptRef.current = null;
    }
  }, [rejectPendingWaiters]);

  const applyRunToState = useCallback((
    nextRun: ResumeOptimizationRun,
    automaticHydration = false,
    preserveLocalSelections = false,
  ) => {
    const previousRunId = latestRunRef.current?.id ?? null;
    const isSameRun = previousRunId === nextRun.id;
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
    setAcceptedChangeIds((current) => (
      preserveLocalSelections && isSameRun
        ? filterResumeOptimizationSelectableChangeIds(effectivePlan(nextRun).changes, current)
        : buildResumeOptimizationInitialAcceptedIds(nextRun)
    ));
    setUiState(hasFrozenAnswerRetry
      ? 'error'
      : resolveResumeOptimizationRunUiState(nextRun.status, automaticHydration));
  }, []);

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
        resolve,
        reject,
        timeout,
      };
    });
  }, []);

  const waitForPersistedEvaluation = useCallback((
    expectedEvaluationSignature: string,
    generation: number,
  ): Promise<void> => {
    const latest = latestInputsRef.current;
    if (
      latest.persistedEvaluationSignature === expectedEvaluationSignature
      && latest.persistedEvaluation
    ) {
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
    latestInputsRef.current = {
      authUserKey,
      resumeId,
      sourceResumeUpdatedAt: canonicalSourceResumeUpdatedAt,
      evaluationSignature,
      persistedEvaluationSignature,
      persistedEvaluation,
    };

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
      && persistedEvaluationSignature === evaluationWaiter.evaluationSignature
      && persistedEvaluation
    ) {
      clearTimeout(evaluationWaiter.timeout);
      evaluationWaiterRef.current = null;
      evaluationWaiter.resolve();
    }
  }, [authUserKey, resumeId, evaluationSignature, canonicalSourceResumeUpdatedAt,
    enabled, flushResumeConfig, generateEvaluation, invalidateGeneration,
    persistedEvaluation, persistedEvaluationSignature, toast]);

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
      setUiState('stale');
      latestToastRef.current.error('简历已变化，当前优化方案已失效；本地草稿已保留。');
    } else {
      setUiState('error');
      latestToastRef.current.error(message);
    }
  }, []);

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
      startAttemptRef.current = null;
      applyRunToState(nextRun);
      setProgressText('');
      setProgressNode(null);
      return nextRun;
    } catch (cause) {
      if (await shouldHandleOperationError(cause, generation, operation)) {
        handleOperationError(cause, '启动简历优化失败。');
      }
      return null;
    } finally {
      if (generationRef.current === generation) controllerRef.current = null;
    }
  }, [
    applyRunToState, assertCurrent, beginHandledOperation, evaluationSignature,
    handleOperationError, markSelfOwnedResumeTimestamp, resumeId,
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
    setAcceptedChangeIds((current) => current.includes(changeId)
      ? current.filter((item) => item !== changeId)
      : [...current, changeId]);
  }, [enabled]);

  const runPostApplyEvaluation = useCallback(async (
    appliedRun: ResumeOptimizationRun,
    expectedEvaluationSignature: string,
    generation: number,
    controller: AbortController,
    operation: FlowOperation,
  ) => {
    setUiState('rescoring');
    setProgressText('正在生成应用后的六维报告…');
    const outcome = await latestGenerateEvaluationRef.current();
    await assertCurrent(generation, operation, appliedRun.id);
    if (outcome.status !== 'success') {
      setRun(appliedRun);
      latestRunRef.current = appliedRun;
      setUiState('error');
      setError('应用已完成，但六维复评失败；可重试复评。');
      return null;
    }
    await waitForPersistedEvaluation(expectedEvaluationSignature, generation);
    await assertCurrent(generation, operation, appliedRun.id);
    const flushedUpdatedAt = await latestFlushResumeConfigRef.current();
    const finalizedUpdatedAt = canonicalizeResumeOptimizationFlowTimestamp(flushedUpdatedAt);
    if (!finalizedUpdatedAt) throw new Error('六维报告尚未保存。');
    await assertCurrent(generation, operation, appliedRun.id);
    markSelfOwnedResumeTimestamp(finalizedUpdatedAt);
    const finalized = await resumeOptimizationService.finalize(appliedRun.id, {
      expectedResumeUpdatedAt: finalizedUpdatedAt,
    }, {
      signal: controller.signal,
      expectedAuthCacheKey: operation.expectedAuthCacheKey,
    });
    await assertCurrent(generation, operation, appliedRun.id);
    applyRunToState(finalized.run);
    setProgressText('');
    latestToastRef.current.success('简历优化与复评已完成。');
    return finalized.run;
  }, [
    applyRunToState, assertCurrent, markSelfOwnedResumeTimestamp,
    waitForPersistedEvaluation,
  ]);

  const applyAcceptedChanges = useCallback(async () => {
    if (!enabled) return null;
    const currentRun = latestRunRef.current;
    if (!currentRun || currentRun.status !== 'preview_ready' || acceptedChangeIds.length === 0) return null;
    if (!isResumeOptimizationRunContextCurrent(
      currentRun,
      latestInputsRef.current.sourceResumeUpdatedAt,
      latestInputsRef.current.evaluationSignature,
    )) {
      setError('简历或六维报告已变化，请重新生成优化方案。');
      setUiState('stale');
      return null;
    }
    const started = await beginHandledOperation('应用简历优化失败。');
    if (!started) return null;
    const { generation, controller, operation } = started;
    setUiState('applying');
    setError(null);
    try {
      const applied = await resumeOptimizationService.apply(currentRun.id, {
        acceptedChangeIds,
        expectedResumeUpdatedAt: currentRun.sourceResumeUpdatedAt,
      }, {
        signal: controller.signal,
        expectedAuthCacheKey: operation.expectedAuthCacheKey,
      });
      await assertCurrent(generation, operation, currentRun.id);
      markSelfOwnedResumeTimestamp(applied.resumeUpdatedAt);
      latestRunRef.current = applied.run;
      setRun(applied.run);
      setUiState('rescoring');
      const sourceCommitPromise = waitForCommittedSource(
        applied.resumeUpdatedAt,
        latestInputsRef.current.evaluationSignature,
        generation,
      );
      void sourceCommitPromise.catch(() => undefined);
      const reload = await reloadResumeContext(resumeId);
      if (reload.status !== 'success') throw reload.error ?? new Error('应用后重新加载简历失败。');
      const sourceCommit = await sourceCommitPromise;
      await assertCurrent(generation, operation, currentRun.id);
      return await runPostApplyEvaluation(
        applied.run,
        sourceCommit.evaluationSignature,
        generation,
        controller,
        operation,
      );
    } catch (cause) {
      if (!await shouldHandleOperationError(cause, generation, operation, currentRun.id)) {
        return null;
      }
      rejectPendingWaiters(cause instanceof Error ? cause : new Error('应用流程失败。'));
      handleOperationError(cause, '应用简历优化失败。');
      return null;
    } finally {
      if (generationRef.current === generation) controllerRef.current = null;
    }
  }, [
    acceptedChangeIds, assertCurrent, beginHandledOperation, enabled, handleOperationError,
    markSelfOwnedResumeTimestamp, reloadResumeContext, resumeId,
    rejectPendingWaiters, runPostApplyEvaluation, shouldHandleOperationError,
    waitForCommittedSource,
  ]);

  const retryRescore = useCallback(async () => {
    if (!enabled) return null;
    const currentRun = latestRunRef.current;
    if (!currentRun || currentRun.status !== 'applied') return null;
    const started = await beginHandledOperation('六维复评失败，可稍后重试。');
    if (!started) return null;
    const { generation, controller, operation } = started;
    setError(null);
    try {
      return await runPostApplyEvaluation(
        currentRun,
        latestInputsRef.current.evaluationSignature,
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
    beginHandledOperation, enabled, handleOperationError, runPostApplyEvaluation,
    shouldHandleOperationError,
  ]);

  const revertRun = useCallback(async () => {
    if (!enabled) return null;
    const currentRun = latestRunRef.current;
    const currentUpdatedAt = latestInputsRef.current.sourceResumeUpdatedAt;
    if (!currentRun || !currentUpdatedAt || !['applied', 'completed'].includes(currentRun.status)) return null;
    const started = await beginHandledOperation('撤销简历优化失败。');
    if (!started) return null;
    const { generation, controller, operation } = started;
    setUiState('applying');
    try {
      const reverted = await resumeOptimizationService.revert(currentRun.id, {
        expectedResumeUpdatedAt: currentUpdatedAt,
      }, {
        signal: controller.signal,
        expectedAuthCacheKey: operation.expectedAuthCacheKey,
      });
      await assertCurrent(generation, operation, currentRun.id);
      markSelfOwnedResumeAndEvaluationTimestamp(reverted.resumeUpdatedAt);
      const reloaded = await reloadResumeContext(resumeId);
      if (reloaded.status !== 'success') throw reloaded.error ?? new Error('撤销后重新加载失败。');
      await assertCurrent(generation, operation, currentRun.id);
      applyRunToState(reverted.run);
      latestToastRef.current.success('已撤销本次简历优化。');
      return reverted.run;
    } catch (cause) {
      if (await shouldHandleOperationError(cause, generation, operation, currentRun.id)) {
        handleOperationError(cause, '撤销简历优化失败。');
      }
      return null;
    } finally {
      if (generationRef.current === generation) controllerRef.current = null;
    }
  }, [
    applyRunToState, assertCurrent, beginHandledOperation, enabled, handleOperationError,
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
