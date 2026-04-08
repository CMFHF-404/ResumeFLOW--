import React, { useState } from 'react';
import { Bot, Loader2, ChevronDown, ChevronRight } from 'lucide-react';

export type MessageItemProps = {
  isUser: boolean;
  content: string;
};

export const MessageItem: React.FC<MessageItemProps> = ({ isUser, content }) => {
  if (isUser) {
    return (
      <div className="flex justify-end mb-4">
        <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-slate-100 px-5 py-3 text-slate-800">
          <div className="whitespace-pre-wrap text-sm leading-7">{content}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start mb-6">
      <div className="mr-4 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
        <Bot className="h-5 w-5" />
      </div>
      <div className="max-w-[85%]">
        <div className="rounded-2xl rounded-tl-sm bg-white border border-slate-100 px-5 py-3 text-slate-800 shadow-sm">
          <div className="whitespace-pre-wrap text-sm leading-7">{content}</div>
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
          <div className="mt-2 text-sm leading-6 text-slate-500 border-l-2 border-slate-200 pl-4 ml-1.5 py-1">
            {thought}
          </div>
        )}
      </div>
    </div>
  );
};
