import type { MutableRefObject } from 'react';

const CARD_EDGE_BASE_CLASS = 'card-edge-motion';
const CARD_EDGE_EXPAND_CLASS = 'card-edge-expand';
const CARD_EDGE_COLLAPSE_CLASS = 'card-edge-collapse';

/**
 * 将日期字符串从前端格式（YYYY.MM 或 YYYY-MM）转换为后端期望的 ISO 日期格式（YYYY-MM-DD）
 * @param dateStr 日期字符串，例如 "2017.09" 或 "2017-09"
 * @returns ISO 格式的日期字符串，例如 "2017-09-01"，如果为空则返回 undefined
 */
export const convertDateToISO = (dateStr: string | undefined): string | undefined => {
  if (!dateStr || !dateStr.trim()) {
    return undefined;
  }

  const trimmed = dateStr.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const parts = trimmed.split(/[.\-]/);
  if (parts.length >= 2) {
    const year = parts[0].padStart(4, '0');
    const month = parts[1].padStart(2, '0');
    return `${year}-${month}-01`;
  }

  if (parts.length === 1 && parts[0].length === 4) {
    return `${parts[0]}-01-01`;
  }

  return undefined;
};

export const parseYearMonthValue = (dateStr?: string): number | null => {
  if (!dateStr) return null;
  const trimmed = dateStr.trim();
  if (!trimmed || trimmed === '至今' || trimmed === 'Present') return null;

  if (/^\d{4}$/.test(trimmed)) {
    return Number(trimmed) * 12 + 1;
  }

  const normalized = trimmed.replace('.', '-');
  const parts = normalized.split('-');
  if (parts.length < 2) return null;

  const year = Number(parts[0]);
  const month = Number(parts[1]);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  if (month < 1 || month > 12) return null;

  return year * 12 + month;
};

export const getTodayLocalISODate = (): string => {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const resolveCardMotionClass = (isCollapsing: boolean) => {
  return isCollapsing
    ? `${CARD_EDGE_BASE_CLASS} ${CARD_EDGE_COLLAPSE_CLASS}`
    : `${CARD_EDGE_BASE_CLASS} ${CARD_EDGE_EXPAND_CLASS}`;
};

export const runDedupedRefresh = async <T,>(
  inFlightRef: MutableRefObject<Promise<T> | null>,
  task: () => Promise<T>
): Promise<T> => {
  if (inFlightRef.current) {
    return inFlightRef.current;
  }
  let request: Promise<T>;
  request = task().finally(() => {
    if (inFlightRef.current === request) {
      inFlightRef.current = null;
    }
  });
  inFlightRef.current = request;
  return request;
};
