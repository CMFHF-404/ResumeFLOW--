import React, { useRef, useEffect } from 'react';
import { Plus, Mic, ArrowUp, Sparkles, Paperclip, X } from 'lucide-react';

export type ChatInputBoxProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isSending: boolean;
  placeholder?: string;
  quickActions?: { label: string; onClick?: () => void }[];
  onPlusClick?: () => void;
  attachmentPreview?: {
    name: string;
    type?: string;
    sizeLabel?: string;
    previewUrl?: string | null;
  } | null;
  onRemoveAttachment?: () => void;
};

export const ChatInputBox: React.FC<ChatInputBoxProps> = ({
  value,
  onChange,
  onSubmit,
  isSending,
  placeholder = '有问题，尽管问',
  quickActions = [],
  onPlusClick,
  attachmentPreview,
  onRemoveAttachment,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      // Limit max height to around 5 lines (120px) before scrolling
      const newHeight = Math.min(textareaRef.current.scrollHeight, 160);
      textareaRef.current.style.height = `${newHeight}px`;
    }
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isSending && (value.trim() || attachmentPreview)) {
        onSubmit();
      }
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="flex flex-col overflow-hidden rounded-[32px] bg-white/70 backdrop-blur-xl border border-white/60 shadow-lg transition-all focus-within:bg-white/90 focus-within:shadow-xl">
        {attachmentPreview ? (
          <div className="px-5 pt-5">
            <div className="relative flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
              {attachmentPreview.previewUrl ? (
                <img
                  src={attachmentPreview.previewUrl}
                  alt={attachmentPreview.name}
                  className="h-16 w-16 rounded-xl object-cover ring-1 ring-slate-200"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-white text-slate-400 ring-1 ring-slate-200">
                  <Paperclip className="h-5 w-5" />
                </div>
              )}
              <div className="min-w-0 flex-1 pr-8">
                <div className="truncate text-sm font-medium text-slate-700">{attachmentPreview.name}</div>
                <div className="mt-1 text-xs text-slate-400">
                  {[attachmentPreview.type, attachmentPreview.sizeLabel].filter(Boolean).join(' · ') || '已选择附件'}
                </div>
              </div>
              <button
                type="button"
                onClick={onRemoveAttachment}
                className="absolute right-2 top-2 rounded-full p-1 text-slate-400 transition hover:bg-white hover:text-slate-600"
                title="移除附件"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : null}

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          className="min-h-[60px] max-h-[160px] w-full resize-none overflow-y-auto border-0 bg-transparent px-6 py-5 text-sm leading-6 text-slate-800 outline-none placeholder:text-slate-400 focus:outline-none focus:ring-0"
        />

        <div className="flex items-center justify-between px-3 py-3">
          <div className="flex items-center gap-1.5 pl-2 overflow-x-auto no-scrollbar">
             <button type="button" onClick={onPlusClick} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition shrink-0" title="添加附件或扩展">
                <Plus className="w-5 h-5"/>
             </button>
             {quickActions.map((action, idx) => (
               <button
                 key={idx}
                 type="button"
                 onClick={action.onClick}
                 className="shrink-0 flex items-center gap-1.5 rounded-full bg-white border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:border-slate-300 transition shadow-sm ml-1"
               >
                 <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                 {action.label}
               </button>
             ))}
          </div>
          
          <div className="flex items-center gap-2 pr-1 shrink-0">
             <button type="button" className="hidden p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition" title="语音输入">
                <Mic className="w-5 h-5"/>
             </button>
             <button
               type="button"
               onClick={onSubmit}
               disabled={isSending || (!value.trim() && !attachmentPreview)}
               className={`flex h-9 w-9 items-center justify-center rounded-full text-white transition disabled:cursor-not-allowed ${
                 (value.trim() || attachmentPreview) && !isSending 
                   ? 'bg-slate-900 hover:bg-slate-800 shadow-md' 
                   : 'bg-slate-200 text-slate-400'
               }`}
             >
               <ArrowUp className="h-5 w-5" />
             </button>
          </div>
        </div>
      </div>
      <div className="mt-3 text-center text-xs text-slate-400">
        AI 可能会犯错。请核对重要信息。
      </div>
    </div>
  );
};
