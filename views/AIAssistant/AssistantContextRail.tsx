import React from 'react';
import {
  FileText,
  Image as ImageIcon,
  Paperclip,
  X,
} from 'lucide-react';
import type { AssistantSelectedResume } from '../../services/aiService';

export type AssistantContextAttachmentPreview = {
  id: string;
  name: string;
  type?: string;
  sizeLabel?: string;
  previewUrl?: string | null;
};

type AssistantContextRailProps = {
  attachments: AssistantContextAttachmentPreview[];
  selectedResume: AssistantSelectedResume | null;
  hideSelectedResumeCard?: boolean;
  onRemoveAttachment?: (attachmentId: string) => void;
  onRemoveSelectedResume?: () => void;
};

const getResumeExperienceLabel = (resume: AssistantSelectedResume) => {
  const selectedCount = resume.selection?.experienceIds.length ?? resume.snapshot.experiences.length;
  if (resume.selection?.mode === 'subset') {
    return `已选 ${selectedCount} 段经历`;
  }
  return selectedCount > 0 ? `全部 ${selectedCount} 段经历` : '暂无经历';
};

export const AssistantContextRail: React.FC<AssistantContextRailProps> = ({
  attachments,
  selectedResume,
  hideSelectedResumeCard = false,
  onRemoveAttachment,
  onRemoveSelectedResume,
}) => {
  const shouldShowSelectedResumeCard = Boolean(selectedResume) && !hideSelectedResumeCard;
  const hasVisibleContext = (
    attachments.length > 0
    || shouldShowSelectedResumeCard
  );
  if (!hasVisibleContext) {
    return null;
  }

  return (
    <div className="mb-2 w-full overflow-hidden">
      <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar" aria-label="已选择的对话上下文">
        {attachments.map((attachment) => (
          <div
            key={attachment.id}
            className="flex h-[76px] w-[206px] shrink-0 gap-2 rounded-2xl border border-slate-200 bg-white/90 px-3 py-2.5 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/90"
          >
            {attachment.previewUrl ? (
              <img
                src={attachment.previewUrl}
                alt={attachment.name}
                className="h-10 w-10 shrink-0 rounded-xl object-cover ring-1 ring-slate-200 dark:ring-slate-700"
              />
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-slate-500 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
                {attachment.type?.startsWith('image/') ? (
                  <ImageIcon className="h-4 w-4" />
                ) : (
                  <Paperclip className="h-4 w-4" />
                )}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-medium text-slate-400 dark:text-slate-500">附件</div>
              <div className="mt-0.5 truncate text-sm font-semibold leading-5 text-slate-800 dark:text-slate-100">
                {attachment.name}
              </div>
              <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                {[attachment.type, attachment.sizeLabel].filter(Boolean).join(' · ') || '已选择附件'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onRemoveAttachment?.(attachment.id)}
              className="self-start rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              title="移除附件"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}

        {selectedResume && shouldShowSelectedResumeCard ? (
          <div className="flex h-[76px] w-[226px] shrink-0 gap-2 rounded-2xl border border-sky-200 bg-sky-50/90 px-3 py-2.5 shadow-sm dark:border-sky-500/30 dark:bg-sky-950/40">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-sky-600 ring-1 ring-sky-100 dark:bg-slate-800 dark:text-sky-300 dark:ring-sky-500/20">
              <FileText className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold text-sky-600 dark:text-sky-300">简历</div>
              <div className="mt-0.5 truncate text-sm font-semibold leading-5 text-slate-800 dark:text-slate-100">
                {selectedResume.resumeName || '未命名简历'}
              </div>
              <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                {selectedResume.jdContext?.trim() ? '已关联 JD' : '未关联 JD'} · {getResumeExperienceLabel(selectedResume)}
              </div>
            </div>
            <button
              type="button"
              onClick={onRemoveSelectedResume}
              className="self-start rounded-full p-1 text-slate-400 transition hover:bg-white hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              title="移除简历"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default AssistantContextRail;
