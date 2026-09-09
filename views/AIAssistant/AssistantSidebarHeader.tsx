import React from 'react';
import {
  FileSearch,
  ChevronDown,
  Maximize2,
  MessageSquarePlus,
  X,
} from 'lucide-react';

type AssistantSidebarHeaderProps = {
  compact?: boolean;
  title: string;
  isHistoryOpen: boolean;
  onNewChat?: () => void;
  onToggleHistory: () => void;
  onExpandToFullPage?: () => void;
  onOpenAnalysisDetails?: () => void;
  onClose?: () => void;
};

const SIDEBAR_ACTION_BUTTON_CLASS = 'pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 dark:text-slate-400 dark:hover:text-white';
const SIDEBAR_ANALYSIS_BUTTON_CLASS = 'pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-emerald-600 transition hover:text-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 dark:text-emerald-300 dark:hover:text-emerald-200';

export const AssistantSidebarHeader: React.FC<AssistantSidebarHeaderProps> = ({
  compact = false,
  title,
  isHistoryOpen,
  onNewChat,
  onToggleHistory,
  onExpandToFullPage,
  onOpenAnalysisDetails,
  onClose,
}) => (
  <div className={`shrink-0 border-b border-slate-200/90 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90 ${compact ? 'px-3 py-1 [&_button]:min-h-11 [&_button]:min-w-11' : 'px-4 py-3'}`}>
    <div className="flex min-w-0 items-center justify-between gap-3">
      <button
        type="button"
        onClick={onToggleHistory}
        className="inline-flex min-w-0 items-center gap-1 rounded-lg py-1 text-sm font-semibold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 dark:text-slate-100"
        title={title}
        aria-label={isHistoryOpen ? '关闭对话记录' : '打开对话记录'}
        aria-controls="assistant-sidebar-history-panel"
        aria-expanded={isHistoryOpen}
      >
        <span className="truncate">{title}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${isHistoryOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      <div className="flex shrink-0 items-center gap-1">
        {onOpenAnalysisDetails && !compact ? (
          <button
            type="button"
            onClick={onOpenAnalysisDetails}
            className={SIDEBAR_ANALYSIS_BUTTON_CLASS}
            title="查看分析详情"
            aria-label="查看分析详情"
          >
            <FileSearch className="h-4 w-4" />
          </button>
        ) : null}
        {onNewChat ? (
          <button
            type="button"
            onClick={onNewChat}
            className={SIDEBAR_ACTION_BUTTON_CLASS}
            title="新建对话"
            aria-label="新建对话"
          >
            <MessageSquarePlus className="h-4 w-4" />
          </button>
        ) : null}
        {!compact ? <button
          type="button"
          onClick={onExpandToFullPage}
          className={SIDEBAR_ACTION_BUTTON_CLASS}
          title="展开到 AI 助手"
          aria-label="展开到 AI 助手"
        >
          <Maximize2 className="h-4 w-4" />
        </button> : null}
        {!compact ? <button
          type="button"
          onClick={onClose}
          className={SIDEBAR_ACTION_BUTTON_CLASS}
          title="关闭 AI 侧栏"
          aria-label="关闭 AI 侧栏"
        >
          <X className="h-4 w-4" />
        </button> : null}
      </div>
    </div>
  </div>
);
