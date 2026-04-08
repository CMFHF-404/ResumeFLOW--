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
      <div className={`rounded-2xl border border-emerald-200 bg-emerald-50/80 p-3 ${className ?? ''}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-700">AI 预览已生成</div>
            <div className="mt-1 text-sm text-emerald-900">现在可以撤销恢复原文，或确认采用到当前编辑态。</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onUndo}
              className="inline-flex items-center gap-2 rounded-full border border-emerald-300 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100"
            >
              <RotateCcw className="h-4 w-4" />
              撤销
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="inline-flex items-center gap-2 rounded-full bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800"
            >
              <Check className="h-4 w-4" />
              确认
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
          <p className="text-xs leading-5 text-slate-500">
            生成后不会立即保存，只会先进入可撤销的预览态。
          </p>
          <button
            type="button"
            onClick={onRun}
            disabled={isRunning || (activeMode === 'custom' && !customPrompt.trim())}
            className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
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
