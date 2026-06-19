import type { Resume } from '../../types';
import { resolveDashboardResumeLocalMatchRate } from '../../utils/dashboardResumeMapper';
import { formatRelativeTime } from '../../utils/timeUtils';

type MatchRateResolver = (id: string) => number | undefined | null;
type DashboardResumeServerUpdate = Pick<Resume, 'id'> & {
  title: string;
  updated_at: string;
};

export type DashboardSortMode = 'created-desc' | 'created-asc' | 'updated-desc' | 'match-desc' | 'match-asc';
export type DashboardTimePreset = 'all' | '7d' | '30d' | '90d' | 'custom';
export type DashboardMatchPreset = 'all' | 'scored' | '80' | '90' | 'custom';

export type DashboardTimeFilter = {
  preset: DashboardTimePreset;
  startDate: string;
  endDate: string;
};

export type DashboardMatchFilter = {
  preset: DashboardMatchPreset;
  min: string;
  max: string;
};

export type DashboardVisibleResumeOptions = {
  searchQuery?: string;
  sortMode?: DashboardSortMode;
  timeFilter?: DashboardTimeFilter;
  matchFilter?: DashboardMatchFilter;
  nowMs?: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SORT_MODE: DashboardSortMode = 'created-desc';

export const normalizeDashboardSearchText = (value: string) => value.trim().toLocaleLowerCase();

const parseTimestampMs = (value?: string) => {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseDateBoundaryMs = (value: string, boundary: 'start' | 'end') => {
  if (!value) {
    return null;
  }
  const suffix = boundary === 'start' ? 'T00:00:00.000' : 'T23:59:59.999';
  const parsed = Date.parse(`${value}${suffix}`);
  return Number.isFinite(parsed) ? parsed : null;
};

const clampPercent = (value: number) => Math.min(Math.max(value, 0), 100);

const parsePercentInput = (value: string) => {
  if (value.trim() === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clampPercent(parsed) : null;
};

const resolveResumeCreatedMs = (resume: Resume) => parseTimestampMs(resume.createdAtValue ?? resume.createdAt);
const resolveResumeUpdatedMs = (resume: Resume) => parseTimestampMs(resume.updatedAtValue ?? resume.lastModified);

const matchesSearchQuery = (resume: Resume, searchQuery: string) => {
  const normalizedQuery = normalizeDashboardSearchText(searchQuery);
  if (!normalizedQuery) {
    return true;
  }
  return normalizeDashboardSearchText(resume.name).includes(normalizedQuery);
};

const matchesTimeFilter = (
  resume: Resume,
  filter: DashboardTimeFilter | undefined,
  nowMs: number
) => {
  if (!filter || filter.preset === 'all') {
    return true;
  }
  const createdMs = resolveResumeCreatedMs(resume);
  if (createdMs === null) {
    return false;
  }
  if (filter.preset === 'custom') {
    const startMs = parseDateBoundaryMs(filter.startDate, 'start');
    const endMs = parseDateBoundaryMs(filter.endDate, 'end');
    return (startMs === null || createdMs >= startMs) && (endMs === null || createdMs <= endMs);
  }
  const days = filter.preset === '7d' ? 7 : filter.preset === '30d' ? 30 : 90;
  return createdMs >= nowMs - days * DAY_MS;
};

const matchesMatchFilter = (resume: Resume, filter: DashboardMatchFilter | undefined) => {
  if (!filter || filter.preset === 'all') {
    return true;
  }
  if (filter.preset === 'scored') {
    return resume.matchRate > 0;
  }
  if (filter.preset === '80') {
    return resume.matchRate >= 80;
  }
  if (filter.preset === '90') {
    return resume.matchRate >= 90;
  }
  const min = parsePercentInput(filter.min);
  const max = parsePercentInput(filter.max);
  return (min === null || resume.matchRate >= min) && (max === null || resume.matchRate <= max);
};

const compareNullableNumber = (
  first: number | null,
  second: number | null,
  direction: 'asc' | 'desc'
) => {
  const firstValue = first ?? Number.NEGATIVE_INFINITY;
  const secondValue = second ?? Number.NEGATIVE_INFINITY;
  return direction === 'asc' ? firstValue - secondValue : secondValue - firstValue;
};

const compareResumesBySortMode = (first: Resume, second: Resume, sortMode: DashboardSortMode) => {
  if (sortMode === 'created-asc') {
    return compareNullableNumber(resolveResumeCreatedMs(first), resolveResumeCreatedMs(second), 'asc');
  }
  if (sortMode === 'updated-desc') {
    return compareNullableNumber(resolveResumeUpdatedMs(first), resolveResumeUpdatedMs(second), 'desc');
  }
  if (sortMode === 'match-desc') {
    return second.matchRate - first.matchRate;
  }
  if (sortMode === 'match-asc') {
    return first.matchRate - second.matchRate;
  }
  return compareNullableNumber(resolveResumeCreatedMs(first), resolveResumeCreatedMs(second), 'desc');
};

export const getVisibleDashboardResumes = (
  items: Resume[],
  options: DashboardVisibleResumeOptions = {}
) => {
  const nowMs = options.nowMs ?? Date.now();
  const sortMode = options.sortMode ?? DEFAULT_SORT_MODE;
  return items
    .map((resume, index) => ({ resume, index }))
    .filter(({ resume }) => matchesSearchQuery(resume, options.searchQuery ?? ''))
    .filter(({ resume }) => matchesTimeFilter(resume, options.timeFilter, nowMs))
    .filter(({ resume }) => matchesMatchFilter(resume, options.matchFilter))
    .sort((first, second) => {
      const result = compareResumesBySortMode(first.resume, second.resume, sortMode);
      return result === 0 ? first.index - second.index : result;
    })
    .map(({ resume }) => resume);
};

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
      && item.createdAtValue === other.createdAtValue
      && item.lastModified === other.lastModified
      && item.updatedAtValue === other.updatedAtValue
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

export const filterSelectedDashboardResumeIds = (ids: string[], visibleResumes: Resume[]) => {
  if (ids.length === 0 || visibleResumes.length === 0) {
    return [];
  }
  const visibleIds = new Set(visibleResumes.map((resume) => resume.id));
  return ids.filter((id) => visibleIds.has(id));
};

export const filterExistingResumeIds = (ids: string[], resumes: Resume[]) => {
  if (ids.length === 0 || resumes.length === 0) {
    return [];
  }
  const existingIds = new Set(resumes.map((resume) => resume.id));
  return ids.filter((id) => existingIds.has(id));
};

export const mergeDashboardResumeServerUpdate = (
  resume: Resume,
  updated: DashboardResumeServerUpdate
): Resume => ({
  ...resume,
  name: updated.title,
  lastModified: formatRelativeTime(updated.updated_at),
  updatedAtValue: updated.updated_at,
});

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
