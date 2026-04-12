import React, { useState } from 'react';
import { Bot, Loader2, ChevronDown, ChevronRight, Paperclip, Briefcase, FolderKanban, GraduationCap } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { AssistantSelectedExperience } from '../../services/aiService';

export type MessageItemProps = {
  isUser: boolean;
  content: string;
  attachment?: {
    name: string;
    type?: string;
    sizeLabel?: string;
  } | null;
  selectedExperiences?: AssistantSelectedExperience[];
};

const EXPERIENCE_ICON = {
  work: Briefcase,
  project: FolderKanban,
  education: GraduationCap,
} as const;

export const MessageItem: React.FC<MessageItemProps> = ({ isUser, content, attachment, selectedExperiences = [] }) => {
  if (isUser) {
    return (
      <div className="mb-4 flex w-full min-w-0 justify-end">
        <div className="w-fit max-w-[88%] min-w-0 rounded-2xl rounded-tr-sm bg-slate-100 px-4 py-3 text-slate-800 sm:max-w-[80%] sm:px-5">
          {selectedExperiences.length > 0 ? (
            <div className="mb-3 flex flex-col gap-2">
              {selectedExperiences.map((item) => {
                const ExperienceIcon = EXPERIENCE_ICON[item.category] ?? Briefcase;
                return (
                  <div key={item.masterId} className="rounded-2xl border border-slate-200 bg-white/90 px-3 py-2">
                    <div className="flex items-start gap-2">
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                        <ExperienceIcon className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-semibold text-slate-700">
                          {item.org || '未填写组织'} / {item.title || '未填写角色'}
                        </div>
                        {item.summary ? (
                          <div className="mt-1 max-h-10 overflow-hidden text-xs leading-5 text-slate-500">
                            {item.summary}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
          {content ? (
            <div className="whitespace-pre-wrap break-words text-[13px] leading-6 sm:text-sm sm:leading-7">{content}</div>
          ) : null}
          {attachment ? (
            <div className={`${content ? 'mt-3' : ''} inline-flex max-w-full items-center gap-2 rounded-2xl border border-slate-200 bg-white/80 px-3 py-2 text-xs text-slate-600`}>
              <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span className="truncate">{attachment.name}</span>
              <span className="shrink-0 text-slate-400">
                {[attachment.type, attachment.sizeLabel].filter(Boolean).join(' · ')}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6 flex w-full min-w-0 justify-start gap-3 sm:gap-4">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 sm:h-8 sm:w-8">
        <Bot className="h-4 w-4 sm:h-5 sm:w-5" />
      </div>
      <div className="min-w-0 flex-1 max-w-full sm:max-w-[85%]">
        <div className="overflow-hidden rounded-2xl rounded-tl-sm border border-slate-100 bg-white px-4 py-3 text-slate-800 shadow-sm sm:px-5 sm:py-4">
          <div className="text-sm leading-7 space-y-3 break-words overflow-hidden">
            <ReactMarkdown
              components={{
                p: ({node, ...props}) => <p className="m-0 whitespace-pre-wrap" {...props} />,
                strong: ({node, ...props}) => <strong className="font-bold text-slate-900" {...props} />,
                ul: ({node, ...props}) => <ul className="list-disc pl-5 m-0 space-y-1.5 marker:text-slate-400" {...props} />,
                ol: ({node, ...props}) => <ol className="list-decimal pl-5 m-0 space-y-1.5 marker:text-slate-400 marker:font-medium" {...props} />,
                li: ({node, ...props}) => <li className="pl-1 whitespace-pre-wrap" {...props} />,
                a: ({node, ...props}) => <a className="text-emerald-600 hover:underline hover:text-emerald-700 font-medium transition-colors" target="_blank" rel="noopener noreferrer" {...props} />,
                h1: ({node, ...props}) => <h1 className="text-lg font-bold text-slate-900 mt-4 mb-2" {...props} />,
                h2: ({node, ...props}) => <h2 className="text-base font-bold text-slate-900 mt-4 mb-2" {...props} />,
                h3: ({node, ...props}) => <h3 className="text-sm font-bold text-slate-900 mt-3 mb-1.5" {...props} />,
                blockquote: ({node, ...props}) => <blockquote className="border-l-4 border-slate-200 pl-4 italic text-slate-600 my-2 whitespace-pre-wrap" {...props} />,
                code: ({node, inline, ...props}: any) => inline 
                  ? <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-[13px] font-mono" {...props} />
                  : <code className="block bg-slate-50 border border-slate-100 text-slate-800 p-3 rounded-lg text-[13px] font-mono overflow-x-auto whitespace-pre my-2 shadow-inner" {...props} />,
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
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100/50 text-emerald-600 opacity-50 sm:h-8 sm:w-8">
        <Bot className="h-4 w-4 sm:h-5 sm:w-5" />
      </div>
      <div className="min-w-0 max-w-full sm:max-w-[85%]">
        <div className="mb-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-2 group outline-none"
          >
            <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 shadow-sm transition group-hover:border-slate-300">
               <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-500" />
               <span className="text-xs font-medium text-slate-600">思考过程</span>
               {expanded ? (
                 <ChevronDown className="h-3.5 w-3.5 text-slate-400 group-hover:text-slate-600" />
               ) : (
                 <ChevronRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-slate-600" />
               )}
            </div>
          </button>
        </div>
        
        {expanded && (
          <div className="mt-2 ml-1.5 border-l-2 border-slate-200 py-1 pl-4 text-sm leading-6 text-slate-500 whitespace-pre-wrap">
            {thought}
          </div>
        )}
      </div>
    </div>
  );
};
