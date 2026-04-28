import React from 'react';
import { Bot, Check, RotateCcw, Sparkles } from 'lucide-react';
import type { PolishMode } from '../services/aiService';

type ToolbarMode = Exclude<PolishMode, 'assistant'>;

export type AIPolishToolbarProps = {
  isPreviewing: boolean;
  isRunning: boolean;
  activeMode: ToolbarMode;
  customPrompt: string;
  hasJdContext?: boolean;
  disabledAssistant?: boolean;
  previewTitle?: string;
  previewDescription?: string;
  previewContent?: React.ReactNode;
  runHint?: string;
  runButtonLabel?: string;
  runningLabel?: string;
  undoLabel?: string;
  confirmLabel?: string;
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
  { value: 'default', label: 'AI 润色' },
  { value: 'highlight', label: '匹配高亮' },
  { value: 'shorten', label: '精简内容' },
  { value: 'expand', label: '扩写文本' },
  { value: 'custom', label: '自定义 Prompt' },
];

const MODE_DESCRIPTIONS_WITH_JD: Record<ToolbarMode, string> = {
  default: '结合 JD，改写成更接近简历成稿的表达。',
  highlight: '保守轻改，只加粗最匹配 JD 的证据。',
  shorten: '保留关键信息，字数压缩 30% 以上。',
  expand: '补充必要上下文，字数扩写 30% 以上。',
  custom: '按你的 Prompt 定向润色，仍以事实为准。',
};

const MODE_DESCRIPTIONS_NO_JD: Record<ToolbarMode, string> = {
  default: '保留原文，仅调整重点内容的强调。',
  highlight: '保留原文，仅调整重点内容的强调。',
  shorten: '保留关键信息，字数压缩 30% 以上。',
  expand: '补充必要上下文，字数扩写 30% 以上。',
  custom: '按你的 Prompt 定向润色，仍以事实为准。',
};

const AIPolishToolbar: React.FC<AIPolishToolbarProps> = ({
  isPreviewing,
  isRunning,
  activeMode,
  customPrompt,
  hasJdContext = false,
  disabledAssistant,
  previewTitle,
  previewDescription,
  previewContent,
  runHint,
  runButtonLabel,
  runningLabel,
  undoLabel,
  confirmLabel,
  onModeChange,
  onCustomPromptChange,
  onRun,
  onUndo,
  onConfirm,
  onOpenAssistant,
  className,
  compact = false,
}) => {
  const hasPreviewContent = Boolean(previewContent);
  const previewHeading = previewTitle ?? 'AI 润色结果';
  const previewMessage = previewDescription ?? '结果已同步到简历预览，请确认是否保存到当前简历。';
  const resolvedRunButtonLabel = runButtonLabel ?? '执行';
  const resolvedRunningLabel = runningLabel ?? '生成中...';
  const resolvedUndoLabel = undoLabel ?? '撤销';
  const resolvedConfirmLabel = confirmLabel ?? '确认';
  const modeDescriptions = hasJdContext ? MODE_DESCRIPTIONS_WITH_JD : MODE_DESCRIPTIONS_NO_JD;
  const modeDescription = runHint ?? modeDescriptions[activeMode];

  if (isPreviewing) {
    return (
        <div
          className={`flex ${hasPreviewContent ? 'min-h-[240px] max-h-[min(68vh,34rem)]' : ''} flex-col overflow-hidden rounded-[24px] border border-emerald-200 bg-[linear-gradient(180deg,rgba(236,253,245,0.96),rgba(255,255,255,0.98))] ${hasPreviewContent ? 'md:h-full md:min-h-0 md:max-h-full' : ''} ${className ?? ''}`}
        >
          <div className={`${hasPreviewContent ? 'border-b border-emerald-200/80' : ''} px-4 py-3`}>
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-700">{previewHeading}</div>
            <div className="mt-1 text-sm leading-6 text-emerald-900">
              {previewMessage}
            </div>
          </div>
        {hasPreviewContent ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <div className="flex min-h-full items-center justify-center">
              <div className="w-full max-w-[560px]">
                {previewContent}
              </div>
            </div>
          </div>
        ) : null}
        <div className={`shrink-0 bg-white/92 px-4 py-3 backdrop-blur ${hasPreviewContent ? 'border-t border-emerald-200/80' : ''}`}>
          <div className={`flex flex-col gap-3 md:flex-row md:items-center ${hasPreviewContent ? 'md:justify-end' : 'md:justify-end'}`}>
            <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onUndo}
              disabled={isRunning}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-emerald-300 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60 md:flex-none"
            >
              <RotateCcw className="h-4 w-4" />
              {resolvedUndoLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isRunning}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60 md:flex-none"
            >
              <Check className="h-4 w-4" />
              {isRunning ? '处理中...' : resolvedConfirmLabel}
            </button>
            </div>
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
          <p className="max-w-[16rem] text-xs leading-5 text-slate-500">{modeDescription}</p>
          <button
            type="button"
            onClick={onRun}
            disabled={isRunning || (activeMode === 'custom' && !customPrompt.trim())}
            className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Sparkles className={`h-4 w-4 ${isRunning ? 'animate-pulse' : ''}`} />
            {isRunning ? resolvedRunningLabel : resolvedRunButtonLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIPolishToolbar;
