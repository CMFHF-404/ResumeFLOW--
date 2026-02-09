import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_DEFAULT_CATEGORY,
  FEEDBACK_MAX_CONTENT_LENGTH,
  FEEDBACK_SUCCESS_CLOSE_DELAY_MS,
  FEEDBACK_SUCCESS_MESSAGE,
  type FeedbackCategory,
} from '../constants/feedback';
import { feedbackService, type FeedbackPayload } from '../services/feedbackService';

export type FeedbackContext = {
  view: string;
  path: string;
  url: string;
  userAgent: string;
};

type FeedbackModalProps = {
  isOpen: boolean;
  context: FeedbackContext;
  onClose: () => void;
};

type FeedbackFormState = {
  category: FeedbackCategory;
  content: string;
  contact: string;
};

const DEFAULT_STATE: FeedbackFormState = {
  category: FEEDBACK_DEFAULT_CATEGORY,
  content: '',
  contact: '',
};

const normalizeInput = (value: string) => value.trim();

const validateContent = (content: string) => {
  if (!content) {
    return '请输入反馈内容';
  }
  if (content.length > FEEDBACK_MAX_CONTENT_LENGTH) {
    return `内容不能超过 ${FEEDBACK_MAX_CONTENT_LENGTH} 字`;
  }
  return null;
};

const buildPayload = (
  state: FeedbackFormState,
  context: FeedbackContext
): FeedbackPayload => ({
  category: state.category,
  content: normalizeInput(state.content),
  contact: normalizeInput(state.contact) || undefined,
  context_json: context,
});

const ModalShell: React.FC<{
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ title, onClose, children }) => (
  <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
    <div className="bg-white dark:bg-surface-dark rounded-2xl shadow-2xl w-[92vw] max-w-lg overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h3>
        <button
          onClick={onClose}
          className="p-2 rounded-full text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-700 transition-colors"
          type="button"
          aria-label="关闭"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  </div>
);

const FeedbackTypeField: React.FC<{
  value: FeedbackCategory;
  onChange: (value: FeedbackCategory) => void;
}> = ({ value, onChange }) => (
  <div>
    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
      类型
    </label>
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as FeedbackCategory)}
      className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary/50"
    >
      {FEEDBACK_CATEGORIES.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </div>
);

const FeedbackContentField: React.FC<{
  value: string;
  count: number;
  error: string | null;
  onChange: (value: string) => void;
}> = ({ value, count, error, onChange }) => (
  <div>
    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
      反馈内容
    </label>
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      rows={4}
      maxLength={FEEDBACK_MAX_CONTENT_LENGTH}
      placeholder="请描述你遇到的问题或建议"
      className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary/50"
    />
    <div className="mt-1 flex items-center justify-between text-xs text-gray-400">
      <span>{error ? <span className="text-red-500">{error}</span> : null}</span>
      <span>
        {count}/{FEEDBACK_MAX_CONTENT_LENGTH}
      </span>
    </div>
  </div>
);

const FeedbackContactField: React.FC<{
  value: string;
  onChange: (value: string) => void;
}> = ({ value, onChange }) => (
  <div>
    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
      联系方式（可选）
    </label>
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder="邮箱 / 微信 / 手机号"
      className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary/50"
    />
  </div>
);

const FeedbackActions: React.FC<{
  isSubmitting: boolean;
  isSuccess: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}> = ({ isSubmitting, isSuccess, onCancel, onSubmit }) => (
  <div className="flex items-center justify-between pt-2">
    <span className="text-sm text-emerald-600">
      {isSuccess ? FEEDBACK_SUCCESS_MESSAGE : null}
    </span>
    <div className="flex items-center gap-3">
      <button
        onClick={onCancel}
        className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
        type="button"
        disabled={isSubmitting}
      >
        取消
      </button>
      <button
        onClick={onSubmit}
        className="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary-dark rounded-lg transition-colors shadow-lg shadow-primary/30 disabled:opacity-60"
        type="button"
        disabled={isSubmitting || isSuccess}
      >
        {isSubmitting ? '提交中...' : '提交反馈'}
      </button>
    </div>
  </div>
);

const FeedbackModal: React.FC<FeedbackModalProps> = ({ isOpen, context, onClose }) => {
  const [formState, setFormState] = useState<FeedbackFormState>(DEFAULT_STATE);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const isOpenRef = useRef(isOpen);
  const submitGuardRef = useRef(0);

  const contentCount = useMemo(
    () => normalizeInput(formState.content).length,
    [formState.content]
  );

  useEffect(() => {
    isOpenRef.current = isOpen;
    if (!isOpen) {
      submitGuardRef.current += 1;
      setFormState(DEFAULT_STATE);
      setError(null);
      setIsSubmitting(false);
      setIsSuccess(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isSuccess) {
      return;
    }
    const timer = window.setTimeout(() => {
      onClose();
    }, FEEDBACK_SUCCESS_CLOSE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [isSuccess, onClose]);

  if (!isOpen) {
    return null;
  }

  const handleSubmit = async () => {
    const normalizedContent = normalizeInput(formState.content);
    const validationError = validateContent(normalizedContent);
    if (validationError) {
      setError(validationError);
      return;
    }
    const submitId = submitGuardRef.current + 1;
    submitGuardRef.current = submitId;
    setIsSubmitting(true);
    setError(null);
    try {
      await feedbackService.create(buildPayload(formState, context));
      if (!isOpenRef.current || submitGuardRef.current !== submitId) {
        return;
      }
      setIsSuccess(true);
    } catch (submitError) {
      console.error('[FeedbackModal] submit failed', submitError);
      if (!isOpenRef.current || submitGuardRef.current !== submitId) {
        return;
      }
      setError('提交失败，请稍后重试');
    } finally {
      if (!isOpenRef.current || submitGuardRef.current !== submitId) {
        return;
      }
      setIsSubmitting(false);
    }
  };

  return (
    <ModalShell title="反馈" onClose={onClose}>
      <div className="space-y-4">
        <FeedbackTypeField
          value={formState.category}
          onChange={(value) => setFormState((prev) => ({ ...prev, category: value }))}
        />
        <FeedbackContentField
          value={formState.content}
          count={contentCount}
          error={error}
          onChange={(value) => setFormState((prev) => ({ ...prev, content: value }))}
        />
        <FeedbackContactField
          value={formState.contact}
          onChange={(value) => setFormState((prev) => ({ ...prev, contact: value }))}
        />
        <FeedbackActions
          isSubmitting={isSubmitting}
          isSuccess={isSuccess}
          onCancel={onClose}
          onSubmit={handleSubmit}
        />
      </div>
    </ModalShell>
  );
};

export default FeedbackModal;
