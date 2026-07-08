import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
  type SetStateAction,
} from 'react';
import type { Resume } from '../../types';
import {
  DASHBOARD_RESUME_PREVIEW_ERROR_TEXT,
  loadDashboardResumePreviewGlobalData,
  loadDashboardResumePreviewSnapshot,
  type DashboardResumePreviewGlobalData,
  type DashboardResumePreviewSnapshot,
} from './resumePreviewState';
import {
  buildDashboardResumePreviewCacheKey,
  isDashboardResumePreviewQueueGenerationCurrent,
  resolveDashboardResumePreviewEntry,
  shouldLoadDashboardResumePreviewEntry,
  type DashboardResumePreviewEntry,
  type DashboardResumePreviewLoadPriority,
  type DashboardResumePreviewQueueItem,
  takeNextDashboardResumePreviewQueueItem,
  upsertDashboardResumePreviewQueueItem,
} from './dashboardResumePreviewCache';
import {
  getResumePreviewDataRevision,
  subscribeResumePreviewDataRevision,
} from '../../services/resumePreviewDataRevision';

type UseDashboardResumePreviewCacheOptions = {
  isAuthenticated: boolean;
  authUserKey?: string | null;
};

export type DashboardResumePreviewCacheController = {
  ensurePreview: (
    resume: Resume,
    options?: { priority?: DashboardResumePreviewLoadPriority }
  ) => void;
  getPreviewEntry: (resume: Resume) => DashboardResumePreviewEntry;
};

const MAX_DASHBOARD_PREVIEW_CONCURRENT_REQUESTS = 2;
const DASHBOARD_PREVIEW_QUEUE_IDLE_TIMEOUT_MS = 300;
const DASHBOARD_PREVIEW_QUEUE_TIMEOUT_MS = 24;

const previewSnapshotCache = new Map<string, DashboardResumePreviewSnapshot>();
const previewInFlightRequests = new Map<string, Promise<DashboardResumePreviewSnapshot>>();
let previewSnapshotCacheOwnerKey: string | null | undefined;

type DashboardPreviewIdleWindow = Window & {
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout: number }
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

const scheduleDashboardResumePreviewQueueDrain = (callback: () => void) => {
  if (typeof window === 'undefined') {
    return () => undefined;
  }
  const browserWindow = window as DashboardPreviewIdleWindow;
  if (typeof browserWindow.requestIdleCallback === 'function') {
    const handle = browserWindow.requestIdleCallback(callback, {
      timeout: DASHBOARD_PREVIEW_QUEUE_IDLE_TIMEOUT_MS,
    });
    return () => browserWindow.cancelIdleCallback?.(handle);
  }
  const timeoutId = window.setTimeout(callback, DASHBOARD_PREVIEW_QUEUE_TIMEOUT_MS);
  return () => window.clearTimeout(timeoutId);
};

export const clearDashboardResumePreviewSnapshotCache = () => {
  previewSnapshotCache.clear();
  previewInFlightRequests.clear();
};

const ensureDashboardResumePreviewSnapshotCacheOwner = (ownerKey?: string | null) => {
  const normalizedOwnerKey = ownerKey ?? null;
  if (previewSnapshotCacheOwnerKey === normalizedOwnerKey) {
    return;
  }
  previewSnapshotCacheOwnerKey = normalizedOwnerKey;
  clearDashboardResumePreviewSnapshotCache();
};

export const useDashboardResumePreviewCache = ({
  isAuthenticated,
  authUserKey = null,
}: UseDashboardResumePreviewCacheOptions): DashboardResumePreviewCacheController => {
  const [entries, setEntries] = useState<Record<string, DashboardResumePreviewEntry>>({});
  const [previewDataRevision, setPreviewDataRevision] = useState(getResumePreviewDataRevision);
  const mountedRef = useRef(true);
  const entriesRef = useRef<Record<string, DashboardResumePreviewEntry>>({});
  const globalDataPromiseRef = useRef<Promise<DashboardResumePreviewGlobalData> | null>(null);
  const previewQueueRef = useRef<DashboardResumePreviewQueueItem[]>([]);
  const activePreviewRequestCountRef = useRef(0);
  const previewQueueGenerationRef = useRef(0);
  const previewQueueSequenceRef = useRef(0);
  const cancelScheduledDrainRef = useRef<(() => void) | null>(null);
  const lastOwnerKeyRef = useRef<string | null | undefined>(authUserKey);
  const lastPreviewDataRevisionRef = useRef(previewDataRevision);

  const setPreviewEntries = useCallback((
    value: SetStateAction<Record<string, DashboardResumePreviewEntry>>
  ) => {
    setEntries((prev) => {
      const next = typeof value === 'function'
        ? (value as (prevState: Record<string, DashboardResumePreviewEntry>) => Record<string, DashboardResumePreviewEntry>)(prev)
        : value;
      entriesRef.current = next;
      return next;
    });
  }, []);

  const resetPreviewQueue = useCallback(() => {
    previewQueueGenerationRef.current += 1;
    previewQueueRef.current = [];
    activePreviewRequestCountRef.current = 0;
    if (cancelScheduledDrainRef.current) {
      cancelScheduledDrainRef.current();
      cancelScheduledDrainRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      resetPreviewQueue();
    };
  }, [resetPreviewQueue]);

  useEffect(() => {
    ensureDashboardResumePreviewSnapshotCacheOwner(authUserKey);
    if (lastOwnerKeyRef.current === authUserKey) {
      return;
    }
    lastOwnerKeyRef.current = authUserKey;
    globalDataPromiseRef.current = null;
    resetPreviewQueue();
    setPreviewEntries({});
    clearDashboardResumePreviewSnapshotCache();
  }, [authUserKey, resetPreviewQueue, setPreviewEntries]);

  useEffect(() => {
    if (isAuthenticated) {
      return;
    }
    globalDataPromiseRef.current = null;
    resetPreviewQueue();
    setPreviewEntries({});
  }, [isAuthenticated, resetPreviewQueue, setPreviewEntries]);

  useEffect(() => subscribeResumePreviewDataRevision(() => {
    setPreviewDataRevision(getResumePreviewDataRevision());
  }), []);

  useEffect(() => {
    if (lastPreviewDataRevisionRef.current === previewDataRevision) {
      return;
    }
    lastPreviewDataRevisionRef.current = previewDataRevision;
    globalDataPromiseRef.current = null;
    resetPreviewQueue();
    setPreviewEntries({});
    clearDashboardResumePreviewSnapshotCache();
  }, [previewDataRevision, resetPreviewQueue, setPreviewEntries]);

  const ensureGlobalData = useCallback(() => {
    if (!globalDataPromiseRef.current) {
      const request = loadDashboardResumePreviewGlobalData()
        .catch((error) => {
          if (globalDataPromiseRef.current === request) {
            globalDataPromiseRef.current = null;
          }
          throw error;
        });
      globalDataPromiseRef.current = request;
    }
    return globalDataPromiseRef.current;
  }, []);

  const scheduleQueueDrain = useCallback((drain: () => void) => {
    if (cancelScheduledDrainRef.current) {
      return;
    }
    cancelScheduledDrainRef.current = scheduleDashboardResumePreviewQueueDrain(() => {
      cancelScheduledDrainRef.current = null;
      drain();
    });
  }, []);

  const drainPreviewQueueRef = useRef<() => void>(() => undefined);

  const completePreviewQueueItem = useCallback((requestGeneration: number) => {
    if (!isDashboardResumePreviewQueueGenerationCurrent(
      previewQueueGenerationRef.current,
      requestGeneration
    )) {
      return;
    }
    activePreviewRequestCountRef.current = Math.max(
      0,
      activePreviewRequestCountRef.current - 1
    );
    if (mountedRef.current && previewQueueRef.current.length > 0) {
      scheduleQueueDrain(drainPreviewQueueRef.current);
    }
  }, [scheduleQueueDrain]);

  const loadQueuedPreview = useCallback((item: DashboardResumePreviewQueueItem) => {
    const cachedSnapshot = previewSnapshotCache.get(item.cacheKey);
    if (cachedSnapshot) {
      startTransition(() => {
        setPreviewEntries((prev) => {
          const latest = prev[item.resumeId];
          if (!latest || latest.cacheKey !== item.cacheKey) {
            return prev;
          }
          return {
            ...prev,
            [item.resumeId]: {
              cacheKey: item.cacheKey,
              status: 'ready',
              snapshot: cachedSnapshot,
            },
          };
        });
      });
      return;
    }

    const requestGeneration = previewQueueGenerationRef.current;
    activePreviewRequestCountRef.current += 1;
    setPreviewEntries((prev) => {
      const latest = prev[item.resumeId];
      if (!latest || latest.cacheKey !== item.cacheKey) {
        return prev;
      }
      return {
        ...prev,
        [item.resumeId]: {
          cacheKey: item.cacheKey,
          status: 'loading',
        },
      };
    });

    let request = previewInFlightRequests.get(item.cacheKey);
    if (!request) {
      request = (async () => {
        const globalData = await ensureGlobalData();
        return loadDashboardResumePreviewSnapshot(item.resumeId, globalData);
      })();
      previewInFlightRequests.set(item.cacheKey, request);
      const clearInFlightRequest = () => {
        if (previewInFlightRequests.get(item.cacheKey) === request) {
          previewInFlightRequests.delete(item.cacheKey);
        }
      };
      request.then(clearInFlightRequest, clearInFlightRequest);
    }

    request
      .then((snapshot) => {
        if (!isDashboardResumePreviewQueueGenerationCurrent(
          previewQueueGenerationRef.current,
          requestGeneration
        )) {
          return;
        }
        previewSnapshotCache.set(item.cacheKey, snapshot);
        if (!mountedRef.current) {
          return;
        }
        startTransition(() => {
          setPreviewEntries((prev) => {
            const latest = prev[item.resumeId];
            if (!latest || latest.cacheKey !== item.cacheKey) {
              return prev;
            }
            return {
              ...prev,
              [item.resumeId]: {
                cacheKey: item.cacheKey,
                status: 'ready',
                snapshot,
              },
            };
          });
        });
      })
      .catch((error) => {
        if (!isDashboardResumePreviewQueueGenerationCurrent(
          previewQueueGenerationRef.current,
          requestGeneration
        )) {
          return;
        }
        console.error('[DashboardResumePreview] 加载缩略预览失败:', error);
        if (!mountedRef.current) {
          return;
        }
        startTransition(() => {
          setPreviewEntries((prev) => {
            const latest = prev[item.resumeId];
            if (!latest || latest.cacheKey !== item.cacheKey) {
              return prev;
            }
            return {
              ...prev,
              [item.resumeId]: {
                cacheKey: item.cacheKey,
                status: 'error',
                error: DASHBOARD_RESUME_PREVIEW_ERROR_TEXT,
              },
            };
          });
        });
      })
      .finally(() => completePreviewQueueItem(requestGeneration));
  }, [completePreviewQueueItem, ensureGlobalData, setPreviewEntries]);

  const drainPreviewQueue = useCallback(() => {
    if (!mountedRef.current || !isAuthenticated) {
      return;
    }
    while (
      activePreviewRequestCountRef.current < MAX_DASHBOARD_PREVIEW_CONCURRENT_REQUESTS
      && previewQueueRef.current.length > 0
    ) {
      const { next, remaining } = takeNextDashboardResumePreviewQueueItem(previewQueueRef.current);
      previewQueueRef.current = remaining;
      if (!next) {
        return;
      }
      loadQueuedPreview(next);
    }
  }, [isAuthenticated, loadQueuedPreview]);

  useEffect(() => {
    drainPreviewQueueRef.current = drainPreviewQueue;
  }, [drainPreviewQueue]);

  const ensurePreview = useCallback((
    resume: Resume,
    options: { priority?: DashboardResumePreviewLoadPriority } = {}
  ) => {
    if (!isAuthenticated) {
      return;
    }
    const priority = options.priority ?? 'visible';
    const cacheKey = buildDashboardResumePreviewCacheKey(
      resume.id,
      resume.updatedAtValue,
      previewDataRevision,
      authUserKey
    );
    const cachedSnapshot = previewSnapshotCache.get(cacheKey);
    const currentEntry = resolveDashboardResumePreviewEntry(
      entriesRef.current[resume.id],
      resume.id,
      resume.updatedAtValue,
      previewDataRevision,
      authUserKey
    );

    if (cachedSnapshot) {
      startTransition(() => {
        setPreviewEntries((prev) => ({
          ...prev,
          [resume.id]: {
            cacheKey,
            status: 'ready',
            snapshot: cachedSnapshot,
          },
        }));
      });
      return;
    }

    if (!shouldLoadDashboardResumePreviewEntry(currentEntry)) {
      if (currentEntry.status === 'queued') {
        previewQueueRef.current = upsertDashboardResumePreviewQueueItem(
          previewQueueRef.current,
          {
            resumeId: resume.id,
            cacheKey,
            priority,
            sequence: currentEntry.queueSequence ?? previewQueueSequenceRef.current,
          }
        );
      }
      return;
    }

    previewQueueSequenceRef.current += 1;
    const queueSequence = previewQueueSequenceRef.current;
    previewQueueRef.current = upsertDashboardResumePreviewQueueItem(
      previewQueueRef.current,
      {
        resumeId: resume.id,
        cacheKey,
        priority,
        sequence: queueSequence,
      }
    );
    setPreviewEntries((prev) => ({
      ...prev,
      [resume.id]: {
        cacheKey,
        status: 'queued',
        queueSequence,
      },
    }));
    scheduleQueueDrain(drainPreviewQueueRef.current);
  }, [authUserKey, isAuthenticated, previewDataRevision, scheduleQueueDrain, setPreviewEntries]);

  const getPreviewEntry = useCallback((resume: Resume) => (
    resolveDashboardResumePreviewEntry(
      entries[resume.id],
      resume.id,
      resume.updatedAtValue,
      previewDataRevision,
      authUserKey
    )
  ), [authUserKey, entries, previewDataRevision]);

  return {
    ensurePreview,
    getPreviewEntry,
  };
};
