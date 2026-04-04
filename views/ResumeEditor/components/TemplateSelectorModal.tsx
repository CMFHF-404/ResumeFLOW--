import React from 'react';
import { Check, X } from 'lucide-react';
import {
  RESUME_TEMPLATE_DEFINITIONS,
  RESUME_THEME_COLOR_PRESETS,
  resolveDefaultResumeThemeColorPresetId,
  resolveResumeThemeColor,
  resolveResumeTemplate,
  type ResumeThemeColorPresetId,
  type ResumeTemplateId,
} from '../../../constants/resumeTemplates';

type TemplateSelectorModalProps = {
  isOpen: boolean;
  selectedTemplateId: ResumeTemplateId;
  themeColorPresetId: ResumeThemeColorPresetId;
  onClose: () => void;
  onSelectTemplate: (id: ResumeTemplateId) => void;
};

const TemplateThumbnail: React.FC<{
  templateId: ResumeTemplateId;
  themeColorPresetId?: string;
}> = ({ templateId, themeColorPresetId }) => {
  const resolvedPresetId = (themeColorPresetId && RESUME_THEME_COLOR_PRESETS.some((item) => item.id === themeColorPresetId))
    ? (themeColorPresetId as ResumeThemeColorPresetId)
    : resolveDefaultResumeThemeColorPresetId(templateId);
  const theme = resolveResumeThemeColor(templateId, resolvedPresetId);
  const template = resolveResumeTemplate(templateId);

  if (template.layoutKind === 'classic') {
    const isModernAvatar = templateId === 'modern-slate-avatar';
    return (
      <div className="h-full rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-950">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <div className="mb-2 h-1.5 w-20 rounded-full" style={{ backgroundColor: theme.accentColor }} />
            <div className="mb-1 h-2.5 w-16 rounded bg-gray-900/80" />
            <div className="mb-3 h-1 w-28 rounded bg-gray-200" />
          </div>
          {isModernAvatar && (
            <div className="h-10 w-7 rounded border border-gray-200 bg-gray-50 flex items-center justify-center">
              <div className="h-full w-full bg-gray-100" />
            </div>
          )}
        </div>
        <div className="space-y-2">
          {[0, 1, 2].map((item) => (
            <div key={item}>
              <div className="mb-1 flex items-center gap-1.5">
                {isModernAvatar && <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: theme.accentColor }} />}
                <div className="h-1.5 w-12 rounded-full" style={{ backgroundColor: theme.accentColor, opacity: isModernAvatar ? 0.7 : 1 }} />
              </div>
              <div className="h-1 w-full rounded bg-gray-200" />
              <div className="mt-1 h-1 w-4/5 rounded bg-gray-200" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (template.layoutKind === 'minimal') {
    return (
      <div className="h-full rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-950">
        <div className="mb-2 flex justify-center">
          <div className="h-2.5 w-20 rounded bg-gray-900/80" />
        </div>
        <div className="mb-3 flex justify-center">
          <div className="h-1 w-16 rounded-full" style={{ backgroundColor: theme.accentBorder }} />
        </div>
        <div className="space-y-3">
          {[0, 1, 2].map((item) => (
            <div key={item}>
              <div className="mb-1 h-1.5 w-10 rounded-full bg-gray-300" />
              <div className="h-1.5 w-full rounded bg-gray-200" />
              <div className="mt-1 h-1.5 w-3/4 rounded bg-gray-200" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (template.layoutKind === 'accent') {
    return (
      <div className="relative h-full overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-950">
        <div className="absolute left-0 right-0 top-0 h-[3px]" style={{ backgroundColor: theme.accentColor }} />
        <div className="p-3 pt-4">
          <div className="mb-3">
            <div className="mb-1.5 flex items-center">
              <div className="mr-1.5 h-2.5 w-1 rounded-[1px]" style={{ backgroundColor: theme.accentColor }} />
              <div className="h-2.5 w-16 rounded bg-gray-900/80" />
            </div>
            <div className="flex items-center gap-1.5 pl-2.5">
              <div className="h-1 w-12 rounded bg-gray-300/80" />
              <div className="h-1.5 w-[1px] bg-gray-300/50" />
              <div className="h-1 w-14 rounded bg-gray-300/80" />
            </div>
          </div>
          <div className="space-y-2.5">
            {[0, 1, 2].map((item) => (
              <div key={item}>
                <div className="mb-1.5 flex items-stretch">
                  <div className="w-[3px] shrink-0 rounded-l-[1px]" style={{ backgroundColor: theme.accentColor }} />
                  <div
                    className="flex flex-1 items-center px-1.5 py-0.5"
                    style={{ background: `linear-gradient(to right, ${theme.accentSoftBg}, transparent)` }}
                  >
                    <div className="h-1.5 w-12 rounded opacity-70" style={{ backgroundColor: theme.accentColor }} />
                  </div>
                </div>
                <div className="space-y-1.5 pl-[4.5px]">
                  <div className="h-1.5 w-full rounded bg-gray-200 dark:bg-gray-800" />
                  <div className="h-1.5 w-5/6 rounded bg-gray-200 dark:bg-gray-800" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (template.layoutKind === 'avatar') {
    return (
      <div className="h-full rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-950">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-1 h-2.5 w-16 rounded bg-gray-900/80" />
            <div className="h-1.5 w-full rounded bg-gray-200" />
          </div>
          <div className="h-10 w-7 rounded-md border border-gray-300 bg-gray-100" />
        </div>
        <div className="mb-3 h-1 rounded-full" style={{ backgroundColor: theme.accentColor }} />
        <div className="space-y-2">
          {[0, 1].map((item) => (
            <div key={item}>
              <div className="mb-1 h-1.5 w-12 rounded-full" style={{ backgroundColor: theme.accentColor }} />
              <div className="h-1.5 w-full rounded bg-gray-200" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-950">
      <div className="grid h-full grid-cols-[0.7fr_1.3fr]">
        <div className="p-3" style={{ backgroundColor: theme.accentSoftBg }}>
          <div className="mb-2 h-10 w-7 rounded-md border border-white/70 bg-white/80" />
          <div className="mb-1 h-1.5 w-10 rounded-full" style={{ backgroundColor: theme.accentColor }} />
          <div className="space-y-1">
            <div className="h-1.5 w-full rounded bg-white/80" />
            <div className="h-1.5 w-4/5 rounded bg-white/80" />
            <div className="h-1.5 w-3/5 rounded bg-white/80" />
          </div>
        </div>
        <div className="p-3">
          <div className="mb-2 h-2.5 w-[4.5rem] rounded bg-gray-900/80" />
          {[0, 1, 2].map((item) => (
            <div key={item} className="mb-2">
              <div className="mb-1 h-1.5 w-11 rounded-full" style={{ backgroundColor: theme.accentColor }} />
              <div className="h-1.5 w-full rounded bg-gray-200" />
              <div className="mt-1 h-1.5 w-3/4 rounded bg-gray-200" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const TemplateSelectorModal: React.FC<TemplateSelectorModalProps> = ({
  isOpen,
  selectedTemplateId,
  themeColorPresetId,
  onClose,
  onSelectTemplate,
}) => {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 px-4" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-gray-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">选择简历模板</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {RESUME_TEMPLATE_DEFINITIONS.map((template) => {
            const isSelected = template.id === selectedTemplateId;
            return (
              <article
                key={template.id}
                className={`flex h-full flex-col rounded-xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-900 ${isSelected ? 'ring-2 ring-primary' : ''}`}
              >
                <div className="mb-3 h-44 overflow-hidden">
                  <TemplateThumbnail
                    templateId={template.id}
                    themeColorPresetId={isSelected ? themeColorPresetId : undefined}
                  />
                </div>

                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{template.name}</h3>
                <p className="mt-1 min-h-[38px] text-xs text-gray-500 dark:text-gray-400">{template.description}</p>
                <button
                  type="button"
                  onClick={() => onSelectTemplate(template.id)}
                  className={`mt-auto inline-flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold ${isSelected ? 'bg-primary text-white' : 'border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'}`}
                >
                  {isSelected ? <Check className="h-3.5 w-3.5" /> : null}
                  {isSelected ? '已选中' : '选中此模板'}
                </button>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default TemplateSelectorModal;
