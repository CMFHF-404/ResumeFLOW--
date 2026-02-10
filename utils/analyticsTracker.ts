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
const TRACK_ONCE_PREFIX = 'resumeFlow.analytics.once';
const SIGN_UP_EVENT_TIMEOUT_MS = 1200;

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

type AiPolishPayload = {
  source: 'experience_bank' | 'resume_editor';
  field: string;
  category?: string;
  action?: AiPolishAction;
  durationMs?: number;
};

type JDAnalysisPayload = {
  resumeId?: string | null;
  matchScore?: number | null;
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

export const trackJDAnalysisStart = ({ resumeId }: JDAnalysisPayload) => {
  trackEvent(ANALYTICS_EVENTS.JD_ANALYSIS_START, {
    ...(resumeId ? { [ANALYTICS_PROPERTIES.RESUME_ID]: resumeId } : {}),
  });
};

export const trackJDAnalysisComplete = ({
  resumeId,
  matchScore,
  durationMs,
}: JDAnalysisPayload, authUserKey?: string | null) => {
  trackEvent(ANALYTICS_EVENTS.JD_ANALYSIS_COMPLETE, {
    ...(resumeId ? { [ANALYTICS_PROPERTIES.RESUME_ID]: resumeId } : {}),
    ...(typeof matchScore === 'number' ? { [ANALYTICS_PROPERTIES.MATCH_SCORE]: matchScore } : {}),
    ...(typeof durationMs === 'number' ? { [ANALYTICS_PROPERTIES.DURATION_MS]: durationMs } : {}),
  });
  incrementAnalyticsCounter(authUserKey, 'aiAnalysisCount');
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
