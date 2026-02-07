import posthog from 'posthog-js';
import { isPosthogEnabled } from './posthogConfig';

const TRACK_ONCE_PREFIX = 'resumeFlow.analytics.once';

const resolveOnceKey = (key: string) => `${TRACK_ONCE_PREFIX}.${key}`;

const canTrack = () => typeof window !== 'undefined' && isPosthogEnabled();

const scheduleCapture = (action: () => void) => {
  if (!canTrack()) {
    return;
  }
  if ('requestIdleCallback' in window) {
    (window as Window & { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback?.(
      () => action()
    );
    return;
  }
  setTimeout(action, 0);
};

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
    // ignore storage errors (private mode, etc.)
  }
};

export const trackEvent = (event: string, properties?: Record<string, any>) => {
  scheduleCapture(() => {
    posthog.capture(event, properties ?? {});
  });
};

const resolveFlush = () => {
  if (!canTrack()) {
    return null;
  }
  const typedPosthog = posthog as typeof posthog & { flush?: () => Promise<void> | void };
  return typeof typedPosthog.flush === 'function' ? typedPosthog.flush.bind(posthog) : null;
};

export const trackEventImmediate = (event: string, properties?: Record<string, any>) => {
  if (!canTrack()) {
    return null;
  }
  posthog.capture(event, properties ?? {});
  const flush = resolveFlush();
  return flush ? flush() : null;
};

export const trackEventOnce = (
  event: string,
  onceKey: string,
  properties?: Record<string, any>
) => {
  if (!canTrack()) {
    return;
  }
  if (hasTracked(onceKey)) {
    return;
  }
  trackEvent(event, properties);
  markTracked(onceKey);
};
