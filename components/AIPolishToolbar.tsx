import React from 'react';
import { Bot, Check, RotateCcw, Sparkles } from 'lucide-react';
import type { PolishMode } from '../services/aiService';
import { SmoothHeightContainer } from './SmoothHeightContainer';

type ToolbarMode = Exclude<PolishMode, 'assistant'>;

export type AIPolishToolbarProps = {
  isPreviewing: boolean;
  isRunning: boolean;
  activeMode: ToolbarMode;
  modeOptions?: ToolbarMode[];
  customPrompt: string;
  hasJdContext?: boolean;
  disabledAssistant?: boolean;
  previewTitle?: string;
  previewDescription?: string;
  previewContent?: React.ReactNode;
  smartCompletionPrompt?: {
    diagnosis: string;
    questions: string[];
    answer: string;
    onAnswerChange: (value: string) => void;
  } | null;
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
  thinkingText?: string;
  onStop?: () => void;
};

const DEFAULT_MODE_OPTIONS: ToolbarMode[] = ['default', 'highlight', 'custom'];

const MODE_LABELS: Record<ToolbarMode, string> = {
  default: 'AI 润色',
  highlight: '匹配高亮',
  smart_complete: '智能补全',
  shorten: '精简内容',
  expand: '扩写文本',
  custom: '自定义 Prompt',
};

const MODE_DESCRIPTIONS_WITH_JD: Record<ToolbarMode, string> = {
  default: '结合 JD，改写成更接近简历成稿的表达。',
  highlight: '保守轻改，只加粗最匹配 JD 的证据。',
  smart_complete: '先判断证据是否足够，必要时在卡片内追问补充事实。',
  shorten: '保留关键信息，字数压缩 30% 以上。',
  expand: '补充必要上下文，字数扩写 30% 以上。',
  custom: '按你的 Prompt 定向润色，仍以事实为准。',
};

const MODE_DESCRIPTIONS_NO_JD: Record<ToolbarMode, string> = {
  default: '结构化 STAR 并转为专业书面语。',
  highlight: '保留原文，仅调整重点内容的强调。',
  smart_complete: '诊断经历证据缺口，并给出可补充的问题。',
  shorten: '保留关键信息，字数压缩 30% 以上。',
  expand: '补充必要上下文，字数扩写 30% 以上。',
  custom: '按你的 Prompt 定向润色，仍以事实为准。',
};

const AIPolishToolbar: React.FC<AIPolishToolbarProps> = ({
  isPreviewing,
  isRunning,
  activeMode,
  modeOptions = DEFAULT_MODE_OPTIONS,
  customPrompt,
  hasJdContext = false,
  disabledAssistant,
  previewTitle,
  previewDescription,
  previewContent,
  smartCompletionPrompt,
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
  thinkingText,
  onStop,
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
  const canStopRunning = isRunning && typeof onStop === 'function' && !isPreviewing;

  if (canStopRunning) {
    return (
      <div className={`flex items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5 backdrop-blur-sm dark:bg-primary-dark/10 transition-all duration-300 ${className ?? ''}`}>
        <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
          <Sparkles className="h-4 w-4 shrink-0 animate-spin text-primary" />
          <SmoothHeightContainer className="flex-1 min-w-0">
            <span className="break-all whitespace-pre-wrap font-semibold leading-relaxed block">
              思考中：{thinkingText || '正在进行 AI 润色...'}
            </span>
          </SmoothHeightContainer>
        </div>
        <button
          type="button"
          onClick={onStop}
          className="flex shrink-0 items-center gap-1 rounded bg-red-50 px-2 py-1 text-xs font-semibold text-red-600 transition hover:bg-red-100 dark:bg-red-950/40 dark:text-red-400"
        >
          停止
        </button>
      </div>
    );
  }

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
    <div className={`max-h-[min(62vh,30rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-sm ${className ?? ''}`}>
      <div className={`flex ${compact ? 'flex-col gap-2' : 'flex-col gap-3'}`}>
        <div className="flex flex-wrap gap-2">
          {modeOptions.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onModeChange(option)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                activeMode === option
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:text-slate-900'
              }`}
            >
              {MODE_LABELS[option]}
            </button>
          ))}
          <button
            type="button"
            onClick={onOpenAssistant}
            disabled={disabledAssistant}
            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Bot className="h-3.5 w-3.5" />
            智能补全
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
        {activeMode === 'smart_complete' && smartCompletionPrompt ? (
          <div className={`ai-polish-card-expand flex ${compact ? 'max-h-[18rem]' : 'max-h-[22rem]'} min-h-0 flex-col overflow-hidden rounded-2xl border border-amber-200 bg-amber-50/80 p-3 md:max-h-none md:overflow-visible`}>
            <div className={`${compact ? 'max-h-[10rem]' : 'max-h-[13rem]'} min-h-0 overflow-y-auto pr-2 md:max-h-none md:overflow-visible md:pr-0`}>
              <div className="text-xs font-semibold text-amber-900">需要补充的信息</div>
              <p className="mt-1 text-xs leading-5 text-amber-800">{smartCompletionPrompt.diagnosis}</p>
              {smartCompletionPrompt.questions.length > 0 ? (
                <div className="mt-2 space-y-1">
                  {smartCompletionPrompt.questions.slice(0, 5).map((question, index) => (
                    <p key={`${question}-${index}`} className="text-xs leading-5 text-amber-900">
                      {index + 1}. {question}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
            <textarea
              value={smartCompletionPrompt.answer}
              onChange={(event) => smartCompletionPrompt.onAnswerChange(event.target.value)}
              placeholder="在这里补充真实事实，例如目标用户、产品取舍、MVP 验证、用户反馈或指标结果。"
              className="mt-3 min-h-[76px] shrink-0 w-full resize-y rounded-2xl border border-amber-200 bg-white px-3 py-3 text-sm leading-6 text-slate-700 outline-none transition placeholder:text-amber-700/50 focus:border-amber-300 focus:ring-2 focus:ring-amber-100"
            />
          </div>
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
