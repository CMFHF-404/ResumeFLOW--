const PRESENT_LABEL = "至今";

/**
 * 将日期字符串转换为后端存储格式，统一到月粒度的当月 1 日。
 * @param dateStr 日期字符串，例如 "2017.09"、"2017-09" 或 "2017年9月"
 * @returns ISO 格式的日期字符串，例如 "2017-09-01"，如果为空或非法则返回 undefined
 */
export const convertDateToISO = (dateStr: string | undefined): string | undefined => {
  if (!dateStr || !dateStr.trim()) {
    return undefined;
  }

  const trimmed = dateStr.trim();
  const normalized = trimmed
    .replace(/年/g, '-')
    .replace(/月/g, '-')
    .replace(/日/g, '')
    .replace(/[./]/g, '-')
    .replace(/\s+/g, '')
    .replace(/-+$/g, '');
  const match = normalized.match(/^(\d{4})(?:-(\d{1,2})(?:-\d{1,2})?)?$/);
  if (!match) {
    return undefined;
  }

  const year = match[1];
  const month = Number(match[2] || '1');
  if (month < 1 || month > 12) {
    return undefined;
  }
  return `${year}-${String(month).padStart(2, '0')}-01`;
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

export const formatYearMonth = (value?: string): string => {
  if (!value) {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const normalized = convertDateToISO(trimmed);
  if (normalized) {
    return normalized.slice(0, 7).replace("-", ".");
  }
  return trimmed.replace(/-/g, ".");
};

export const normalizeDateInput = (value: string): string | undefined => {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return convertDateToISO(trimmed);
};

export const buildExperienceDate = (
  start?: string,
  end?: string,
  isCurrent?: boolean
): string => {
  const startText = formatYearMonth(start);
  const endText = isCurrent ? PRESENT_LABEL : formatYearMonth(end);
  if (startText && endText) {
    return `${startText} - ${endText}`;
  }
  return startText || endText || "";
};
