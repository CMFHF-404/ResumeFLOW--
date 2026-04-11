import React, { useState } from 'react';
import { Bot, Loader2, ChevronDown, ChevronRight, Paperclip } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

export type MessageItemProps = {
  isUser: boolean;
  content: string;
  attachment?: {
    name: string;
    type?: string;
    sizeLabel?: string;
  } | null;
};

export const MessageItem: React.FC<MessageItemProps> = ({ isUser, content, attachment }) => {
  if (isUser) {
    return (
      <div className="flex justify-end mb-4">
        <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-slate-100 px-5 py-3 text-slate-800">
          {content ? (
            <div className="whitespace-pre-wrap text-sm leading-7">{content}</div>
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
    <div className="flex justify-start mb-6 w-full">
      <div className="mr-4 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
        <Bot className="h-5 w-5" />
      </div>
      <div className="flex-1 max-w-[85%]">
        <div className="rounded-2xl rounded-tl-sm bg-white border border-slate-100 px-5 py-4 text-slate-800 shadow-sm">
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
    <div className="flex justify-start mb-6">
      <div className="mr-4 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100/50 text-emerald-600 opacity-50">
        <Bot className="h-5 w-5" />
      </div>
      <div className="max-w-[85%]">
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
          <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-500 border-l-2 border-slate-200 pl-4 ml-1.5 py-1">
            {thought}
          </div>
        )}
      </div>
    </div>
  );
};
