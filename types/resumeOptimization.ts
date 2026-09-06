import type { ResumeEvaluationDimensionName } from './ai';

export const RESUME_OPTIMIZATION_STATUSES = [
  'planning',
  'awaiting_answers',
  'preview_ready',
  'applying',
  'applied',
  'rescoring',
  'completed',
  'failed',
  'stale',
  'cancelled',
  'reverted',
] as const;

export type ResumeOptimizationStatus = (typeof RESUME_OPTIMIZATION_STATUSES)[number];

export type ResumeOptimizationUiState =
  | 'closed'
  | 'starting'
  | 'awaiting_answers'
  | 'answering'
  | 'preview'
  | 'applying'
  | 'rescoring'
  | 'completed'
  | 'error'
  | 'stale';

export type ResumeOptimizationAction =
  | 'rewrite_now'
  | 'ask_user'
  | 'suggest_from_bank'
  | 'leave_unchanged';

export type ResumeOptimizationScope = 'general' | 'jd_targeted';

export type ResumeOptimizationModuleType =
  | 'experience_star'
  | 'personal_summary'
  | 'skills_order'
  | 'section_order'
  | 'bank_suggestion';

export type ResumeOptimizationAnswerState =
  | 'answered'
  | 'no_data'
  | 'unknown'
  | 'not_my_work'
  | 'skipped';

export type ResumeOptimizationSafetyStatus = 'pending' | 'allowed' | 'blocked';

export type ResumeOptimizationProgressNode =
  | 'freeze_snapshot'
  | 'prepare_context'
  | 'plan_changes'
  | 'verify_changes'
  | 'persist_run'
  | 'rewrite_answers';

export type ResumeOptimizationSourceLabel =
  | '当前简历'
  | '已选经历原始版本'
  | '本轮补充信息'
  | '已验证来源';

export interface ResumeOptimizationChange {
  changeId: string;
  issueIds: string[];
  dimension: string;
  moduleType: ResumeOptimizationModuleType;
  moduleId: string;
  fieldPath: string;
  actionKind: ResumeOptimizationAction;
  scope: ResumeOptimizationScope;
  beforeValue: unknown;
  generalValue: unknown | null;
  targetedValue: unknown | null;
  sourceLabels: ResumeOptimizationSourceLabel[];
  introducedTerms: string[];
  rationale: string;
  expectedScoreGain: number;
  defaultSelected: boolean;
  safetyStatus: ResumeOptimizationSafetyStatus;
  safetyFindings: string[];
}

export interface ResumeOptimizationQuestionChoice {
  value: string;
  label: string;
}

export interface ResumeOptimizationQuestion {
  questionId: string;
  moduleId: string;
  fieldPath: string;
  text: string;
  reason: string;
  answerType: 'single_choice_with_text';
  choices: ResumeOptimizationQuestionChoice[];
  affectsChangeIds: string[];
  priority: number;
}

export interface ResumeOptimizationAnswer {
  questionId: string;
  state: ResumeOptimizationAnswerState;
  value: string;
}

export interface ResumeOptimizationBankSuggestion {
  suggestionId: string;
  masterExperienceId: string;
  category: string;
  title: string;
  org: string;
  matchScore: number;
  reason: string;
  capabilities: string[];
}

export interface ResumeOptimizationSafetySummary {
  allowedChangeIds: string[];
  blockedChangeIds: string[];
  pendingChangeIds: string[];
  findings: string[];
}

export interface ResumeOptimizationPlan {
  changes: ResumeOptimizationChange[];
  questions: ResumeOptimizationQuestion[];
  bankSuggestions: ResumeOptimizationBankSuggestion[];
  safetySummary: ResumeOptimizationSafetySummary;
}

export interface ResumeOptimizationDimensionDelta {
  dimension: ResumeEvaluationDimensionName;
  beforeScore: number;
  afterScore: number;
  delta: number;
}

export interface ResumeOptimizationIssueCounts {
  before: number;
  after: number;
  resolved: number;
  remaining: number;
  introduced: number;
}

export interface ResumeOptimizationPostEvaluation {
  version: 'resume_optimization_post_evaluation_v1';
  evaluationSignature: string;
  resumeUpdatedAt: string;
  beforeScore: number;
  afterScore: number;
  scoreDelta: number;
  dimensionDeltas: ResumeOptimizationDimensionDelta[];
  issueCounts: ResumeOptimizationIssueCounts;
  unresolvedFactGapCount: number;
  acceptedChangeCount: number;
  blockedChangeCount: number;
  bankSuggestionCount: number;
  safetySummary: ResumeOptimizationSafetySummary;
}

export interface ResumeOptimizationRun {
  id: string;
  resumeId: string;
  status: ResumeOptimizationStatus;
  optimizerVersion: 'resume_optimization_v1';
  policyVersion: 'thin_safety_v1' | 'evidence_semantic_v2';
  promptVersion: 'resume_optimization_prompt_v1';
  sourceResumeUpdatedAt: string;
  sourceEvaluationSignature: string;
  sourceJdSignature: string;
  sourceSnapshotHash: string;
  sourceBeforeScore: number | null;
  plan: ResumeOptimizationPlan;
  answers: ResumeOptimizationAnswer[];
  result: ResumeOptimizationPlan | null;
  postEvaluation: ResumeOptimizationPostEvaluation | null;
  acceptedChangeIds: string[];
  appliedContentSignature: string | null;
  createdAt: string;
  updatedAt: string;
  appliedResumeUpdatedAt: string | null;
  appliedAt: string | null;
  completedAt: string | null;
}

export interface ResumeOptimizationStartInput {
  resumeId: string;
  evaluationSignature: string;
  expectedResumeUpdatedAt: string;
  includeBankSuggestions?: boolean;
}

export interface ResumeOptimizationAnswersInput {
  answers: ResumeOptimizationAnswer[];
}

export interface ResumeOptimizationApplyInput {
  acceptedChangeIds: string[];
  expectedResumeUpdatedAt: string;
}

export interface ResumeOptimizationTimestampInput {
  expectedResumeUpdatedAt: string;
}

export interface ResumeOptimizationApplyResponse {
  run: ResumeOptimizationRun;
  resumeUpdatedAt: string;
  appliedChangeIds: string[];
}

export interface ResumeOptimizationFinalizeResponse {
  run: ResumeOptimizationRun;
}

export interface ResumeOptimizationRevertResponse {
  run: ResumeOptimizationRun;
  resumeUpdatedAt: string;
}

export interface ResumeOptimizationProgressEvent {
  type: 'progress';
  node: ResumeOptimizationProgressNode;
  title: string;
  requestId: string;
}

export interface ResumeOptimizationFinalEvent {
  type: 'final';
  result: ResumeOptimizationRun;
  requestId: string;
}

export interface ResumeOptimizationErrorEvent {
  type: 'error';
  code: string;
  message: string;
  requestId: string;
  statusCode: number;
  retryable: boolean;
}

export type ResumeOptimizationStreamEvent =
  | ResumeOptimizationProgressEvent
  | ResumeOptimizationFinalEvent
  | ResumeOptimizationErrorEvent;

export interface ResumeOptimizationRequestOptions {
  signal?: AbortSignal;
  expectedAuthCacheKey?: string;
}

export interface ResumeOptimizationStreamOptions
  extends ResumeOptimizationRequestOptions {
  onEvent?: (event: ResumeOptimizationStreamEvent) => void;
}

export interface ResumeOptimizationStartOptions
  extends ResumeOptimizationStreamOptions {
  idempotencyKey: string;
}
