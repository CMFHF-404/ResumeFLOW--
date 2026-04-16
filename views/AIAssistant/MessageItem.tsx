import React, { useState } from 'react';
import {
  Bot,
  Loader2,
  ChevronDown,
  ChevronRight,
  Paperclip,
  Briefcase,
  FolderKanban,
  GraduationCap,
  FileText,
  Image as ImageIcon,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { AssistantSelectedExperience, AssistantSelectedResume } from '../../services/aiService';

export type MessageAttachmentPreview = {
  id: string;
  name: string;
  type?: string;
  sizeLabel?: string;
};

export type MessageItemProps = {
  isUser: boolean;
  content: string;
  attachments?: MessageAttachmentPreview[];
  selectedExperiences?: AssistantSelectedExperience[];
  selectedResume?: AssistantSelectedResume | null;
};

const EXPERIENCE_ICON = {
  work: Briefcase,
  project: FolderKanban,
  education: GraduationCap,
} as const;

const AttachmentRail: React.FC<{
  attachments: MessageAttachmentPreview[];
  selectedExperiences: AssistantSelectedExperience[];
  selectedResume: AssistantSelectedResume | null;
}> = ({ attachments, selectedExperiences, selectedResume }) => {
  if (attachments.length === 0 && selectedExperiences.length === 0 && !selectedResume) {
    return null;
  }

  return (
    <div className="mb-3 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className="flex h-[80px] w-[204px] shrink-0 gap-3 rounded-2xl border border-slate-200 bg-white/90 px-3 py-3 dark:border-slate-700 dark:bg-slate-900/90"
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
            {attachment.type?.startsWith('image/') ? (
              <ImageIcon className="h-4 w-4" />
            ) : (
              <Paperclip className="h-4 w-4" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
              附件
            </div>
            <div className="mt-1 truncate text-xs font-semibold leading-5 text-slate-700 dark:text-slate-100">
              {attachment.name}
            </div>
            <div className="mt-1 truncate text-xs text-slate-400 dark:text-slate-500">
              {[attachment.type, attachment.sizeLabel].filter(Boolean).join(' · ') || '已选择附件'}
            </div>
          </div>
        </div>
      ))}

      {selectedResume ? (
        <div className="flex h-[80px] w-[204px] shrink-0 gap-3 rounded-2xl border border-sky-200 bg-sky-50/75 px-3 py-3 dark:border-sky-500/30 dark:bg-sky-950/35">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-sky-600 dark:bg-slate-800 dark:text-sky-300">
            <FileText className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-sky-500 dark:text-sky-300">
              简历
            </div>
            <div className="mt-1 truncate text-xs font-semibold leading-5 text-slate-700 dark:text-slate-100">
              {selectedResume.resumeName || '未命名简历'}
            </div>
            <div className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
              {selectedResume.jdContext?.trim() ? '已关联 JD' : '未关联 JD'}
            </div>
          </div>
        </div>
      ) : null}

      {selectedExperiences.map((item) => {
        const ExperienceIcon = EXPERIENCE_ICON[item.category] ?? Briefcase;
        const experienceLabel = item.category === 'project'
          ? '项目'
          : item.category === 'education'
            ? '教育'
            : '经历';

        return (
          <div
            key={item.masterId}
            className="flex h-[80px] w-[204px] shrink-0 gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/75 px-3 py-3 dark:border-emerald-500/30 dark:bg-emerald-950/35"
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-emerald-600 dark:bg-slate-800 dark:text-emerald-300">
              <ExperienceIcon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-emerald-600 dark:text-emerald-300">
                {experienceLabel}
              </div>
              <div className="mt-1 truncate text-xs font-semibold leading-5 text-slate-700 dark:text-slate-100">
                {item.org || '未填写组织'} / {item.title || '未填写角色'}
              </div>
              <div className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
                {item.summary || '已选中经历内容'}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const MessageItem: React.FC<MessageItemProps> = ({
  isUser,
  content,
  attachments = [],
  selectedExperiences = [],
  selectedResume = null,
}) => {
  if (isUser) {
    return (
      <div className="mb-4 flex w-full min-w-0 justify-end">
        <div className="w-fit max-w-[88%] min-w-0 rounded-2xl rounded-tr-sm bg-slate-100 px-4 py-3 text-slate-800 dark:bg-slate-800 dark:text-slate-100 sm:max-w-[80%] sm:px-5">
          <AttachmentRail
            attachments={attachments}
            selectedExperiences={selectedExperiences}
            selectedResume={selectedResume}
          />
          {content ? (
            <div className="whitespace-pre-wrap break-words text-[13px] leading-6 sm:text-sm sm:leading-7">
              {content}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6 flex w-full min-w-0 justify-start gap-3 sm:gap-4">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300 sm:h-8 sm:w-8">
        <Bot className="h-4 w-4 sm:h-5 sm:w-5" />
      </div>
      <div className="min-w-0 flex-1 max-w-full sm:max-w-[85%]">
        <div className="overflow-hidden rounded-2xl rounded-tl-sm border border-slate-100 bg-white px-4 py-3 text-slate-800 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:shadow-[0_16px_40px_-24px_rgba(2,6,23,0.95)] sm:px-5 sm:py-4">
          <div className="space-y-3 overflow-hidden break-words text-sm leading-7">
            <ReactMarkdown
              components={{
                p: ({ node, ...props }) => <p className="m-0 whitespace-pre-wrap" {...props} />,
                strong: ({ node, ...props }) => <strong className="font-bold text-slate-900 dark:text-slate-100" {...props} />,
                ul: ({ node, ...props }) => <ul className="m-0 list-disc space-y-1.5 pl-5 marker:text-slate-400 dark:marker:text-slate-500" {...props} />,
                ol: ({ node, ...props }) => <ol className="m-0 list-decimal space-y-1.5 pl-5 marker:font-medium marker:text-slate-400 dark:marker:text-slate-500" {...props} />,
                li: ({ node, ...props }) => <li className="whitespace-pre-wrap pl-1" {...props} />,
                a: ({ node, ...props }) => (
                  <a
                    className="font-medium text-emerald-600 transition-colors hover:text-emerald-700 hover:underline dark:text-emerald-300 dark:hover:text-emerald-200"
                    target="_blank"
                    rel="noopener noreferrer"
                    {...props}
                  />
                ),
                h1: ({ node, ...props }) => <h1 className="mb-2 mt-4 text-lg font-bold text-slate-900 dark:text-slate-100" {...props} />,
                h2: ({ node, ...props }) => <h2 className="mb-2 mt-4 text-base font-bold text-slate-900 dark:text-slate-100" {...props} />,
                h3: ({ node, ...props }) => <h3 className="mb-1.5 mt-3 text-sm font-bold text-slate-900 dark:text-slate-100" {...props} />,
                blockquote: ({ node, ...props }) => <blockquote className="my-2 whitespace-pre-wrap border-l-4 border-slate-200 pl-4 italic text-slate-600 dark:border-slate-700 dark:text-slate-300" {...props} />,
                code: ({ node, inline, ...props }: any) => inline
                  ? <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[13px] text-slate-800 dark:bg-slate-800 dark:text-slate-100" {...props} />
                  : <code className="my-2 block overflow-x-auto whitespace-pre rounded-lg border border-slate-100 bg-slate-50 p-3 font-mono text-[13px] text-slate-800 shadow-inner dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" {...props} />,
              }}
            >
              {content}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
};

export const ActiveThoughtBlock: React.FC<{ thought: string }> = ({ thought }) => {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="mb-6 flex w-full min-w-0 justify-start gap-3 sm:gap-4">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100/50 text-emerald-600 opacity-50 dark:bg-emerald-500/10 dark:text-emerald-300 sm:h-8 sm:w-8">
        <Bot className="h-4 w-4 sm:h-5 sm:w-5" />
      </div>
      <div className="min-w-0 max-w-full sm:max-w-[85%]">
        <div className="mb-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="group flex items-center gap-2 outline-none"
          >
            <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 shadow-sm transition group-hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:group-hover:border-slate-600">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-500" />
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">思考过程</span>
              {expanded ? (
                <ChevronDown className="h-3.5 w-3.5 text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300" />
              )}
            </div>
          </button>
        </div>

        {expanded ? (
          <div className="ml-1.5 mt-2 whitespace-pre-wrap border-l-2 border-slate-200 py-1 pl-4 text-sm leading-6 text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {thought}
          </div>
        ) : null}
      </div>
    </div>
  );
};
