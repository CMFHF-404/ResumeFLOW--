import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp, Sparkles, Trash2, X } from 'lucide-react';
import AIPolishToolbar from '../components/AIPolishToolbar';
import type { PolishMode } from '../services/aiService';
import MonthPicker from '../components/MonthPicker';
import RichTextEditor from '../components/RichTextEditor';
import { parseYearMonthValue, resolveCardMotionClass } from './experienceUtils';
import { stripRichTextToText } from '../utils/richText';

const getThemeClasses = (color: string = 'primary') => {
  if (color === 'primary') {
    return {
      button: 'bg-primary hover:bg-primary-dark text-white shadow-primary/20',
      tag: 'hover:text-primary hover:border-primary hover:bg-primary/5',
      focus: 'focus:ring-primary/20 focus:border-primary',
    };
  }
  return {
    button: `bg-${color}-600 hover:bg-${color}-700 text-white shadow-${color}-500/20`,
    tag: `hover:text-${color}-600 hover:border-${color}-600 hover:bg-${color}-50`,
    focus: `focus:ring-${color}-500/20 focus:border-${color}-500`,
  };
};

export type StarFieldKey = 's' | 't' | 'a' | 'r';

export type ExperienceCardData = {
  org: string;
  title: string;
  start_date: string;
  end_date: string;
  star: Record<StarFieldKey, string>;
  editMode: 'simple' | 'expert';
  simpleText: string;
  draftId?: string | null;
  clientDraftKey?: string | null;
  draftStatus?: 'idle' | 'saving' | 'saved' | 'error';
};

export type ExperienceCardLabels = {
  orgLabel: string;
  titleLabel: string;
  orgPlaceholder: string;
  titlePlaceholder: string;
  summaryPlaceholder: string;
};

export const STAR_FIELD_LABELS: Record<StarFieldKey, string> = {
  s: '情境',
  t: '任务',
  a: '行动',
  r: '结果',
};

const STAR_SECTIONS: Array<{
  id: StarFieldKey;
  label: string;
  color: string;
  ph: string;
}> = [
    { id: 's', label: 'S - 情境 (Situation)', color: 'blue', ph: '情境描述：描述当时面临的背景、面临的挑战或问题...' },
    { id: 't', label: 'T - 任务 (Task)', color: 'orange', ph: '任务目标：说明你的职责是什么，需要达到什么样的具体目标...' },
    { id: 'a', label: 'A - 行动 (Action)', color: 'amber', ph: '行动细节：你具体做了什么，采取了哪些步骤，使用了什么技能或工具... \n\n【TIPS】：如果您暂时不知道 STAR 怎么写，可以将全部经历写在此处，AI 润色将自动为您拆分' },
    { id: 'r', label: 'R - 结果 (Result)', color: 'emerald', ph: '取得成果：最终取得了什么量化的成果、正面反馈或具体影响...' },
  ];

const EXPERIENCE_BANK_POLISH_MODES: Array<Exclude<PolishMode, 'assistant'>> = ['default', 'custom'];
const SIMPLE_PARSING_EDITOR_CLASS = 'simple-parsing-flow border-purple-300 bg-purple-50/40 shadow-[0_0_0_3px_rgba(168,85,247,0.18),0_0_30px_rgba(168,85,247,0.35)] dark:border-purple-500/60 dark:bg-purple-950/20';
const STAR_MODE_LETTERS = [
  { letter: 'S', className: 'text-blue-600 dark:text-blue-400' },
  { letter: 'T', className: 'text-orange-600 dark:text-orange-400' },
  { letter: 'A', className: 'text-amber-600 dark:text-amber-400' },
  { letter: 'R', className: 'text-emerald-600 dark:text-emerald-400' },
];

type ExperienceCardProps = {
  data: ExperienceCardData;
  labels: ExperienceCardLabels;
  isExpanded: boolean;
  isCollapsing: boolean;
  isModified: boolean;
  isSaving: boolean;
  isPolishing: boolean;
  isPolishPreviewing: boolean;
  activePolishMode: Exclude<PolishMode, 'assistant'>;
  customPolishPrompt: string;
  onToggle: () => void;
  onDelete: () => void;
  onSave: () => void;
  onFormalizeSimpleEntry: () => void;
  onCancel: () => void;
  onFieldChange: (field: string, value: string | string[]) => void;
  onEditModeChange: (mode: 'simple' | 'expert') => void;
  onPolishModeChange: (mode: Exclude<PolishMode, 'assistant'>) => void;
  onCustomPolishPromptChange: (value: string) => void;
  onRunPolish: () => void;
  onUndoPolishPreview: () => void;
  onConfirmPolishPreview: () => void;
  onOpenAssistant: () => void;
  onUndo: (field: StarFieldKey) => boolean;
  themeColor?: string;
};

const CollapsedExperienceCard: React.FC<{
  data: ExperienceCardData;
  labels: ExperienceCardLabels;
  onToggle: () => void;
  onDelete: () => void;
}> = ({ data, labels, onToggle, onDelete }) => {
  const handleDelete = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onDelete();
    },
    [onDelete]
  );

  return (
    <div
      className="p-5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
      onClick={onToggle}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => event.key === 'Enter' && onToggle()}
    >
      <div className="hidden items-start justify-between gap-4 md:flex">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex min-w-0 items-center gap-3">
            <h3 className="min-w-0 shrink truncate font-bold text-gray-900 dark:text-white">{data.org}</h3>
            <span className="shrink-0 text-gray-300 dark:text-gray-600">|</span>
            <span className="min-w-0 shrink truncate font-medium text-gray-700 dark:text-gray-300">{data.title}</span>
          </div>
          <p className="truncate text-sm text-gray-500 dark:text-gray-400">
            {data.star?.s
              ? `${stripRichTextToText(data.star.s).substring(0, 60)}...`
              : labels.summaryPlaceholder}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-right">
          <span className="block text-sm font-mono text-gray-500 dark:text-gray-400">
            {data.start_date} - {data.end_date || '至今'}
          </span>
          <button
            onClick={handleDelete}
            className="text-gray-400 hover:text-red-500 transition-colors p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
            title="删除"
            type="button"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <ChevronDown className="w-5 h-5 text-gray-400" />
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 md:hidden">
        <div className="min-w-0">
          <h3 className="truncate font-bold text-gray-900 dark:text-white">
            {data.org}
          </h3>
        </div>
        <div className="flex shrink-0 items-start gap-2">
          <button
            onClick={handleDelete}
            className="text-gray-400 hover:text-red-500 transition-colors p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
            title="删除"
            type="button"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <ChevronDown className="w-5 h-5 text-gray-400" />
        </div>
        <div className="col-span-full flex items-start justify-between gap-4 pt-1">
          <p className="min-w-0 truncate text-sm font-medium text-gray-700 dark:text-gray-300">
            {data.title}
          </p>
          <p className="shrink-0 whitespace-nowrap text-right text-sm font-mono text-gray-500 dark:text-gray-400">
            {data.start_date} - {data.end_date || '至今'}
          </p>
        </div>
        <p className="col-span-full pt-1 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
          {data.star?.s
            ? `${stripRichTextToText(data.star.s).substring(0, 60)}...`
            : labels.summaryPlaceholder}
        </p>
      </div>
    </div>
  );
};

const ExperienceCardHeader: React.FC<{
  data: ExperienceCardData;
  labels: ExperienceCardLabels;
  onFieldChange: (field: string, value: string | string[]) => void;
  isLocked: boolean;
  themeColor?: string;
}> = ({ data, labels, onFieldChange, isLocked, themeColor }) => (
  <div className="p-6 pb-2 border-b border-gray-50 dark:border-gray-800/50">
    <div className="flex flex-col lg:flex-row gap-6 mb-4">
      <div className="flex-1">
        <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">
          {labels.orgLabel}
        </label>
        <input
          className="fluid-input text-xl font-bold text-gray-900 dark:text-white placeholder-gray-300"
          placeholder={labels.orgPlaceholder}
          type="text"
          value={data.org}
          onChange={(e) => onFieldChange('org', e.target.value)}
          disabled={isLocked}
        />
      </div>
      <div className="flex-1">
        <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">
          {labels.titleLabel}
        </label>
        <input
          className="fluid-input text-xl font-bold text-gray-900 dark:text-white placeholder-gray-300"
          placeholder={labels.titlePlaceholder}
          type="text"
          value={data.title}
          onChange={(e) => onFieldChange('title', e.target.value)}
          disabled={isLocked}
        />
      </div>
      <div className="w-full lg:w-auto shrink-0">
        <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">时间段</label>
        <div className="flex items-center gap-2 h-[42px] lg:h-auto self-end">
          <div className="w-32 h-full">
            <MonthPicker
              value={data.start_date}
              onChange={(val) => {
                onFieldChange('start_date', val);
                const startValue = parseYearMonthValue(val);
                const endValue = parseYearMonthValue(data.end_date);
                if (startValue !== null && endValue !== null && startValue > endValue) {
                  onFieldChange('end_date', '');
                }
              }}
              placeholder="开始时间"
              className="h-full"
              disabled={isLocked}
            />
          </div>
          <span className="text-gray-400">-</span>
          <div className="w-32 h-full">
            <MonthPicker
              value={data.end_date}
              onChange={(val) => onFieldChange('end_date', val)}
              placeholder="结束时间"
              allowPresent
              className="h-full"
              minDate={data.start_date}
              disabled={isLocked}
            />
          </div>
        </div>
      </div>
    </div>
  </div>
);

const StarSectionItem: React.FC<{
  section: typeof STAR_SECTIONS[number];
  isLast: boolean;
  value: string;
  onChange: (value: string) => void;
  onUndo: () => boolean;
  readOnly: boolean;
  modeTabs?: React.ReactNode;
  themeColor?: string;
}> = ({ section, isLast, value, onChange, onUndo, readOnly, modeTabs, themeColor }) => (
  <div className="relative flex gap-0 pb-3 md:gap-4 md:pb-0">
    {!isLast && <div className="absolute left-[19px] top-10 bottom-0 hidden w-[2px] bg-gray-100 dark:bg-gray-800 md:block"></div>}
    <div
      className={`hidden shrink-0 h-10 w-10 items-center justify-center rounded-full bg-${section.color}-50 text-${section.color}-600 ring-4 ring-white dark:bg-${section.color}-900/20 dark:text-${section.color}-400 dark:ring-surface-dark md:flex`}
    >
      {section.id.toUpperCase()}
    </div>
    <div className="min-w-0 flex-1 pb-0 pt-0 md:pb-4 md:pt-1">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <span
          className={`text-xs font-bold text-${section.color}-600 dark:text-${section.color}-400 uppercase tracking-widest`}
        >
          {section.label}
        </span>
        {section.id === 's' ? modeTabs : null}
      </div>
      <RichTextEditor
        className={`w-full bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg p-3 text-sm text-gray-700 dark:text-gray-300 resize-none leading-relaxed transition-all hover:bg-white dark:hover:bg-gray-800 shadow-sm focus:ring-2 ${getThemeClasses(themeColor).focus
          } ${section.id === 'a' ? 'min-h-[160px]' : 'min-h-[48px]'}`}
        value={value}
        placeholder={section.ph}
        onChange={onChange}
        ariaLabel={`${section.label} 输入`}
        enableList={false}
        onUndo={onUndo}
        readOnly={readOnly}
      />
    </div>
  </div>
);

const StarSectionList: React.FC<{
  data: ExperienceCardData;
  onFieldChange: (field: string, value: string | string[]) => void;
  onUndo: (field: StarFieldKey) => boolean;
  readOnly: boolean;
  modeTabs: React.ReactNode;
  themeColor?: string;
}> = ({ data, onFieldChange, onUndo, readOnly, modeTabs, themeColor }) => (
  <div className="space-y-4">
    {STAR_SECTIONS.map((section, idx) => (
      <StarSectionItem
        key={section.id}
        section={section}
        isLast={idx === STAR_SECTIONS.length - 1}
        value={data.star?.[section.id] || ''}
        onChange={(value) => onFieldChange(`star.${section.id}`, value)}
        onUndo={() => onUndo(section.id)}
        readOnly={readOnly}
        modeTabs={idx === 0 ? modeTabs : null}
        themeColor={themeColor}
      />
    ))}
  </div>
);

const ExperienceModeTabs: React.FC<{
  mode: 'simple' | 'expert';
  onChange: (mode: 'simple' | 'expert') => void;
  disabled: boolean;
}> = ({ mode, onChange, disabled }) => (
  <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1 text-sm dark:border-gray-700 dark:bg-gray-800">
    <button
      type="button"
      onClick={() => onChange('simple')}
      disabled={disabled}
      className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
        mode === 'simple'
          ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
          : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
      }`}
    >
      原始文本
    </button>
    <button
      type="button"
      onClick={() => onChange('expert')}
      disabled={disabled}
      aria-label="切换到 STAR"
      className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
        mode === 'expert'
          ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
          : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
      }`}
    >
      <span className="inline-flex items-center gap-0.5 font-bold">
        {STAR_MODE_LETTERS.map((item) => (
          <span key={item.letter} className={item.className}>
            {item.letter}
          </span>
        ))}
      </span>
    </button>
  </div>
);

const SimpleExperienceEditor: React.FC<{
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  isProcessingSimpleEntry: boolean;
  themeColor?: string;
}> = ({ value, onChange, readOnly, isProcessingSimpleEntry, themeColor }) => (
  <div className="space-y-3">
    <RichTextEditor
      className={`min-h-[260px] w-full rounded-lg border p-4 text-sm leading-relaxed text-gray-700 transition-all focus:ring-2 dark:text-gray-300 ${isProcessingSimpleEntry ? SIMPLE_PARSING_EDITOR_CLASS : `border-gray-200 bg-gray-50 shadow-sm hover:bg-white dark:border-gray-700 dark:bg-gray-800/50 dark:hover:bg-gray-800 ${getThemeClasses(themeColor).focus}`}`}
      value={value}
      placeholder="直接写下完整经历，支持 Markdown、加粗、斜体、链接。可使用 S/T/A/R 标题，或用 --- 分隔四段。"
      onChange={onChange}
      ariaLabel="简易模式经历输入"
      enableList={false}
      readOnly={readOnly}
    />
  </div>
);

const ExperienceCardFooter: React.FC<{
  data: ExperienceCardData;
  isModified: boolean;
  isSaving: boolean;
  isPolishing: boolean;
  isPolishPreviewing: boolean;
  activePolishMode: Exclude<PolishMode, 'assistant'>;
  customPolishPrompt: string;
  onDelete: () => void;
  onCancel: () => void;
  onSave: () => void;
  onFormalizeSimpleEntry: () => void;
  onToggle: () => void;
  onPolishModeChange: (mode: Exclude<PolishMode, 'assistant'>) => void;
  onCustomPolishPromptChange: (value: string) => void;
  onRunPolish: () => void;
  onUndoPolishPreview: () => void;
  onConfirmPolishPreview: () => void;
  onOpenAssistant: () => void;
  themeColor?: string;
}> = ({
  data,
  isModified,
  isSaving,
  isPolishing,
  isPolishPreviewing,
  activePolishMode,
  customPolishPrompt,
  onDelete,
  onCancel,
  onSave,
  onFormalizeSimpleEntry,
  onToggle,
  onPolishModeChange,
  onCustomPolishPromptChange,
  onRunPolish,
  onUndoPolishPreview,
  onConfirmPolishPreview,
  onOpenAssistant,
  themeColor,
}) => {
  const isProcessingSimpleEntry = isSaving && data.editMode === 'simple';
  const [isPolishDialogOpen, setIsPolishDialogOpen] = useState(false);
  const [dialogStyle, setDialogStyle] = useState<React.CSSProperties>();
  const [isDialogMobile, setIsDialogMobile] = useState(false);
  const polishButtonRef = useRef<HTMLButtonElement | null>(null);
  const polishDialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isPolishDialogOpen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsPolishDialogOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPolishDialogOpen]);

  useEffect(() => {
    if (!isPolishDialogOpen) {
      setDialogStyle(undefined);
      setIsDialogMobile(false);
      return undefined;
    }

    let finalizeFrameId = 0;

    const getDialogMetrics = () => {
      if (!polishButtonRef.current || !polishDialogRef.current) {
        return null;
      }
      const margin = 16;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const isMobileViewport = viewportWidth < 768;
      const preferredWidth = isMobileViewport
        ? (isPolishPreviewing ? 360 : 320)
        : (isPolishPreviewing ? 576 : 672);
      const targetWidth = Math.min(viewportWidth - margin * 2, preferredWidth);
      const buttonRect = polishButtonRef.current.getBoundingClientRect();
      const gap = isMobileViewport ? 8 : 12;

      const left = Math.min(
        Math.max(isMobileViewport ? buttonRect.left - 8 : buttonRect.left - 12, margin),
        viewportWidth - targetWidth - margin
      );

      return {
        buttonRect,
        gap,
        isMobileViewport,
        left,
        margin,
        targetWidth,
        viewportHeight,
      };
    };

    const updateDialogPosition = () => {
      const metrics = getDialogMetrics();
      if (!metrics) {
        return;
      }

      const currentWidth = polishDialogRef.current.offsetWidth;
      const needsWidthSync = Math.abs(currentWidth - metrics.targetWidth) > 1;

      const getDialogTop = (
        dialogHeight: number,
        currentMetrics: typeof metrics
      ) => {
        let top = currentMetrics.buttonRect.top - dialogHeight - currentMetrics.gap;
        if (top < currentMetrics.margin) {
          top = Math.min(
            currentMetrics.buttonRect.bottom + currentMetrics.gap,
            currentMetrics.viewportHeight - dialogHeight - currentMetrics.margin
          );
        }

        return Math.max(currentMetrics.margin, top);
      };

      const applyDialogPosition = (
        dialogHeight: number,
        visibility: 'hidden' | 'visible'
      ) => {
        setIsDialogMobile(metrics.isMobileViewport);
        setDialogStyle({
          left: `${metrics.left}px`,
          top: `${getDialogTop(dialogHeight, metrics)}px`,
          visibility,
          width: `${metrics.targetWidth}px`,
        });
      };

      if (!needsWidthSync) {
        applyDialogPosition(polishDialogRef.current.offsetHeight, 'visible');
        return;
      }

      setIsDialogMobile(metrics.isMobileViewport);
      setDialogStyle({
        left: `${metrics.left}px`,
        top: `${metrics.margin}px`,
        visibility: 'hidden',
        width: `${metrics.targetWidth}px`,
      });

      window.cancelAnimationFrame(finalizeFrameId);
      finalizeFrameId = window.requestAnimationFrame(() => {
        const nextMetrics = getDialogMetrics();
        if (!nextMetrics || !polishDialogRef.current) {
          return;
        }

        const dialogHeight = polishDialogRef.current.offsetHeight;
        setIsDialogMobile(nextMetrics.isMobileViewport);
        setDialogStyle({
          left: `${nextMetrics.left}px`,
          top: `${getDialogTop(dialogHeight, nextMetrics)}px`,
          visibility: 'visible',
          width: `${nextMetrics.targetWidth}px`,
        });
      });
    };

    const frameId = window.requestAnimationFrame(updateDialogPosition);
    window.addEventListener('resize', updateDialogPosition);
    window.addEventListener('scroll', updateDialogPosition, true);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.cancelAnimationFrame(finalizeFrameId);
      window.removeEventListener('resize', updateDialogPosition);
      window.removeEventListener('scroll', updateDialogPosition, true);
    };
  }, [activePolishMode, customPolishPrompt, isPolishDialogOpen, isPolishPreviewing]);

  return (
    <div className="relative border-t border-gray-100 bg-gray-50 px-6 py-4 dark:border-gray-800 dark:bg-gray-800/50">
      {isPolishDialogOpen && typeof document !== 'undefined'
        ? createPortal(
          <>
            {isDialogMobile ? (
              <div
                className="fixed inset-0 z-[55] bg-slate-950/18 backdrop-blur-[1px]"
                onClick={() => setIsPolishDialogOpen(false)}
              />
            ) : null}
            <div
              className="fixed z-[60]"
              style={dialogStyle ?? { visibility: 'hidden' }}
              onClick={(event) => event.stopPropagation()}
            >
              <div ref={polishDialogRef} className={`flex w-full flex-col overflow-hidden rounded-[26px] border border-slate-200/90 bg-white/95 shadow-[0_28px_80px_rgba(15,23,42,0.18)] backdrop-blur ${isPolishPreviewing ? 'max-h-[min(70vh,26rem)]' : ''}`}>
                <div className="flex items-start justify-between gap-3 border-b border-slate-200/80 bg-[linear-gradient(135deg,rgba(240,253,250,0.95),rgba(255,255,255,0.98))] px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-700">
                      AI 润色工具栏
                    </div>
                    <div className="mt-1 truncate text-sm font-semibold text-slate-900">
                      {data.title || '未填写职位'}
                    </div>
                    {data.org ? (
                      <div className="mt-0.5 truncate text-xs text-slate-500">
                        {data.org}
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsPolishDialogOpen(false)}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
                    title="关闭润色工具栏"
                    aria-label="关闭润色工具栏"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className={isPolishPreviewing ? 'min-h-0 flex flex-1 flex-col overflow-hidden p-3' : 'p-3'}>
                  <AIPolishToolbar
                    isPreviewing={isPolishPreviewing}
                    isRunning={isPolishing}
                    activeMode={activePolishMode}
                    modeOptions={EXPERIENCE_BANK_POLISH_MODES}
                    customPrompt={customPolishPrompt}
                    hasJdContext={false}
                    onModeChange={onPolishModeChange}
                    onCustomPromptChange={onCustomPolishPromptChange}
                    onRun={onRunPolish}
                    onUndo={onUndoPolishPreview}
                    onConfirm={onConfirmPolishPreview}
                    onOpenAssistant={onOpenAssistant}
                    className="border-0 bg-transparent p-0 shadow-none"
                  />
                </div>
              </div>
            </div>
          </>,
          document.body
        )
        : null}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={onDelete}
            className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
            title="删除"
            type="button"
            disabled={isSaving}
          >
            <Trash2 className="h-4 w-4" />
          </button>
          {data.editMode === 'expert' ? (
            <button
              ref={polishButtonRef}
              onClick={() => setIsPolishDialogOpen((prev) => !prev)}
              className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border transition-colors ${
                isPolishDialogOpen
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-gray-200 bg-white text-gray-500 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700'
              }`}
              title="打开 AI 润色工具栏"
              aria-label="打开 AI 润色工具栏"
              type="button"
            >
              <Sparkles className={`h-4 w-4 ${isPolishing ? 'animate-pulse' : ''}`} />
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {isModified ? (
            <>
              <button
                onClick={onCancel}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white"
                disabled={isSaving}
                type="button"
              >
                取消
              </button>
              <button
                onClick={data.editMode === 'simple' ? onFormalizeSimpleEntry : onSave}
                className={`flex items-center gap-2 rounded-lg px-6 py-2 text-sm font-medium shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${getThemeClasses(themeColor).button}`}
                disabled={isSaving || isPolishPreviewing}
                title={isPolishPreviewing ? '请先确认或撤销当前润色预览' : undefined}
                type="button"
              >
                {isProcessingSimpleEntry ? '解析中...' : isSaving ? '保存中...' : data.editMode === 'simple' ? '正式录入' : '保存'}
              </button>
            </>
          ) : (
            <button
              onClick={onToggle}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white"
              type="button"
            >
              折叠
              <ChevronUp className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const ExpandedExperienceCard: React.FC<{
  data: ExperienceCardData;
  labels: ExperienceCardLabels;
  isCollapsing: boolean;
  isPolishing: boolean;
  isPolishPreviewing: boolean;
  isModified: boolean;
  isSaving: boolean;
  activePolishMode: Exclude<PolishMode, 'assistant'>;
  customPolishPrompt: string;
  onToggle: () => void;
  onDelete: () => void;
  onSave: () => void;
  onFormalizeSimpleEntry: () => void;
  onCancel: () => void;
  onFieldChange: (field: string, value: string | string[]) => void;
  onEditModeChange: (mode: 'simple' | 'expert') => void;
  onPolishModeChange: (mode: Exclude<PolishMode, 'assistant'>) => void;
  onCustomPolishPromptChange: (value: string) => void;
  onRunPolish: () => void;
  onUndoPolishPreview: () => void;
  onConfirmPolishPreview: () => void;
  onOpenAssistant: () => void;
  onUndo: (field: StarFieldKey) => boolean;
  themeColor?: string;
}> = ({
  data,
  labels,
  isCollapsing,
  isPolishing,
  isPolishPreviewing,
  isModified,
  isSaving,
  activePolishMode,
  customPolishPrompt,
  onToggle,
  onDelete,
  onSave,
  onFormalizeSimpleEntry,
  onCancel,
  onFieldChange,
  onEditModeChange,
  onPolishModeChange,
  onCustomPolishPromptChange,
  onRunPolish,
  onUndoPolishPreview,
  onConfirmPolishPreview,
  onOpenAssistant,
  onUndo,
  themeColor,
}) => {
  const modeTabs = (
    <div className="flex flex-wrap items-center gap-3">
      <ExperienceModeTabs mode={data.editMode} onChange={onEditModeChange} disabled={isSaving} />
      {data.draftStatus && data.draftStatus !== 'idle' ? (
        <span className="text-xs text-gray-400">
          {data.draftStatus === 'saving'
            ? '草稿保存中...'
            : data.draftStatus === 'saved'
              ? '草稿已保存'
              : '草稿保存失败'}
        </span>
      ) : null}
    </div>
  );
  const isProcessingSimpleEntry = isSaving && data.editMode === 'simple';

  return (
    <div className={resolveCardMotionClass(isCollapsing)}>
      <ExperienceCardHeader
        data={data}
        labels={labels}
        onFieldChange={onFieldChange}
        isLocked={isSaving}
        themeColor={themeColor}
      />
      <div className="p-6 pt-4 space-y-4">
        {data.editMode === 'simple' ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs leading-relaxed text-gray-400 dark:text-gray-500">
              解析规则：可用 S/T/A/R 标题，或用 --- 分隔情境、任务、行动、结果，也可随意填写，AI 会智能介入解析。
            </p>
            {modeTabs}
          </div>
        ) : null}
        {data.editMode === 'simple' ? (
          <SimpleExperienceEditor
            value={data.simpleText}
            onChange={(value) => onFieldChange('simpleText', value)}
            readOnly={isSaving}
            isProcessingSimpleEntry={isProcessingSimpleEntry}
            themeColor={themeColor}
          />
        ) : (
          <StarSectionList
            data={data}
            onFieldChange={onFieldChange}
            onUndo={onUndo}
            readOnly={isSaving}
            modeTabs={modeTabs}
            themeColor={themeColor}
          />
        )}
      </div>
      <ExperienceCardFooter
        data={data}
        isModified={isModified}
        isSaving={isSaving}
        isPolishing={isPolishing}
        isPolishPreviewing={isPolishPreviewing}
        activePolishMode={activePolishMode}
        customPolishPrompt={customPolishPrompt}
        onDelete={onDelete}
        onCancel={onCancel}
        onSave={onSave}
        onFormalizeSimpleEntry={onFormalizeSimpleEntry}
        onToggle={onToggle}
        onPolishModeChange={onPolishModeChange}
        onCustomPolishPromptChange={onCustomPolishPromptChange}
        onRunPolish={onRunPolish}
        onUndoPolishPreview={onUndoPolishPreview}
        onConfirmPolishPreview={onConfirmPolishPreview}
        onOpenAssistant={onOpenAssistant}
        themeColor={themeColor}
      />
    </div>
  );
};

const ExperienceCard = React.forwardRef<HTMLDivElement, ExperienceCardProps>(
  (
    {
      data,
      labels,
      isExpanded,
      isCollapsing,
      isModified,
      isSaving,
      isPolishing,
      isPolishPreviewing,
      activePolishMode,
      customPolishPrompt,
      onToggle,
      onDelete,
      onSave,
      onFormalizeSimpleEntry,
      onCancel,
      onFieldChange,
      onEditModeChange,
      onPolishModeChange,
      onCustomPolishPromptChange,
      onRunPolish,
      onUndoPolishPreview,
      onConfirmPolishPreview,
      onOpenAssistant,
      onUndo,
      themeColor,
    },
    ref
  ) => {
    const showExpanded = isExpanded || isCollapsing;

    return (
      <div
        ref={ref}
        className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-md transition-all duration-300 overflow-hidden"
      >
        {!showExpanded ? (
          <CollapsedExperienceCard
            data={data}
            labels={labels}
            onToggle={onToggle}
            onDelete={onDelete}
          />
        ) : (
          <ExpandedExperienceCard
            data={data}
            labels={labels}
            isCollapsing={isCollapsing}
            isPolishing={isPolishing}
            isPolishPreviewing={isPolishPreviewing}
            isModified={isModified}
            isSaving={isSaving}
            activePolishMode={activePolishMode}
            customPolishPrompt={customPolishPrompt}
            onToggle={onToggle}
            onDelete={onDelete}
            onSave={onSave}
            onFormalizeSimpleEntry={onFormalizeSimpleEntry}
            onCancel={onCancel}
            onFieldChange={onFieldChange}
            onEditModeChange={onEditModeChange}
            onPolishModeChange={onPolishModeChange}
            onCustomPolishPromptChange={onCustomPolishPromptChange}
            onRunPolish={onRunPolish}
            onUndoPolishPreview={onUndoPolishPreview}
            onConfirmPolishPreview={onConfirmPolishPreview}
            onOpenAssistant={onOpenAssistant}
            onUndo={onUndo}
            themeColor={themeColor}
          />
        )}
      </div>
    );
  }
);

ExperienceCard.displayName = 'ExperienceCard';

export default ExperienceCard;
