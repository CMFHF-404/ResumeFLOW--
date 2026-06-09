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

const DROPDOWN_WIDTH = 192;
const DROPDOWN_OFFSET = 4;
const DROPDOWN_VIEWPORT_PADDING = 8;
const DROPDOWN_ESTIMATED_HEIGHT = 200;

export type DropdownAnchor = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type DropdownPosition = {
  top: number;
  left: number;
};

type DropdownViewport = {
  width: number;
  height: number;
};

const resolveDropdownViewport = (): DropdownViewport => {
  if (typeof window === 'undefined') {
    return { width: 0, height: 0 };
  }
  return { width: window.innerWidth, height: window.innerHeight };
};

export const buildDropdownAnchor = (rect: Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left'>): DropdownAnchor => ({
  top: rect.top,
  right: rect.right,
  bottom: rect.bottom,
  left: rect.left,
});

const clampNumber = (value: number, min: number, max: number) => {
  return Math.min(Math.max(value, min), max);
};

export const resolveDropdownPosition = (
  anchor: DropdownAnchor,
  menuSize: { width: number; height: number },
  viewport: DropdownViewport = resolveDropdownViewport()
): DropdownPosition => {
  const menuWidth = menuSize.width || DROPDOWN_WIDTH;
  const menuHeight = menuSize.height || DROPDOWN_ESTIMATED_HEIGHT;
  const spaceBelow = viewport.height - anchor.bottom;
  const spaceAbove = anchor.top;
  const shouldOpenUp = spaceBelow < menuHeight + DROPDOWN_OFFSET && spaceAbove > spaceBelow;
  const maxTop = Math.max(DROPDOWN_VIEWPORT_PADDING, viewport.height - menuHeight - DROPDOWN_VIEWPORT_PADDING);
  const maxLeft = Math.max(DROPDOWN_VIEWPORT_PADDING, viewport.width - menuWidth - DROPDOWN_VIEWPORT_PADDING);
  const top = shouldOpenUp
    ? clampNumber(
      anchor.top - menuHeight - DROPDOWN_OFFSET,
      DROPDOWN_VIEWPORT_PADDING,
      maxTop
    )
    : clampNumber(
      anchor.bottom + DROPDOWN_OFFSET,
      DROPDOWN_VIEWPORT_PADDING,
      maxTop
    );
  const idealLeft = anchor.right - menuWidth;
  const left = clampNumber(
    idealLeft,
    DROPDOWN_VIEWPORT_PADDING,
    maxLeft
  );
  return { top, left };
};
