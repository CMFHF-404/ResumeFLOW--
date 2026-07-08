import { useCallback, useEffect, useRef, useState } from 'react';
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
  resolveDashboardResumePreviewEntry,
  shouldLoadDashboardResumePreviewEntry,
  type DashboardResumePreviewEntry,
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
  ensurePreview: (resume: Resume) => void;
  getPreviewEntry: (resume: Resume) => DashboardResumePreviewEntry;
};

const previewSnapshotCache = new Map<string, DashboardResumePreviewSnapshot>();
const previewInFlightRequests = new Map<string, Promise<DashboardResumePreviewSnapshot>>();
let previewSnapshotCacheOwnerKey: string | null | undefined;

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
  const globalDataPromiseRef = useRef<Promise<DashboardResumePreviewGlobalData> | null>(null);
  const lastOwnerKeyRef = useRef<string | null | undefined>(authUserKey);
  const lastPreviewDataRevisionRef = useRef(previewDataRevision);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    ensureDashboardResumePreviewSnapshotCacheOwner(authUserKey);
    if (lastOwnerKeyRef.current === authUserKey) {
      return;
    }
    lastOwnerKeyRef.current = authUserKey;
    globalDataPromiseRef.current = null;
    setEntries({});
    clearDashboardResumePreviewSnapshotCache();
  }, [authUserKey]);

  useEffect(() => {
    if (isAuthenticated) {
      return;
    }
    globalDataPromiseRef.current = null;
    setEntries({});
  }, [isAuthenticated]);

  useEffect(() => subscribeResumePreviewDataRevision(() => {
    setPreviewDataRevision(getResumePreviewDataRevision());
  }), []);

  useEffect(() => {
    if (lastPreviewDataRevisionRef.current === previewDataRevision) {
      return;
    }
    lastPreviewDataRevisionRef.current = previewDataRevision;
    globalDataPromiseRef.current = null;
    setEntries({});
    clearDashboardResumePreviewSnapshotCache();
  }, [previewDataRevision]);

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

  const ensurePreview = useCallback((resume: Resume) => {
    if (!isAuthenticated) {
      return;
    }
    const cacheKey = buildDashboardResumePreviewCacheKey(
      resume.id,
      resume.updatedAtValue,
      previewDataRevision,
      authUserKey
    );
    const cachedSnapshot = previewSnapshotCache.get(cacheKey);
    const currentEntry = resolveDashboardResumePreviewEntry(
      entries[resume.id],
      resume.id,
      resume.updatedAtValue,
      previewDataRevision,
      authUserKey
    );

    if (cachedSnapshot) {
      setEntries((prev) => ({
        ...prev,
        [resume.id]: {
          cacheKey,
          status: 'ready',
          snapshot: cachedSnapshot,
        },
      }));
      return;
    }

    if (!shouldLoadDashboardResumePreviewEntry(currentEntry)) {
      return;
    }

    setEntries((prev) => ({
      ...prev,
      [resume.id]: {
        cacheKey,
        status: 'loading',
      },
    }));

    let request = previewInFlightRequests.get(cacheKey);
    if (!request) {
      request = (async () => {
        const globalData = await ensureGlobalData();
        return loadDashboardResumePreviewSnapshot(resume.id, globalData);
      })();
      previewInFlightRequests.set(cacheKey, request);
      const clearInFlightRequest = () => {
        if (previewInFlightRequests.get(cacheKey) === request) {
          previewInFlightRequests.delete(cacheKey);
        }
      };
      request.then(clearInFlightRequest, clearInFlightRequest);
    }

    request
      .then((snapshot) => {
        previewSnapshotCache.set(cacheKey, snapshot);
        if (!mountedRef.current) {
          return;
        }
        setEntries((prev) => {
          const latest = prev[resume.id];
          if (!latest || latest.cacheKey !== cacheKey) {
            return prev;
          }
          return {
            ...prev,
            [resume.id]: {
              cacheKey,
              status: 'ready',
              snapshot,
            },
          };
        });
      })
      .catch((error) => {
        console.error('[DashboardResumePreview] 加载缩略预览失败:', error);
        if (!mountedRef.current) {
          return;
        }
        setEntries((prev) => {
          const latest = prev[resume.id];
          if (!latest || latest.cacheKey !== cacheKey) {
            return prev;
          }
          return {
            ...prev,
            [resume.id]: {
              cacheKey,
              status: 'error',
              error: DASHBOARD_RESUME_PREVIEW_ERROR_TEXT,
            },
          };
        });
      });
  }, [authUserKey, ensureGlobalData, entries, isAuthenticated, previewDataRevision]);

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
