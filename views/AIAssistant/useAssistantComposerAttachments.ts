import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  buildAttachmentFileKey,
  buildComposerAttachment,
  isAcceptedAssistantAttachmentFile,
  isSameComposerAttachmentList,
  normalizeIncomingAttachmentFile,
  type AssistantComposerAttachment,
} from './attachmentUtils';

const MAX_ASSISTANT_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const formatAssistantAttachmentTooLargeMessage = (fileName: string) => {
  const normalizedName = fileName.trim();
  const label = normalizedName ? `「${normalizedName}」` : '';
  return `附件${label}过大，请上传不超过 5MB 的文件。`;
};

type UseAssistantComposerAttachmentsOptions = {
  onError: (message: string, duration?: number) => string;
};

export const useAssistantComposerAttachments = ({
  onError,
}: UseAssistantComposerAttachmentsOptions) => {
  const [composerAttachments, setComposerAttachments] = useState<AssistantComposerAttachment[]>([]);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const composerAttachmentsRef = useRef<AssistantComposerAttachment[]>([]);

  const revokeComposerAttachmentPreviews = useCallback((attachments: AssistantComposerAttachment[]) => {
    attachments.forEach((attachment) => {
      if (attachment.previewUrl) {
        URL.revokeObjectURL(attachment.previewUrl);
      }
    });
  }, []);

  const clearComposerAttachments = useCallback(() => {
    setComposerAttachments((current) => {
      revokeComposerAttachmentPreviews(current);
      return [];
    });
    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = '';
    }
  }, [revokeComposerAttachmentPreviews]);

  const clearComposerAttachmentsIfMatches = useCallback((target: AssistantComposerAttachment[]) => {
    if (!target.length || !isSameComposerAttachmentList(composerAttachmentsRef.current, target)) {
      return;
    }
    clearComposerAttachments();
  }, [clearComposerAttachments]);

  const restoreComposerAttachmentsIfEmpty = useCallback((attachments: AssistantComposerAttachment[]) => {
    setComposerAttachments((current) => {
      if (current.length > 0) {
        return current;
      }
      return attachments;
    });
  }, []);

  const appendComposerAttachments = useCallback((incomingFiles: File[], source: 'picker' | 'drop' | 'paste' = 'picker') => {
    if (incomingFiles.length === 0) {
      return;
    }

    const rejectedFiles = incomingFiles.filter((file) => !isAcceptedAssistantAttachmentFile(file));
    if (rejectedFiles.length > 0) {
      onError('仅支持上传图片、PDF 或 DOCX 附件');
    }

    const oversizedFiles = incomingFiles.filter(
      (file) => isAcceptedAssistantAttachmentFile(file) && file.size > MAX_ASSISTANT_ATTACHMENT_BYTES
    );
    if (oversizedFiles.length > 0) {
      onError(formatAssistantAttachmentTooLargeMessage(oversizedFiles[0].name), 6000);
    }

    const normalizedFiles = incomingFiles
      .filter((file) => isAcceptedAssistantAttachmentFile(file) && file.size <= MAX_ASSISTANT_ATTACHMENT_BYTES)
      .map((file) => normalizeIncomingAttachmentFile(file, source === 'paste' ? '粘贴图片' : '附件'));

    if (normalizedFiles.length === 0) {
      if (attachmentInputRef.current) {
        attachmentInputRef.current.value = '';
      }
      return;
    }

    setComposerAttachments((current) => {
      const existingKeys = new Set(current.map((attachment) => buildAttachmentFileKey(attachment.file)));
      const nextAttachments = normalizedFiles
        .filter((file) => {
          const fileKey = buildAttachmentFileKey(file);
          if (existingKeys.has(fileKey)) {
            return false;
          }
          existingKeys.add(fileKey);
          return true;
        })
        .map((file) => buildComposerAttachment(file));

      return nextAttachments.length > 0 ? [...current, ...nextAttachments] : current;
    });

    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = '';
    }
  }, [onError]);

  const removeComposerAttachment = useCallback((attachmentId: string) => {
    setComposerAttachments((current) => {
      const target = current.find((item) => item.id === attachmentId);
      if (!target) {
        return current;
      }
      if (target.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return current.filter((item) => item.id !== attachmentId);
    });
  }, []);

  const handleAttachmentSelect = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    if (files.length === 0) {
      return;
    }
    appendComposerAttachments(files, 'picker');
    if (event.target) {
      event.target.value = '';
    }
  }, [appendComposerAttachments]);

  const openAttachmentPicker = useCallback(() => {
    attachmentInputRef.current?.click();
  }, []);

  useEffect(() => {
    composerAttachmentsRef.current = composerAttachments;
  }, [composerAttachments]);

  useEffect(() => () => {
    revokeComposerAttachmentPreviews(composerAttachmentsRef.current);
  }, [revokeComposerAttachmentPreviews]);

    return {
    composerAttachments,
    attachmentInputRef,
    clearComposerAttachments,
    clearComposerAttachmentsIfMatches,
    restoreComposerAttachmentsIfEmpty,
    appendComposerAttachments,
    removeComposerAttachment,
    handleAttachmentSelect,
    openAttachmentPicker,
  };
};
