import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Plus,
  Mic,
  ArrowUp,
  BrainCircuit,
  Paperclip,
  X,
  Briefcase,
  ChevronUp,
  FileText,
  Image as ImageIcon,
  FolderKanban,
  GraduationCap,
} from 'lucide-react';
import type { AssistantSelectedExperience, AssistantSelectedResume } from '../../services/aiService';

export type ChatInputAttachmentPreview = {
  id: string;
  name: string;
  type?: string;
  sizeLabel?: string;
  previewUrl?: string | null;
};

export type ChatInputBoxProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isSending: boolean;
  isDeepThinkingEnabled?: boolean;
  onDeepThinkingChange?: (enabled: boolean) => void;
  placeholder?: string;
  plusActions?: { key: string; label: string; onClick?: () => void }[];
  attachments?: ChatInputAttachmentPreview[];
  onRemoveAttachment?: (attachmentId: string) => void;
  onAddAttachments?: (files: File[]) => void;
  selectedExperiences?: AssistantSelectedExperience[];
  onRemoveSelectedExperience?: (masterId: string) => void;
  selectedResume?: AssistantSelectedResume | null;
  onRemoveSelectedResume?: () => void;
};

const EXPERIENCE_ICON = {
  work: Briefcase,
  project: FolderKanban,
  education: GraduationCap,
} as const;

const hasFilesInDataTransfer = (dataTransfer: DataTransfer | null | undefined) => {
  if (!dataTransfer) {
    return false;
  }
  return Array.from(dataTransfer.types).includes('Files');
};

export const ChatInputBox: React.FC<ChatInputBoxProps> = ({
  value,
  onChange,
  onSubmit,
  isSending,
  isDeepThinkingEnabled = false,
  onDeepThinkingChange,
  placeholder = '有问题，尽管问',
  plusActions = [],
  attachments = [],
  onRemoveAttachment,
  onAddAttachments,
  selectedExperiences = [],
  onRemoveSelectedExperience,
  selectedResume,
  onRemoveSelectedResume,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const dragDepthRef = useRef(0);
  const [isPlusMenuOpen, setIsPlusMenuOpen] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);

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
      if (!isSending && (value.trim() || attachments.length > 0 || selectedExperiences.length > 0 || selectedResume)) {
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

  const hasAssets = attachments.length > 0 || Boolean(selectedResume) || selectedExperiences.length > 0;

  return (
    <div className="mx-auto w-full max-w-3xl">
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
                <div className="mt-1 text-xs text-emerald-600 dark:text-emerald-200/80">支持图片、PDF 和 DOCX，并会以横向卡片排列</div>
              </div>
            </div>
          </div>
        ) : null}

        {hasAssets ? (
          <div className="px-4 pt-4 sm:px-5 sm:pt-5">
            <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
              {attachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="flex h-[88px] w-[220px] shrink-0 gap-3 rounded-2xl border border-slate-200 bg-slate-50/85 px-3 py-3 dark:border-slate-700 dark:bg-slate-900/90 sm:w-[232px]"
                >
                  {attachment.previewUrl ? (
                    <img
                      src={attachment.previewUrl}
                      alt={attachment.name}
                      className="h-12 w-12 shrink-0 rounded-2xl object-cover ring-1 ring-slate-200 dark:ring-slate-700"
                    />
                  ) : (
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-slate-500 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
                      {attachment.type?.startsWith('image/') ? (
                        <ImageIcon className="h-4 w-4" />
                      ) : (
                        <Paperclip className="h-4 w-4" />
                      )}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                      附件
                    </div>
                    <div className="mt-1 truncate text-sm font-medium leading-5 text-slate-700 dark:text-slate-100">
                      {attachment.name}
                    </div>
                    <div className="mt-1 truncate text-xs text-slate-400 dark:text-slate-500">
                      {[attachment.type, attachment.sizeLabel].filter(Boolean).join(' · ') || '已选择附件'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemoveAttachment?.(attachment.id)}
                    className="self-start rounded-full p-1 text-slate-400 transition hover:bg-white hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    title="移除附件"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}

              {selectedResume ? (
                <div className="flex h-[88px] w-[220px] shrink-0 gap-3 rounded-2xl border border-sky-200 bg-sky-50/85 px-3 py-3 dark:border-sky-500/30 dark:bg-sky-950/35 sm:w-[232px]">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-sky-600 ring-1 ring-sky-100 dark:bg-slate-800 dark:text-sky-300 dark:ring-sky-500/20">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-sky-500 dark:text-sky-300">
                      简历
                    </div>
                    <div className="mt-1 truncate text-sm font-medium leading-5 text-slate-700 dark:text-slate-100">
                      {selectedResume.resumeName || '未命名简历'}
                    </div>
                    <div className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
                      {selectedResume.jdContext?.trim() ? '已关联 JD' : '未关联 JD'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={onRemoveSelectedResume}
                    className="self-start rounded-full p-1 text-slate-400 transition hover:bg-white hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    title="移除简历"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : null}

              {selectedExperiences.map((item) => {
                const ExperienceIcon = EXPERIENCE_ICON[item.category] ?? Briefcase;
                const experienceLabel = item.category === 'project'
                  ? '项目'
                  : item.category === 'education'
                    ? '教育'
                    : '经历';

                return (
                  <div
                    key={item.masterId}
                    className="flex h-[88px] w-[220px] shrink-0 gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/80 px-3 py-3 dark:border-emerald-500/30 dark:bg-emerald-950/35 sm:w-[232px]"
                  >
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-emerald-600 ring-1 ring-emerald-100 dark:bg-slate-800 dark:text-emerald-300 dark:ring-emerald-500/20">
                      <ExperienceIcon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-emerald-600 dark:text-emerald-300">
                        {experienceLabel}
                      </div>
                      <div className="mt-1 truncate text-sm font-medium leading-5 text-slate-700 dark:text-slate-100">
                        {item.org || '未填写组织'} / {item.title || '未填写角色'}
                      </div>
                      <div className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
                        {item.summary || '已选中经历内容'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoveSelectedExperience?.(item.masterId)}
                      className="self-start rounded-full p-1 text-slate-400 transition hover:bg-white hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                      title="移除经历"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
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
          className="min-h-[56px] max-h-[160px] w-full resize-none overflow-y-auto border-0 bg-transparent px-4 py-4 text-sm leading-6 text-slate-800 outline-none placeholder:text-slate-400 focus:outline-none focus:ring-0 dark:text-slate-100 dark:placeholder:text-slate-500 sm:min-h-[60px] sm:px-6 sm:py-5"
        />

        <div className="flex items-center justify-between px-2 py-2 sm:px-3 sm:py-3">
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
          </div>

          <div className="flex shrink-0 items-center gap-2 pr-1">
            <button
              type="button"
              onClick={() => onDeepThinkingChange?.(!isDeepThinkingEnabled)}
              disabled={isSending}
              aria-pressed={isDeepThinkingEnabled}
              aria-label="深度思考"
              className={`inline-flex h-9 w-9 items-center justify-center rounded-full border transition disabled:cursor-not-allowed disabled:opacity-55 ${
                isDeepThinkingEnabled
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700 shadow-sm shadow-emerald-100 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200 dark:shadow-none'
                  : 'border-transparent text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200'
              }`}
              title="深度思考"
            >
              <BrainCircuit className="h-5 w-5" />
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
              disabled={isSending || (!value.trim() && attachments.length === 0 && selectedExperiences.length === 0 && !selectedResume)}
              className={`flex h-9 w-9 items-center justify-center rounded-full text-white transition disabled:cursor-not-allowed ${
                (value.trim() || attachments.length > 0 || selectedExperiences.length > 0 || selectedResume) && !isSending
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
