import React, { useCallback } from 'react';
import { ChevronDown, ChevronUp, Sparkles, Trash2 } from 'lucide-react';
import MonthPicker from '../components/MonthPicker';
import RichTextEditor from '../components/RichTextEditor';
import { SKILL_TAGS } from '../data/skillTags';
import { parseYearMonthValue, resolveCardMotionClass } from './experienceUtils';
import TagInput from './TagInput';
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
  tags: string[];
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
  polishLabel: string;
}> = [
    { id: 's', label: 'S - 情境 (Situation)', color: 'blue', ph: 'Describe the context...', polishLabel: '情境' },
    { id: 't', label: 'T - 任务 (Task)', color: 'orange', ph: 'What were your goals?', polishLabel: '任务' },
    { id: 'a', label: 'A - 行动 (Action)', color: 'amber', ph: 'What specifically did you do?', polishLabel: '行动' },
    { id: 'r', label: 'R - 结果 (Result)', color: 'emerald', ph: 'Quantifiable outcomes...', polishLabel: '结果' },
  ];

type ExperienceCardProps = {
  data: ExperienceCardData;
  labels: ExperienceCardLabels;
  isExpanded: boolean;
  isCollapsing: boolean;
  isModified: boolean;
  isSaving: boolean;
  showTags?: boolean;
  isGeneratingTags: boolean;
  isFieldPolishing: (field: StarFieldKey) => boolean;
  onToggle: () => void;
  onDelete: () => void;
  onSave: () => void;
  onCancel: () => void;
  onFieldChange: (field: string, value: string | string[]) => void;
  onPolish: (field: StarFieldKey) => void;
  onGenerateTags?: () => void;
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
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <h3 className="font-bold text-gray-900 dark:text-white truncate">{data.org}</h3>
            <span className="text-gray-300 dark:text-gray-600">|</span>
            <span className="text-gray-700 dark:text-gray-300 font-medium">{data.title}</span>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
            {data.star?.s
              ? `${stripRichTextToText(data.star.s).substring(0, 60)}...`
              : labels.summaryPlaceholder}
          </p>
        </div>
        <div className="text-right shrink-0 flex items-center gap-2">
          <span className="block text-sm font-mono text-gray-500">
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
  onPolish: () => void;
  isPolishing: boolean;
  themeColor?: string;
}> = ({ section, isLast, value, onChange, onPolish, isPolishing, themeColor }) => {
  const polishTitle = isPolishing ? 'AI 润色中...' : `AI 润色${section.polishLabel}`;
  return (
    <div className="flex gap-4 relative group">
      {!isLast && <div className="absolute left-[19px] top-10 bottom-0 w-[2px] bg-gray-100 dark:bg-gray-800"></div>}
      <div
        className={`shrink-0 w-10 h-10 rounded-full bg-${section.color}-50 dark:bg-${section.color}-900/20 text-${section.color}-600 dark:text-${section.color}-400 flex items-center justify-center ring-4 ring-white dark:ring-surface-dark z-10 font-bold`}
      >
        {section.id.toUpperCase()}
      </div>
      <div className="flex-1 pt-1 pb-4">
        <div className="flex items-center justify-between mb-2">
          <span
            className={`text-xs font-bold text-${section.color}-600 dark:text-${section.color}-400 uppercase tracking-widest`}
          >
            {section.label}
          </span>
          <button
            type="button"
            onClick={onPolish}
            disabled={isPolishing}
            title={polishTitle}
            aria-label={polishTitle}
            className="inline-flex items-center justify-center p-1 text-amber-500 hover:text-amber-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Sparkles className={`w-4 h-4 ${isPolishing ? 'animate-pulse' : ''}`} />
          </button>
        </div>
        <RichTextEditor
          className={`w-full bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg p-3 text-sm text-gray-700 dark:text-gray-300 resize-none leading-relaxed transition-all hover:bg-white dark:hover:bg-gray-800 shadow-sm focus:ring-2 ${isPolishing ? 'focus:ring-amber-500/20 focus:border-amber-500' : getThemeClasses(themeColor).focus
            } ${section.id === 'a' ? 'min-h-[160px]' : 'min-h-[48px]'}`}
          value={value}
          placeholder={section.ph}
          onChange={onChange}
          ariaLabel={`${section.label} 输入`}
        />
      </div>
    </div>
  );
};

const StarSectionList: React.FC<{
  data: ExperienceCardData;
  onFieldChange: (field: string, value: string | string[]) => void;
  onPolish: (field: StarFieldKey) => void;
  isFieldPolishing: (field: StarFieldKey) => boolean;
  themeColor?: string;
}> = ({ data, onFieldChange, onPolish, isFieldPolishing, themeColor }) => (
  <div className="space-y-4">
    {STAR_SECTIONS.map((section, idx) => (
      <StarSectionItem
        key={section.id}
        section={section}
        isLast={idx === STAR_SECTIONS.length - 1}
        value={data.star?.[section.id] || ''}
        onChange={(value) => onFieldChange(`star.${section.id}`, value)}
        onPolish={() => onPolish(section.id)}
        isPolishing={isFieldPolishing(section.id)}
        themeColor={themeColor}
      />
    ))}
  </div>
);

const ExperienceCardFooter: React.FC<{
  isModified: boolean;
  isSaving: boolean;
  onDelete: () => void;
  onCancel: () => void;
  onSave: () => void;
  onToggle: () => void;
  themeColor?: string;
}> = ({ isModified, isSaving, onDelete, onCancel, onSave, onToggle, themeColor }) => (
  <div className="bg-gray-50 dark:bg-gray-800/50 px-6 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-end">
    <div className="flex items-center gap-2">
      <button
        onClick={onDelete}
        className="text-gray-400 hover:text-red-500 transition-colors p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg mr-2"
        title="删除"
        type="button"
      >
        <Trash2 className="w-4 h-4" />
      </button>

      {isModified ? (
        <>
          <button
            onClick={onCancel}
            className="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
            disabled={isSaving}
            type="button"
          >
            取消
          </button>
          <button
            onClick={onSave}
            className={`flex items-center gap-2 text-sm font-medium px-6 py-2 rounded-lg transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed ${getThemeClasses(themeColor).button}`}
            disabled={isSaving}
            type="button"
          >
            {isSaving ? '保存中...' : '保存'}
          </button>
        </>
      ) : (
        <button
          onClick={onToggle}
          className="flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white px-4 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          type="button"
        >
          折叠
          <ChevronUp className="w-4 h-4" />
        </button>
      )}
    </div>
  </div>
);

const ExpandedExperienceCard: React.FC<{
  data: ExperienceCardData;
  labels: ExperienceCardLabels;
  isCollapsing: boolean;
  showTags: boolean;
  isGeneratingTags: boolean;
  isFieldPolishing: (field: StarFieldKey) => boolean;
  isModified: boolean;
  isSaving: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onSave: () => void;
  onCancel: () => void;
  onFieldChange: (field: string, value: string | string[]) => void;
  onPolish: (field: StarFieldKey) => void;
  onGenerateTags?: () => void;
  themeColor?: string;
}> = ({
  data,
  labels,
  isCollapsing,
  showTags,
  isGeneratingTags,
  isFieldPolishing,
  isModified,
  isSaving,
  onToggle,
  onDelete,
  onSave,
  onCancel,
  onFieldChange,
  onPolish,
  onGenerateTags,
  themeColor,
}) => (
    <div className={resolveCardMotionClass(isCollapsing)}>
      <ExperienceCardHeader data={data} labels={labels} onFieldChange={onFieldChange} themeColor={themeColor} />
      <div className="p-6 pt-4 space-y-4">
        <StarSectionList
          data={data}
          onFieldChange={onFieldChange}
          onPolish={onPolish}
          isFieldPolishing={isFieldPolishing}
          themeColor={themeColor}
        />

        {showTags && (
          <div className="space-y-2 pt-2">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">技能标签</label>
            <TagInput
              value={data.tags || []}
              suggestions={SKILL_TAGS}
              onChange={(next) => onFieldChange('tags', next)}
              onAiFill={onGenerateTags}
              isAiLoading={isGeneratingTags}
              themeColor={themeColor}
            />
          </div>
        )}
      </div>
      <ExperienceCardFooter
        isModified={isModified}
        isSaving={isSaving}
        onDelete={onDelete}
        onCancel={onCancel}
        onSave={onSave}
        onToggle={onToggle}
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
      showTags = false,
      isGeneratingTags,
      isFieldPolishing,
      onToggle,
      onDelete,
      onSave,
      onCancel,
      onFieldChange,
      onPolish,
      onGenerateTags,
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
          <CollapsedExperienceCard data={data} labels={labels} onToggle={onToggle} onDelete={onDelete} />
        ) : (
          <ExpandedExperienceCard
            data={data}
            labels={labels}
            isCollapsing={isCollapsing}
            showTags={showTags}
            isGeneratingTags={isGeneratingTags}
            isFieldPolishing={isFieldPolishing}
            isModified={isModified}
            isSaving={isSaving}
            onToggle={onToggle}
            onDelete={onDelete}
            onSave={onSave}
            onCancel={onCancel}
            onFieldChange={onFieldChange}
            onPolish={onPolish}
            onGenerateTags={onGenerateTags}
            themeColor={themeColor}
          />
        )}
      </div>
    );
  }
);

ExperienceCard.displayName = 'ExperienceCard';

export default ExperienceCard;
