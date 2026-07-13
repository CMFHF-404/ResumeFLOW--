import React, { useEffect, useState } from 'react';
import {
  Check,
  GripVertical,
  LayoutTemplate,
  PenLine,
  Save,
  SlidersHorizontal,
  Wand2,
} from 'lucide-react';
import {
  RESUME_TEMPLATE_DEFINITIONS,
  RESUME_THEME_COLOR_PRESETS,
  resolveResumeTemplate,
  type ResumeTemplateId,
  type ResumeThemeColorPresetId,
} from '../../../constants/resumeTemplates';
import type { ResumeExperienceListMarkerStyle } from '../../../types/resume';
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  FONT_SIZE_STEP,
  LINE_HEIGHT_MAX,
  LINE_HEIGHT_MIN,
  LINE_HEIGHT_STEP,
  SMART_PAGE_ITEM_SPACING_MIN,
  SMART_PAGE_ITEM_SPACING_STEP,
  SMART_PAGE_TOP_PADDING_STEP_PX,
} from '../constants';
import {
  MAX_ITEM_SPACING_EM,
  TOP_PADDING_MIN_PX,
  TOP_PADDING_SLIDER_MAX,
  formatOptionNumberLabel,
} from '../layoutUtils';
import type { ResumeTemplatePresetMap } from '../../resumeTemplateStorage';
import EditorSidebar, { EditingSuggestionNav, type EditorSidebarProps } from './EditorSidebar';
import ExperienceTab from './ExperienceTab';
import type { ResumeEditorLayoutAdjustPanelProps } from './ResumeEditorLayoutAdjustPanel';
import { TemplateThumbnail } from './TemplateSelectorModal';

export type ResumeFactoryTab = 'templates' | 'edit' | 'layout';

export type ResumeFactorySidebarProps = {
  activeTab: ResumeFactoryTab;
  onTabChange: (tab: ResumeFactoryTab) => void;
  editorSidebarProps: Omit<EditorSidebarProps, 'layoutMode' | 'showJDPanel'>;
  layoutAdjustProps: ResumeEditorLayoutAdjustPanelProps;
  selectedTemplateId: ResumeTemplateId;
  templatePresetMap: ResumeTemplatePresetMap;
  isTemplatePresetMapReady: boolean;
  onSelectTemplate: (templateId: ResumeTemplateId) => void;
  onCustomizeTemplate: (templateId: ResumeTemplateId) => void;
  sectionOrder: string[];
  onSectionOrderChange: (order: string[]) => void;
  experienceListMarkerStyle: ResumeExperienceListMarkerStyle;
  onExperienceListMarkerStyleChange: (value: ResumeExperienceListMarkerStyle) => void;
  skillTagSeparator: string;
  onSkillTagSeparatorChange: (value: string) => void;
  onSaveCurrentTemplateDefault: () => Promise<void>;
  onRestoreDefault: () => void;
  onAdjustToSinglePage: () => void;
};

const FACTORY_TABS: Array<{
  key: ResumeFactoryTab;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = [
  { key: 'templates', label: '模板选择', Icon: LayoutTemplate },
  { key: 'edit', label: '简历编辑', Icon: PenLine },
  { key: 'layout', label: '页面布局', Icon: SlidersHorizontal },
];

const SECTION_LABELS: Record<string, string> = {
  summary: '个人评价',
  education: '教育背景',
  work: '工作经历',
  project: '项目经历',
  certifications: '证书资质',
  skills: '技能清单',
};

const MARKER_OPTIONS: Array<{
  value: ResumeExperienceListMarkerStyle;
  label: string;
}> = [
  { value: 'unordered', label: '圆点' },
  { value: 'ordered', label: '序号' },
  { value: 'none', label: '无符号' },
];

const SIDEBAR_SLIDE_DURATION_MS = 300;
const SIDEBAR_SLIDE_EASING_CLASS = 'ease-[cubic-bezier(0.25,1,0.5,1)]';
const TEMPLATE_COLLECTIONS = [
  {
    key: 'deephire',
    label: '精选模板',
    templates: RESUME_TEMPLATE_DEFINITIONS.filter((template) => template.collection === 'deephire'),
  },
  {
    key: 'native',
    label: '经典模板',
    templates: RESUME_TEMPLATE_DEFINITIONS.filter((template) => template.collection === 'native'),
  },
] as const;

const SliderField: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
}> = ({ label, value, min, max, step, unit = '', onChange }) => (
  <label className="block">
    <div className="mb-2 flex items-center justify-between gap-3">
      <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{label}</span>
      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500 dark:bg-gray-800 dark:text-gray-300">
        {formatOptionNumberLabel(value, step < 0.1 ? 2 : 1)}
        {unit}
      </span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-gray-200 accent-primary dark:bg-gray-700"
    />
  </label>
);

const TemplateSelectionPanel: React.FC<Pick<
  ResumeFactorySidebarProps,
  | 'selectedTemplateId'
  | 'layoutAdjustProps'
  | 'templatePresetMap'
  | 'isTemplatePresetMapReady'
  | 'onSelectTemplate'
  | 'onCustomizeTemplate'
>> = ({
  selectedTemplateId,
  layoutAdjustProps,
  templatePresetMap,
  isTemplatePresetMapReady,
  onSelectTemplate,
  onCustomizeTemplate,
}) => (
  <div className="space-y-7 px-4 pb-6 pt-4">
    {TEMPLATE_COLLECTIONS.map((collection) => (
      <section key={collection.key}>
        {collection.key === 'native' ? (
          <div className="mb-3 flex items-center justify-between gap-3 border-t border-gray-200 pt-5 dark:border-gray-800">
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400">{collection.label}</h3>
            <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500">{collection.templates.length} 套</span>
          </div>
        ) : null}
        <div className="grid grid-cols-3 gap-x-2 gap-y-5">
          {collection.templates.map((template) => {
            const isSelected = template.id === selectedTemplateId;
            const preset = templatePresetMap[template.id];
            return (
              <article key={template.id} className="min-w-0">
                <div className="group relative">
                  <button
                    type="button"
                    onClick={() => onSelectTemplate(template.id)}
                    disabled={!isTemplatePresetMapReady}
                    className="block w-full rounded-[9px] text-left outline-none transition focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
                    aria-label={`选择${template.name}模板`}
                    aria-pressed={isSelected}
                    title={template.name}
                  >
                    <div
                      className={[
                        'relative aspect-[112/175] overflow-hidden rounded-[9px] bg-gray-100 shadow-sm transition dark:bg-gray-800',
                        isSelected
                          ? 'ring-2 ring-primary ring-offset-2 dark:ring-offset-gray-950'
                          : 'ring-1 ring-gray-200 hover:ring-gray-300 dark:ring-gray-700 dark:hover:ring-gray-600',
                      ].join(' ')}
                    >
                      <TemplateThumbnail
                        templateId={template.id}
                        thumbnailSrc={template.thumbnailSrc}
                        themeColorPresetId={
                          isSelected
                            ? layoutAdjustProps.themeColorPresetId
                            : preset?.themeColorPresetId
                        }
                      />
                      {isSelected ? (
                        <span
                          className="absolute bottom-1.5 right-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white shadow-sm"
                          aria-hidden="true"
                        >
                          <Check className="h-3 w-3" />
                        </span>
                      ) : null}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onCustomizeTemplate(template.id)}
                    disabled={!isTemplatePresetMapReady}
                    className="absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/80 bg-white/95 text-gray-600 opacity-0 shadow-sm backdrop-blur transition hover:bg-white focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-wait disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900/95 dark:text-gray-200"
                    aria-label={`自定义${template.name}模板`}
                    title={`自定义${template.name}模板`}
                  >
                    <SlidersHorizontal className="h-3 w-3" />
                  </button>
                  {preset ? (
                    <span className="pointer-events-none absolute left-1.5 top-1.5 rounded bg-emerald-600 px-1 py-0.5 text-[9px] font-bold leading-none text-white shadow-sm">
                      已调
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 truncate text-center text-xs font-medium text-[#526045] dark:text-gray-300">
                  {template.name}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    ))}
  </div>
);

const LayoutPanel: React.FC<Omit<
  ResumeFactorySidebarProps,
  'activeTab' | 'onTabChange' | 'editorSidebarProps' | 'templatePresetMap' | 'isTemplatePresetMapReady' | 'onSelectTemplate' | 'onCustomizeTemplate'
>> = ({
  layoutAdjustProps,
  selectedTemplateId,
  sectionOrder,
  onSectionOrderChange,
  experienceListMarkerStyle,
  onExperienceListMarkerStyleChange,
  skillTagSeparator,
  onSkillTagSeparatorChange,
  onSaveCurrentTemplateDefault,
  onRestoreDefault,
  onAdjustToSinglePage,
}) => {
  const [isSaving, setIsSaving] = useState(false);
  const selectedTemplate = resolveResumeTemplate(selectedTemplateId);

  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragActiveId, setDragActiveId] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) {
      return;
    }
    const nextOrder = [...sectionOrder];
    const draggedItem = nextOrder[draggedIndex];
    nextOrder.splice(draggedIndex, 1);
    nextOrder.splice(index, 0, draggedItem);
    setDraggedIndex(index);
    onSectionOrderChange(nextOrder);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragActiveId(null);
  };

  const moveSection = (sectionId: string, offset: number) => {
    const currentIndex = sectionOrder.indexOf(sectionId);
    const nextIndex = currentIndex + offset;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= sectionOrder.length) {
      return;
    }
    const nextOrder = [...sectionOrder];
    nextOrder.splice(currentIndex, 1);
    nextOrder.splice(nextIndex, 0, sectionId);
    onSectionOrderChange(nextOrder);
  };
  const saveDefault = async () => {
    setIsSaving(true);
    try {
      await onSaveCurrentTemplateDefault();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4 p-4">
      <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 truncate text-sm font-semibold text-gray-900 dark:text-white">
            {selectedTemplate.name}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void saveDefault()}
              disabled={isSaving}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-2.5 py-2 text-xs font-semibold text-white transition hover:bg-primary-dark disabled:cursor-wait disabled:opacity-60"
            >
              <Save className="h-3.5 w-3.5" />
              {isSaving ? '保存中' : '设为默认'}
            </button>
            <button
              type="button"
              onClick={onRestoreDefault}
              className="rounded-lg border border-gray-200 px-2.5 py-2 text-xs font-semibold text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              恢复默认
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-gray-900 dark:text-white">排版参数</div>
          <button
            type="button"
            onClick={onAdjustToSinglePage}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white transition hover:bg-primary-dark"
          >
            <Wand2 className="h-3.5 w-3.5" />
            智能一页
          </button>
        </div>
        <div className="space-y-4">
          {layoutAdjustProps.isThemeColorCustomizationEnabled ? (
            <div>
              <div className="mb-3 text-xs font-semibold text-gray-500 dark:text-gray-400">主题颜色</div>
              <div className="grid grid-cols-4 gap-2">
                {RESUME_THEME_COLOR_PRESETS.map((color) => {
                  const isActive = color.id === layoutAdjustProps.themeColorPresetId;
                  return (
                    <button
                      key={color.id}
                      type="button"
                      onClick={() => layoutAdjustProps.onThemeColorChange(color.id as ResumeThemeColorPresetId)}
                      className={[
                        'flex h-10 items-center justify-center rounded-lg border transition',
                        isActive
                          ? 'border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900'
                          : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-300',
                      ].join(' ')}
                      title={color.name}
                    >
                      <span className="sr-only">{color.name}</span>
                      <span
                        className="h-4 w-4 rounded-full border border-black/10"
                        style={{ backgroundColor: color.accentColor }}
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
              此模板使用固定配色
            </div>
          )}
          <div className="space-y-4">
            <SliderField
              label="字号"
              value={layoutAdjustProps.fontSize}
              min={FONT_SIZE_MIN}
              max={FONT_SIZE_MAX}
              step={FONT_SIZE_STEP}
              unit="px"
              onChange={layoutAdjustProps.onFontSizeChange}
            />
            <SliderField
              label="行高"
              value={layoutAdjustProps.lineHeight}
              min={LINE_HEIGHT_MIN}
              max={LINE_HEIGHT_MAX}
              step={LINE_HEIGHT_STEP}
              onChange={layoutAdjustProps.onLineHeightChange}
            />
            <SliderField
              label="页边距"
              value={layoutAdjustProps.topPaddingPx}
              min={TOP_PADDING_MIN_PX}
              max={TOP_PADDING_SLIDER_MAX}
              step={SMART_PAGE_TOP_PADDING_STEP_PX}
              unit="px"
              onChange={layoutAdjustProps.onTopPaddingChange}
            />
            <SliderField
              label="模块间距"
              value={layoutAdjustProps.sectionSpacingKey}
              min={2}
              max={12}
              step={1}
              onChange={(value) => layoutAdjustProps.onSectionSpacingChange(value)}
            />
            <SliderField
              label="条目间距"
              value={layoutAdjustProps.itemSpacingEm}
              min={SMART_PAGE_ITEM_SPACING_MIN}
              max={MAX_ITEM_SPACING_EM}
              step={SMART_PAGE_ITEM_SPACING_STEP}
              onChange={layoutAdjustProps.onItemSpacingChange}
            />
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
        <div className="mb-3 text-xs font-semibold text-gray-500 dark:text-gray-400">
          模块顺序
        </div>
        <div className="space-y-2">
          {sectionOrder.map((sectionId, index) => {
            const isDragging = index === draggedIndex;
            const isDraggable = dragActiveId === sectionId;
            return (
              <div
                key={sectionId}
                draggable={isDraggable}
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                className={[
                  'grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-2 rounded-xl border p-2.5 shadow-xs transition-all duration-200',
                  isDragging
                    ? 'border-dashed border-primary bg-primary/5 opacity-40 scale-95 shadow-none'
                    : 'border-gray-200 bg-white hover:border-gray-300 dark:border-gray-800 dark:bg-gray-950/40 dark:hover:border-gray-700',
                ].join(' ')}
              >
                <div
                  onMouseDown={() => setDragActiveId(sectionId)}
                  onMouseUp={() => setDragActiveId(null)}
                  onMouseLeave={() => setDragActiveId(null)}
                  onTouchStart={() => setDragActiveId(sectionId)}
                  onTouchEnd={() => setDragActiveId(null)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 active:cursor-grabbing dark:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-400 cursor-grab"
                >
                  <GripVertical className="h-3.5 w-3.5 shrink-0" />
                </div>
                <span className="w-5 shrink-0 text-xs font-bold text-gray-400 dark:text-gray-500 text-center">{index + 1}</span>
                <span className="truncate text-sm font-semibold text-gray-700 dark:text-gray-200">
                  {SECTION_LABELS[sectionId] ?? sectionId}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
        <div className="mb-3 text-xs font-semibold text-gray-500 dark:text-gray-400">段落与技能样式</div>
        <div className="grid grid-cols-3 gap-2">
          {MARKER_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onExperienceListMarkerStyleChange(option.value)}
              className={[
                'rounded-lg border px-2 py-2 text-xs font-semibold transition',
                experienceListMarkerStyle === option.value
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800',
              ].join(' ')}
            >
              {option.label}
            </button>
          ))}
        </div>
        <label className="mt-3 block">
          <span className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">技能分隔符</span>
          <input
            type="text"
            value={skillTagSeparator}
            onChange={(event) => onSkillTagSeparatorChange(event.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
          />
        </label>
      </section>
    </div>
  );
};

const ResumeFactorySidebar: React.FC<ResumeFactorySidebarProps> = ({
  activeTab,
  onTabChange,
  editorSidebarProps,
  ...rest
}) => {
  const fullscreenEditScrollRef = React.useRef<HTMLDivElement | null>(null);
  const isExperienceEditingFullscreen = activeTab === 'edit'
    && editorSidebarProps.sidebarTab === 'experience'
    && Boolean(editorSidebarProps.experienceTabProps.experience.editingExpId);
  const [shouldRenderExperienceEditLayer, setShouldRenderExperienceEditLayer] = useState(isExperienceEditingFullscreen);
  const [isExperienceEditLayerVisible, setIsExperienceEditLayerVisible] = useState(isExperienceEditingFullscreen);

  useEffect(() => {
    if (isExperienceEditingFullscreen) {
      setShouldRenderExperienceEditLayer(true);
      const frameId = window.requestAnimationFrame(() => setIsExperienceEditLayerVisible(true));
      return () => window.cancelAnimationFrame(frameId);
    }
    setIsExperienceEditLayerVisible(false);
    if (!shouldRenderExperienceEditLayer) {
      return undefined;
    }
    const timeoutId = window.setTimeout(() => setShouldRenderExperienceEditLayer(false), SIDEBAR_SLIDE_DURATION_MS);
    return () => window.clearTimeout(timeoutId);
  }, [isExperienceEditingFullscreen, shouldRenderExperienceEditLayer]);

  return (
    <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden border-r border-border-light bg-gray-50/80 dark:border-border-dark dark:bg-surface-dark">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          aria-hidden={isExperienceEditingFullscreen}
          inert={isExperienceEditingFullscreen ? true : undefined}
          className={[
            'absolute inset-0 flex min-h-0 flex-col transition-[transform,opacity] duration-300 motion-reduce:transition-none',
            SIDEBAR_SLIDE_EASING_CLASS,
            isExperienceEditLayerVisible
              ? '-translate-x-full opacity-0 pointer-events-none'
              : 'translate-x-0 opacity-100',
          ].join(' ')}
        >
          <div className="shrink-0 border-b border-border-light bg-white px-3 py-3 dark:border-border-dark dark:bg-surface-dark">
            <div className="relative grid grid-cols-3 gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-900">
              <div
                className={`absolute bottom-1 top-1 rounded-lg bg-white shadow-xs transition-transform duration-300 motion-reduce:transition-none dark:bg-gray-800 ${SIDEBAR_SLIDE_EASING_CLASS}`}
                style={{
                  width: 'calc((100% - 16px) / 3)',
                  left: '4px',
                  transform: activeTab === 'templates'
                    ? 'translate3d(0, 0, 0)'
                    : activeTab === 'edit'
                      ? 'translate3d(calc(100% + 4px), 0, 0)'
                      : 'translate3d(calc(200% + 8px), 0, 0)',
                }}
              />
              {FACTORY_TABS.map(({ key, label, Icon }) => {
                const isActive = activeTab === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onTabChange(key)}
                    className={[
                      'relative z-10 inline-flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition-colors duration-200',
                      isActive
                        ? 'text-gray-900 dark:text-white'
                        : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100',
                    ].join(' ')}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden relative">
            <div
              className={`flex h-full w-[300%] transition-transform duration-300 motion-reduce:transition-none ${SIDEBAR_SLIDE_EASING_CLASS}`}
              style={{
                transform: activeTab === 'templates'
                  ? 'translate3d(0, 0, 0)'
                  : activeTab === 'edit'
                    ? 'translate3d(-33.3333%, 0, 0)'
                    : 'translate3d(-66.6666%, 0, 0)',
              }}
            >
              <div className="w-[33.3333%] h-full flex-shrink-0 overflow-y-auto min-w-0">
                <TemplateSelectionPanel {...rest} />
              </div>
              <div className="w-[33.3333%] h-full flex-shrink-0 overflow-y-auto min-w-0">
                <EditorSidebar {...editorSidebarProps} />
              </div>
              <div className="w-[33.3333%] h-full flex-shrink-0 overflow-y-auto min-w-0">
                <LayoutPanel {...rest} />
              </div>
            </div>
          </div>
        </div>

        {shouldRenderExperienceEditLayer ? (
          <div
            aria-hidden={!isExperienceEditingFullscreen}
            inert={!isExperienceEditingFullscreen ? true : undefined}
            className={[
              'absolute inset-0 flex min-h-0 flex-col bg-gray-50/80 transition-[transform,opacity] duration-300 motion-reduce:transition-none dark:bg-surface-dark',
              SIDEBAR_SLIDE_EASING_CLASS,
              isExperienceEditLayerVisible
                ? 'translate-x-0 opacity-100'
                : 'translate-x-full opacity-0 pointer-events-none',
            ].join(' ')}
          >
            <div className="shrink-0">
              <EditingSuggestionNav {...editorSidebarProps.editingSuggestion} />
            </div>
            <div
              ref={fullscreenEditScrollRef}
              className="flex-1 space-y-4 overflow-y-auto bg-gray-50/30 p-4 dark:bg-black/20 md:p-5"
            >
              <ExperienceTab
                {...editorSidebarProps.experienceTabProps}
                layoutMode="inline"
                scrollContainerRef={fullscreenEditScrollRef}
              />
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
};

export default ResumeFactorySidebar;
