export const FEEDBACK_CATEGORIES = [
  { value: 'bug', label: '问题/BUG' },
  { value: 'suggestion', label: '建议' },
  { value: 'other', label: '其他' },
] as const;

export type FeedbackCategory = typeof FEEDBACK_CATEGORIES[number]['value'];

export const FEEDBACK_DEFAULT_CATEGORY: FeedbackCategory = 'bug';
export const FEEDBACK_MAX_CONTENT_LENGTH = 500;
export const FEEDBACK_SUCCESS_MESSAGE = '反馈已提交，感谢支持';
export const FEEDBACK_SUCCESS_CLOSE_DELAY_MS = 900;
