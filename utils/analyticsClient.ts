type GtagEventParams = Record<string, any>;

type GtagFn = (...args: any[]) => void;

type TrackEventOptions = {
  transport?: 'beacon' | 'xhr';
  timeoutMs?: number;
  waitForCallback?: boolean;
};

const hasWindow = typeof window !== 'undefined';
const DEBUG_STORAGE_KEY = 'resumeFlow.analytics.debug';
const DEFAULT_EVENT_TIMEOUT_MS = 1200;

const getGtag = (): GtagFn | null => {
  if (!hasWindow) {
    return null;
  }
  const gtag = window.gtag;
  return typeof gtag === 'function' ? gtag : null;
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

const buildEventPayload = (
  params?: GtagEventParams,
  options?: TrackEventOptions,
  callback?: () => void
) => {
  const payload: GtagEventParams = { ...(params ?? {}) };
  if (options?.transport) {
    payload.transport_type = options.transport;
  }
  if (typeof options?.timeoutMs === 'number') {
    payload.event_timeout = options.timeoutMs;
  }
  if (callback) {
    payload.event_callback = callback;
  }
  return payload;
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

const emitEvent = (
  event: string,
  params?: GtagEventParams,
  options?: TrackEventOptions,
  immediate?: boolean,
  callback?: () => void
) => {
  const gtag = getGtag();
  if (!gtag) {
    logDebug('gtag not available', { event, params });
    return false;
  }
  const payload = buildEventPayload(params, options, callback);
  logDebug(immediate ? 'event:immediate' : 'event', { event, params: payload });
  schedule(() => gtag('event', event, payload), immediate);
  return true;
};

const resolveTimeout = (timeoutMs?: number) => {
  if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return timeoutMs;
  }
  return DEFAULT_EVENT_TIMEOUT_MS;
};

const waitForEventCallback = (
  event: string,
  params?: GtagEventParams,
  options?: TrackEventOptions
) => {
  const timeoutMs = resolveTimeout(options?.timeoutMs);
  return new Promise<void>((resolve) => {
    let resolved = false;
    const finish = () => {
      if (resolved) {
        return;
      }
      resolved = true;
      resolve();
    };
    const didEmit = emitEvent(
      event,
      params,
      { ...options, timeoutMs },
      true,
      finish
    );
    if (!didEmit) {
      finish();
      return;
    }
    setTimeout(finish, timeoutMs + 50);
  });
};

export const trackEvent = (
  event: string,
  params?: GtagEventParams,
  options?: TrackEventOptions
) => {
  return emitEvent(event, params, options, false);
};

export const trackEventImmediate = (
  event: string,
  params?: GtagEventParams,
  options?: TrackEventOptions
) => {
  if (options?.waitForCallback) {
    return waitForEventCallback(event, params, options);
  }
  emitEvent(event, params, options, true);
  return Promise.resolve();
};
