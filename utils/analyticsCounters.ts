export type AnalyticsCounters = {
  exportCount: number;
  aiAnalysisCount: number;
  resumeSortCount: number;
};

export type AnalyticsCounterKey = keyof AnalyticsCounters;

const STORAGE_PREFIX = 'resumeFlow.analytics.counters';
const DEFAULT_COUNTERS: AnalyticsCounters = {
  exportCount: 0,
  aiAnalysisCount: 0,
  resumeSortCount: 0,
};

const normalizeCount = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
};

const buildStorageKey = (authUserKey?: string | null) => {
  return `${STORAGE_PREFIX}.${authUserKey ?? 'anonymous'}`;
};

const readCounters = (authUserKey?: string | null): AnalyticsCounters => {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_COUNTERS };
  }
  try {
    const raw = localStorage.getItem(buildStorageKey(authUserKey));
    if (!raw) {
      return { ...DEFAULT_COUNTERS };
    }
    const parsed = JSON.parse(raw) as Partial<AnalyticsCounters>;
    return {
      exportCount: normalizeCount(parsed.exportCount),
      aiAnalysisCount: normalizeCount(parsed.aiAnalysisCount),
      resumeSortCount: normalizeCount(parsed.resumeSortCount),
    };
  } catch (error) {
    return { ...DEFAULT_COUNTERS };
  }
};

const writeCounters = (authUserKey: string | null | undefined, counters: AnalyticsCounters) => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(buildStorageKey(authUserKey), JSON.stringify(counters));
  } catch (error) {
    // ignore storage errors
  }
};

export const getAnalyticsCounters = (authUserKey?: string | null): AnalyticsCounters => {
  return readCounters(authUserKey);
};

export const incrementAnalyticsCounter = (
  authUserKey: string | null | undefined,
  key: AnalyticsCounterKey
) => {
  const current = readCounters(authUserKey);
  const next = {
    ...current,
    [key]: current[key] + 1,
  };
  writeCounters(authUserKey, next);
  return {
    before: current[key],
    after: next[key],
    counters: next,
  };
};
