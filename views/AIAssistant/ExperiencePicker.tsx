import React, { useEffect, useMemo, useState } from 'react';
import { Briefcase, Check, FolderKanban, GraduationCap, Search, X } from 'lucide-react';
import {
  MAX_ASSISTANT_SELECTED_EXPERIENCES,
  type AssistantSelectedExperience,
} from '../../services/aiService';

type ExperiencePickerProps = {
  isOpen: boolean;
  items: AssistantSelectedExperience[];
  selectedIds: string[];
  isLoading?: boolean;
  onClose: () => void;
  onConfirm: (masterIds: string[]) => void;
};

const CATEGORY_META = {
  work: { label: '工作经历', icon: Briefcase },
  project: { label: '项目经历', icon: FolderKanban },
  education: { label: '教育经历', icon: GraduationCap },
} as const;

const buildDateLabel = (item: AssistantSelectedExperience) => {
  const start = item.startDate || '时间待补充';
  const end = item.isCurrent ? '至今' : (item.endDate || '时间待补充');
  return `${start} - ${end}`;
};

export const ExperiencePicker: React.FC<ExperiencePickerProps> = ({
  isOpen,
  items,
  selectedIds,
  isLoading = false,
  onClose,
  onConfirm,
}) => {
  const [draftSelectedIds, setDraftSelectedIds] = useState<string[]>(selectedIds);
  const [keyword, setKeyword] = useState('');

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setDraftSelectedIds(selectedIds);
    setKeyword('');
  }, [isOpen, selectedIds]);

  const filteredItems = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) {
      return items;
    }
    return items.filter((item) => {
      const haystack = [
        item.org,
        item.title,
        item.summary,
        CATEGORY_META[item.category].label,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedKeyword);
    });
  }, [items, keyword]);

  const toggleItem = (masterId: string) => {
    setDraftSelectedIds((current) => (
      current.includes(masterId)
        ? current.filter((item) => item !== masterId)
        : current.length >= MAX_ASSISTANT_SELECTED_EXPERIENCES
          ? current
          : [...current, masterId]
    ));
  };

  if (!isOpen) {
    return null;
  }

  const content = (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">选择经历</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            可多选，AI 会优先参考这些经历，最多选择 {MAX_ASSISTANT_SELECTED_EXPERIENCES} 条。
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          aria-label="关闭经历选择器"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
          <Search className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索组织、岗位、项目名"
            className="w-full appearance-none border-0 bg-transparent text-sm text-slate-700 shadow-none outline-none ring-0 placeholder:text-slate-400 focus:border-0 focus:outline-none focus:ring-0 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {isLoading ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
            正在加载经历列表...
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
            没有找到可选经历
          </div>
        ) : (
          <div className="space-y-3">
            {filteredItems.map((item) => {
              const categoryMeta = CATEGORY_META[item.category];
              const isSelected = draftSelectedIds.includes(item.masterId);
              const CategoryIcon = categoryMeta.icon;
              return (
                <button
                  key={item.masterId}
                  type="button"
                  onClick={() => toggleItem(item.masterId)}
                  className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                    isSelected
                      ? 'border-emerald-300 bg-emerald-50 shadow-sm dark:border-emerald-500/40 dark:bg-emerald-950/35'
                      : draftSelectedIds.length >= MAX_ASSISTANT_SELECTED_EXPERIENCES
                        ? 'border-slate-200 bg-white opacity-60 dark:border-slate-700 dark:bg-slate-900'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:hover:border-slate-600 dark:hover:bg-slate-900'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl ${
                      isSelected ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300'
                    }`}>
                      <CategoryIcon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-white/90 px-2 py-1 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700">
                          {categoryMeta.label}
                        </span>
                        <span className="text-xs text-slate-400 dark:text-slate-500">{buildDateLabel(item)}</span>
                      </div>
                      <div className="mt-2 truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {item.org || '未填写组织'} / {item.title || '未填写角色'}
                      </div>
                      {item.summary ? (
                        <div className="mt-2 max-h-12 overflow-hidden text-sm leading-6 text-slate-600 dark:text-slate-400">
                          {item.summary}
                        </div>
                      ) : null}
                    </div>
                    <div className={`mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                      isSelected
                        ? 'border-emerald-500 bg-emerald-500 text-white'
                        : 'border-slate-300 bg-white text-transparent dark:border-slate-600 dark:bg-slate-900'
                    }`}>
                      <Check className="h-3.5 w-3.5" />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-4 dark:border-slate-800">
        <div className="text-sm text-slate-500 dark:text-slate-400">
          已选择 {draftSelectedIds.length} / {MAX_ASSISTANT_SELECTED_EXPERIENCES} 条经历
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => onConfirm(draftSelectedIds.slice(0, MAX_ASSISTANT_SELECTED_EXPERIENCES))}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            确认选择
          </button>
        </div>
      </div>
    </>
  );

  return (
    <>
      <div className="fixed inset-0 z-[120] hidden bg-black/45 md:block" onClick={onClose} />
      <div className="fixed inset-0 z-[121] hidden items-center justify-center px-4 md:flex">
        <div className="flex h-[78vh] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] bg-white shadow-[0_24px_80px_rgba(15,23,42,0.28)] dark:bg-slate-950 dark:shadow-[0_24px_80px_rgba(2,6,23,0.7)]">
          {content}
        </div>
      </div>

      <div className="fixed inset-0 z-[120] bg-black/35 backdrop-blur-[1px] md:hidden" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-[121] h-[78vh] rounded-t-[28px] border border-slate-200 bg-white shadow-[0_-24px_60px_rgba(15,23,42,0.22)] dark:border-slate-800 dark:bg-slate-950 dark:shadow-[0_-24px_60px_rgba(2,6,23,0.8)] md:hidden">
        <div className="mx-auto mt-3 h-1.5 w-14 rounded-full bg-slate-200 dark:bg-slate-700" />
        <div className="flex h-[calc(100%-18px)] flex-col">
          {content}
        </div>
      </div>
    </>
  );
};

export default ExperiencePicker;
