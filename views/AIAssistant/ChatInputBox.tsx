import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Plus, Mic, ArrowUp, Paperclip, X, Briefcase, ChevronUp, FileText } from 'lucide-react';
import type { AssistantSelectedExperience, AssistantSelectedResume } from '../../services/aiService';

export type ChatInputBoxProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isSending: boolean;
  placeholder?: string;
  plusActions?: { key: string; label: string; onClick?: () => void }[];
  attachmentPreview?: {
    name: string;
    type?: string;
    sizeLabel?: string;
    previewUrl?: string | null;
  } | null;
  onRemoveAttachment?: () => void;
  selectedExperiences?: AssistantSelectedExperience[];
  onRemoveSelectedExperience?: (masterId: string) => void;
  selectedResume?: AssistantSelectedResume | null;
  onRemoveSelectedResume?: () => void;
};

export const ChatInputBox: React.FC<ChatInputBoxProps> = ({
  value,
  onChange,
  onSubmit,
  isSending,
  placeholder = '有问题，尽管问',
  plusActions = [],
  attachmentPreview,
  onRemoveAttachment,
  selectedExperiences = [],
  onRemoveSelectedExperience,
  selectedResume,
  onRemoveSelectedResume,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const [isPlusMenuOpen, setIsPlusMenuOpen] = useState(false);

  // Resize before paint to avoid visible jump/flicker during rapid typing.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = '0px';
    const fullHeight = textarea.scrollHeight;
    const nextHeight = Math.min(fullHeight, 160);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = fullHeight > 160 ? 'auto' : 'hidden';
  }, [value]);

  useEffect(() => {
    if (!isPlusMenuOpen) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (!plusMenuRef.current?.contains(event.target as Node)) {
        setIsPlusMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [isPlusMenuOpen]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isSending && (value.trim() || attachmentPreview || selectedExperiences.length > 0 || selectedResume)) {
        onSubmit();
      }
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="relative flex flex-col overflow-visible rounded-[24px] border border-white/60 bg-white/70 shadow-lg backdrop-blur-xl transition-all focus-within:bg-white/90 focus-within:shadow-xl sm:rounded-[32px]">
        {attachmentPreview ? (
          <div className="px-4 pt-4 sm:px-5 sm:pt-5">
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

        {selectedResume ? (
          <div className="px-4 pt-4 sm:px-5 sm:pt-5">
            <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
              <div className="flex w-[280px] max-w-[78vw] shrink-0 items-start gap-2 rounded-2xl border border-sky-200 bg-sky-50/80 px-3 py-2 sm:w-[420px] sm:max-w-[80vw]">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-white text-sky-600 ring-1 ring-sky-100">
                  <FileText className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-700">
                    {selectedResume.resumeName || '未命名简历'}
                  </div>
                  <div className="mt-1 truncate text-xs text-slate-500">
                    {selectedResume.jdContext?.trim() ? '已关联 JD' : '未关联 JD'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onRemoveSelectedResume}
                  className="rounded-full p-1 text-slate-400 transition hover:bg-white hover:text-slate-600"
                  title="移除简历"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {selectedExperiences.length > 0 ? (
          <div className="px-4 pt-4 sm:px-5 sm:pt-5">
            <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
              {selectedExperiences.map((item) => (
                <div
                  key={item.masterId}
                  className="flex w-[280px] max-w-[78vw] shrink-0 items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 sm:w-[420px] sm:max-w-[80vw]"
                >
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-600 ring-1 ring-emerald-100">
                    <Briefcase className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-700">
                      {item.org || '未填写组织'} / {item.title || '未填写角色'}
                    </div>
                    {item.summary ? (
                      <div className="mt-1 truncate text-xs text-slate-500">
                        {item.summary}
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemoveSelectedExperience?.(item.masterId)}
                    className="rounded-full p-1 text-slate-400 transition hover:bg-white hover:text-slate-600"
                    title="移除经历"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
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
          className="min-h-[56px] max-h-[160px] w-full resize-none overflow-y-auto border-0 bg-transparent px-4 py-4 text-sm leading-6 text-slate-800 outline-none placeholder:text-slate-400 focus:outline-none focus:ring-0 sm:min-h-[60px] sm:px-6 sm:py-5"
        />

        <div className="flex items-center justify-between px-2 py-2 sm:px-3 sm:py-3">
          <div className="flex min-w-0 items-center gap-2 pl-1 sm:pl-2">
             <div ref={plusMenuRef} className="relative shrink-0">
               <button
                 type="button"
                 onClick={() => setIsPlusMenuOpen((current) => !current)}
                 className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition"
                 title="添加经历或附件"
               >
                  {isPlusMenuOpen ? <ChevronUp className="w-5 h-5" /> : <Plus className="w-5 h-5"/>}
               </button>
               {isPlusMenuOpen ? (
                 <div className="absolute bottom-12 left-0 z-30 min-w-[168px] rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_16px_32px_rgba(15,23,42,0.12)]">
                   {plusActions.map((action) => (
                     <button
                       key={action.key}
                       type="button"
                       onClick={() => {
                         setIsPlusMenuOpen(false);
                         action.onClick?.();
                       }}
                       className="flex w-full items-center rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                     >
                       {action.label}
                     </button>
                   ))}
                 </div>
               ) : null}
             </div>
          </div>
          
          <div className="flex items-center gap-2 pr-1 shrink-0">
             <button type="button" className="hidden p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition" title="语音输入">
                <Mic className="w-5 h-5"/>
             </button>
             <button
               type="button"
               onClick={onSubmit}
               disabled={isSending || (!value.trim() && !attachmentPreview && selectedExperiences.length === 0 && !selectedResume)}
               className={`flex h-9 w-9 items-center justify-center rounded-full text-white transition disabled:cursor-not-allowed ${
                 (value.trim() || attachmentPreview || selectedExperiences.length > 0 || selectedResume) && !isSending 
                   ? 'bg-slate-900 hover:bg-slate-800 shadow-md' 
                   : 'bg-slate-200 text-slate-400'
               }`}
             >
               <ArrowUp className="h-5 w-5" />
             </button>
          </div>
        </div>
      </div>
      <div className="mt-3 px-1 text-center text-xs text-slate-400">
        AI 可能会犯错。请核对重要信息。
      </div>
    </div>
  );
};
