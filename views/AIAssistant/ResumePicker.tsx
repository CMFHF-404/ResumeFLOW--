import React, { useEffect, useMemo, useState } from 'react';
import { Check, FileText, Search, X } from 'lucide-react';

export type ResumePickerItem = {
  id: string;
  title: string;
  targetRole?: string;
  updatedAt?: string;
  hasJD: boolean;
};

type ResumePickerProps = {
  isOpen: boolean;
  items: ResumePickerItem[];
  selectedId?: string | null;
  isLoading?: boolean;
  isApplying?: boolean;
  onClose: () => void;
  onConfirm: (resumeId: string) => void;
};

const buildMetaLabel = (item: ResumePickerItem) => {
  const meta = [
    item.targetRole?.trim() ? `目标岗位：${item.targetRole.trim()}` : '',
    item.hasJD ? '已关联 JD' : '未关联 JD',
  ].filter(Boolean);
  return meta.join(' · ');
};

export const ResumePicker: React.FC<ResumePickerProps> = ({
  isOpen,
  items,
  selectedId = null,
  isLoading = false,
  isApplying = false,
  onClose,
  onConfirm,
}) => {
  const [draftSelectedId, setDraftSelectedId] = useState<string | null>(selectedId);
  const [keyword, setKeyword] = useState('');

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setDraftSelectedId(selectedId);
    setKeyword('');
  }, [isOpen, selectedId]);

  const filteredItems = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) {
      return items;
    }
    return items.filter((item) => {
      const haystack = [item.title, item.targetRole, item.hasJD ? '已关联 JD' : '未关联 JD']
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedKeyword);
    });
  }, [items, keyword]);

  if (!isOpen) {
    return null;
  }

  const content = (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">选择简历</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            单选一份简历，AI 会在本轮对话里带入该简历和对应 JD。
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          aria-label="关闭简历选择器"
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
            placeholder="搜索简历名称或目标岗位"
            className="w-full appearance-none border-0 bg-transparent text-sm text-slate-700 shadow-none outline-none ring-0 placeholder:text-slate-400 focus:border-0 focus:outline-none focus:ring-0 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {isLoading ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
            正在加载简历列表...
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
            没有找到可选简历
          </div>
        ) : (
          <div className="space-y-3">
            {filteredItems.map((item) => {
              const isSelected = draftSelectedId === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setDraftSelectedId(item.id)}
                  className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                    isSelected
                      ? 'border-sky-300 bg-sky-50 shadow-sm dark:border-sky-500/40 dark:bg-sky-950/35'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:hover:border-slate-600 dark:hover:bg-slate-900'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl ${
                      isSelected ? 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300'
                    }`}>
                      <FileText className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {item.title || '未命名简历'}
                      </div>
                      <div className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
                        {buildMetaLabel(item)}
                      </div>
                    </div>
                    <div className={`mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                      isSelected
                        ? 'border-sky-500 bg-sky-500 text-white'
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
          {draftSelectedId ? '已选择 1 份简历' : '请选择 1 份简历'}
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
            disabled={!draftSelectedId || isApplying}
            onClick={() => {
              if (draftSelectedId) {
                onConfirm(draftSelectedId);
              }
            }}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isApplying ? '带入中...' : '确认选择'}
          </button>
        </div>
      </div>
    </>
  );

  return (
    <>
      <div className="fixed inset-0 z-[120] hidden bg-black/45 md:block" onClick={onClose} />
      <div className="fixed inset-0 z-[121] hidden items-center justify-center px-4 md:flex">
        <div className="flex h-[72vh] w-full max-w-2xl flex-col overflow-hidden rounded-[28px] bg-white shadow-[0_24px_80px_rgba(15,23,42,0.28)] dark:bg-slate-950 dark:shadow-[0_24px_80px_rgba(2,6,23,0.7)]">
          {content}
        </div>
      </div>

      <div className="fixed inset-0 z-[120] bg-black/35 backdrop-blur-[1px] md:hidden" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-[121] h-[72vh] rounded-t-[28px] border border-slate-200 bg-white shadow-[0_-24px_60px_rgba(15,23,42,0.22)] dark:border-slate-800 dark:bg-slate-950 dark:shadow-[0_-24px_60px_rgba(2,6,23,0.8)] md:hidden">
        <div className="mx-auto mt-3 h-1.5 w-14 rounded-full bg-slate-200 dark:bg-slate-700" />
        <div className="flex h-[calc(100%-18px)] flex-col">
          {content}
        </div>
      </div>
    </>
  );
};

export default ResumePicker;
