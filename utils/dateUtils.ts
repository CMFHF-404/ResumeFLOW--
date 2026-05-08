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
