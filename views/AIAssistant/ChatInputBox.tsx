import React, { useRef, useEffect } from 'react';
import { SendHorizonal } from 'lucide-react';

export type ChatInputBoxProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isSending: boolean;
  placeholder?: string;
  quickActions?: { label: string; onClick?: () => void }[];
};

export const ChatInputBox: React.FC<ChatInputBoxProps> = ({
  value,
  onChange,
  onSubmit,
  isSending,
  placeholder = '发送消息...',
  quickActions = [],
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
      if (!isSending && value.trim()) {
        onSubmit();
      }
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl">
      {/* Quick Actions (floating above) */}
      {quickActions.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          {quickActions.map((action, idx) => (
            <button
              key={idx}
              type="button"
              onClick={action.onClick}
              className="rounded-full bg-white border border-slate-200 px-3 py-1.5 text-slate-500 hover:text-slate-700 hover:border-slate-300 transition shadow-sm"
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      {/* Main Input Box */}
      <div className="relative flex items-end rounded-3xl border border-slate-200 bg-white p-2 shadow-sm transition-shadow focus-within:border-slate-300 focus-within:shadow-md">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          className="max-h-[160px] min-h-[44px] w-full resize-none bg-transparent px-4 py-3 text-sm leading-6 text-slate-800 placeholder:text-slate-400 outline-none"
        />
        <div className="p-1 shrink-0">
          <button
            type="button"
            onClick={onSubmit}
            disabled={isSending || !value.trim()}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
          >
            <SendHorizonal className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="mt-2 text-center text-[11px] text-slate-400">
        AI 可能会犯错。请核对重要信息。
      </div>
    </div>
  );
};
