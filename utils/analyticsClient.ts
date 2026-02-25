type AnalyticsEventParams = Record<string, string | number | boolean | null | undefined>;

type UmamiTrackFn = (eventName?: string, eventData?: Record<string, any>) => void;

type TrackEventOptions = {
  transport?: 'beacon' | 'xhr';
  timeoutMs?: number;
  waitForCallback?: boolean;
};

const hasWindow = typeof window !== 'undefined';
const DEBUG_STORAGE_KEY = 'yuanzijianli.analytics.debug';
const DEFAULT_EVENT_TIMEOUT_MS = 1200;

const getUmamiTrack = (): UmamiTrackFn | null => {
  if (!hasWindow) {
    return null;
  }
  const track = window.umami?.track;
  return typeof track === 'function' ? track : null;
};

const isDebugEnabled = () => {
  if (!hasWindow) {
    return false;
  }
  try {
    return localStorage.getItem(DEBUG_STORAGE_KEY) === '1';
  } catch (error) {
    return false;
  }
};

const logDebug = (message: string, payload?: Record<string, any>) => {
  if (!isDebugEnabled()) {
    return;
  }
  if (payload) {
    console.info('[Analytics]', message, payload);
    return;
  }
  console.info('[Analytics]', message);
};

const schedule = (task: () => void, immediate?: boolean) => {
  if (immediate) {
    task();
    return;
  }
  if (hasWindow && 'requestIdleCallback' in window) {
    (window as Window & { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback?.(
      task
    );
    return;
  }
  setTimeout(task, 0);
};

const sanitizeParams = (params?: AnalyticsEventParams) => {
  if (!params) {
    return undefined;
  }
  return Object.entries(params).reduce<Record<string, any>>((acc, [key, value]) => {
    if (value === undefined) {
      return acc;
    }
    acc[key] = value;
    return acc;
  }, {});
};

const emitEvent = (
  event: string,
  params?: AnalyticsEventParams,
  immediate?: boolean
) => {
  const track = getUmamiTrack();
  if (!track) {
    logDebug('umami not available', { event, params });
    return false;
  }
  const payload = sanitizeParams(params);
  logDebug(immediate ? 'event:immediate' : 'event', { event, params: payload });
  schedule(() => track(event, payload), immediate);
  return true;
};

const resolveTimeout = (timeoutMs?: number) => {
  if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return timeoutMs;
  }
  return DEFAULT_EVENT_TIMEOUT_MS;
};

const waitForEventFlush = (
  event: string,
  params?: AnalyticsEventParams,
  options?: TrackEventOptions
) => {
  const timeoutMs = resolveTimeout(options?.timeoutMs);
  return new Promise<void>((resolve) => {
    const didEmit = emitEvent(event, params, true);
    if (!didEmit) {
      resolve();
      return;
    }
    setTimeout(resolve, timeoutMs);
  });
};

export const trackPageView = (view: string, path: string) => {
  const track = getUmamiTrack();
  if (!track) {
    logDebug('umami not available', { view, path });
    return false;
  }
  logDebug('page_view', { view, path });
  track();
  return true;
};

export const trackEvent = (
  event: string,
  params?: AnalyticsEventParams,
  _options?: TrackEventOptions
) => {
  return emitEvent(event, params, false);
};

export const trackEventImmediate = (
  event: string,
  params?: AnalyticsEventParams,
  options?: TrackEventOptions
) => {
  if (options?.waitForCallback) {
    return waitForEventFlush(event, params, options);
  }
  emitEvent(event, params, true);
  return Promise.resolve();
};
