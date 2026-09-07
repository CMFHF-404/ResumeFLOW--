import {
  ANALYTICS_EVENTS,
  ANALYTICS_PROPERTIES,
  type AiPolishAction,
} from '../constants/analyticsEvents';
import { trackEvent, trackEventImmediate, trackPageView as emitPageView } from './analyticsClient';
import {
  getAnalyticsCounters,
  incrementAnalyticsCounter,
  type AnalyticsCounters,
} from './analyticsCounters';

const FIRST_EXPERIENCE_ONCE_KEY = 'first_experience_created';
const TRACK_ONCE_PREFIX = 'yuanzijianli.analytics.once';
const SIGN_UP_EVENT_TIMEOUT_MS = 1200;
const JUST_LOGGED_IN_SESSION_KEY = 'yuanzijianli.analytics.just_logged_in';

const resolveOnceKey = (key: string) => `${TRACK_ONCE_PREFIX}.${key}`;

const hasTracked = (key: string) => {
  try {
    return Boolean(localStorage.getItem(resolveOnceKey(key)));
  } catch (error) {
    return false;
  }
};

const markTracked = (key: string) => {
  try {
    localStorage.setItem(resolveOnceKey(key), new Date().toISOString());
  } catch (error) {
    // ignore storage errors
  }
};

const readSessionStorage = (key: string) => {
  try {
    return sessionStorage.getItem(key);
  } catch (error) {
    return null;
  }
};

const writeSessionStorage = (key: string, value: string | null) => {
  try {
    if (value === null) {
      sessionStorage.removeItem(key);
      return;
    }
    sessionStorage.setItem(key, value);
  } catch (error) {
    // ignore storage errors
  }
};

type AiPolishPayload = {
  source: 'experience_bank' | 'resume_editor';
  field: string;
  category?: string;
  action?: AiPolishAction;
  durationMs?: number;
};

type AIAssistantDraftAppliedPayload = {
  source: 'direct' | 'experience_bank' | 'resume_editor';
  cardType: 'experience' | 'certification' | 'skill_group';
  callbackOnly?: boolean;
};

type JDAnalysisPayload = {
  resumeId?: string | null;
  jdMatchScore?: number | null;
  resumeQualityScore?: number | null;
  durationMs?: number;
};

type SmartAssemblyPayload = {
  resumeId?: string | null;
  action?: 'success' | 'partial_overflow' | 'no_match' | 'skipped' | 'error' | 'empty_jd' | 'analysis_unavailable';
  durationMs?: number;
  experienceCount?: number;
  certificationCount?: number;
  skillCount?: number;
  totalSelected?: number;
};

type BossGreetingPayload = {
  resumeId?: string | null;
  source: 'generate' | 'refresh' | 'copy' | 'toggle';
  action?: 'success' | 'error' | 'empty' | 'shown' | 'hidden' | 'analysis_unavailable';
  durationMs?: number;
};

type ResumeDuplicatedPayload = {
  source: 'dashboard' | 'editor';
  action: 'success' | 'error' | 'partial' | 'warning';
  sourceResumeId?: string | null;
  duplicatedResumeId?: string | null;
  durationMs?: number;
};

type LayoutChangePayload = {
  from: string;
  to: string;
};

type SmartOnePagePayload = {
  lineHeight: number;
  fontSize: number;
};

type ModuleReorderPayload = {
  moduleType: string;
  moduleKey: string;
  fromPosition: number;
  toPosition: number;
  sectionId?: string;
};

type ResumeCardCheckedPayload = {
  cardType: 'experience' | 'education' | 'certification' | 'skill';
  category?: 'work' | 'project';
  checked?: boolean;
};

type ExperienceBankImportedPayload = {
  experienceCount: number;
  certificationCount: number;
  skillCount: number;
  personalInfoCount: number;
  totalSelected: number;
};

type ExperienceBankExportedPayload = {
  workCount: number;
  projectCount: number;
  educationCount: number;
  certificationCount: number;
  skillCount: number;
};

export const trackPageView = (view: string) => {
  const path = typeof window === 'undefined' ? '' : window.location.pathname;
  emitPageView(view, path);
  trackEvent(ANALYTICS_EVENTS.PAGE_VIEW, {
    [ANALYTICS_PROPERTIES.VIEW]: view,
    [ANALYTICS_PROPERTIES.PATH]: path,
  });
};

export const trackSignUpSuccess = () => {
  trackEvent(ANALYTICS_EVENTS.SIGN_UP_SUCCESS);
};

export const trackSignUpSuccessImmediate = () => {
  return trackEventImmediate(ANALYTICS_EVENTS.SIGN_UP_SUCCESS, undefined, {
    waitForCallback: true,
    transport: 'beacon',
    timeoutMs: SIGN_UP_EVENT_TIMEOUT_MS,
  });
};

export const trackLoginStart = (source: string) => {
  return trackEventImmediate(ANALYTICS_EVENTS.LOGIN_START, {
    [ANALYTICS_PROPERTIES.SOURCE]: source,
  });
};

export const markJustLoggedIn = () => {
  writeSessionStorage(JUST_LOGGED_IN_SESSION_KEY, new Date().toISOString());
};

export const consumeJustLoggedIn = () => {
  const didJustLogIn = Boolean(readSessionStorage(JUST_LOGGED_IN_SESSION_KEY));
  if (didJustLogIn) {
    writeSessionStorage(JUST_LOGGED_IN_SESSION_KEY, null);
  }
  return didJustLogIn;
};

export const trackLoginSuccessImmediate = (source = 'callback') => {
  return trackEventImmediate(ANALYTICS_EVENTS.LOGIN_SUCCESS, {
    [ANALYTICS_PROPERTIES.SOURCE]: source,
  }, {
    waitForCallback: true,
    transport: 'beacon',
    timeoutMs: SIGN_UP_EVENT_TIMEOUT_MS,
  });
};

export const trackAuthenticatedVisit = (
  _authUserKey: string,
  source: 'post_login' | 'session_restore',
  view?: string
) => {
  trackEvent(ANALYTICS_EVENTS.AUTHENTICATED_VISIT, {
    [ANALYTICS_PROPERTIES.SOURCE]: source,
    ...(view ? { [ANALYTICS_PROPERTIES.VIEW]: view } : {}),
  });
};

export const trackFirstExperienceCreated = (category?: string) => {
  if (hasTracked(FIRST_EXPERIENCE_ONCE_KEY)) {
    return;
  }
  const didTrack = trackEvent(ANALYTICS_EVENTS.FIRST_EXPERIENCE_CREATED, {
    ...(category ? { [ANALYTICS_PROPERTIES.CATEGORY]: category } : {}),
  });
  if (didTrack) {
    markTracked(FIRST_EXPERIENCE_ONCE_KEY);
  }
};

export const trackAiPolishStart = ({ source, field, category }: AiPolishPayload) => {
  trackEvent(ANALYTICS_EVENTS.AI_POLISH_START, {
    [ANALYTICS_PROPERTIES.SOURCE]: source,
    [ANALYTICS_PROPERTIES.FIELD]: field,
    ...(category ? { [ANALYTICS_PROPERTIES.CATEGORY]: category } : {}),
  });
};

export const trackAiPolishResult = ({
  source,
  field,
  category,
  action,
  durationMs,
}: AiPolishPayload) => {
  trackEvent(ANALYTICS_EVENTS.AI_POLISH_RESULT, {
    [ANALYTICS_PROPERTIES.SOURCE]: source,
    [ANALYTICS_PROPERTIES.FIELD]: field,
    ...(category ? { [ANALYTICS_PROPERTIES.CATEGORY]: category } : {}),
    ...(action ? { [ANALYTICS_PROPERTIES.ACTION]: action } : {}),
    ...(typeof durationMs === 'number' ? { [ANALYTICS_PROPERTIES.DURATION_MS]: durationMs } : {}),
  });
};

export const trackAiPolishApplied = ({ source, field, category }: AiPolishPayload) => {
  trackEvent(ANALYTICS_EVENTS.AI_POLISH_APPLIED, {
    [ANALYTICS_PROPERTIES.SOURCE]: source,
    [ANALYTICS_PROPERTIES.FIELD]: field,
    ...(category ? { [ANALYTICS_PROPERTIES.CATEGORY]: category } : {}),
  });
};

export const trackAiPolishUndone = ({ source, field, category }: AiPolishPayload) => {
  trackEvent(ANALYTICS_EVENTS.AI_POLISH_UNDONE, {
    [ANALYTICS_PROPERTIES.SOURCE]: source,
    [ANALYTICS_PROPERTIES.FIELD]: field,
    ...(category ? { [ANALYTICS_PROPERTIES.CATEGORY]: category } : {}),
  });
};

export const trackAiAssistantDraftApplied = ({
  source,
  cardType,
  callbackOnly,
}: AIAssistantDraftAppliedPayload) => {
  trackEvent(ANALYTICS_EVENTS.AI_ASSISTANT_DRAFT_APPLIED, {
    [ANALYTICS_PROPERTIES.SOURCE]: source,
    [ANALYTICS_PROPERTIES.CARD_TYPE]: cardType,
    ...(typeof callbackOnly === 'boolean'
      ? { [ANALYTICS_PROPERTIES.CALLBACK_ONLY]: callbackOnly }
      : {}),
  });
};

export const trackJDAnalysisStart = ({ resumeId }: JDAnalysisPayload) => {
  trackEvent(ANALYTICS_EVENTS.JD_ANALYSIS_START, {
    ...(resumeId ? { [ANALYTICS_PROPERTIES.RESUME_ID]: resumeId } : {}),
  });
};

export const trackJDAnalysisComplete = ({
  resumeId,
  jdMatchScore,
  resumeQualityScore,
  durationMs,
}: JDAnalysisPayload, authUserKey?: string | null) => {
  trackEvent(ANALYTICS_EVENTS.JD_ANALYSIS_COMPLETE, {
    ...(resumeId ? { [ANALYTICS_PROPERTIES.RESUME_ID]: resumeId } : {}),
    ...(typeof jdMatchScore === 'number'
      ? { [ANALYTICS_PROPERTIES.MATCH_SCORE]: jdMatchScore }
      : {}),
    ...(typeof resumeQualityScore === 'number'
      ? { [ANALYTICS_PROPERTIES.RESUME_QUALITY_SCORE]: resumeQualityScore }
      : {}),
    ...(typeof durationMs === 'number' ? { [ANALYTICS_PROPERTIES.DURATION_MS]: durationMs } : {}),
  });
  incrementAnalyticsCounter(authUserKey, 'aiAnalysisCount');
};

export const trackSmartAssemblyStart = ({ resumeId }: Pick<SmartAssemblyPayload, 'resumeId'>) => {
  trackEvent(ANALYTICS_EVENTS.SMART_ASSEMBLY_START, {
    ...(resumeId ? { [ANALYTICS_PROPERTIES.RESUME_ID]: resumeId } : {}),
  });
};

export const trackSmartAssemblyResult = ({
  resumeId,
  action,
  durationMs,
  experienceCount,
  certificationCount,
  skillCount,
  totalSelected,
}: SmartAssemblyPayload) => {
  trackEvent(ANALYTICS_EVENTS.SMART_ASSEMBLY_RESULT, {
    ...(resumeId ? { [ANALYTICS_PROPERTIES.RESUME_ID]: resumeId } : {}),
    ...(action ? { [ANALYTICS_PROPERTIES.ACTION]: action } : {}),
    ...(typeof durationMs === 'number' ? { [ANALYTICS_PROPERTIES.DURATION_MS]: durationMs } : {}),
    ...(typeof experienceCount === 'number' ? { [ANALYTICS_PROPERTIES.EXPERIENCE_COUNT]: experienceCount } : {}),
    ...(typeof certificationCount === 'number' ? { [ANALYTICS_PROPERTIES.CERTIFICATION_COUNT]: certificationCount } : {}),
    ...(typeof skillCount === 'number' ? { [ANALYTICS_PROPERTIES.SKILL_COUNT]: skillCount } : {}),
    ...(typeof totalSelected === 'number' ? { [ANALYTICS_PROPERTIES.TOTAL_SELECTED]: totalSelected } : {}),
  });
};

export const trackBossGreetingStart = ({
  resumeId,
  source,
}: Pick<BossGreetingPayload, 'resumeId' | 'source'>) => {
  trackEvent(ANALYTICS_EVENTS.BOSS_GREETING_START, {
    ...(resumeId ? { [ANALYTICS_PROPERTIES.RESUME_ID]: resumeId } : {}),
    [ANALYTICS_PROPERTIES.SOURCE]: source,
  });
};

export const trackBossGreetingResult = ({
  resumeId,
  source,
  action,
  durationMs,
}: BossGreetingPayload) => {
  trackEvent(ANALYTICS_EVENTS.BOSS_GREETING_RESULT, {
    ...(resumeId ? { [ANALYTICS_PROPERTIES.RESUME_ID]: resumeId } : {}),
    [ANALYTICS_PROPERTIES.SOURCE]: source,
    ...(action ? { [ANALYTICS_PROPERTIES.ACTION]: action } : {}),
    ...(typeof durationMs === 'number' ? { [ANALYTICS_PROPERTIES.DURATION_MS]: durationMs } : {}),
  });
};

export const trackResumeDuplicated = ({
  source,
  action,
  sourceResumeId,
  duplicatedResumeId,
  durationMs,
}: ResumeDuplicatedPayload) => {
  trackEvent(ANALYTICS_EVENTS.RESUME_DUPLICATED, {
    [ANALYTICS_PROPERTIES.SOURCE]: source,
    [ANALYTICS_PROPERTIES.ACTION]: action,
    ...(sourceResumeId ? { [ANALYTICS_PROPERTIES.SOURCE_RESUME_ID]: sourceResumeId } : {}),
    ...(duplicatedResumeId ? { [ANALYTICS_PROPERTIES.DUPLICATED_RESUME_ID]: duplicatedResumeId } : {}),
    ...(typeof durationMs === 'number' ? { [ANALYTICS_PROPERTIES.DURATION_MS]: durationMs } : {}),
  });
};

export const trackLayoutModeChange = ({ from, to }: LayoutChangePayload) => {
  trackEvent(ANALYTICS_EVENTS.LAYOUT_MODE_CHANGE, {
    [ANALYTICS_PROPERTIES.FROM]: from,
    [ANALYTICS_PROPERTIES.TO]: to,
  });
};

export const trackSmartOnePageTriggered = ({ lineHeight, fontSize }: SmartOnePagePayload) => {
  trackEvent(ANALYTICS_EVENTS.SMART_ONE_PAGE_TRIGGERED, {
    [ANALYTICS_PROPERTIES.LINE_HEIGHT]: lineHeight,
    [ANALYTICS_PROPERTIES.FONT_SIZE]: fontSize,
  });
};

export const trackModuleReordered = ({
  moduleType,
  moduleKey,
  fromPosition,
  toPosition,
  sectionId,
}: ModuleReorderPayload, authUserKey?: string | null) => {
  trackEvent(ANALYTICS_EVENTS.MODULE_REORDERED, {
    [ANALYTICS_PROPERTIES.MODULE_TYPE]: moduleType,
    [ANALYTICS_PROPERTIES.MODULE_KEY]: moduleKey,
    [ANALYTICS_PROPERTIES.FROM_POSITION]: fromPosition,
    [ANALYTICS_PROPERTIES.TO_POSITION]: toPosition,
    ...(sectionId ? { [ANALYTICS_PROPERTIES.SECTION_ID]: sectionId } : {}),
  });
  incrementAnalyticsCounter(authUserKey, 'resumeSortCount');
};

const buildExportParams = (counters: AnalyticsCounters) => ({
  [ANALYTICS_PROPERTIES.EXPORT_COUNT_BEFORE]: counters.exportCount,
  [ANALYTICS_PROPERTIES.AI_ANALYSIS_COUNT]: counters.aiAnalysisCount,
  [ANALYTICS_PROPERTIES.RESUME_SORT_COUNT]: counters.resumeSortCount,
});

export const trackResumeExported = (authUserKey?: string | null) => {
  const counters = getAnalyticsCounters(authUserKey);
  trackEvent(ANALYTICS_EVENTS.RESUME_EXPORTED, buildExportParams(counters));
  incrementAnalyticsCounter(authUserKey, 'exportCount');
};

export const trackResumeCardChecked = ({
  cardType,
  category,
  checked = true,
}: ResumeCardCheckedPayload) => {
  trackEvent(ANALYTICS_EVENTS.RESUME_CARD_CHECKED, {
    [ANALYTICS_PROPERTIES.CARD_TYPE]: cardType,
    ...(category ? { [ANALYTICS_PROPERTIES.CATEGORY]: category } : {}),
    [ANALYTICS_PROPERTIES.CHECKED]: checked,
  });
};

export const trackExperienceBankImported = ({
  experienceCount,
  certificationCount,
  skillCount,
  personalInfoCount,
  totalSelected,
}: ExperienceBankImportedPayload) => {
  trackEvent(ANALYTICS_EVENTS.EXPERIENCE_BANK_IMPORTED, {
    [ANALYTICS_PROPERTIES.EXPERIENCE_COUNT]: experienceCount,
    [ANALYTICS_PROPERTIES.CERTIFICATION_COUNT]: certificationCount,
    [ANALYTICS_PROPERTIES.SKILL_COUNT]: skillCount,
    [ANALYTICS_PROPERTIES.PERSONAL_INFO_COUNT]: personalInfoCount,
    [ANALYTICS_PROPERTIES.TOTAL_SELECTED]: totalSelected,
  });
};

export const trackExperienceBankExported = ({
  workCount,
  projectCount,
  educationCount,
  certificationCount,
  skillCount,
}: ExperienceBankExportedPayload) => {
  trackEvent(ANALYTICS_EVENTS.EXPERIENCE_BANK_EXPORTED, {
    [ANALYTICS_PROPERTIES.WORK_COUNT]: workCount,
    [ANALYTICS_PROPERTIES.PROJECT_COUNT]: projectCount,
    [ANALYTICS_PROPERTIES.EDUCATION_COUNT]: educationCount,
    [ANALYTICS_PROPERTIES.CERTIFICATION_COUNT]: certificationCount,
    [ANALYTICS_PROPERTIES.SKILL_COUNT]: skillCount,
  });
};

type ResumeOptimizationAnalyticsResultAction = 'success' | 'failure';
type ResumeOptimizationAnalyticsBankAction = 'view_experience' | 'open_auto_assembly';

type ResumeOptimizationAnalyticsContext = {
  resumeId?: string | null;
  runId?: string | null;
};

type ResumeOptimizationAnalyticsPlanMetrics = ResumeOptimizationAnalyticsContext & {
  directChangeCount?: number;
  questionCount?: number;
  blockedChangeCount?: number;
  bankSuggestionCount?: number;
  durationMs?: number;
  failureCode?: string;
  action?: ResumeOptimizationAnalyticsResultAction;
};

type ResumeOptimizationAnalyticsAnswerMetrics = ResumeOptimizationAnalyticsContext & {
  questionCount: number;
  answeredCount: number;
  noDataCount: number;
  unknownCount: number;
  notMyWorkCount: number;
  skippedCount: number;
};

type ResumeOptimizationAnalyticsMutationMetrics = ResumeOptimizationAnalyticsContext & {
  action?: ResumeOptimizationAnalyticsResultAction;
  acceptedChangeCount?: number;
  blockedChangeCount?: number;
  bankSuggestionCount?: number;
  durationMs?: number;
  failureCode?: string;
};

type ResumeOptimizationAnalyticsRescoreMetrics = ResumeOptimizationAnalyticsContext & {
  action: ResumeOptimizationAnalyticsResultAction;
  acceptedChangeCount?: number;
  blockedChangeCount?: number;
  bankSuggestionCount?: number;
  durationMs?: number;
  failureCode?: string;
};

const SAFE_RESUME_OPTIMIZATION_FAILURE_CODE = /^[a-z][a-z0-9_]{0,63}$/;
const SAFE_RESUME_OPTIMIZATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const safeResumeOptimizationNumber = (value: unknown): number | undefined => (
  typeof value === 'number' && Number.isFinite(value) ? value : undefined
);

const safeResumeOptimizationFailureCode = (value: unknown): string | undefined => (
  typeof value === 'string' && SAFE_RESUME_OPTIMIZATION_FAILURE_CODE.test(value)
    ? value
    : undefined
);

const safeResumeOptimizationId = (value: unknown): string | undefined => (
  typeof value === 'string' && SAFE_RESUME_OPTIMIZATION_ID.test(value)
    ? value.toLowerCase()
    : undefined
);

const buildSafeResumeOptimizationIdentifiers = ({
  resumeId,
  runId,
}: ResumeOptimizationAnalyticsContext) => {
  const safeResumeId = safeResumeOptimizationId(resumeId);
  const safeRunId = safeResumeOptimizationId(runId);
  return {
    ...(safeResumeId ? { [ANALYTICS_PROPERTIES.RESUME_ID]: safeResumeId } : {}),
    ...(safeRunId ? { [ANALYTICS_PROPERTIES.RUN_ID]: safeRunId } : {}),
  };
};

export const toResumeOptimizationAnalyticsFailureCode = (cause: unknown): string | undefined => {
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return undefined;
  return safeResumeOptimizationFailureCode((cause as { code?: unknown }).code);
};

export const trackResumeOptimizationCtaView = () => {
  trackEvent(ANALYTICS_EVENTS.RESUME_OPTIMIZATION_CTA_VIEW, {});
};

export const trackResumeOptimizationCtaClick = () => {
  trackEvent(ANALYTICS_EVENTS.RESUME_OPTIMIZATION_CTA_CLICK, {});
};

export const trackResumeOptimizationPlanStart = ({
  resumeId,
}: Pick<ResumeOptimizationAnalyticsPlanMetrics, 'resumeId'> = {}) => {
  trackEvent(ANALYTICS_EVENTS.RESUME_OPTIMIZATION_PLAN_START, {
    ...buildSafeResumeOptimizationIdentifiers({ resumeId }),
  });
};

export const trackResumeOptimizationPlanResult = ({
  resumeId,
  runId,
  action,
  directChangeCount,
  questionCount,
  blockedChangeCount,
  bankSuggestionCount,
  durationMs,
  failureCode,
}: ResumeOptimizationAnalyticsPlanMetrics) => {
  const safeFailureCode = safeResumeOptimizationFailureCode(failureCode);
  trackEvent(ANALYTICS_EVENTS.RESUME_OPTIMIZATION_PLAN_RESULT, {
    ...buildSafeResumeOptimizationIdentifiers({ resumeId, runId }),
    ...(action === 'success' || action === 'failure'
      ? { [ANALYTICS_PROPERTIES.ACTION]: action }
      : {}),
    ...(safeResumeOptimizationNumber(directChangeCount) !== undefined
      ? { [ANALYTICS_PROPERTIES.DIRECT_CHANGE_COUNT]: directChangeCount as number }
      : {}),
    ...(safeResumeOptimizationNumber(questionCount) !== undefined
      ? { [ANALYTICS_PROPERTIES.QUESTION_COUNT]: questionCount as number }
      : {}),
    ...(safeResumeOptimizationNumber(blockedChangeCount) !== undefined
      ? { [ANALYTICS_PROPERTIES.BLOCKED_CHANGE_COUNT]: blockedChangeCount as number }
      : {}),
    ...(safeResumeOptimizationNumber(bankSuggestionCount) !== undefined
      ? { [ANALYTICS_PROPERTIES.BANK_SUGGESTION_COUNT]: bankSuggestionCount as number }
      : {}),
    ...(safeResumeOptimizationNumber(durationMs) !== undefined
      ? { [ANALYTICS_PROPERTIES.DURATION_MS]: durationMs as number }
      : {}),
    ...(safeFailureCode ? { [ANALYTICS_PROPERTIES.FAILURE_CODE]: safeFailureCode } : {}),
  });
};

export const trackResumeOptimizationQuestionsView = ({
  resumeId,
  runId,
  questionCount,
}: Pick<ResumeOptimizationAnalyticsAnswerMetrics, 'resumeId' | 'runId' | 'questionCount'>) => {
  trackEvent(ANALYTICS_EVENTS.RESUME_OPTIMIZATION_QUESTIONS_VIEW, {
    ...buildSafeResumeOptimizationIdentifiers({ resumeId, runId }),
    ...(safeResumeOptimizationNumber(questionCount) !== undefined
      ? { [ANALYTICS_PROPERTIES.QUESTION_COUNT]: questionCount }
      : {}),
  });
};

export const trackResumeOptimizationQuestionsSubmit = ({
  resumeId,
  runId,
  questionCount,
  answeredCount,
  noDataCount,
  unknownCount,
  notMyWorkCount,
  skippedCount,
}: ResumeOptimizationAnalyticsAnswerMetrics) => {
  trackEvent(ANALYTICS_EVENTS.RESUME_OPTIMIZATION_QUESTIONS_SUBMIT, {
    ...buildSafeResumeOptimizationIdentifiers({ resumeId, runId }),
    [ANALYTICS_PROPERTIES.QUESTION_COUNT]: questionCount,
    [ANALYTICS_PROPERTIES.ANSWERED_COUNT]: answeredCount,
    [ANALYTICS_PROPERTIES.NO_DATA_COUNT]: noDataCount,
    [ANALYTICS_PROPERTIES.UNKNOWN_COUNT]: unknownCount,
    [ANALYTICS_PROPERTIES.NOT_MY_WORK_COUNT]: notMyWorkCount,
    [ANALYTICS_PROPERTIES.SKIPPED_COUNT]: skippedCount,
  });
};

export const trackResumeOptimizationChangeToggle = ({
  resumeId,
  runId,
  acceptedChangeCount,
}: Pick<ResumeOptimizationAnalyticsMutationMetrics, 'resumeId' | 'runId'>
  & Required<Pick<ResumeOptimizationAnalyticsMutationMetrics, 'acceptedChangeCount'>>) => {
  trackEvent(ANALYTICS_EVENTS.RESUME_OPTIMIZATION_CHANGE_TOGGLE, {
    ...buildSafeResumeOptimizationIdentifiers({ resumeId, runId }),
    [ANALYTICS_PROPERTIES.ACCEPTED_CHANGE_COUNT]: acceptedChangeCount,
  });
};

export const trackResumeOptimizationApplyStart = ({
  resumeId,
  runId,
  acceptedChangeCount,
  blockedChangeCount,
  bankSuggestionCount,
}: ResumeOptimizationAnalyticsMutationMetrics) => {
  trackEvent(ANALYTICS_EVENTS.RESUME_OPTIMIZATION_APPLY_START, {
    ...buildSafeResumeOptimizationIdentifiers({ resumeId, runId }),
    ...(safeResumeOptimizationNumber(acceptedChangeCount) !== undefined
      ? { [ANALYTICS_PROPERTIES.ACCEPTED_CHANGE_COUNT]: acceptedChangeCount as number }
      : {}),
    ...(safeResumeOptimizationNumber(blockedChangeCount) !== undefined
      ? { [ANALYTICS_PROPERTIES.BLOCKED_CHANGE_COUNT]: blockedChangeCount as number }
      : {}),
    ...(safeResumeOptimizationNumber(bankSuggestionCount) !== undefined
      ? { [ANALYTICS_PROPERTIES.BANK_SUGGESTION_COUNT]: bankSuggestionCount as number }
      : {}),
  });
};

export const trackResumeOptimizationApplyResult = ({
  resumeId,
  runId,
  action,
  acceptedChangeCount,
  blockedChangeCount,
  bankSuggestionCount,
  durationMs,
  failureCode,
}: ResumeOptimizationAnalyticsMutationMetrics) => {
  const safeFailureCode = safeResumeOptimizationFailureCode(failureCode);
  trackEvent(ANALYTICS_EVENTS.RESUME_OPTIMIZATION_APPLY_RESULT, {
    ...buildSafeResumeOptimizationIdentifiers({ resumeId, runId }),
    ...(action === 'success' || action === 'failure'
      ? { [ANALYTICS_PROPERTIES.ACTION]: action }
      : {}),
    ...(safeResumeOptimizationNumber(acceptedChangeCount) !== undefined
      ? { [ANALYTICS_PROPERTIES.ACCEPTED_CHANGE_COUNT]: acceptedChangeCount as number }
      : {}),
    ...(safeResumeOptimizationNumber(blockedChangeCount) !== undefined
      ? { [ANALYTICS_PROPERTIES.BLOCKED_CHANGE_COUNT]: blockedChangeCount as number }
      : {}),
    ...(safeResumeOptimizationNumber(bankSuggestionCount) !== undefined
      ? { [ANALYTICS_PROPERTIES.BANK_SUGGESTION_COUNT]: bankSuggestionCount as number }
      : {}),
    ...(safeResumeOptimizationNumber(durationMs) !== undefined
      ? { [ANALYTICS_PROPERTIES.DURATION_MS]: durationMs as number }
      : {}),
    ...(safeFailureCode ? { [ANALYTICS_PROPERTIES.FAILURE_CODE]: safeFailureCode } : {}),
  });
};

export const trackResumeOptimizationRescoreResult = ({
  resumeId,
  runId,
  action,
  acceptedChangeCount,
  blockedChangeCount,
  bankSuggestionCount,
  durationMs,
  failureCode,
}: ResumeOptimizationAnalyticsRescoreMetrics) => {
  const safeFailureCode = safeResumeOptimizationFailureCode(failureCode);
  trackEvent(ANALYTICS_EVENTS.RESUME_OPTIMIZATION_RESCORE_RESULT, {
    ...buildSafeResumeOptimizationIdentifiers({ resumeId, runId }),
    [ANALYTICS_PROPERTIES.ACTION]: action,
    ...(safeResumeOptimizationNumber(acceptedChangeCount) !== undefined
      ? { [ANALYTICS_PROPERTIES.ACCEPTED_CHANGE_COUNT]: acceptedChangeCount as number }
      : {}),
    ...(safeResumeOptimizationNumber(blockedChangeCount) !== undefined
      ? { [ANALYTICS_PROPERTIES.BLOCKED_CHANGE_COUNT]: blockedChangeCount as number }
      : {}),
    ...(safeResumeOptimizationNumber(bankSuggestionCount) !== undefined
      ? { [ANALYTICS_PROPERTIES.BANK_SUGGESTION_COUNT]: bankSuggestionCount as number }
      : {}),
    ...(safeResumeOptimizationNumber(durationMs) !== undefined
      ? { [ANALYTICS_PROPERTIES.DURATION_MS]: durationMs as number }
      : {}),
    ...(safeFailureCode ? { [ANALYTICS_PROPERTIES.FAILURE_CODE]: safeFailureCode } : {}),
  });
};

export const trackResumeOptimizationRevertResult = ({
  resumeId,
  runId,
  action,
  durationMs,
  failureCode,
}: Pick<ResumeOptimizationAnalyticsMutationMetrics, 'resumeId' | 'runId' | 'action' | 'durationMs' | 'failureCode'>) => {
  const safeFailureCode = safeResumeOptimizationFailureCode(failureCode);
  trackEvent(ANALYTICS_EVENTS.RESUME_OPTIMIZATION_REVERT_RESULT, {
    ...buildSafeResumeOptimizationIdentifiers({ resumeId, runId }),
    ...(action === 'success' || action === 'failure'
      ? { [ANALYTICS_PROPERTIES.ACTION]: action }
      : {}),
    ...(safeResumeOptimizationNumber(durationMs) !== undefined
      ? { [ANALYTICS_PROPERTIES.DURATION_MS]: durationMs as number }
      : {}),
    ...(safeFailureCode ? { [ANALYTICS_PROPERTIES.FAILURE_CODE]: safeFailureCode } : {}),
  });
};

export const trackResumeOptimizationBankSuggestionClick = ({
  resumeId,
  runId,
  action,
  bankSuggestionCount,
}: {
  resumeId?: string | null;
  runId?: string | null;
  action: ResumeOptimizationAnalyticsBankAction;
  bankSuggestionCount: number;
}) => {
  trackEvent(ANALYTICS_EVENTS.RESUME_OPTIMIZATION_BANK_SUGGESTION_CLICK, {
    ...buildSafeResumeOptimizationIdentifiers({ resumeId, runId }),
    [ANALYTICS_PROPERTIES.ACTION]: action,
    [ANALYTICS_PROPERTIES.BANK_SUGGESTION_COUNT]: bankSuggestionCount,
  });
};

export const trackResumeOptimizationPreviewView = ({
  resumeId,
  runId,
  directChangeCount,
  questionCount,
  blockedChangeCount,
  bankSuggestionCount,
}: Pick<
  ResumeOptimizationAnalyticsPlanMetrics,
  'resumeId' | 'runId' | 'directChangeCount' | 'questionCount' | 'blockedChangeCount' | 'bankSuggestionCount'
>) => {
  trackEvent(ANALYTICS_EVENTS.RESUME_OPTIMIZATION_PREVIEW_VIEW, {
    ...buildSafeResumeOptimizationIdentifiers({ resumeId, runId }),
    ...(safeResumeOptimizationNumber(directChangeCount) !== undefined
      ? { [ANALYTICS_PROPERTIES.DIRECT_CHANGE_COUNT]: directChangeCount as number }
      : {}),
    ...(safeResumeOptimizationNumber(questionCount) !== undefined
      ? { [ANALYTICS_PROPERTIES.QUESTION_COUNT]: questionCount as number }
      : {}),
    ...(safeResumeOptimizationNumber(blockedChangeCount) !== undefined
      ? { [ANALYTICS_PROPERTIES.BLOCKED_CHANGE_COUNT]: blockedChangeCount as number }
      : {}),
    ...(safeResumeOptimizationNumber(bankSuggestionCount) !== undefined
      ? { [ANALYTICS_PROPERTIES.BANK_SUGGESTION_COUNT]: bankSuggestionCount as number }
      : {}),
  });
};
