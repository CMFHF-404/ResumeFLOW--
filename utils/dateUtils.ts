import { convertDateToISO } from "../views/experienceUtils";

const PRESENT_LABEL = "至今";

export const formatYearMonth = (value?: string): string => {
  if (!value) {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed.slice(0, 7).replace("-", ".");
  }
  if (/^\d{4}-\d{2}$/.test(trimmed)) {
    return trimmed.replace("-", ".");
  }
  return trimmed.replace("-", ".");
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
