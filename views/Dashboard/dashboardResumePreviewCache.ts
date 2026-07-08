import type { DashboardResumePreviewSnapshot } from './resumePreviewState';

export type DashboardResumePreviewLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export type DashboardResumePreviewEntry = {
  cacheKey: string;
  status: DashboardResumePreviewLoadStatus;
  snapshot?: DashboardResumePreviewSnapshot;
  error?: string;
};

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
