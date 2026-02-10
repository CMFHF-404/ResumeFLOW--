type AnalyticsEventParams = Record<string, string | number | boolean | null | undefined>;

type TrackEventOptions = {
  transport?: 'beacon' | 'xhr';
  timeoutMs?: number;
  waitForCallback?: boolean;
};

type HmtTrackEventCommand = ['_trackEvent', string, string, string?, number?];
type HmtTrackPageViewCommand = ['_trackPageview', string];
type HmtCommand = HmtTrackEventCommand | HmtTrackPageViewCommand;
type HmtQueue = { push: (command: HmtCommand) => number };
type BaiduAnalyticsStatus = 'loading' | 'loaded' | 'failed';

const hasWindow = typeof window !== 'undefined';
const DEBUG_STORAGE_KEY = 'resumeFlow.analytics.debug';
const DEFAULT_EVENT_TIMEOUT_MS = 1200;
const EVENT_CATEGORY = 'resume_flow';
const PAGE_VIEW_PARAM_KEY = 'rf_view';
const BAIDU_ANALYTICS_STATUS_KEY = '__baiduAnalyticsStatus';
// Baidu analytics does not expose delivery callbacks; keep a short delay to avoid long blocks.
const EVENT_FLUSH_DELAY_MS = 200;

const getBaiduAnalyticsStatus = () => {
  if (!hasWindow) {
    return null;
  }
  const status = (window as Window & {
    [BAIDU_ANALYTICS_STATUS_KEY]?: BaiduAnalyticsStatus;
  })[BAIDU_ANALYTICS_STATUS_KEY];
  return status ?? null;
};

const isBaiduAnalyticsLoaded = () => getBaiduAnalyticsStatus() === 'loaded';

const isBaiduAnalyticsFailed = () => getBaiduAnalyticsStatus() === 'failed';

const ensureHmtQueue = (): HmtQueue | null => {
  if (!hasWindow) {
    return null;
  }
  if (isBaiduAnalyticsFailed()) {
    logDebug('hmt load failed');
    return null;
  }
  if (!window._hmt) {
    window._hmt = [];
  }
  return window._hmt as unknown as HmtQueue;
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
    return {};
  }
  return Object.entries(params).reduce<Record<string, any>>((acc, [key, value]) => {
    if (value === undefined) {
      return acc;
    }
    acc[key] = value;
    return acc;
  }, {});
};

const buildEventLabel = (params?: AnalyticsEventParams) => {
  const payload = sanitizeParams(params);
  if (!Object.keys(payload).length) {
    return '';
  }
  try {
    return JSON.stringify(payload);
  } catch (error) {
    return '';
  }
};

const buildPageViewPath = (path: string, view?: string) => {
  if (!view) {
    return path;
  }
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}${PAGE_VIEW_PARAM_KEY}=${encodeURIComponent(view)}`;
};

const pushCommand = (command: HmtCommand, immediate?: boolean) => {
  const queue = ensureHmtQueue();
  if (!queue) {
    logDebug('hmt not available', { command });
    return false;
  }
  schedule(() => queue.push(command), immediate);
  return true;
};

const emitEvent = (
  event: string,
  params?: AnalyticsEventParams,
  immediate?: boolean
) => {
  const label = buildEventLabel(params);
  const command: HmtCommand = label
    ? ['_trackEvent', EVENT_CATEGORY, event, label]
    : ['_trackEvent', EVENT_CATEGORY, event];
  logDebug(immediate ? 'event:immediate' : 'event', { event, params });
  return pushCommand(command, immediate);
};

const resolveTimeout = (timeoutMs?: number) => {
  if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return timeoutMs;
  }
  return DEFAULT_EVENT_TIMEOUT_MS;
};

const resolveFlushDelay = (timeoutMs: number) => {
  if (isBaiduAnalyticsLoaded()) {
    return Math.min(timeoutMs, EVENT_FLUSH_DELAY_MS);
  }
  return timeoutMs;
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
    setTimeout(resolve, resolveFlushDelay(timeoutMs));
  });
};

export const trackPageView = (view: string, path: string) => {
  const safePath = path || '/';
  const pagePath = buildPageViewPath(safePath, view);
  logDebug('page_view', { view, path: pagePath });
  return pushCommand(['_trackPageview', pagePath], false);
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
