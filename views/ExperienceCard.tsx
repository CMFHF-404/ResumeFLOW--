import React, { useCallback } from 'react';
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
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
  onCancel: () => void;
  onFieldChange: (field: string, value: string | string[]) => void;
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
  themeColor?: string;
}> = ({ data, labels, onFieldChange, themeColor }) => (
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
  themeColor?: string;
}> = ({ section, isLast, value, onChange, onUndo, themeColor }) => (
  <div className="relative flex gap-0 pb-3 md:gap-4 md:pb-0">
    {!isLast && <div className="absolute left-[19px] top-10 bottom-0 hidden w-[2px] bg-gray-100 dark:bg-gray-800 md:block"></div>}
    <div
      className={`hidden shrink-0 h-10 w-10 items-center justify-center rounded-full bg-${section.color}-50 text-${section.color}-600 ring-4 ring-white dark:bg-${section.color}-900/20 dark:text-${section.color}-400 dark:ring-surface-dark md:flex`}
    >
      {section.id.toUpperCase()}
    </div>
    <div className="min-w-0 flex-1 pb-0 pt-0 md:pb-4 md:pt-1">
      <div className="mb-2 flex items-center justify-between">
        <span
          className={`text-xs font-bold text-${section.color}-600 dark:text-${section.color}-400 uppercase tracking-widest`}
        >
          {section.label}
        </span>
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
      />
    </div>
  </div>
);

const StarSectionList: React.FC<{
  data: ExperienceCardData;
  onFieldChange: (field: string, value: string | string[]) => void;
  onUndo: (field: StarFieldKey) => boolean;
  themeColor?: string;
}> = ({ data, onFieldChange, onUndo, themeColor }) => (
  <div className="space-y-4">
    {STAR_SECTIONS.map((section, idx) => (
      <StarSectionItem
        key={section.id}
        section={section}
        isLast={idx === STAR_SECTIONS.length - 1}
        value={data.star?.[section.id] || ''}
        onChange={(value) => onFieldChange(`star.${section.id}`, value)}
        onUndo={() => onUndo(section.id)}
        themeColor={themeColor}
      />
    ))}
  </div>
);

const ExperienceCardFooter: React.FC<{
  isModified: boolean;
  isSaving: boolean;
  isPolishing: boolean;
  isPolishPreviewing: boolean;
  activePolishMode: Exclude<PolishMode, 'assistant'>;
  customPolishPrompt: string;
  onDelete: () => void;
  onCancel: () => void;
  onSave: () => void;
  onToggle: () => void;
  onPolishModeChange: (mode: Exclude<PolishMode, 'assistant'>) => void;
  onCustomPolishPromptChange: (value: string) => void;
  onRunPolish: () => void;
  onUndoPolishPreview: () => void;
  onConfirmPolishPreview: () => void;
  onOpenAssistant: () => void;
  themeColor?: string;
}> = ({
  isModified,
  isSaving,
  isPolishing,
  isPolishPreviewing,
  activePolishMode,
  customPolishPrompt,
  onDelete,
  onCancel,
  onSave,
  onToggle,
  onPolishModeChange,
  onCustomPolishPromptChange,
  onRunPolish,
  onUndoPolishPreview,
  onConfirmPolishPreview,
  onOpenAssistant,
}) => {
  return (
    <div className="space-y-4 border-t border-gray-100 bg-gray-50 px-6 py-4 dark:border-gray-800 dark:bg-gray-800/50">
      <AIPolishToolbar
        isPreviewing={isPolishPreviewing}
        isRunning={isPolishing}
        activeMode={activePolishMode}
        customPrompt={customPolishPrompt}
        onModeChange={onPolishModeChange}
        onCustomPromptChange={onCustomPolishPromptChange}
        onRun={onRunPolish}
        onUndo={onUndoPolishPreview}
        onConfirm={onConfirmPolishPreview}
        onOpenAssistant={onOpenAssistant}
      />

      <div className="flex items-center justify-between">
        <button
          onClick={onDelete}
          className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
          title="删除"
          type="button"
        >
          <Trash2 className="h-4 w-4" />
        </button>

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
                onClick={onSave}
                className={`flex items-center gap-2 rounded-lg px-6 py-2 text-sm font-medium shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${getThemeClasses(themeColor).button}`}
                disabled={isSaving}
                type="button"
              >
                {isSaving ? '保存中...' : '保存'}
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
  onCancel: () => void;
  onFieldChange: (field: string, value: string | string[]) => void;
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
  onCancel,
  onFieldChange,
  onPolishModeChange,
  onCustomPolishPromptChange,
  onRunPolish,
  onUndoPolishPreview,
  onConfirmPolishPreview,
  onOpenAssistant,
  onUndo,
  themeColor,
}) => (
    <div className={resolveCardMotionClass(isCollapsing)}>
      <ExperienceCardHeader
        data={data}
        labels={labels}
        onFieldChange={onFieldChange}
        themeColor={themeColor}
      />
      <div className="p-6 pt-4 space-y-4">
        <StarSectionList
          data={data}
          onFieldChange={onFieldChange}
          onUndo={onUndo}
          themeColor={themeColor}
        />
      </div>
      <ExperienceCardFooter
        isModified={isModified}
        isSaving={isSaving}
        isPolishing={isPolishing}
        isPolishPreviewing={isPolishPreviewing}
        activePolishMode={activePolishMode}
        customPolishPrompt={customPolishPrompt}
        onDelete={onDelete}
        onCancel={onCancel}
        onSave={onSave}
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
      onCancel,
      onFieldChange,
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
            onCancel={onCancel}
            onFieldChange={onFieldChange}
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
