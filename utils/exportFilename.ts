const FILENAME_SAFE_PATTERN = /[\/:*?"<>|]/g;
const DATE_PART_LENGTH = 2;
const DATE_PAD_CHAR = '0';
const MONTH_OFFSET = 1;

const padDatePart = (value: number) => String(value).padStart(DATE_PART_LENGTH, DATE_PAD_CHAR);

const buildDateStamp = (date: Date) => {
  const year = date.getFullYear();
  const month = padDatePart(date.getMonth() + MONTH_OFFSET);
  const day = padDatePart(date.getDate());
  return `${year}${month}${day}`;
};

const sanitizeFilenamePart = (value: string) => {
  const trimmed = value.trim();
  const sanitized = trimmed.replace(FILENAME_SAFE_PATTERN, '');
  return sanitized.trim();
};

export const buildResumeExportTitle = (resumeName: string, date = new Date()) => {
  const safeName = sanitizeFilenamePart(resumeName) || '未命名简历';
  return `简历-${safeName}-${buildDateStamp(date)}`;
};

export const buildExperienceBankExportTitle = (date = new Date()) => {
  return `经历库-${buildDateStamp(date)}`;
};

export const buildExperienceBankExportDateLabel = (date = new Date()) => {
  const year = date.getFullYear();
  const month = padDatePart(date.getMonth() + MONTH_OFFSET);
  const day = padDatePart(date.getDate());
  return `${year}.${month}.${day}`;
};
