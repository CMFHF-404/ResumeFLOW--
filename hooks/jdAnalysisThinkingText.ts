import { appendThoughtDisplayText } from "../utils/aiThought";

export const JD_THINKING_TEXT_MAX_LENGTH = 96;

const JD_THINKING_TEXT_SEPARATOR = ' / ';

export const appendJDThinkingText = (
  current: string,
  rawSummary: string,
  maxLength = JD_THINKING_TEXT_MAX_LENGTH
) => {
  return appendThoughtDisplayText(current, rawSummary, {
    separator: JD_THINKING_TEXT_SEPARATOR,
    dedupeStrategy: 'all',
    maxLength,
  });
};
