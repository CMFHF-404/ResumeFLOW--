import React, { type Dispatch, type SetStateAction } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FileBadge2,
  PanelRightClose,
} from 'lucide-react';

import { AssistantDraftCardView } from './AssistantDraftCardView';
import type { AssistantDraftGroup, AssistantDraftMessageItem } from './sessionUtils';
import type { DraftPanelVersionState, DraftSurface } from './useAssistantDraftPanelState';

type DraftGroupViewProps = {
  group: AssistantDraftGroup;
  index: number;
  surface?: DraftSurface;
  versionState: DraftPanelVersionState;
  draftExpandedByGroupId: Record<string, boolean>;
  setDraftExpandedByGroupId: Dispatch<SetStateAction<Record<string, boolean>>>;
  appliedMessageIds: Set<string>;
  manualSaveMessageIds: Set<string>;
  applyingMessageIds: Set<string>;
  onApplyDraft: (item: AssistantDraftMessageItem) => void;
};

type DraftPanelProps = {
  draftGroups: AssistantDraftGroup[];
  draftCardCount: number;
  draftExpandedByGroupId: Record<string, boolean>;
  setDraftExpandedByGroupId: Dispatch<SetStateAction<Record<string, boolean>>>;
  getDraftVersionState: (surface: DraftSurface) => DraftPanelVersionState;
  appliedMessageIds: Set<string>;
  manualSaveMessageIds: Set<string>;
  applyingMessageIds: Set<string>;
  onApplyDraft: (item: AssistantDraftMessageItem) => void;
};

type MobileDraftTrayProps = DraftPanelProps & {
  isMobileDraftTrayOpen: boolean;
  setIsMobileDraftTrayOpen: Dispatch<SetStateAction<boolean>>;
};

type DesktopDraftPanelProps = DraftPanelProps & {
  isDraftPanelOpen: boolean;
  setIsDraftPanelOpen: Dispatch<SetStateAction<boolean>>;
};

const AssistantDraftGroupView: React.FC<DraftGroupViewProps> = ({
  group,
  index,
  surface = 'desktop',
  versionState,
  draftExpandedByGroupId,
  setDraftExpandedByGroupId,
  appliedMessageIds,
  manualSaveMessageIds,
  applyingMessageIds,
  onApplyDraft,
}) => {
  const latestVersionIndex = group.items.length - 1;
  const versionIndex = Math.min(
    Math.max(versionState.versionByGroupId[group.id] ?? latestVersionIndex, 0),
    latestVersionIndex,
  );
  const item = group.items[versionIndex] ?? group.latestItem;
  const isExpanded = draftExpandedByGroupId[group.id] ?? index === 0;
  const setVersionIndex = (nextIndex: number) => {
    versionState.setVersionByGroupId((current) => ({
      ...current,
      [group.id]: Math.min(Math.max(nextIndex, 0), latestVersionIndex),
    }));
  };

  return (
    <div key={group.id} className="transition-all duration-300 ease-out" data-draft-surface={surface}>
      <div className="relative">
        {group.items.length > 1 ? (
          <div className="absolute right-4 top-5 z-10 flex items-center rounded-2xl bg-slate-100/95 p-1 shadow-sm backdrop-blur dark:bg-slate-900/95">
            <button
              type="button"
              onClick={() => setVersionIndex(versionIndex - 1)}
              disabled={versionIndex <= 0}
              className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-slate-600 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
              title="上一版"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="min-w-10 text-center text-xs font-semibold text-slate-600 dark:text-slate-300">
              {versionIndex + 1}/{group.items.length}
            </div>
            <button
              type="button"
              onClick={() => setVersionIndex(versionIndex + 1)}
              disabled={versionIndex >= latestVersionIndex}
              className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-slate-600 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
              title="下一版"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        ) : null}
        <AssistantDraftCardView
          key={item.message.id}
          card={item.card}
          expanded={isExpanded}
          onExpandedChange={(expanded) => {
            setDraftExpandedByGroupId((current) => ({
              ...current,
              [group.id]: expanded,
            }));
          }}
          onApply={() => onApplyDraft(item)}
          disabled={appliedMessageIds.has(item.message.id) || manualSaveMessageIds.has(item.message.id)}
          isApplied={appliedMessageIds.has(item.message.id)}
          isApplying={applyingMessageIds.has(item.message.id)}
          isManualSaveMode={item.isManualSaveMode}
          showManualSaveHint={manualSaveMessageIds.has(item.message.id)}
          onJumpToEditor={item.onJumpToEditor}
        />
      </div>
    </div>
  );
};

export const AssistantMobileDraftTray: React.FC<MobileDraftTrayProps> = ({
  draftGroups,
  draftCardCount,
  isMobileDraftTrayOpen,
  setIsMobileDraftTrayOpen,
  getDraftVersionState,
  ...draftGroupProps
}) => {
  if (draftCardCount <= 0) {
    return null;
  }

  return (
    <div className="mb-2 md:hidden">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-[0_18px_50px_-34px_rgba(15,23,42,0.55)] backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <button
          type="button"
          onClick={() => setIsMobileDraftTrayOpen((current) => !current)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
          title={isMobileDraftTrayOpen ? '收起草稿' : '展开草稿'}
        >
          <span className="inline-flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">草稿</span>
            <span className="inline-flex min-w-6 shrink-0 items-center justify-center rounded-full bg-emerald-50 px-2 text-xs font-semibold leading-6 text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-500/20">
              {draftCardCount}
            </span>
          </span>
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200">
            {isMobileDraftTrayOpen ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronUp className="h-4 w-4" />
            )}
          </span>
        </button>
        <div
          className={`grid transition-all duration-300 ease-out ${
            isMobileDraftTrayOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          }`}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="max-h-[44vh] space-y-3 overflow-y-auto border-t border-slate-100 px-3 pb-3 dark:border-slate-800">
              {draftGroups.map((group, index) => (
                <AssistantDraftGroupView
                  key={group.id}
                  group={group}
                  index={index}
                  surface="mobile"
                  versionState={getDraftVersionState('mobile')}
                  {...draftGroupProps}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const AssistantDesktopDraftPanel: React.FC<DesktopDraftPanelProps> = ({
  draftGroups,
  draftCardCount,
  isDraftPanelOpen,
  setIsDraftPanelOpen,
  getDraftVersionState,
  ...draftGroupProps
}) => {
  if (draftCardCount <= 0) {
    return null;
  }

  return (
    <>
      {!isDraftPanelOpen ? (
        <button
          type="button"
          onClick={() => setIsDraftPanelOpen(true)}
          className="fixed right-5 top-5 z-40 hidden h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-white/95 text-slate-600 shadow-[0_18px_45px_-24px_rgba(15,23,42,0.45)] backdrop-blur transition hover:border-slate-300 hover:bg-white hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-white md:inline-flex"
          title="展开草稿"
        >
          <FileBadge2 className="h-5 w-5" />
          <span className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-semibold leading-5 text-white">
            {draftCardCount}
          </span>
        </button>
      ) : null}
      <aside
        aria-hidden={!isDraftPanelOpen}
        className={`hidden shrink-0 overflow-hidden bg-white/95 text-slate-900 shadow-[-18px_0_50px_-36px_rgba(15,23,42,0.32)] transition-[width,opacity,transform,border-color] duration-300 ease-out dark:bg-slate-950/95 dark:text-slate-100 md:flex md:flex-col ${
          isDraftPanelOpen
            ? 'w-[400px] translate-x-0 border-l border-slate-200/90 opacity-100 dark:border-slate-800'
            : 'pointer-events-none w-0 translate-x-8 border-l-0 opacity-0'
        }`}
      >
        <div className="flex h-full w-[400px] min-w-[400px] flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 dark:border-slate-800">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-500">Drafts</div>
              <div className="mt-1 truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                草稿
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setIsDraftPanelOpen(false)}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-600 transition hover:bg-slate-200 hover:text-slate-900 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                title="收起草稿"
              >
                <PanelRightClose className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-6 pt-1">
            {draftGroups.map((group, index) => (
              <AssistantDraftGroupView
                key={group.id}
                group={group}
                index={index}
                versionState={getDraftVersionState('desktop')}
                {...draftGroupProps}
              />
            ))}
          </div>
        </div>
      </aside>
    </>
  );
};
