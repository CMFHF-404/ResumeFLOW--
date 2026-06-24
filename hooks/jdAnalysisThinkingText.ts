export const JD_THINKING_TEXT_MAX_LENGTH = 96;

const JD_THINKING_TEXT_SEPARATOR = ' / ';

const normalizeThinkingSummary = (value: string) => value
  .replace(/\s+/g, ' ')
  .trim();

const splitThinkingText = (value: string) => value
  .split(JD_THINKING_TEXT_SEPARATOR)
  .map((item) => item.trim())
  .filter(Boolean);

export const appendJDThinkingText = (
  current: string,
  rawSummary: string,
  maxLength = JD_THINKING_TEXT_MAX_LENGTH
) => {
  const summary = normalizeThinkingSummary(rawSummary);
  if (!summary) {
    return current;
  }

  const parts = splitThinkingText(current).filter((item) => item !== summary);
  parts.push(summary);

  let next = parts.join(JD_THINKING_TEXT_SEPARATOR);
  while (parts.length > 1 && next.length > maxLength) {
    parts.shift();
    next = parts.join(JD_THINKING_TEXT_SEPARATOR);
  }

  if (next.length <= maxLength) {
    return next;
  }
  return next.slice(-maxLength).trimStart();
};
