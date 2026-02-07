import {
  ANALYTICS_EVENTS,
  ANALYTICS_PROPERTIES,
  type AiPolishAction,
} from '../constants/analyticsEvents';
import { trackEvent, trackEventImmediate, trackEventOnce } from './posthog';

const FIRST_EXPERIENCE_ONCE_KEY = 'first_experience_created';

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

export const trackPageView = (view: string) => {
  const path = typeof window === 'undefined' ? '' : window.location.pathname;
  trackEvent(ANALYTICS_EVENTS.PAGE_VIEW, {
    [ANALYTICS_PROPERTIES.VIEW]: view,
    [ANALYTICS_PROPERTIES.PATH]: path,
  });
};

export const trackSignUpSuccess = () => {
  trackEvent(ANALYTICS_EVENTS.SIGN_UP_SUCCESS);
};

export const trackSignUpSuccessImmediate = () => {
  return trackEventImmediate(ANALYTICS_EVENTS.SIGN_UP_SUCCESS);
};

export const trackFirstExperienceCreated = (category?: string) => {
  trackEventOnce(ANALYTICS_EVENTS.FIRST_EXPERIENCE_CREATED, FIRST_EXPERIENCE_ONCE_KEY, {
    ...(category ? { [ANALYTICS_PROPERTIES.CATEGORY]: category } : {}),
  });
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
}: JDAnalysisPayload) => {
  trackEvent(ANALYTICS_EVENTS.JD_ANALYSIS_COMPLETE, {
    ...(resumeId ? { [ANALYTICS_PROPERTIES.RESUME_ID]: resumeId } : {}),
    ...(typeof matchScore === 'number' ? { [ANALYTICS_PROPERTIES.MATCH_SCORE]: matchScore } : {}),
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
}: ModuleReorderPayload) => {
  trackEvent(ANALYTICS_EVENTS.MODULE_REORDERED, {
    [ANALYTICS_PROPERTIES.MODULE_TYPE]: moduleType,
    [ANALYTICS_PROPERTIES.MODULE_KEY]: moduleKey,
    [ANALYTICS_PROPERTIES.FROM_POSITION]: fromPosition,
    [ANALYTICS_PROPERTIES.TO_POSITION]: toPosition,
    ...(sectionId ? { [ANALYTICS_PROPERTIES.SECTION_ID]: sectionId } : {}),
  });
};

export const trackResumeExported = () => {
  trackEvent(ANALYTICS_EVENTS.RESUME_EXPORTED);
};
