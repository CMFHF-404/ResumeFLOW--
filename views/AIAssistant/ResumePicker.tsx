import React, { useEffect, useMemo, useState } from 'react';
import {
  Briefcase,
  Check,
  FileText,
  FolderKanban,
  Search,
  Square,
  X,
} from 'lucide-react';
import type { AssistantSelectedResume } from '../../services/aiService';
import { buildDefaultResumeExperienceSelection } from './resumeSelectionUtils';

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
  selectedResume?: AssistantSelectedResume | null;
  isLoading?: boolean;
  isLoadingDetail?: boolean;
  isApplying?: boolean;
  onClose: () => void;
  onLoadDetail: (resumeId: string) => Promise<AssistantSelectedResume | null>;
  onConfirm: (resumeId: string, experienceIds: string[]) => void;
};

const buildMetaLabel = (item: ResumePickerItem) => {
  const meta = [
    item.targetRole?.trim() ? `目标岗位：${item.targetRole.trim()}` : '',
    item.hasJD ? '已关联 JD' : '未关联 JD',
  ].filter(Boolean);
  return meta.join(' · ');
};

const buildExperienceLabel = (item: AssistantSelectedResume['snapshot']['experiences'][number]) => {
  const org = item.org || '未填写组织';
  const title = item.title || '未填写角色';
  return `${org} / ${title}`;
};

export const ResumePicker: React.FC<ResumePickerProps> = ({
  isOpen,
  items,
  selectedId = null,
  selectedResume = null,
  isLoading = false,
  isLoadingDetail = false,
  isApplying = false,
  onClose,
  onLoadDetail,
  onConfirm,
}) => {
  const [draftSelectedId, setDraftSelectedId] = useState<string | null>(selectedId);
  const [draftResume, setDraftResume] = useState<AssistantSelectedResume | null>(selectedResume);
  const [draftExperienceIds, setDraftExperienceIds] = useState<string[]>([]);
  const [keyword, setKeyword] = useState('');

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setDraftSelectedId(selectedId);
    setKeyword('');
    setDraftResume(selectedResume?.resumeId === selectedId ? selectedResume : null);
    setDraftExperienceIds(
      selectedResume?.resumeId === selectedId && selectedResume.selection
        ? selectedResume.selection.experienceIds
        : buildDefaultResumeExperienceSelection(selectedResume),
    );
  }, [isOpen, selectedId, selectedResume]);

  useEffect(() => {
    if (!isOpen || !draftSelectedId) {
      return;
    }
    let cancelled = false;
    void onLoadDetail(draftSelectedId).then((loadedResume) => {
      if (cancelled) {
        return;
      }
      if (!loadedResume) {
        setDraftResume(null);
        setDraftExperienceIds([]);
        return;
      }
      setDraftResume(loadedResume);
      const shouldKeepExistingSelection = selectedResume?.resumeId === draftSelectedId && selectedResume.selection;
      setDraftExperienceIds(
        shouldKeepExistingSelection
          ? selectedResume.selection.experienceIds
          : buildDefaultResumeExperienceSelection(loadedResume),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [draftSelectedId, isOpen, onLoadDetail, selectedResume]);

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

  const resumeExperiences = draftResume?.snapshot.experiences ?? [];
  const selectedExperienceIdSet = useMemo(() => new Set(draftExperienceIds), [draftExperienceIds]);
  const hasEmptyExperienceSelection = resumeExperiences.length > 0 && draftExperienceIds.length === 0;
  const canConfirm = Boolean(draftSelectedId && draftResume) && !isApplying && !isLoadingDetail && !hasEmptyExperienceSelection;

  const toggleExperience = (experienceId: string) => {
    setDraftExperienceIds((current) => (
      current.includes(experienceId)
        ? current.filter((item) => item !== experienceId)
        : [...current, experienceId]
    ));
  };

  const toggleAllExperiences = () => {
    const allIds = buildDefaultResumeExperienceSelection(draftResume);
    setDraftExperienceIds((current) => (
      current.length === allIds.length ? [] : allIds
    ));
  };

  if (!isOpen) {
    return null;
  }

  const content = (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">选择简历与经历</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            先选一份简历，再勾选本轮对话要重点参考的简历内经历。
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

      <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] md:grid-rows-1">
        <div className="min-h-0 border-b border-slate-100 dark:border-slate-800 md:border-b-0 md:border-r">
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

          <div className="max-h-[30vh] overflow-y-auto px-5 py-4 md:max-h-none">
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
                      onClick={() => {
                        if (draftSelectedId !== item.id) {
                          setDraftResume(null);
                          setDraftExperienceIds([]);
                        }
                        setDraftSelectedId(item.id);
                      }}
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
        </div>

        <div className="min-h-0 overflow-y-auto px-5 py-4">
          {!draftSelectedId ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              请选择一份简历后再勾选经历
            </div>
          ) : isLoadingDetail || !draftResume ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              正在加载简历经历...
            </div>
          ) : resumeExperiences.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              这份简历暂无可单独选择的工作/项目经历，将带入教育、证书和技能内容。
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">简历内经历</div>
                  <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    已选择 {draftExperienceIds.length} / {resumeExperiences.length} 段
                  </div>
                </div>
                <button
                  type="button"
                  onClick={toggleAllExperiences}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-white"
                >
                  {draftExperienceIds.length === resumeExperiences.length ? '取消全选' : '全选'}
                </button>
              </div>
              {hasEmptyExperienceSelection ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                  至少保留一段简历内经历，AI 才能聚焦这份简历。
                </div>
              ) : null}
              {resumeExperiences.map((item) => {
                const isSelected = selectedExperienceIdSet.has(item.id);
                const Icon = item.org ? Briefcase : FolderKanban;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggleExperience(item.id)}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                      isSelected
                        ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-950/35'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:hover:border-slate-600 dark:hover:bg-slate-900'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
                        isSelected ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300'
                      }`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {buildExperienceLabel(item)}
                        </div>
                        <div className="mt-1 max-h-10 overflow-hidden text-xs leading-5 text-slate-500 dark:text-slate-400">
                          {[item.star.s, item.star.t, item.star.a, item.star.r].filter(Boolean).join(' ') || '这段经历暂无 STAR 详情'}
                        </div>
                      </div>
                      <div className={`mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                        isSelected
                          ? 'border-emerald-500 bg-emerald-500 text-white'
                          : 'border-slate-300 bg-white text-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-600'
                      }`}>
                        {isSelected ? <Check className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-4 dark:border-slate-800">
        <div className="text-sm text-slate-500 dark:text-slate-400">
          {draftSelectedId
            ? resumeExperiences.length > 0
              ? `已选择 1 份简历，${draftExperienceIds.length} 段经历`
              : '已选择 1 份简历'
            : '请选择 1 份简历'}
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
            disabled={!canConfirm}
            onClick={() => {
              if (draftSelectedId && canConfirm) {
                onConfirm(draftSelectedId, draftExperienceIds);
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
        <div className="flex h-[78vh] w-full max-w-4xl flex-col overflow-hidden rounded-[28px] bg-white shadow-[0_24px_80px_rgba(15,23,42,0.28)] dark:bg-slate-950 dark:shadow-[0_24px_80px_rgba(2,6,23,0.7)]">
          {content}
        </div>
      </div>

      <div className="fixed inset-0 z-[120] bg-black/35 backdrop-blur-[1px] md:hidden" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-[121] h-[82vh] rounded-t-[28px] border border-slate-200 bg-white shadow-[0_-24px_60px_rgba(15,23,42,0.22)] dark:border-slate-800 dark:bg-slate-950 dark:shadow-[0_-24px_60px_rgba(2,6,23,0.8)] md:hidden">
        <div className="mx-auto mt-3 h-1.5 w-14 rounded-full bg-slate-200 dark:bg-slate-700" />
        <div className="flex h-[calc(100%-18px)] flex-col">
          {content}
        </div>
      </div>
    </>
  );
};

export default ResumePicker;
