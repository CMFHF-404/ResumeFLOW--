import React from 'react';
import {
  FileSearch,
  History,
  Maximize2,
  X,
} from 'lucide-react';

type AssistantSidebarHeaderProps = {
  title: string;
  isHistoryOpen: boolean;
  onToggleHistory: () => void;
  onExpandToFullPage?: () => void;
  onOpenAnalysisDetails?: () => void;
  onClose?: () => void;
};

const SIDEBAR_ACTION_BUTTON_CLASS = 'pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 dark:text-slate-400 dark:hover:text-white';
const SIDEBAR_ANALYSIS_BUTTON_CLASS = 'pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 text-white shadow-sm shadow-emerald-500/25 transition hover:bg-emerald-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 dark:bg-emerald-500 dark:text-white dark:hover:bg-emerald-400';
const SIDEBAR_ANALYSIS_BUTTON_STYLE: React.CSSProperties = {
  backgroundColor: '#10b981',
  color: '#fff',
};

export const AssistantSidebarHeader: React.FC<AssistantSidebarHeaderProps> = ({
  title,
  isHistoryOpen,
  onToggleHistory,
  onExpandToFullPage,
  onOpenAnalysisDetails,
  onClose,
}) => (
  <div className="shrink-0 border-b border-slate-200/90 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
    <div className="flex min-w-0 items-center justify-between gap-3">
      <div className="min-w-0 truncate text-sm font-semibold text-slate-900 dark:text-slate-100" title={title}>
        {title}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onToggleHistory}
          className={isHistoryOpen
            ? 'pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 transition hover:bg-emerald-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 dark:bg-emerald-500/15 dark:text-emerald-200 dark:hover:bg-emerald-500/25'
            : SIDEBAR_ACTION_BUTTON_CLASS
          }
          title={isHistoryOpen ? '关闭对话记录' : '打开对话记录'}
          aria-label={isHistoryOpen ? '关闭对话记录' : '打开对话记录'}
          aria-controls="assistant-sidebar-history-panel"
          aria-expanded={isHistoryOpen}
        >
          <History className="h-4 w-4" />
        </button>
        {onOpenAnalysisDetails ? (
          <button
            type="button"
            onClick={onOpenAnalysisDetails}
            className={SIDEBAR_ANALYSIS_BUTTON_CLASS}
            style={SIDEBAR_ANALYSIS_BUTTON_STYLE}
            title="查看分析详情"
            aria-label="查看分析详情"
          >
            <FileSearch className="h-4 w-4" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={onExpandToFullPage}
          className={SIDEBAR_ACTION_BUTTON_CLASS}
          title="展开到 AI 助手"
          aria-label="展开到 AI 助手"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onClose}
          className={SIDEBAR_ACTION_BUTTON_CLASS}
          title="关闭 AI 侧栏"
          aria-label="关闭 AI 侧栏"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  </div>
);
