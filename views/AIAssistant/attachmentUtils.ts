import type { AssistantMessage } from '../../services/aiService';

export type AssistantAttachmentPreview = {
  id: string;
  name: string;
  type?: string;
  sizeLabel?: string;
  previewUrl?: string | null;
};

export type AssistantComposerAttachment = AssistantAttachmentPreview & {
  file: File;
};

export const ASSISTANT_ATTACHMENT_ACCEPT_ATTR = '.pdf,.docx,.jpg,.jpeg,.png,.webp';

const ASSISTANT_ATTACHMENT_ACCEPTED_EXTENSIONS = new Set(['.pdf', '.docx', '.jpg', '.jpeg', '.png', '.webp']);
const ASSISTANT_ATTACHMENT_MIME_TO_EXTENSION: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
};

const createAttachmentSelectionId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export const buildAttachmentFileKey = (file: File) => `${file.name}::${file.size}::${file.lastModified}::${file.type}`;

export const isAcceptedAssistantAttachmentFile = (file: File) => {
  const normalizedName = file.name.trim().toLowerCase();
  const extension = normalizedName.includes('.') ? normalizedName.slice(normalizedName.lastIndexOf('.')) : '';
  if (extension && ASSISTANT_ATTACHMENT_ACCEPTED_EXTENSIONS.has(extension)) {
    return true;
  }
  return Object.prototype.hasOwnProperty.call(ASSISTANT_ATTACHMENT_MIME_TO_EXTENSION, file.type);
};

const buildFallbackAttachmentName = (file: File, prefix = '附件') => {
  const extension = ASSISTANT_ATTACHMENT_MIME_TO_EXTENSION[file.type] ?? '';
  return `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}${extension}`;
};

export const normalizeIncomingAttachmentFile = (file: File, prefix = '附件') => {
  const trimmedName = file.name.trim();
  if (trimmedName) {
    return file;
  }
  return new File([file], buildFallbackAttachmentName(file, prefix), {
    type: file.type,
    lastModified: file.lastModified || Date.now(),
  });
};

const formatFileSize = (size: number) => {
  if (!Number.isFinite(size) || size <= 0) {
    return '';
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

export const buildComposerAttachment = (file: File): AssistantComposerAttachment => ({
  id: createAttachmentSelectionId(),
  file,
  name: file.name.trim() || buildFallbackAttachmentName(file),
  type: file.type || '附件',
  sizeLabel: formatFileSize(file.size),
  previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
});

export const isSameComposerAttachmentList = (
  left: AssistantComposerAttachment[] | null | undefined,
  right: AssistantComposerAttachment[] | null | undefined,
) => {
  const leftItems = left ?? [];
  const rightItems = right ?? [];
  if (leftItems.length !== rightItems.length) {
    return false;
  }
  return leftItems.every((item, index) => item.id === rightItems[index]?.id);
};

const normalizeMessageAttachmentPreview = (
  value: unknown,
  fallbackId: string,
): AssistantAttachmentPreview | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const attachment = value as Record<string, unknown>;
  const name = typeof attachment['name'] === 'string' ? attachment['name'].trim() : '';
  if (!name) {
    return null;
  }
  return {
    id: typeof attachment['id'] === 'string' && attachment['id'].trim() ? attachment['id'].trim() : fallbackId,
    name,
    type: typeof attachment['type'] === 'string'
      ? attachment['type']
      : typeof attachment['contentType'] === 'string'
        ? attachment['contentType']
        : undefined,
    sizeLabel: typeof attachment['sizeLabel'] === 'string' ? attachment['sizeLabel'] : undefined,
  };
};

export const readMessageAttachmentPreviews = (message: AssistantMessage): AssistantAttachmentPreview[] => {
  const previews: AssistantAttachmentPreview[] = [];
  const seenIds = new Set<string>();
  const pushPreview = (value: unknown, fallbackId: string) => {
    const preview = normalizeMessageAttachmentPreview(value, fallbackId);
    if (!preview || seenIds.has(preview.id)) {
      return;
    }
    seenIds.add(preview.id);
    previews.push(preview);
  };

  const rawAttachments = message.content_json?.attachments;
  if (Array.isArray(rawAttachments)) {
    rawAttachments.forEach((item, index) => {
      pushPreview(item, `${message.id}-attachment-${index}`);
    });
  }

  pushPreview(message.content_json?.attachment, `${message.id}-attachment-primary`);
  return previews;
};
