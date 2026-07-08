import type { DashboardResumePreviewSnapshot } from './resumePreviewState';

export type DashboardResumePreviewLoadStatus = 'idle' | 'queued' | 'loading' | 'ready' | 'error';
export type DashboardResumePreviewLoadPriority = 'visible' | 'nearby';

export type DashboardResumePreviewEntry = {
  cacheKey: string;
  status: DashboardResumePreviewLoadStatus;
  queueSequence?: number;
  snapshot?: DashboardResumePreviewSnapshot;
  error?: string;
};

export type DashboardResumePreviewQueueItem = {
  resumeId: string;
  cacheKey: string;
  priority: DashboardResumePreviewLoadPriority;
  sequence: number;
};

const DASHBOARD_RESUME_PREVIEW_PRIORITY_WEIGHT: Record<DashboardResumePreviewLoadPriority, number> = {
  visible: 0,
  nearby: 1,
};

const getHigherDashboardResumePreviewPriority = (
  current: DashboardResumePreviewLoadPriority,
  next: DashboardResumePreviewLoadPriority
) => (
  DASHBOARD_RESUME_PREVIEW_PRIORITY_WEIGHT[next] < DASHBOARD_RESUME_PREVIEW_PRIORITY_WEIGHT[current]
    ? next
    : current
);

export const buildDashboardResumePreviewCacheKey = (
  resumeId: string,
  updatedAtValue?: string,
  previewDataRevision?: number,
  ownerKey?: string | null
) => {
  const baseKey = `${resumeId}::${updatedAtValue || 'unknown'}`;
  const ownerScopedKey = ownerKey ? `${ownerKey}::${baseKey}` : baseKey;
  return typeof previewDataRevision === 'number'
    ? `${ownerScopedKey}::${previewDataRevision}`
    : ownerScopedKey;
};

export const resolveDashboardResumePreviewEntry = (
  entry: DashboardResumePreviewEntry | undefined,
  resumeId: string,
  updatedAtValue?: string,
  previewDataRevision?: number,
  ownerKey?: string | null
): DashboardResumePreviewEntry => {
  const cacheKey = buildDashboardResumePreviewCacheKey(
    resumeId,
    updatedAtValue,
    previewDataRevision,
    ownerKey
  );
  if (entry?.cacheKey === cacheKey) {
    return entry;
  }
  return {
    cacheKey,
    status: 'idle',
  };
};

export const shouldLoadDashboardResumePreviewEntry = (
  entry: DashboardResumePreviewEntry
) => entry.status === 'idle' || entry.status === 'error';

export const isDashboardResumePreviewQueueGenerationCurrent = (
  currentGeneration: number,
  requestGeneration: number
) => currentGeneration === requestGeneration;

export const compareDashboardResumePreviewQueueItems = (
  left: DashboardResumePreviewQueueItem,
  right: DashboardResumePreviewQueueItem
) => {
  const priorityDiff = DASHBOARD_RESUME_PREVIEW_PRIORITY_WEIGHT[left.priority]
    - DASHBOARD_RESUME_PREVIEW_PRIORITY_WEIGHT[right.priority];
  if (priorityDiff !== 0) {
    return priorityDiff;
  }
  return left.sequence - right.sequence;
};

export const upsertDashboardResumePreviewQueueItem = (
  queue: DashboardResumePreviewQueueItem[],
  item: DashboardResumePreviewQueueItem
): DashboardResumePreviewQueueItem[] => {
  const existingIndex = queue.findIndex((queuedItem) => queuedItem.cacheKey === item.cacheKey);
  if (existingIndex === -1) {
    return [...queue, item].sort(compareDashboardResumePreviewQueueItems);
  }

  const existing = queue[existingIndex];
  const nextQueue = queue.slice();
  nextQueue[existingIndex] = {
    ...existing,
    priority: getHigherDashboardResumePreviewPriority(existing.priority, item.priority),
  };
  return nextQueue.sort(compareDashboardResumePreviewQueueItems);
};

export const takeNextDashboardResumePreviewQueueItem = (
  queue: DashboardResumePreviewQueueItem[]
) => {
  if (queue.length === 0) {
    return {
      next: null,
      remaining: [] as DashboardResumePreviewQueueItem[],
    };
  }
  const [next, ...remaining] = queue.slice().sort(compareDashboardResumePreviewQueueItems);
  return { next, remaining };
};
