import React from 'react';
import { Bot, Check, RotateCcw, Sparkles } from 'lucide-react';
import type { PolishMode } from '../services/aiService';

type ToolbarMode = Exclude<PolishMode, 'assistant'>;

export type AIPolishToolbarProps = {
  isPreviewing: boolean;
  isRunning: boolean;
  activeMode: ToolbarMode;
  customPrompt: string;
  disabledAssistant?: boolean;
  previewDescription?: string;
  previewContent?: React.ReactNode;
  onModeChange: (mode: ToolbarMode) => void;
  onCustomPromptChange: (value: string) => void;
  onRun: () => void;
  onUndo: () => void;
  onConfirm: () => void;
  onOpenAssistant: () => void;
  className?: string;
  compact?: boolean;
};

const MODE_OPTIONS: Array<{ value: ToolbarMode; label: string }> = [
  { value: 'default', label: '默认润色' },
  { value: 'shorten', label: '精简内容' },
  { value: 'expand', label: '扩写文本' },
  { value: 'custom', label: '自定义 Prompt' },
];

const AIPolishToolbar: React.FC<AIPolishToolbarProps> = ({
  isPreviewing,
  isRunning,
  activeMode,
  customPrompt,
  disabledAssistant,
  previewDescription,
  previewContent,
  onModeChange,
  onCustomPromptChange,
  onRun,
  onUndo,
  onConfirm,
  onOpenAssistant,
  className,
  compact = false,
}) => {
  if (isPreviewing) {
    return (
      <div
        className={`flex min-h-[240px] max-h-[min(68vh,34rem)] flex-col overflow-hidden rounded-[24px] border border-emerald-200 bg-[linear-gradient(180deg,rgba(236,253,245,0.96),rgba(255,255,255,0.98))] ${className ?? ''}`}
      >
        <div className="border-b border-emerald-200/80 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-700">AI 预览已生成</div>
          <div className="mt-1 text-sm leading-6 text-emerald-900">
            {previewDescription ?? '现在可以撤销恢复原文，或确认采用到当前编辑态。'}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="flex min-h-full items-center justify-center">
            <div className="w-full max-w-[560px]">
              {previewContent ? (
                previewContent
              ) : (
                <div className="rounded-[20px] border border-emerald-100 bg-white/85 px-4 py-5 text-center text-sm leading-6 text-emerald-900 shadow-[0_14px_40px_rgba(16,185,129,0.08)]">
                  {previewDescription ?? '现在可以撤销恢复原文，或确认采用到当前编辑态。'}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="border-t border-emerald-200/80 bg-white/92 px-4 py-3 backdrop-blur">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              onClick={onUndo}
              disabled={isRunning}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-emerald-300 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RotateCcw className="h-4 w-4" />
              撤销
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isRunning}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Check className="h-4 w-4" />
              {isRunning ? '处理中...' : '确认'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-sm ${className ?? ''}`}>
      <div className={`flex ${compact ? 'flex-col gap-2' : 'flex-col gap-3'}`}>
        <div className="flex flex-wrap gap-2">
          {MODE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onModeChange(option.value)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                activeMode === option.value
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:text-slate-900'
              }`}
            >
              {option.label}
            </button>
          ))}
          <button
            type="button"
            onClick={onOpenAssistant}
            disabled={disabledAssistant}
            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Bot className="h-3.5 w-3.5" />
            高级模式
          </button>
        </div>
        {activeMode === 'custom' ? (
          <textarea
            value={customPrompt}
            onChange={(event) => onCustomPromptChange(event.target.value)}
            placeholder="例如：突出跨团队协作，但保持事实克制，不要夸大成果。"
            className="min-h-[84px] w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm leading-6 text-slate-700 outline-none transition focus:border-slate-300 focus:bg-white"
          />
        ) : null}
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs leading-5 text-slate-500">执行后生成预览</p>
          <button
            type="button"
            onClick={onRun}
            disabled={isRunning || (activeMode === 'custom' && !customPrompt.trim())}
            className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Sparkles className={`h-4 w-4 ${isRunning ? 'animate-pulse' : ''}`} />
            {isRunning ? '生成中...' : '执行'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIPolishToolbar;
