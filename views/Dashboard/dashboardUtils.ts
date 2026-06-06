import type { Resume } from '../../types';
import { resolveDashboardResumeLocalMatchRate } from '../../utils/dashboardResumeMapper';

type MatchRateResolver = (id: string) => number | undefined | null;

export const mergeMatchRatesIntoResumes = (
  items: Resume[],
  resolveLocalMatchRate: MatchRateResolver = resolveDashboardResumeLocalMatchRate
) => {
  let changed = false;
  const next = items.map((resume) => {
    const localMatchRate = resolveLocalMatchRate(resume.id);
    const matchRate = typeof localMatchRate === 'number' ? localMatchRate : resume.matchRate;
    const status = (matchRate > 0 ? 'final' : 'draft') as Resume['status'];
    if (resume.matchRate === matchRate && resume.status === status) {
      return resume;
    }
    changed = true;
    return { ...resume, matchRate, status };
  });
  return changed ? next : items;
};

export const areResumeListsEqual = (prev: Resume[], next: Resume[]) => {
  if (prev === next) {
    return true;
  }
  if (prev.length !== next.length) {
    return false;
  }
  return prev.every((item, index) => {
    const other = next[index];
    return item.id === other.id
      && item.name === other.name
      && item.targetRole === other.targetRole
      && item.matchRate === other.matchRate
      && item.createdAt === other.createdAt
      && item.lastModified === other.lastModified
      && item.status === other.status
      && item.type === other.type;
  });
};

export const removeResumeIds = (items: Resume[], idsToRemove: string[]) => {
  if (idsToRemove.length === 0) {
    return items;
  }
  const removeSet = new Set(idsToRemove);
  return items.filter((resume) => !removeSet.has(resume.id));
};

export const filterExistingResumeIds = (ids: string[], resumes: Resume[]) => {
  if (ids.length === 0 || resumes.length === 0) {
    return [];
  }
  const existingIds = new Set(resumes.map((resume) => resume.id));
  return ids.filter((id) => existingIds.has(id));
};
