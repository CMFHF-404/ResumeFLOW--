import React from 'react';
import { Check, X } from 'lucide-react';
import {
  RESUME_TEMPLATE_DEFINITIONS,
  resolveResumeTemplate,
  type ResumeTemplateId,
} from '../../../constants/resumeTemplates';

type TemplateSelectorModalProps = {
  isOpen: boolean;
  selectedTemplateId: ResumeTemplateId;
  onClose: () => void;
  onSelectTemplate: (id: ResumeTemplateId) => void;
};

const TemplateSelectorModal: React.FC<TemplateSelectorModalProps> = ({
  isOpen,
  selectedTemplateId,
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
            const resolved = resolveResumeTemplate(template.id);
            return (
              <article
                key={template.id}
                className={`rounded-xl border p-3 ${template.cardClassName} ${isSelected ? 'ring-2 ring-primary' : ''}`}
              >
                <div className="mb-2 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-950">
                  <div className={`mb-2 flex ${resolved.headerClassName === 'text-center' ? 'justify-center' : 'justify-between'} items-center`}>
                    {template.hasAvatar ? (
                      <div className="mr-2 flex h-9 w-9 items-center justify-center rounded-full bg-gray-200 text-xs font-bold text-gray-600">
                        照片
                      </div>
                    ) : null}
                    <div className={`h-2 w-24 rounded ${resolved.headerClassName === 'text-center' ? '' : 'flex-1'}`} style={{ backgroundColor: template.accentColor }} />
                  </div>
                  <div className="space-y-1.5">
                    <div className="h-1.5 w-full rounded bg-gray-200" />
                    <div className="h-1.5 w-4/5 rounded bg-gray-200" />
                    <div className="h-1.5 w-3/4 rounded bg-gray-200" />
                  </div>
                </div>

                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{template.name}</h3>
                <p className="mt-1 min-h-[38px] text-xs text-gray-500 dark:text-gray-400">{template.description}</p>
                <button
                  type="button"
                  onClick={() => onSelectTemplate(template.id)}
                  className={`mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold ${isSelected ? 'bg-primary text-white' : 'border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'}`}
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
