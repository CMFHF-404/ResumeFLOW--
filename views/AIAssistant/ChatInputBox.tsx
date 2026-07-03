import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Plus,
  Mic,
  ArrowUp,
  BrainCircuit,
  ChevronUp,
  Sparkles,
  PenLine,
  HeartPulse,
  ChevronDown,
} from 'lucide-react';
import type { AssistantSkillId, AssistantSuggestedFollowup } from '../../services/aiService';
import { ASSISTANT_SKILL_PRESETS } from './AssistantSkillPresetPanel';

export type ChatInputBoxProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isSending: boolean;
  isDeepThinkingEnabled?: boolean;
  shouldExpandDeepThinkingButton?: boolean;
  surface?: 'full' | 'sidebar';
  onDeepThinkingChange?: (enabled: boolean) => void;
  placeholder?: string;
  plusActions?: { key: string; label: string; onClick?: () => void }[];
  onAddAttachments?: (files: File[]) => void;
  hasContextItems?: boolean;
  resumeModules?: {
    id: string;
    label: string;
    displayLabel: string;
    kind: 'experience' | 'education' | 'certification' | 'skills';
    contextId?: string;
  }[];
  selectedResumeModuleIds?: string[];
  onSelectedResumeModuleIdsChange?: (ids: string[]) => void;
  activeSkillId?: AssistantSkillId | null;
  onSelectSkillPreset?: (skillId: AssistantSkillId, prompt: string) => void;
  suggestedFollowups?: AssistantSuggestedFollowup[];
  onSelectSuggestedFollowup?: (skillId: AssistantSkillId, prompt: string) => void;
};

const hasFilesInDataTransfer = (dataTransfer: DataTransfer | null | undefined) => {
  if (!dataTransfer) {
    return false;
  }
  return Array.from(dataTransfer.types).includes('Files');
};

const QUICK_SKILL_BUTTONS: {
  label: string;
  presetId: AssistantSkillId;
  Icon: React.ComponentType<{ className?: string }>;
  iconClassName: string;
}[] = [
  {
    label: 'STAR 引导助手',
    presetId: 'star_guidance',
    Icon: Sparkles,
    iconClassName: 'text-emerald-500',
  },
  {
    label: '智能补全',
    presetId: 'experience_completion',
    Icon: PenLine,
    iconClassName: 'text-violet-500',
  },
  {
    label: '模拟面试',
    presetId: 'mock_interview',
    Icon: HeartPulse,
    iconClassName: 'text-red-500',
  },
];

const SKILL_PRESET_BY_ID = new Map(ASSISTANT_SKILL_PRESETS.map((preset) => [preset.id, preset]));

export const ChatInputBox: React.FC<ChatInputBoxProps> = ({
  value,
  onChange,
  onSubmit,
  isSending,
  isDeepThinkingEnabled = false,
  shouldExpandDeepThinkingButton = true,
  surface = 'full',
  onDeepThinkingChange,
  placeholder = '有问题，尽管问',
  plusActions = [],
  onAddAttachments,
  hasContextItems = false,
  resumeModules = [],
  selectedResumeModuleIds = [],
  onSelectedResumeModuleIdsChange,
  activeSkillId = null,
  onSelectSkillPreset,
  suggestedFollowups = [],
  onSelectSuggestedFollowup,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const moduleMenuRef = useRef<HTMLDivElement>(null);
  const dragDepthRef = useRef(0);
  const [isPlusMenuOpen, setIsPlusMenuOpen] = useState(false);
  const [isModuleMenuOpen, setIsModuleMenuOpen] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const selectedResumeModules = selectedResumeModuleIds
    .map((id) => resumeModules.find((item) => item.id === id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const selectedModuleCount = selectedResumeModules.length;
  const selectedModuleSummary = selectedResumeModules[selectedModuleCount - 1]?.displayLabel ?? '简历各模块';
  const selectedModuleTitle = selectedResumeModules.map((item) => item.displayLabel).join('、') || '简历各模块';
  const isSidebarSurface = surface === 'sidebar';
  const textareaMaxHeight = isSidebarSurface ? 112 : 160;
  const textareaClassName = isSidebarSurface
    ? 'min-h-[40px] max-h-[112px] w-full resize-none overflow-y-auto border-0 bg-transparent px-4 py-2.5 text-sm leading-6 text-slate-800 outline-none placeholder:text-slate-400 focus:outline-none focus:ring-0 dark:text-slate-100 dark:placeholder:text-slate-500 sm:min-h-[44px] sm:px-5 sm:py-3'
    : 'min-h-[56px] max-h-[160px] w-full resize-none overflow-y-auto border-0 bg-transparent px-4 py-4 text-sm leading-6 text-slate-800 outline-none placeholder:text-slate-400 focus:outline-none focus:ring-0 dark:text-slate-100 dark:placeholder:text-slate-500 sm:min-h-[60px] sm:px-6 sm:py-5';
  const composerControlsClassName = isSidebarSurface
    ? 'flex items-center justify-between px-2 py-1.5 sm:px-3 sm:py-2'
    : 'flex items-center justify-between px-2 py-2 sm:px-3 sm:py-3';
  const hasSuggestedFollowups = suggestedFollowups.length > 0;

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = '0px';
    const fullHeight = textarea.scrollHeight;
    const nextHeight = Math.min(fullHeight, textareaMaxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = fullHeight > textareaMaxHeight ? 'auto' : 'hidden';
  }, [value, textareaMaxHeight]);

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

  useEffect(() => {
    const filteredIds = selectedResumeModuleIds.filter((id) => resumeModules.some((item) => item.id === id));
    if (filteredIds.length === selectedResumeModuleIds.length) {
      return;
    }
    onSelectedResumeModuleIdsChange?.(filteredIds);
  }, [onSelectedResumeModuleIdsChange, resumeModules, selectedResumeModuleIds]);

  useEffect(() => {
    if (!isModuleMenuOpen) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (!moduleMenuRef.current?.contains(event.target as Node)) {
        setIsModuleMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [isModuleMenuOpen]);

  const canSubmit = Boolean(value.trim() || hasContextItems) && !isSending;
  const shouldShowDeepThinkingLabel = isDeepThinkingEnabled && shouldExpandDeepThinkingButton;

  const handleResumeModuleToggle = (mod: NonNullable<ChatInputBoxProps['resumeModules']>[number]) => {
    const nextIds = selectedResumeModuleIds.includes(mod.id)
      ? selectedResumeModuleIds.filter((id) => id !== mod.id)
      : [...selectedResumeModuleIds, mod.id];
    setIsModuleMenuOpen(false);
    onSelectedResumeModuleIdsChange?.(nextIds);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSubmit) {
        onSubmit();
      }
    }
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboardItems = Array.from(event.clipboardData.items);
    const imageFiles = clipboardItems
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((item): item is File => Boolean(item));

    if (imageFiles.length === 0) {
      return;
    }

    event.preventDefault();
    onAddAttachments?.(imageFiles);
  };

  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFilesInDataTransfer(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    setIsDragActive(true);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFilesInDataTransfer(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    if (!isDragActive) {
      setIsDragActive(true);
    }
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFilesInDataTransfer(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragActive(false);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFilesInDataTransfer(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragActive(false);
    const droppedFiles = Array.from(event.dataTransfer.files);
    if (droppedFiles.length > 0) {
      onAddAttachments?.(droppedFiles);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl">
      {/* 快捷推荐动作小丸子 */}
      <div
        className="mb-2.5 flex flex-nowrap overflow-x-auto items-center justify-start gap-2 px-1 pb-1"
      >
        {hasSuggestedFollowups ? suggestedFollowups.map((item) => (
          <button
            key={`${item.skillId}-${item.label}`}
            type="button"
            onClick={() => {
              onSelectSuggestedFollowup?.(item.skillId, item.prompt);
              textareaRef.current?.focus();
            }}
            className="inline-flex shrink-0 items-center rounded-full border border-emerald-100 bg-emerald-50/90 px-3.5 py-1.5 text-left text-xs font-semibold leading-5 text-emerald-800 shadow-xs transition hover:border-emerald-200 hover:bg-emerald-100 dark:border-emerald-500/25 dark:bg-emerald-500/12 dark:text-emerald-100 dark:hover:border-emerald-400/40 dark:hover:bg-emerald-500/18"
            title={item.prompt}
          >
            <span className="whitespace-nowrap">{item.label}</span>
          </button>
        )) : QUICK_SKILL_BUTTONS.map(({ label, presetId, Icon, iconClassName }) => {
          const preset = SKILL_PRESET_BY_ID.get(presetId);
          const isActive = activeSkillId === presetId;
          return (
            <button
              key={presetId}
              type="button"
              aria-pressed={isActive}
              onClick={() => {
                if (preset) {
                  onSelectSkillPreset?.(preset.id, preset.prompt);
                  if (!onSelectSkillPreset) {
                    onChange(preset.prompt);
                  }
                }
                textareaRef.current?.focus();
              }}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold shadow-xs transition ${
                isActive
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200'
                  : 'border-slate-200 bg-white/95 text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950/80 dark:text-slate-300 dark:hover:border-slate-700'
              }`}
              title={preset?.title}
            >
              <Icon className={`h-3 w-3 ${iconClassName}`} />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      <div
        className={`relative flex flex-col overflow-visible rounded-[24px] border border-white/55 bg-white/48 shadow-[0_24px_70px_-30px_rgba(15,23,42,0.35)] backdrop-blur-2xl transition-all focus-within:bg-white/62 focus-within:shadow-[0_28px_90px_-34px_rgba(15,23,42,0.42)] dark:border-slate-700/80 dark:bg-slate-950/82 dark:shadow-[0_28px_90px_-34px_rgba(2,6,23,0.88)] dark:focus-within:bg-slate-950/92 sm:rounded-[32px] ${
          isDragActive
            ? 'border-emerald-300 bg-emerald-50/90 shadow-[0_20px_60px_-28px_rgba(16,185,129,0.45)] dark:border-emerald-500/70 dark:bg-emerald-950/45'
            : ''
        }`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragActive ? (
          <div className="pointer-events-none absolute inset-0 z-20 rounded-[24px] border-2 border-dashed border-emerald-400 bg-emerald-50/80 dark:border-emerald-500 dark:bg-emerald-950/60 sm:rounded-[32px]">
            <div className="flex h-full items-center justify-center px-6 text-center">
              <div className="rounded-2xl bg-white/90 px-4 py-3 shadow-sm dark:bg-slate-900/95 dark:shadow-[0_16px_40px_-20px_rgba(2,6,23,0.9)]">
                <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">松手即可上传附件</div>
                <div className="mt-1 text-xs text-emerald-600 dark:text-emerald-200/80">支持图片、PDF 和 DOCX，并会显示在底部上下文卡片里</div>
              </div>
            </div>
          </div>
        ) : null}

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={placeholder}
          rows={1}
          className={textareaClassName}
        />

        <div className={composerControlsClassName}>
          <div className="flex min-w-0 items-center gap-2 pl-1 sm:pl-2">
            <div ref={plusMenuRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setIsPlusMenuOpen((current) => !current)}
                className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                title="添加经历或附件"
              >
                {isPlusMenuOpen ? <ChevronUp className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
              </button>
              {isPlusMenuOpen ? (
                <div className="absolute bottom-12 left-0 z-30 min-w-[168px] rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_16px_32px_rgba(15,23,42,0.12)] dark:border-slate-700 dark:bg-slate-900 dark:shadow-[0_20px_48px_-20px_rgba(2,6,23,0.9)]">
                  {plusActions.map((action) => (
                    <button
                      key={action.key}
                      type="button"
                      onClick={() => {
                        setIsPlusMenuOpen(false);
                        action.onClick?.();
                      }}
                      className="flex w-full items-center rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-800"
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {resumeModules && resumeModules.length > 0 ? (
              <div ref={moduleMenuRef} className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setIsModuleMenuOpen((current) => !current)}
                  title={selectedModuleTitle}
                  className={`inline-flex max-w-[168px] items-center gap-1 rounded-xl border px-2.5 py-1.5 text-[11px] font-bold transition ${
                    selectedModuleCount > 0
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 shadow-sm shadow-emerald-100/60 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-200 dark:shadow-none dark:hover:bg-emerald-500/20'
                      : 'border-slate-200/80 bg-slate-50/80 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  <span className="min-w-0 truncate">{selectedModuleSummary}</span>
                  {selectedModuleCount > 1 ? (
                    <span className="shrink-0 rounded-full bg-white/75 px-1 text-[10px] leading-4 text-emerald-700 dark:bg-slate-950/40 dark:text-emerald-200">
                      +{selectedModuleCount - 1}
                    </span>
                  ) : null}
                  <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${isModuleMenuOpen ? 'rotate-180' : ''}`} />
                </button>
                {isModuleMenuOpen ? (
                  <div className="absolute bottom-12 left-0 z-30 min-w-[220px] max-h-[220px] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_16px_32px_rgba(15,23,42,0.12)] dark:border-slate-700 dark:bg-slate-900 dark:shadow-[0_20px_48px_-20px_rgba(2,6,23,0.95)]">
                    {resumeModules.map((mod) => {
                      const isSelected = selectedResumeModuleIds.includes(mod.id);
                      return (
                        <button
                          key={mod.id}
                          type="button"
                          onClick={() => handleResumeModuleToggle(mod)}
                          className={`flex w-full items-center rounded-xl px-3 py-2 text-left text-xs font-semibold transition ${
                            isSelected
                              ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-100 hover:bg-emerald-600 dark:bg-emerald-500 dark:text-white dark:shadow-none dark:hover:bg-emerald-500'
                              : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/80'
                          }`}
                        >
                          <span className="truncate">{mod.label}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-2 pr-1">
            <button
              type="button"
              onClick={() => onDeepThinkingChange?.(!isDeepThinkingEnabled)}
              disabled={isSending}
              aria-pressed={isDeepThinkingEnabled}
              aria-label="深度思考"
              style={{
                width: shouldShowDeepThinkingLabel ? 112 : 36,
                paddingLeft: shouldShowDeepThinkingLabel ? 12 : 0,
                paddingRight: shouldShowDeepThinkingLabel ? 12 : 0,
              }}
              className={`inline-flex h-9 shrink-0 items-center justify-center overflow-hidden rounded-full border transition-[width,padding,background-color,border-color,color,box-shadow] duration-200 ease-out motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-55 ${
                shouldShowDeepThinkingLabel ? 'gap-1.5' : 'gap-0'
              } ${
                isDeepThinkingEnabled
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700 shadow-sm shadow-emerald-100 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200 dark:shadow-none'
                  : 'border-transparent text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200'
              }`}
              title="深度思考"
            >
              <BrainCircuit className={`h-5 w-5 shrink-0 transition-transform duration-200 ease-out motion-reduce:transition-none ${isDeepThinkingEnabled ? 'scale-105' : 'scale-100'}`} />
              <span
                aria-hidden={!shouldShowDeepThinkingLabel}
                style={{
                  width: shouldShowDeepThinkingLabel ? 64 : 0,
                  opacity: shouldShowDeepThinkingLabel ? 1 : 0,
                  transform: shouldShowDeepThinkingLabel ? 'translateX(0)' : 'translateX(-4px)',
                }}
                className="inline-block overflow-hidden whitespace-nowrap text-xs font-semibold transition-[width,opacity,transform] duration-200 ease-out motion-reduce:transition-none"
              >
                深度思考
              </span>
            </button>
            <button
              type="button"
              className="hidden rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              title="语音输入"
            >
              <Mic className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={!canSubmit}
              className={`flex h-9 w-9 items-center justify-center rounded-full text-white transition disabled:cursor-not-allowed ${
                canSubmit
                  ? 'bg-slate-900 shadow-md hover:bg-slate-800'
                  : 'bg-slate-200 text-slate-400'
              }`}
            >
              <ArrowUp className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
      <div className="mt-3 px-1 text-center text-xs text-slate-400 dark:text-slate-500">
        AI 可能会犯错。请核对重要信息。
      </div>
    </div>
  );
};
