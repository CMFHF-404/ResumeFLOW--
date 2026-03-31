import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Upload, X } from 'lucide-react';
import {
  FEEDBACK_ALLOWED_IMAGE_TYPES,
  FEEDBACK_CATEGORIES,
  FEEDBACK_DEFAULT_CATEGORY,
  FEEDBACK_MAX_CONTENT_LENGTH,
  FEEDBACK_MAX_IMAGE_SIZE_BYTES,
  FEEDBACK_MAX_IMAGE_SIZE_MB,
  FEEDBACK_MAX_IMAGES,
  FEEDBACK_SUCCESS_CLOSE_DELAY_MS,
  FEEDBACK_SUCCESS_MESSAGE,
  type FeedbackCategory,
} from '../constants/feedback';
import { feedbackService, type FeedbackFormData } from '../services/feedbackService';

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
  images: File[];
};

/** 图片选择后生成的预览条目 */
type ImagePreview = {
  file: File;
  previewUrl: string;
};

const DEFAULT_STATE: FeedbackFormState = {
  category: FEEDBACK_DEFAULT_CATEGORY,
  content: '',
  contact: '',
  images: [],
};

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

const normalizeInput = (value: string) => value.trim();

const validateContent = (content: string): string | null => {
  if (!content) return '请输入反馈内容';
  if (content.length > FEEDBACK_MAX_CONTENT_LENGTH) {
    return `内容不能超过 ${FEEDBACK_MAX_CONTENT_LENGTH} 字`;
  }
  return null;
};

/**
 * 校验单张图片文件，返回错误信息或 null。
 * 类型和大小的限制从常量读取，便于统一维护。
 */
const validateImageFile = (file: File): string | null => {
  const isValidType = (FEEDBACK_ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type);
  if (!isValidType) {
    return `不支持的图片格式：${file.type || '未知'}，请上传 JPG/PNG/WebP/GIF`;
  }
  if (file.size > FEEDBACK_MAX_IMAGE_SIZE_BYTES) {
    return `图片 "${file.name}" 超过 ${FEEDBACK_MAX_IMAGE_SIZE_MB}MB 限制`;
  }
  return null;
};

const buildFormData = (
  state: FeedbackFormState,
  context: FeedbackContext
): { formData: FeedbackFormData; images: File[] } => ({
  formData: {
    category: state.category,
    content: normalizeInput(state.content),
    contact: normalizeInput(state.contact) || undefined,
    context_json: context,
  },
  images: state.images,
});

// ---------------------------------------------------------------------------
// 子组件
// ---------------------------------------------------------------------------

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

/**
 * 图片上传区域组件。
 * 支持点击选图、拖拽上传、逐张删除。
 * 预览 URL 在组件内部通过 Object URL 管理生命周期。
 */
const FeedbackImageField: React.FC<{
  previews: ImagePreview[];
  imageError: string | null;
  onAdd: (files: FileList) => void;
  onRemove: (index: number) => void;
}> = ({ previews, imageError, onAdd, onRemove }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const canAddMore = previews.length < FEEDBACK_MAX_IMAGES;

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.dataTransfer.files.length > 0) {
      onAdd(event.dataTransfer.files);
    }
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
        图片附件（可选，最多 {FEEDBACK_MAX_IMAGES} 张）
      </label>

      {/* 已选图片缩略图列表 */}
      {previews.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {previews.map((item, index) => (
            <div
              key={item.previewUrl}
              className="relative w-16 h-16 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 group"
            >
              <img
                src={item.previewUrl}
                alt={item.file.name}
                className="w-full h-full object-cover"
              />
              <button
                type="button"
                onClick={() => onRemove(index)}
                aria-label={`删除图片 ${item.file.name}`}
                className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-4 h-4 text-white" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 上传触发区域：仅在未达到上限时显示 */}
      {canAddMore && (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => inputRef.current?.click()}
          className="flex items-center justify-center gap-2 py-3 px-4 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-sm text-gray-500 dark:text-gray-400 hover:border-primary hover:text-primary cursor-pointer transition-colors"
        >
          <Upload className="w-4 h-4" />
          <span>点击或拖拽上传图片</span>
          <Image className="w-4 h-4 opacity-50" />
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={FEEDBACK_ALLOWED_IMAGE_TYPES.join(',')}
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) {
            onAdd(e.target.files);
            // 清空 value，确保相同文件可以重复选择
            e.target.value = '';
          }
        }}
      />

      {imageError && (
        <p className="mt-1 text-xs text-red-500">{imageError}</p>
      )}
      <p className="mt-1 text-xs text-gray-400">
        支持 JPG、PNG、WebP、GIF，每张不超过 {FEEDBACK_MAX_IMAGE_SIZE_MB}MB
      </p>
    </div>
  );
};

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

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

const FeedbackModal: React.FC<FeedbackModalProps> = ({ isOpen, context, onClose }) => {
  const [formState, setFormState] = useState<FeedbackFormState>(DEFAULT_STATE);
  const [imagePreviews, setImagePreviews] = useState<ImagePreview[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const isOpenRef = useRef(isOpen);
  const submitGuardRef = useRef(0);
  const latestPreviewsRef = useRef<ImagePreview[]>([]);

  const contentCount = useMemo(
    () => normalizeInput(formState.content).length,
    [formState.content]
  );

  /** 释放所有图片预览 URL，防止内存泄漏 */
  const revokeAllPreviews = (previews: ImagePreview[]) => {
    previews.forEach((p) => URL.revokeObjectURL(p.previewUrl));
  };

  useEffect(() => {
    latestPreviewsRef.current = imagePreviews;
  }, [imagePreviews]);

  useEffect(() => {
    return () => {
      revokeAllPreviews(latestPreviewsRef.current);
    };
  }, []);

  useEffect(() => {
    isOpenRef.current = isOpen;
    if (!isOpen) {
      submitGuardRef.current += 1;
      setFormState(DEFAULT_STATE);
      setImagePreviews((prev) => {
        revokeAllPreviews(prev);
        return [];
      });
      setError(null);
      setImageError(null);
      setIsSubmitting(false);
      setIsSuccess(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isSuccess) return;
    const timer = window.setTimeout(() => {
      onClose();
    }, FEEDBACK_SUCCESS_CLOSE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [isSuccess, onClose]);

  if (!isOpen) return null;

  /** 添加图片：校验每张文件后更新状态，创建预览 URL */
  const handleAddImages = (fileList: FileList) => {
    setImageError(null);
    const incoming = Array.from(fileList);
    const remaining = FEEDBACK_MAX_IMAGES - formState.images.length;
    const toAdd = incoming.slice(0, remaining);

    for (const file of toAdd) {
      const err = validateImageFile(file);
      if (err) {
        setImageError(err);
        return;
      }
    }

    if (incoming.length > remaining) {
      setImageError(`最多只能上传 ${FEEDBACK_MAX_IMAGES} 张，已自动截取前 ${remaining} 张`);
    }

    const newPreviews: ImagePreview[] = toAdd.map((f) => ({
      file: f,
      previewUrl: URL.createObjectURL(f),
    }));

    setFormState((prev) => ({ ...prev, images: [...prev.images, ...toAdd] }));
    setImagePreviews((prev) => [...prev, ...newPreviews]);
  };

  /** 删除单张图片并释放预览 URL */
  const handleRemoveImage = (index: number) => {
    setImageError(null);
    setImagePreviews((prev) => {
      const target = prev[index];
      if (!target) {
        return prev;
      }
      URL.revokeObjectURL(target.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
    setFormState((prev) => ({
      ...prev,
      images: prev.images.filter((_, i) => i !== index),
    }));
  };

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
      const { formData, images } = buildFormData(formState, context);
      await feedbackService.create(formData, images);
      if (!isOpenRef.current || submitGuardRef.current !== submitId) return;
      setIsSuccess(true);
    } catch (submitError) {
      console.error('[FeedbackModal] submit failed', submitError);
      if (!isOpenRef.current || submitGuardRef.current !== submitId) return;
      setError('提交失败，请稍后重试');
    } finally {
      if (!isOpenRef.current || submitGuardRef.current !== submitId) return;
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
        <FeedbackImageField
          previews={imagePreviews}
          imageError={imageError}
          onAdd={handleAddImages}
          onRemove={handleRemoveImage}
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
